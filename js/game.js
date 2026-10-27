/**
 * Manhunt Core Game Engine & State Machine
 * Handles role-based visibility, grace period head start, 5-minute runner ping cycle,
 * proximity alarms, tag detection, and match victory conditions.
 */
class ManhuntGame {
  constructor() {
    this.state = 'LOBBY'; // LOBBY, WAITING, GRACE_PERIOD, ACTIVE, GAME_OVER
    this.role = 'runner'; // 'runner' or 'seeker'
    this.nickname = 'Player';
    this.isHost = false;
    this.roomCode = '';

    // Match Timers & Intervals
    this.gracePeriodRemaining = 0;
    this.gameTimeRemaining = 0;
    this.runnerPingCountdown = 0;
    this.lastRunnerPingTime = 0;
    this.gameLoopInterval = null;

    // Player state
    this.isTagged = false;
    this.isPaused = false;
    this.taggedRunners = new Set();
    this.activeRunners = new Set();
    this.activeSeekers = new Set();
    this.matchStartTimestamp = 0;
    this.lockedTargetId = null;
    this.seekerPingCountdown = 0;

    // Telemetry cache
    this.lastKnownPositions = new Map(); // id -> { lat, lng, role, timestamp }
    this.lastSelfCoords = null;

    // Audio & sensory state
    this.lastProximityAlertTime = 0;
    this.nearestOpponentDistance = null;
    this.nearestOpponentBearing = null;
    this.nearestOpponentName = '';
  }

  init() {
    this.setupNetworkListeners();
    this.setupGeoListeners();
  }

  setupNetworkListeners() {
    Network.on('connected', (info) => {
      console.log('Network connected mode:', info.mode);
      UI.updateConnectionBadge(true, info.mode);
    });

    Network.on('disconnected', (info) => {
      UI.updateConnectionBadge(false);
    });

    Network.on('player_joined', (peer) => {
      this.updatePlayerRoster();
      UI.showToast(`${peer.nickname} joined as ${peer.role.toUpperCase()}`, 'info');
      UI.playAudioCue('join');
    });

    Network.on('player_left', (peer) => {
      this.updatePlayerRoster();
      MapController.removePeer(peer.playerId);
      UI.showToast(`${peer.nickname} left the room`, 'warning');
    });

    Network.on('game_started', (data) => {
      this.onGameStartedRemote(data);
    });

    Network.on('host_command', (data) => {
      this.handleHostCommand(data);
    });

    Network.on('telemetry', (data) => {
      this.onRemoteTelemetry(data);
    });

    Network.on('tag_event', (data) => {
      this.onRemoteTag(data);
    });

    Network.on('settings_synced', (newSettings) => {
      Config.save(newSettings);
      UI.populateSettingsUI();
      UI.updateLobbyRulesDisplay(newSettings);
      UI.showToast('Host updated match settings', 'info');
    });
  }

  setupGeoListeners() {
    Geo.onLocationUpdate((coords) => {
      this.lastSelfCoords = coords;
      MapController.updateSelfLocation(coords.lat, coords.lng, this.role, coords.heading);

      if (this.state === 'ACTIVE' || this.state === 'GRACE_PERIOD') {
        this.processLocationTick(coords);
      }
    });

    Geo.onError((err) => {
      console.warn('GPS Error:', err.message);
      UI.showToast(`GPS Warning: ${err.message}`, 'warning');
    });
  }

  /**
   * Host creates a new room
   */
  createRoom(nickname, role) {
    this.roomCode = NetworkEngine.generateRoomCode();
    this.nickname = nickname || 'Host';
    this.role = role || 'runner';
    this.isHost = true;
    this.state = 'WAITING';

    Network.connect(this.roomCode, this.nickname, this.role, true);
    UI.showScreen('screen-waiting');
    UI.setRoomCodeDisplay(this.roomCode);
    this.updatePlayerRoster();

    // Start GPS tracking
    Geo.startTracking();
  }

  /**
   * Player joins an existing room
   */
  joinRoom(roomCode, nickname, role) {
    this.roomCode = roomCode.toUpperCase().trim();
    this.nickname = nickname || 'Player';
    this.role = role || 'runner';
    this.isHost = false;
    this.state = 'WAITING';

    Network.connect(this.roomCode, this.nickname, this.role, false);
    UI.showScreen('screen-waiting');
    UI.setRoomCodeDisplay(this.roomCode);
    this.updatePlayerRoster();

    Geo.startTracking();
  }

  /**
   * Switch roles in lobby
   */
  setRole(newRole) {
    this.role = newRole;
    Network.role = newRole;
    Network.sendPresence();
    this.updatePlayerRoster();
  }

  updatePlayerRoster() {
    const list = [];
    // Add self
    list.push({
      id: Network.playerId,
      nickname: this.nickname + ' (You)',
      role: this.role,
      isHost: this.isHost
    });

    for (const [id, peer] of Network.peers.entries()) {
      list.push(peer);
    }

    this.activeRunners.clear();
    this.activeSeekers.clear();

    list.forEach(p => {
      if (p.role === 'runner') this.activeRunners.add(p.id);
      else if (p.role === 'seeker') this.activeSeekers.add(p.id);
    });

    UI.renderLobbyRoster(list, this.isHost);
  }

  /**
   * Host starts the match
   */
  startMatch() {
    if (!this.isHost) return;

    const matchConfig = {
      seekerTrackingMode: Config.settings.seekerTrackingMode,
      gracePeriod: Config.settings.gracePeriod,
      gameDuration: Config.settings.gameDuration,
      runnerPingInterval: Config.settings.runnerPingInterval,
      boundaryRadiusMeters: Config.settings.boundaryRadiusMeters,
      startTimestamp: Date.now()
    };

    Network.broadcast('start_game', matchConfig);
    this.onGameStartedRemote(matchConfig);
  }

  onGameStartedRemote(data) {
    if (data.seekerTrackingMode) Config.settings.seekerTrackingMode = data.seekerTrackingMode;
    if (data.gracePeriod !== undefined) Config.settings.gracePeriod = data.gracePeriod;
    if (data.gameDuration !== undefined) Config.settings.gameDuration = data.gameDuration;
    if (data.runnerPingInterval !== undefined) Config.settings.runnerPingInterval = data.runnerPingInterval;
    if (data.boundaryRadiusMeters !== undefined) Config.settings.boundaryRadiusMeters = data.boundaryRadiusMeters;

    this.matchStartTimestamp = data.startTimestamp;
    this.gracePeriodRemaining = Config.settings.gracePeriod;
    this.gameTimeRemaining = Config.settings.gameDuration;
    this.runnerPingCountdown = Config.settings.runnerPingInterval;
    this.seekerPingCountdown = Config.settings.seekerTrackingMode === 'live' ? 0 : parseInt(Config.settings.seekerTrackingMode, 10);
    this.isTagged = false;
    this.isPaused = false;
    this.taggedRunners.clear();

    // Initialize tactical map with self location if available
    if (this.lastSelfCoords) {
      MapController.init(this.lastSelfCoords.lat, this.lastSelfCoords.lng);
      MapController.updateSelfLocation(this.lastSelfCoords.lat, this.lastSelfCoords.lng, this.role);
      if (Config.settings.boundaryRadiusMeters > 0) {
        MapController.setBoundary(this.lastSelfCoords.lat, this.lastSelfCoords.lng, Config.settings.boundaryRadiusMeters);
      }
    } else {
      MapController.init();
    }

    UI.showScreen('screen-hud');
    UI.updateHostButtons(this.isHost);
    UI.requestWakeLock();
    MapController.invalidate();
    setTimeout(() => {
      MapController.invalidate();
      MapController.fitAll();
    }, 350);

    if (this.gracePeriodRemaining > 0) {
      this.state = 'GRACE_PERIOD';
      UI.setGracePeriodState(true, this.gracePeriodRemaining, this.role);
      UI.playAudioCue('siren');
      UI.showToast(`Grace Period Active! Runners have ${Math.round(this.gracePeriodRemaining / 60)}m head start!`, 'info');
    } else {
      this.beginActiveHunt();
    }

    this.startGameLoop();
  }

  beginActiveHunt() {
    this.state = 'ACTIVE';
    UI.setGracePeriodState(false);
    UI.playAudioCue('start');
    UI.showToast('THE HUNT HAS BEGUN! Seekers are released!', 'danger');

    // Trigger initial runner ping immediately at game start
    if (this.role === 'runner' && this.lastSelfCoords) {
      this.broadcastRunnerPing(this.lastSelfCoords);
    }
  }

  startGameLoop() {
    if (this.gameLoopInterval) clearInterval(this.gameLoopInterval);

    this.gameLoopInterval = setInterval(() => {
      this.tick();
    }, 1000);
  }

  tick() {
    if (this.isPaused) return;

    // 1. Grace period countdown
    if (this.state === 'GRACE_PERIOD') {
      this.gracePeriodRemaining--;
      UI.updateGraceCountdown(this.gracePeriodRemaining);
      if (this.gracePeriodRemaining <= 0) {
        this.beginActiveHunt();
      }
      return;
    }

    if (this.state !== 'ACTIVE') return;

    // 2. Overall game duration countdown
    if (this.gameTimeRemaining > 0) {
      this.gameTimeRemaining--;
      UI.updateMatchTimeRemaining(this.gameTimeRemaining);
      if (this.gameTimeRemaining <= 0) {
        this.endGame('time_expired');
        return;
      }
    }

    // 3. Runner Ping Countdown (reveals runner coordinates periodically)
    this.runnerPingCountdown--;
    UI.updatePingCountdown(this.runnerPingCountdown, Config.settings.runnerPingInterval, this.role);

    if (this.runnerPingCountdown <= 0) {
      this.runnerPingCountdown = Config.settings.runnerPingInterval;
      if (this.role === 'runner' && !this.isTagged && this.lastSelfCoords) {
        this.broadcastRunnerPing(this.lastSelfCoords);
      }
    }

    // 4. Seeker Tracking (Live vs Periodic Ping)
    if (this.role === 'seeker' && this.lastSelfCoords) {
      if (Config.settings.seekerTrackingMode === 'live') {
        if (Date.now() - (this.lastSeekerSend || 0) >= (Config.settings.seekerPingInterval * 1000)) {
          this.lastSeekerSend = Date.now();
          Network.broadcast('telemetry', {
            lat: this.lastSelfCoords.lat,
            lng: this.lastSelfCoords.lng,
            role: 'seeker',
            speed: this.lastSelfCoords.speed,
            heading: this.lastSelfCoords.heading,
            timestamp: Date.now()
          });
        }
      } else {
        const seekerInterval = parseInt(Config.settings.seekerTrackingMode, 10);
        this.seekerPingCountdown--;
        if (this.seekerPingCountdown <= 0) {
          this.seekerPingCountdown = seekerInterval;
          Network.broadcast('telemetry', {
            lat: this.lastSelfCoords.lat,
            lng: this.lastSelfCoords.lng,
            role: 'seeker',
            isPingSnapshot: true,
            speed: this.lastSelfCoords.speed,
            heading: this.lastSelfCoords.heading,
            timestamp: Date.now()
          });
          UI.playAudioCue('ping');
          UI.showToast('📍 Seeker periodic ping broadcasted!', 'warning');
        }
      }
    }

    // 5. Evaluate distances & Proximity Alert
    this.evaluateDistances();
  }

  /**
   * Broadcast a Runner ping snapshot to all players
   */
  broadcastRunnerPing(coords) {
    this.lastRunnerPingTime = Date.now();
    Network.broadcast('telemetry', {
      lat: coords.lat,
      lng: coords.lng,
      role: 'runner',
      isPingSnapshot: true,
      timestamp: Date.now()
    });

    UI.playAudioCue('ping');
    UI.triggerPingPulseAnimation();
    UI.showToast('📍 Runner location ping broadcasted!', 'warning');
  }

  /**
   * Process local location update
   */
  processLocationTick(coords) {
    this.lastSelfCoords = coords;
    if (this.isPaused) return;

    // If seeker and in live mode, send immediate telemetry if enough delta
    if (this.role === 'seeker' && this.state === 'ACTIVE' && Config.settings.seekerTrackingMode === 'live') {
      const now = Date.now();
      if (now - (this.lastSeekerSend || 0) >= (Config.settings.seekerPingInterval * 1000)) {
        this.lastSeekerSend = now;
        Network.broadcast('telemetry', {
          lat: coords.lat,
          lng: coords.lng,
          role: 'seeker',
          speed: coords.speed,
          heading: coords.heading,
          timestamp: now
        });
      }
    }
  }

  /**
   * Process remote telemetry packet
   */
  onRemoteTelemetry(data) {
    const { playerId, lat, lng, role, isPingSnapshot, isReconSweep, nickname } = data;
    this.lastKnownPositions.set(playerId, { lat, lng, role, timestamp: Date.now(), nickname });

    if (role === 'runner') {
      this.activeRunners.add(playerId);
    } else if (role === 'seeker') {
      this.activeSeekers.add(playerId);
    }

    const isLiveSeeker = Config.settings.seekerTrackingMode === 'live';
    if (role === 'seeker') {
      if (isLiveSeeker || isPingSnapshot || isReconSweep || this.role === 'seeker') {
        MapController.updatePeerLocation(playerId, lat, lng, 'seeker', nickname || 'Seeker', isPingSnapshot || isReconSweep);
      }
    } else if (role === 'runner') {
      if (isPingSnapshot || isReconSweep || this.role === 'runner') {
        MapController.updatePeerLocation(playerId, lat, lng, 'runner', nickname || 'Runner', true);
        if (isPingSnapshot || isReconSweep) {
          UI.playAudioCue('radar-blip');
          UI.showToast(`🚨 Runner ping revealed: ${nickname || 'Runner'}!`, 'info');
        }
      }
    }

    this.evaluateDistances();
  }

  /**
   * Seeker selects a specific runner target
   */
  selectTarget(targetId, targetNickname = null) {
    this.lockedTargetId = targetId;
    if (targetId) {
      UI.showToast(`🎯 Locked onto: ${targetNickname || 'Target'}`, 'info');
    } else {
      UI.showToast('🎯 Radar tracking closest runner (Auto)', 'info');
    }

    // Refresh active runner markers on map to reflect target lock beacon
    for (const [id, pos] of this.lastKnownPositions.entries()) {
      if (pos.role === 'runner') {
        MapController.updatePeerLocation(id, pos.lat, pos.lng, 'runner', pos.nickname || 'Runner', false);
      }
    }

    this.evaluateDistances();
  }

  /**
   * Host mission control actions
   */
  sendHostCommand(cmd, data = {}) {
    if (!this.isHost) return;
    const packet = { cmd, data, timestamp: Date.now() };
    Network.broadcast('host_command', packet);
    this.handleHostCommand(packet);
  }

  handleHostCommand(packet) {
    if (!packet) return;
    const { cmd, data } = packet;

    if (cmd === 'pause') {
      this.isPaused = true;
      UI.setPauseState(true, this.isHost);
      UI.playAudioCue('warning');
      UI.showToast('⏸️ Operation suspended by Host', 'warning');
    } else if (cmd === 'resume') {
      this.isPaused = false;
      UI.setPauseState(false, this.isHost);
      UI.playAudioCue('start');
      UI.showToast('▶️ Operation resumed by Host', 'info');
    } else if (cmd === 'recon_sweep') {
      UI.playAudioCue('siren');
      UI.showToast('🛰️ Satellite recon sweep active! All coordinates revealed!', 'danger');
      if (this.lastSelfCoords) {
        Network.broadcast('telemetry', {
          lat: this.lastSelfCoords.lat,
          lng: this.lastSelfCoords.lng,
          role: this.role,
          isPingSnapshot: true,
          isReconSweep: true,
          timestamp: Date.now()
        });
        MapController.triggerPingWave(this.lastSelfCoords.lat, this.lastSelfCoords.lng, this.role === 'seeker' ? '#ff4757' : '#00f5b4');
      }
    } else if (cmd === 'emergency_stop') {
      this.isPaused = false;
      UI.setPauseState(false, this.isHost);
      this.leaveMatch();
      UI.showToast(`🛑 Operation terminated by Host: ${data && data.reason ? data.reason : 'Host aborted match'}`, 'danger');
      UI.playAudioCue('tag');
    }
  }

  /**
   * Calculate distances to opponents, evaluate proximity alarms, locked targets, and tag ranges
   */
  evaluateDistances() {
    if (!this.lastSelfCoords || this.state !== 'ACTIVE') return;

    const selfLat = this.lastSelfCoords.lat;
    const selfLng = this.lastSelfCoords.lng;
    let closestDistance = Infinity;
    let closestBearing = 0;
    let closestOpponent = null;
    let tagCandidate = null;

    const isSeeker = this.role === 'seeker';
    const runnerTargets = [];

    for (const [id, pos] of this.lastKnownPositions.entries()) {
      if (isSeeker) {
        // Seekers look for active, untagged Runners
        if (pos.role === 'runner' && !this.taggedRunners.has(id)) {
          const dist = GeoEngine.getDistance(selfLat, selfLng, pos.lat, pos.lng);
          const bearing = GeoEngine.getBearing(selfLat, selfLng, pos.lat, pos.lng);
          const targetObj = { id, nickname: pos.nickname || 'Runner', distance: dist, bearing: bearing };
          runnerTargets.push(targetObj);

          if (this.lockedTargetId === id) {
            closestOpponent = targetObj;
            closestDistance = dist;
            closestBearing = bearing;
          }
        }
      } else {
        // Runners watch for Seekers
        if (pos.role === 'seeker') {
          const dist = GeoEngine.getDistance(selfLat, selfLng, pos.lat, pos.lng);
          if (dist < closestDistance) {
            closestDistance = dist;
            closestBearing = GeoEngine.getBearing(selfLat, selfLng, pos.lat, pos.lng);
            closestOpponent = { id, nickname: pos.nickname || 'Seeker', distance: dist, bearing: closestBearing };
          }
        }
      }
    }

    if (isSeeker) {
      runnerTargets.sort((a, b) => a.distance - b.distance);

      // If no locked target, or locked target is no longer active, fallback to closest runner
      if (!closestOpponent && runnerTargets.length > 0) {
        closestOpponent = runnerTargets[0];
        closestDistance = closestOpponent.distance;
        closestBearing = closestOpponent.bearing;
      }

      // Check Tag Range for Seeker
      if (closestOpponent && closestOpponent.distance <= Config.settings.tagDistanceMeters) {
        tagCandidate = closestOpponent;
      }

      // Update Target Selector Menu & pill
      UI.renderTargetList(runnerTargets, this.lockedTargetId);
    }

    this.nearestOpponentDistance = closestDistance !== Infinity ? closestDistance : null;
    this.nearestOpponentBearing = closestBearing;

    // Update Proximity HUD
    UI.updateProximityHUD(closestDistance !== Infinity ? closestDistance : null, closestBearing, closestOpponent, this.lockedTargetId !== null);

    // Seeker Tag Action Button trigger
    if (isSeeker) {
      UI.updateTagButtonState(tagCandidate);
    }

    // Runner Proximity Warning Alarm (Beep / Haptic)
    if (!isSeeker && closestDistance <= Config.settings.proximityAlertMeters) {
      const now = Date.now();
      if (now - this.lastProximityAlertTime >= (Config.settings.proximityAlertInterval * 1000)) {
        this.lastProximityAlertTime = now;
        UI.triggerProximityAlert(closestDistance, GeoEngine.getCardinalDirection(closestBearing));
      }
    }
  }

  /**
   * Seeker tags a runner
   */
  tagRunner(targetPlayerId, runnerNickname) {
    if (this.role !== 'seeker') return;

    const tagEvent = {
      seekerId: Network.playerId,
      seekerName: this.nickname,
      runnerId: targetPlayerId,
      runnerName: runnerNickname,
      timestamp: Date.now()
    };

    Network.broadcast('tag_event', tagEvent);
    this.onRemoteTag(tagEvent);
  }

  onRemoteTag(data) {
    const { seekerName, runnerId, runnerName } = data;
    this.activeRunners.add(runnerId);
    this.taggedRunners.add(runnerId);

    UI.playAudioCue('tag');
    UI.showToast(`🎯 ${runnerName} was tagged by ${seekerName}!`, 'danger');

    // If self was tagged
    if (runnerId === Network.playerId) {
      this.isTagged = true;
      UI.showCapturedModal();
    }

    // Check if all runners have been tagged
    this.checkVictoryConditions();
  }

  checkVictoryConditions() {
    let untaggedCount = 0;
    for (const runnerId of this.activeRunners) {
      if (!this.taggedRunners.has(runnerId)) {
        untaggedCount++;
      }
    }

    if (untaggedCount === 0 && this.activeRunners.size > 0) {
      this.endGame('all_runners_tagged');
    }
  }

  endGame(reason) {
    this.state = 'GAME_OVER';
    if (this.gameLoopInterval) {
      clearInterval(this.gameLoopInterval);
      this.gameLoopInterval = null;
    }

    let winner = 'Seekers';
    let message = '';

    if (reason === 'all_runners_tagged') {
      winner = 'Seekers';
      message = 'All runners were hunted down and captured!';
      UI.playAudioCue('victory');
    } else if (reason === 'time_expired') {
      winner = 'Runners';
      message = 'Time expired! Surviving runners evaded capture!';
      UI.playAudioCue('victory');
    }

    UI.showGameOverScreen({
      winner,
      message,
      duration: Math.round((Date.now() - this.matchStartTimestamp) / 1000),
      totalRunners: this.activeRunners.size,
      taggedCount: this.taggedRunners.size
    });
  }

  leaveMatch() {
    if (this.gameLoopInterval) clearInterval(this.gameLoopInterval);
    this.isPaused = false;
    this.lockedTargetId = null;
    Geo.stopTracking();
    Network.disconnect();
    this.state = 'LOBBY';
    UI.releaseWakeLock();
    UI.setPauseState(false);
    UI.showScreen('screen-lobby');
    UI.showToast('Exited operation. Returned to lobby.', 'info');
  }
}

// Global ManhuntGame singleton
const Game = new ManhuntGame();
