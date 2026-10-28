/**
 * Manhunt Core Game Engine & State Machine
 * Handles role-based visibility, grace period head start, runner ping cycle,
 * proximity alarms, tag detection, runner mobile confirmation, and infection/elimination modes.
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
    this.pendingTagRequest = null;

    // Telemetry cache
    this.lastKnownPositions = new Map(); // id -> { lat, lng, role, timestamp, nickname }
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
      console.log('Network connected mode:', info.mode, info.broker);
      UI.updateConnectionBadge(true, info.broker);
    });

    Network.on('disconnected', (info) => {
      UI.updateConnectionBadge(false);
    });

    Network.on('player_joined', (peer) => {
      this.updatePlayerRoster();
      UI.updateConnectionBadge(Network.isConnected, Network.activeBrokerName);
      UI.showToast(`${peer.nickname} joined as ${peer.role.toUpperCase()}`, 'info');
      UI.playAudioCue('join');
    });

    Network.on('player_updated', () => {
      this.updatePlayerRoster();
      UI.updateConnectionBadge(Network.isConnected, Network.activeBrokerName);
    });

    Network.on('player_left', (peer) => {
      this.updatePlayerRoster();
      MapController.removePeer(peer.playerId);
      UI.updateConnectionBadge(Network.isConnected, Network.activeBrokerName);
      UI.showToast(`${peer.nickname} left the room`, 'warning');
    });

    Network.on('game_started', (data) => {
      this.onGameStartedRemote(data);
    });

    Network.on('room_state', (data) => {
      this.handleRoomStateBeacon(data);
    });

    Network.on('role_assigned', (data) => {
      this.handleRoleAssigned(data);
    });

    Network.on('tag_request', (data) => {
      this.handleTagRequest(data);
    });

    Network.on('tag_confirmed', (data) => {
      this.onRemoteTagConfirmed(data);
    });

    Network.on('tag_disputed', (data) => {
      this.handleTagDisputed(data);
    });

    Network.on('host_command', (data) => {
      this.handleHostCommand(data);
    });

    Network.on('telemetry', (data) => {
      this.onRemoteTelemetry(data);
    });

    Network.on('tag_event', (data) => {
      this.onRemoteTagConfirmed(data);
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
   * Switch own role in lobby
   */
  setRole(newRole) {
    this.role = newRole;
    Network.role = newRole;
    Network.sendPresence();
    this.updatePlayerRoster();
  }

  /**
   * Host reassigns another player's role in the lobby
   */
  setPlayerRoleByHost(targetPlayerId, newRole) {
    if (!this.isHost) return;
    const peer = Network.peers.get(targetPlayerId);
    if (peer) {
      peer.role = newRole;
    }
    Network.broadcast('role_assigned', {
      targetPlayerId: targetPlayerId,
      newRole: newRole,
      hostName: this.nickname
    }, true);
    this.updatePlayerRoster();
    UI.showToast(`Squad role updated: ${peer ? peer.nickname : 'Player'} is now ${newRole.toUpperCase()}`, 'info');
  }

  handleRoleAssigned(data) {
    if (data.targetPlayerId === Network.playerId) {
      this.role = data.newRole;
      Network.role = data.newRole;
      UI.showToast(`👑 Host assigned you to ${data.newRole.toUpperCase()}!`, 'warning');
      UI.playAudioCue('ping');
      this.updatePlayerRoster();
      if (this.state === 'ACTIVE' || this.state === 'GRACE_PERIOD') {
        UI.adaptHUDForRole(this.role);
        if (this.lastSelfCoords) {
          MapController.updateSelfLocation(this.lastSelfCoords.lat, this.lastSelfCoords.lng, this.role);
        }
      }
    } else {
      const peer = Network.peers.get(data.targetPlayerId);
      if (peer) {
        peer.role = data.newRole;
      }
      this.updatePlayerRoster();
    }
  }

  /**
   * Handle room state beacon from host (ensures late joiners & reconnects snap into match)
   */
  handleRoomStateBeacon(data) {
    if (this.isHost) return;

    if (data.settings) {
      Config.save(data.settings);
      UI.populateSettingsUI();
      UI.updateLobbyRulesDisplay(Config.settings);
    }

    if (this.state === 'WAITING' && data.peers && Array.isArray(data.peers)) {
      data.peers.forEach(p => {
        if (p.id !== Network.playerId) {
          Network.peers.set(p.id, { ...(Network.peers.get(p.id) || {}), ...p });
        }
      });
      this.updatePlayerRoster();
    }

    // Auto catch-up into ongoing match if client was waiting
    if (this.state === 'WAITING' && (data.state === 'ACTIVE' || data.state === 'GRACE_PERIOD')) {
      console.log('Synchronizing into live operation via host beacon...');
      this.onGameStartedRemote({
        seekerTrackingMode: data.settings ? data.settings.seekerTrackingMode : Config.settings.seekerTrackingMode,
        gracePeriod: data.settings ? data.settings.gracePeriod : Config.settings.gracePeriod,
        gameDuration: data.settings ? data.settings.gameDuration : Config.settings.gameDuration,
        runnerPingInterval: data.settings ? data.settings.runnerPingInterval : Config.settings.runnerPingInterval,
        boundaryRadiusMeters: data.settings ? data.settings.boundaryRadiusMeters : Config.settings.boundaryRadiusMeters,
        runnerCaptureMode: data.settings ? data.settings.runnerCaptureMode : Config.settings.runnerCaptureMode,
        tagDistanceMeters: data.settings ? data.settings.tagDistanceMeters : Config.settings.tagDistanceMeters,
        startTimestamp: data.matchStartTimestamp || Date.now()
      });
    }
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

    for (const [, peer] of Network.peers.entries()) {
      list.push(peer);
    }

    this.activeRunners.clear();
    this.activeSeekers.clear();

    list.forEach(p => {
      if (p.role === 'runner') this.activeRunners.add(p.id);
      else if (p.role === 'seeker') this.activeSeekers.add(p.id);
    });

    UI.renderLobbyRoster(list, this.isHost);
    this.populateHostControlsModal();
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
      runnerCaptureMode: Config.settings.runnerCaptureMode,
      tagDistanceMeters: Config.settings.tagDistanceMeters,
      requireTagConfirmation: Config.settings.requireTagConfirmation,
      startTimestamp: Date.now()
    };

    Network.broadcast('start_game', matchConfig, true);
    this.onGameStartedRemote(matchConfig);
  }

  onGameStartedRemote(data) {
    if (data.seekerTrackingMode) Config.settings.seekerTrackingMode = data.seekerTrackingMode;
    if (data.gracePeriod !== undefined) Config.settings.gracePeriod = data.gracePeriod;
    if (data.gameDuration !== undefined) Config.settings.gameDuration = data.gameDuration;
    if (data.runnerPingInterval !== undefined) Config.settings.runnerPingInterval = data.runnerPingInterval;
    if (data.boundaryRadiusMeters !== undefined) Config.settings.boundaryRadiusMeters = data.boundaryRadiusMeters;
    if (data.runnerCaptureMode) Config.settings.runnerCaptureMode = data.runnerCaptureMode;
    if (data.tagDistanceMeters !== undefined) Config.settings.tagDistanceMeters = data.tagDistanceMeters;
    if (data.requireTagConfirmation !== undefined) Config.settings.requireTagConfirmation = data.requireTagConfirmation;

    this.matchStartTimestamp = data.startTimestamp;
    this.gracePeriodRemaining = Config.settings.gracePeriod;
    this.gameTimeRemaining = Config.settings.gameDuration;
    this.runnerPingCountdown = Config.settings.runnerPingInterval;
    this.seekerPingCountdown = Config.settings.seekerTrackingMode === 'live' ? 0 : parseInt(Config.settings.seekerTrackingMode, 10);
    this.isTagged = false;
    this.isPaused = false;
    this.taggedRunners.clear();

    // Populate active lists
    this.activeRunners.clear();
    this.activeSeekers.clear();
    if (this.role === 'runner') this.activeRunners.add(Network.playerId);
    else this.activeSeekers.add(Network.playerId);

    for (const [id, peer] of Network.peers.entries()) {
      if (peer.role === 'runner') this.activeRunners.add(id);
      else if (peer.role === 'seeker') this.activeSeekers.add(id);
    }

    // Initialize tactical map
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
    UI.adaptHUDForRole(this.role);
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

    // 3. Runner Ping Countdown
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
            nickname: this.nickname,
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
            nickname: this.nickname,
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
      nickname: this.nickname,
      timestamp: Date.now()
    });

    UI.playAudioCue('ping');
    UI.triggerPingPulseAnimation();
    UI.showToast('📍 Runner location ping broadcasted!', 'warning');
  }

  processLocationTick(coords) {
    this.lastSelfCoords = coords;
    if (this.isPaused) return;

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
          nickname: this.nickname,
          timestamp: now
        });
      }
    }
  }

  onRemoteTelemetry(data) {
    const { playerId, lat, lng, role, isPingSnapshot, isReconSweep, nickname } = data;
    this.lastKnownPositions.set(playerId, { lat, lng, role, timestamp: Date.now(), nickname });

    if (role === 'runner' && !this.taggedRunners.has(playerId)) {
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

  selectTarget(targetId, targetNickname = null) {
    this.lockedTargetId = targetId;
    if (targetId) {
      UI.showToast(`🎯 Locked onto: ${targetNickname || 'Target'}`, 'info');
    } else {
      UI.showToast('🎯 Radar tracking closest runner (Auto)', 'info');
    }

    for (const [id, pos] of this.lastKnownPositions.entries()) {
      if (pos.role === 'runner') {
        MapController.updatePeerLocation(id, pos.lat, pos.lng, 'runner', pos.nickname || 'Runner', false);
      }
    }

    this.evaluateDistances();
  }

  sendHostCommand(cmd, data = {}) {
    if (!this.isHost) return;
    const packet = { cmd, data, timestamp: Date.now() };
    Network.broadcast('host_command', packet, true);
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
          nickname: this.nickname,
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

      if (!closestOpponent && runnerTargets.length > 0) {
        closestOpponent = runnerTargets[0];
        closestDistance = closestOpponent.distance;
        closestBearing = closestOpponent.bearing;
      }

      // Check Tag Range for Seeker using customized setting
      const tagRange = Config.settings.tagDistanceMeters || 15;
      if (closestOpponent && closestOpponent.distance <= tagRange) {
        tagCandidate = closestOpponent;
      }

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

    // Runner Proximity Warning Alarm
    const proxLimit = Config.settings.proximityAlertMeters;
    if (!isSeeker && proxLimit > 0 && closestDistance <= proxLimit) {
      const now = Date.now();
      if (now - this.lastProximityAlertTime >= (Config.settings.proximityAlertInterval * 1000)) {
        this.lastProximityAlertTime = now;
        UI.triggerProximityAlert(closestDistance, GeoEngine.getCardinalDirection(closestBearing));
      }
    }
  }

  /**
   * Seeker initiates tag
   */
  tagRunner(targetPlayerId, runnerNickname) {
    if (this.role !== 'seeker') return;

    const tagDistance = this.nearestOpponentDistance ? Math.round(this.nearestOpponentDistance) : Config.settings.tagDistanceMeters;
    const tagData = {
      seekerId: Network.playerId,
      seekerName: this.nickname,
      runnerId: targetPlayerId,
      runnerName: runnerNickname,
      tagDistance: tagDistance,
      timestamp: Date.now()
    };

    if (Config.settings.requireTagConfirmation) {
      UI.showToast(`📡 Tag sent to ${runnerNickname}. Awaiting confirmation...`, 'info');
      Network.broadcast('tag_request', tagData, true);
    } else {
      // Instant tag mode
      Network.broadcast('tag_confirmed', tagData, true);
      this.onRemoteTagConfirmed(tagData);
    }
  }

  /**
   * Runner receives tag request prompt
   */
  handleTagRequest(data) {
    if (data.runnerId !== Network.playerId) return;

    this.pendingTagRequest = data;
    if (Config.settings.requireTagConfirmation) {
      UI.showRunnerTagConfirmModal(data.seekerName, data.tagDistance);
    } else {
      // Automatic confirmation
      this.confirmCaught();
    }
  }

  /**
   * Runner taps "I WAS CAUGHT"
   */
  confirmCaught() {
    if (!this.pendingTagRequest) return;
    const req = this.pendingTagRequest;
    this.pendingTagRequest = null;
    UI.closeModal('modal-runner-tag-confirm');

    Network.broadcast('tag_confirmed', req, true);
    this.onRemoteTagConfirmed(req);
  }

  /**
   * Runner taps "DISPUTE"
   */
  disputeCaught() {
    if (!this.pendingTagRequest) return;
    const req = this.pendingTagRequest;
    this.pendingTagRequest = null;
    UI.closeModal('modal-runner-tag-confirm');

    Network.broadcast('tag_disputed', {
      ...req,
      disputeReason: 'out_of_range_or_missed'
    }, true);
    UI.showToast('You disputed the tag (Out of range / missed).', 'warning');
  }

  handleTagDisputed(data) {
    if (data.seekerId === Network.playerId) {
      UI.showToast(`❌ ${data.runnerName} disputed your tag!`, 'danger');
      UI.playAudioCue('warning');
    } else {
      UI.showToast(`⚠️ Tag dispute: ${data.runnerName} rejected tag by ${data.seekerName}`, 'warning');
    }
  }

  /**
   * Host anti-stall force tag
   */
  forceTagRunnerByHost(targetPlayerId, runnerNickname) {
    if (!this.isHost) return;
    const tagData = {
      seekerId: Network.playerId,
      seekerName: this.nickname + ' (Host Force)',
      runnerId: targetPlayerId,
      runnerName: runnerNickname,
      tagDistance: 0,
      timestamp: Date.now()
    };
    Network.broadcast('tag_confirmed', tagData, true);
    this.onRemoteTagConfirmed(tagData);
    UI.showToast(`👑 Host confirmed tag on ${runnerNickname}`, 'info');
    this.populateHostControlsModal();
  }

  /**
   * Process confirmed tag across all clients
   */
  onRemoteTagConfirmed(data) {
    const { seekerName, runnerId, runnerName } = data;
    this.taggedRunners.add(runnerId);

    UI.playAudioCue('tag');
    UI.showToast(`🎯 ${runnerName} was tagged by ${seekerName}!`, 'danger');

    const isSelf = runnerId === Network.playerId;
    const isInfection = Config.settings.runnerCaptureMode === 'infection';

    if (isSelf) {
      if (isInfection) {
        // Converted to Seeker!
        this.role = 'seeker';
        Network.role = 'seeker';
        UI.adaptHUDForRole('seeker');
        UI.playAudioCue('siren');
        UI.showToast('🧬 INFECTION! You are now a SEEKER! Hunt surviving runners!', 'danger');
        if (this.lastSelfCoords) {
          MapController.updateSelfLocation(this.lastSelfCoords.lat, this.lastSelfCoords.lng, 'seeker');
          Network.broadcast('telemetry', {
            lat: this.lastSelfCoords.lat,
            lng: this.lastSelfCoords.lng,
            role: 'seeker',
            speed: this.lastSelfCoords.speed,
            heading: this.lastSelfCoords.heading,
            nickname: this.nickname,
            timestamp: Date.now()
          });
        }
      } else {
        // Elimination Mode
        this.isTagged = true;
        UI.showCapturedModal();
      }
    } else {
      if (isInfection) {
        const peer = Network.peers.get(runnerId);
        if (peer) peer.role = 'seeker';
        const cached = this.lastKnownPositions.get(runnerId);
        if (cached) {
          cached.role = 'seeker';
          MapController.updatePeerLocation(runnerId, cached.lat, cached.lng, 'seeker', runnerName, false);
        }
        this.activeRunners.delete(runnerId);
        this.activeSeekers.add(runnerId);
      }
    }

    this.populateHostControlsModal();
    this.checkVictoryConditions();
  }

  populateHostControlsModal() {
    const list = document.getElementById('host-force-tag-list');
    if (!list) return;
    list.innerHTML = '';

    const untaggedRunners = [];
    if (this.role === 'runner' && !this.taggedRunners.has(Network.playerId)) {
      untaggedRunners.push({ id: Network.playerId, nickname: this.nickname + ' (You)' });
    }

    for (const [id, peer] of Network.peers.entries()) {
      if (peer.role === 'runner' && !this.taggedRunners.has(id)) {
        untaggedRunners.push({ id: id, nickname: peer.nickname });
      }
    }

    if (untaggedRunners.length === 0) {
      list.innerHTML = '<div style="font-size:0.75rem; color:var(--theme-text-muted); padding:4px;">No active runners to tag</div>';
      return;
    }

    untaggedRunners.forEach(r => {
      const item = document.createElement('div');
      item.className = 'force-tag-item';
      item.innerHTML = `
        <span>${r.nickname}</span>
        <button type="button" class="btn-force-tag" onclick="Game.forceTagRunnerByHost('${r.id}', '${r.nickname}')">
          FORCE TAG
        </button>
      `;
      list.appendChild(item);
    });
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
      message = Config.settings.runnerCaptureMode === 'infection'
        ? 'Infection complete! All runners were hunted down and converted!'
        : 'All runners were captured by the seekers!';
      UI.playAudioCue('victory');
    } else if (reason === 'time_expired') {
      winner = 'Runners';
      message = 'Time expired! Surviving runners successfully evaded pursuit!';
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
    this.pendingTagRequest = null;
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
