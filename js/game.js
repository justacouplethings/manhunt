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
    this.isCaught = false; // State flag to prevent catch notification/conversion spam
    this.isPaused = false;
    this.taggedRunners = new Set();
    this.activeRunners = new Set();
    this.initialRunners = new Set();
    this.activeSeekers = new Set();
    this.matchStartTimestamp = 0;
    this.lastGameOverData = null;
    this.lockedTargetId = null;
    this.seekerPingCountdown = 0;
    this.pendingTagRequest = null;
    this.lastTagAttemptTime = 0;
    this.currentMatchConfig = null;
    this.lobbySyncInterval = null;

    // Telemetry cache
    this.lastKnownPositions = new Map(); // id -> { lat, lng, role, timestamp, nickname } (displayed/pinged positions for UI)
    this.trueLivePositions = new Map(); // id -> { lat, lng, role, timestamp, nickname } (silent true live GPS positions)
    this.lastSelfCoords = null;

    // Audio & sensory state
    this.lastProximityAlertTime = 0;
    this.lastHunterProximityAlertTime = 0;
    this.nearestOpponentDistance = null;
    this.nearestOpponentBearing = null;
    this.nearestOpponentName = '';

    // Global Fixed Boundary & Flare State
    this.boundaryCenter = null; // { lat, lng } fixed globally at match launch by Host
    this.boundaryRadiusMeters = 1500;
    this.isOutOfBounds = false;
    this.lastFlareTimestamp = 0;
    this.lastRunnerLiveSend = 0;
  }

  /**
   * Completely clears match state, stale players, bot telemetry, and map markers
   */
  resetMatchState() {
    if (this.gameLoopInterval) {
      clearInterval(this.gameLoopInterval);
      this.gameLoopInterval = null;
    }
    if (this.lobbySyncInterval) {
      clearInterval(this.lobbySyncInterval);
      this.lobbySyncInterval = null;
    }
    this.isPaused = false;
    this.isTagged = false;
    this.isCaught = false;
    this.lastTagAttemptTime = 0;
    this.currentMatchConfig = null;
    this.isOutOfBounds = false;
    this.boundaryCenter = null;
    this.boundaryRadiusMeters = Config.settings.boundaryRadiusMeters || 1500;
    this.lockedTargetId = null;
    this.pendingTagRequest = null;
    this.lastSeekerSend = 0;
    this.lastRunnerLiveSend = 0;
    this.lastRunnerPingTime = 0;
    this.lastFlareTimestamp = 0;
    this.lastProximityAlertTime = 0;
    this.lastHunterProximityAlertTime = 0;
    this.nearestOpponentDistance = null;
    this.nearestOpponentBearing = null;
    this.nearestOpponentName = '';

    // Clear collections
    this.lastKnownPositions.clear();
    this.trueLivePositions.clear();
    this.taggedRunners.clear();
    this.activeRunners.clear();
    this.initialRunners.clear();
    this.activeSeekers.clear();
    this.lastGameOverData = null;

    // Clear network peers
    if (typeof Network !== 'undefined' && Network.peers) {
      Network.peers.clear();
    }

    // Clear map markers & breadcrumbs
    if (typeof MapController !== 'undefined' && MapController.clearAllPeers) {
      MapController.clearAllPeers();
    }

    // Stop sandbox bots if active
    if (typeof Simulation !== 'undefined' && Simulation.isActive) {
      Simulation.stop();
    }

    // Reset UI
    if (typeof UI !== 'undefined' && UI.resetMatchUI) {
      UI.resetMatchUI();
    }
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

    Network.on('start_game', (data) => {
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

    Network.on('admin_command', (data) => {
      this.handleAdminCommand(data);
    });

    Network.on('telemetry', (data) => {
      this.onRemoteTelemetry(data);
    });

    Network.on('tag_event', (data) => {
      this.onRemoteTagConfirmed(data);
    });

    Network.on('match_over', (data) => {
      this.onRemoteGameOver(data);
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
    this.resetMatchState();
    this.roomCode = NetworkEngine.generateRoomCode();
    this.nickname = nickname || 'Host';
    this.role = role || 'runner';
    this.isHost = true;
    this.state = 'WAITING';

    Network.connect(this.roomCode, this.nickname, this.role, true);
    UI.showScreen('screen-waiting');
    UI.setRoomCodeDisplay(this.roomCode);
    this.updatePlayerRoster();

    // Start lobby synchronization interval
    if (this.lobbySyncInterval) clearInterval(this.lobbySyncInterval);
    this.lobbySyncInterval = setInterval(() => {
      if (this.state === 'WAITING' && this.roomCode) {
        Network.sendPresence();
        if (this.isHost) {
          Network.emitHostBeacon();
        }
      }
    }, 1500);

    // Start GPS tracking
    Geo.startTracking();
  }

  /**
   * Player joins an existing room
   */
  joinRoom(roomCode, nickname, role) {
    this.resetMatchState();
    this.roomCode = roomCode.toUpperCase().trim();
    this.nickname = nickname || 'Player';
    this.role = role || 'runner';
    this.isHost = false;
    this.state = 'WAITING';

    Network.connect(this.roomCode, this.nickname, this.role, false);
    UI.showScreen('screen-waiting');
    UI.setRoomCodeDisplay(this.roomCode);
    this.updatePlayerRoster();

    // Start lobby synchronization interval
    if (this.lobbySyncInterval) clearInterval(this.lobbySyncInterval);
    this.lobbySyncInterval = setInterval(() => {
      if (this.state === 'WAITING' && this.roomCode) {
        Network.sendPresence();
      }
    }, 1500);

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
      UI.notifyCriticalEvent('ROLE ASSIGNED', `👑 Host assigned you to ${data.newRole.toUpperCase()}!`, 'warning');
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

    if (data.boundaryCenter) {
      this.boundaryCenter = data.boundaryCenter;
    }
    if (data.boundaryRadiusMeters !== undefined) {
      this.boundaryRadiusMeters = data.boundaryRadiusMeters;
      Config.settings.boundaryRadiusMeters = data.boundaryRadiusMeters;
    }

    const roster = data.roster || data.peers;
    if (this.state === 'WAITING' && roster && Array.isArray(roster)) {
      roster.forEach(p => {
        if (p.id !== Network.playerId) {
          Network.peers.set(p.id, { ...(Network.peers.get(p.id) || {}), ...p });
        }
      });
      this.updatePlayerRoster();
    }

    // Auto catch-up into ongoing match if client was waiting
    if (this.state === 'WAITING' && (data.state === 'ACTIVE' || data.state === 'GRACE_PERIOD')) {
      console.log('Synchronizing into live operation via host beacon...');
      const matchConfig = data.matchConfig || {
        seekerTrackingMode: data.settings ? data.settings.seekerTrackingMode : Config.settings.seekerTrackingMode,
        gracePeriod: data.settings ? data.settings.gracePeriod : Config.settings.gracePeriod,
        gameDuration: data.settings ? data.settings.gameDuration : Config.settings.gameDuration,
        runnerPingInterval: data.settings ? data.settings.runnerPingInterval : Config.settings.runnerPingInterval,
        boundaryRadiusMeters: data.boundaryRadiusMeters !== undefined ? data.boundaryRadiusMeters : (data.settings ? data.settings.boundaryRadiusMeters : Config.settings.boundaryRadiusMeters),
        boundaryCenter: data.boundaryCenter || null,
        runnerCaptureMode: data.settings ? data.settings.runnerCaptureMode : Config.settings.runnerCaptureMode,
        tagDistanceMeters: data.settings ? data.settings.tagDistanceMeters : Config.settings.tagDistanceMeters,
        requireTagConfirmation: data.settings ? data.settings.requireTagConfirmation : Config.settings.requireTagConfirmation,
        startTimestamp: data.matchStartTimestamp || Date.now(),
        roster: roster || []
      };
      this.onGameStartedRemote(matchConfig);
    }

    // Auto catch-up if operation concluded on host
    if (data.state === 'GAME_OVER' && this.state !== 'GAME_OVER' && this.state !== 'LOBBY') {
      console.log('Synchronizing into concluded match via host beacon...');
      this.endGame(data.lastGameOverData || { winner: 'Seekers', reason: 'all_runners_tagged' });
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
   * Host starts the match (prompts host to establish fixed boundary radius)
   */
  startMatch() {
    if (!this.isHost) return;
    UI.showBoundaryPromptModal();
  }

  /**
   * Host confirms boundary settings and officially launches the operation
   */
  confirmAndLaunchMatch(boundaryRadius) {
    if (!this.isHost) return;

    // Fixed boundary center locked to Host's current coordinates
    const anchor = this.lastSelfCoords
      ? { lat: this.lastSelfCoords.lat, lng: this.lastSelfCoords.lng }
      : { lat: 40.7580, lng: -73.9855 }; // fallback default anchor

    this.boundaryCenter = anchor;
    this.boundaryRadiusMeters = boundaryRadius !== undefined ? boundaryRadius : Config.settings.boundaryRadiusMeters;
    Config.settings.boundaryRadiusMeters = this.boundaryRadiusMeters;

    // Build authoritative squad roster at launch time
    const roster = [
      {
        id: Network.playerId,
        nickname: this.nickname,
        role: this.role,
        isHost: true
      },
      ...Array.from(Network.peers.values()).map(p => ({
        id: p.id,
        nickname: p.nickname,
        role: p.role,
        isHost: !!p.isHost
      }))
    ];

    const matchConfig = {
      seekerTrackingMode: Config.settings.seekerTrackingMode,
      gracePeriod: Config.settings.gracePeriod,
      gameDuration: Config.settings.gameDuration,
      runnerPingInterval: Config.settings.runnerPingInterval,
      boundaryRadiusMeters: this.boundaryRadiusMeters,
      boundaryCenter: this.boundaryCenter,
      runnerCaptureMode: Config.settings.runnerCaptureMode,
      tagDistanceMeters: Config.settings.tagDistanceMeters,
      requireTagConfirmation: Config.settings.requireTagConfirmation,
      flareCooldownSeconds: Config.settings.flareCooldownSeconds || 60,
      startTimestamp: Date.now(),
      roster: roster
    };
    this.currentMatchConfig = matchConfig;

    if (this.lobbySyncInterval) {
      clearInterval(this.lobbySyncInterval);
      this.lobbySyncInterval = null;
    }

    Network.broadcast('start_game', matchConfig, true);
    Network.emitHostBeacon();
    this.onGameStartedRemote(matchConfig);
  }

  onGameStartedRemote(data) {
    if (this.state === 'ACTIVE' || this.state === 'GRACE_PERIOD') {
      return; // Deduplicate start_game burst retransmissions
    }

    if (this.lobbySyncInterval) {
      clearInterval(this.lobbySyncInterval);
      this.lobbySyncInterval = null;
    }

    if (data.seekerTrackingMode) Config.settings.seekerTrackingMode = data.seekerTrackingMode;
    if (data.gracePeriod !== undefined) Config.settings.gracePeriod = data.gracePeriod;
    if (data.gameDuration !== undefined) Config.settings.gameDuration = data.gameDuration;
    if (data.runnerPingInterval !== undefined) Config.settings.runnerPingInterval = data.runnerPingInterval;
    if (data.flareCooldownSeconds !== undefined) Config.settings.flareCooldownSeconds = data.flareCooldownSeconds;
    if (data.boundaryRadiusMeters !== undefined) {
      this.boundaryRadiusMeters = data.boundaryRadiusMeters;
      Config.settings.boundaryRadiusMeters = data.boundaryRadiusMeters;
    }
    if (data.boundaryCenter) {
      this.boundaryCenter = data.boundaryCenter;
    }
    if (data.runnerCaptureMode) Config.settings.runnerCaptureMode = data.runnerCaptureMode;
    if (data.tagDistanceMeters !== undefined) Config.settings.tagDistanceMeters = data.tagDistanceMeters;
    if (data.requireTagConfirmation !== undefined) Config.settings.requireTagConfirmation = data.requireTagConfirmation;

    // Ingest authoritative roster into peers if present
    const roster = data.roster || data.peers;
    if (Array.isArray(roster)) {
      roster.forEach(p => {
        if (p.id !== Network.playerId) {
          Network.peers.set(p.id, { ...(Network.peers.get(p.id) || {}), ...p });
        }
      });
    }

    this.matchStartTimestamp = data.startTimestamp || Date.now();
    this.gracePeriodRemaining = Config.settings.gracePeriod;
    this.gameTimeRemaining = Config.settings.gameDuration;
    this.runnerPingCountdown = Config.settings.runnerPingInterval;
    this.seekerPingCountdown = Config.settings.seekerTrackingMode === 'live' ? 0 : parseInt(Config.settings.seekerTrackingMode, 10);
    this.isTagged = false;
    this.isCaught = false;
    this.isPaused = false;
    this.isOutOfBounds = false;
    this.taggedRunners.clear();

    // Populate active and initial participant lists from authoritative roster
    this.activeRunners.clear();
    this.activeSeekers.clear();
    this.initialRunners.clear();
    this.lastGameOverData = null;

    if (this.role === 'runner') {
      this.activeRunners.add(Network.playerId);
      this.initialRunners.add(Network.playerId);
    } else {
      this.activeSeekers.add(Network.playerId);
    }

    for (const [id, peer] of Network.peers.entries()) {
      if (peer.role === 'runner') {
        this.activeRunners.add(id);
        this.initialRunners.add(id);
      } else if (peer.role === 'seeker') {
        this.activeSeekers.add(id);
      }
    }

    // Initialize tactical map with center
    const mapCenterLat = this.lastSelfCoords ? this.lastSelfCoords.lat : (this.boundaryCenter ? this.boundaryCenter.lat : 40.7580);
    const mapCenterLng = this.lastSelfCoords ? this.lastSelfCoords.lng : (this.boundaryCenter ? this.boundaryCenter.lng : -73.9855);
    MapController.init(mapCenterLat, mapCenterLng);

    if (this.lastSelfCoords) {
      MapController.updateSelfLocation(this.lastSelfCoords.lat, this.lastSelfCoords.lng, this.role);
    }

    // Apply globally fixed boundary circle for all players (runners and seekers)
    if (this.boundaryCenter && this.boundaryRadiusMeters > 0) {
      MapController.setBoundary(this.boundaryCenter.lat, this.boundaryCenter.lng, this.boundaryRadiusMeters);
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
      UI.notifyCriticalEvent('GRACE PERIOD ACTIVE', `Runners have ${Math.round(this.gracePeriodRemaining / 60)}m head start!`, 'info');
    } else {
      this.beginActiveHunt();
    }

    this.startGameLoop();
  }

  beginActiveHunt() {
    this.state = 'ACTIVE';
    UI.setGracePeriodState(false);
    UI.playAudioCue('start');
    UI.notifyCriticalEvent('THE HUNT HAS BEGUN!', 'Seekers are released! Evade pursuit!', 'danger');

    // Trigger initial runner ping immediately at game start
    if (this.role === 'runner' && this.lastSelfCoords) {
      this.broadcastRunnerPing(this.lastSelfCoords, false);
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
        const gameOverPayload = {
          winner: 'Runners',
          reason: 'time_expired',
          message: 'Time expired! Surviving runners successfully evaded pursuit!',
          duration: Math.round((Date.now() - this.matchStartTimestamp) / 1000),
          totalRunners: this.initialRunners ? this.initialRunners.size : this.activeRunners.size,
          taggedCount: this.taggedRunners.size,
          timestamp: Date.now()
        };
        if (this.isHost) {
          Network.broadcast('match_over', gameOverPayload, true);
        }
        this.endGame(gameOverPayload);
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
        const seekerInterval = this.getDynamicBroadcastInterval();
        if (Date.now() - (this.lastSeekerSend || 0) >= seekerInterval) {
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
        }
      }
    }

    // 5. Evaluate distances & Proximity Alert
    this.evaluateDistances();
  }

  /**
   * Dynamic polling rate: increases to near real-time (1000ms) when hunter and runner are within close range (<=100m)
   */
  getDynamicBroadcastInterval() {
    const nearThreshold = Config.settings.dynamicNearDistanceMeters || 100;
    if (this.nearestOpponentDistance !== null && this.nearestOpponentDistance <= nearThreshold) {
      return 1000; // Near real-time 1s polling
    }
    if (this.role === 'runner') {
      return 2000; // Standard squad live telemetry
    }
    return (Config.settings.seekerPingInterval || 5) * 1000;
  }

  /**
   * Decoupled runner distance & trajectory calculation
   * Uses real-time silent telemetry, projected dead-reckoning trajectory vector, or last ping
   */
  getEffectiveRunnerDistance(runnerId, lastKnownPos, selfLat, selfLng) {
    if (selfLat == null || selfLng == null) {
      return { distance: Infinity, bearing: 0, isLive: false, source: 'none' };
    }

    // 1. Silent real-time live telemetry check
    const truePos = this.trueLivePositions.get(runnerId);
    if (truePos && truePos.lat != null && truePos.lng != null) {
      const dist = GeoEngine.getDistance(selfLat, selfLng, truePos.lat, truePos.lng);
      const bearing = GeoEngine.getBearing(selfLat, selfLng, truePos.lat, truePos.lng);
      return {
        distance: dist,
        bearing: bearing,
        lat: truePos.lat,
        lng: truePos.lng,
        isLive: true,
        source: 'true_live'
      };
    }

    // 2. Trajectory projection / dead-reckoning from last known position
    if (lastKnownPos && lastKnownPos.lat != null && lastKnownPos.lng != null) {
      const now = Date.now();
      const speed = Number(lastKnownPos.speed) || 0;
      const heading = lastKnownPos.heading != null ? Number(lastKnownPos.heading) : null;
      const dt = lastKnownPos.timestamp ? (now - lastKnownPos.timestamp) / 1000 : 0;

      // Project if moving and ping was within the last 45 seconds
      if (speed > 0.5 && heading !== null && dt > 0 && dt <= 45) {
        const rad = (heading * Math.PI) / 180;
        const distTraveled = speed * dt;
        const dLat = (distTraveled * Math.cos(rad)) / 111111;
        const dLng = (distTraveled * Math.sin(rad)) / (111111 * Math.cos((lastKnownPos.lat * Math.PI) / 180));
        const projLat = lastKnownPos.lat + dLat;
        const projLng = lastKnownPos.lng + dLng;

        const projDist = GeoEngine.getDistance(selfLat, selfLng, projLat, projLng);
        const lastDist = GeoEngine.getDistance(selfLat, selfLng, lastKnownPos.lat, lastKnownPos.lng);

        const effectiveDist = Math.min(projDist, lastDist);
        const effectiveBearing = GeoEngine.getBearing(selfLat, selfLng, effectiveDist === projDist ? projLat : lastKnownPos.lat, effectiveDist === projDist ? projLng : lastKnownPos.lng);

        return {
          distance: effectiveDist,
          bearing: effectiveBearing,
          lat: effectiveDist === projDist ? projLat : lastKnownPos.lat,
          lng: effectiveDist === projDist ? projLng : lastKnownPos.lng,
          isLive: false,
          projected: true,
          source: 'projected_trajectory'
        };
      }

      const dist = GeoEngine.getDistance(selfLat, selfLng, lastKnownPos.lat, lastKnownPos.lng);
      const bearing = GeoEngine.getBearing(selfLat, selfLng, lastKnownPos.lat, lastKnownPos.lng);
      return {
        distance: dist,
        bearing: bearing,
        lat: lastKnownPos.lat,
        lng: lastKnownPos.lng,
        isLive: false,
        source: 'last_known'
      };
    }

    return { distance: Infinity, bearing: 0, isLive: false, source: 'none' };
  }

  /**
   * Hunter Proximity Alert: local push notification, haptic vibration, and audio cue
   * Optimized with cooldown to prevent excessive battery drain
   */
  triggerHunterProximityAlert(runnerName, distance, bearing) {
    this.lastHunterProximityAlertTime = Date.now();
    const cardinal = GeoEngine.getCardinalDirection(bearing);
    const distRounded = Math.round(distance);

    // 1. Haptic feedback / vibration pattern for hunter
    UI.vibrate([150, 80, 150, 80, 250]);

    // 2. Audio warning cue
    UI.playAudioCue('warning');

    // 3. UI In-App Alert banner
    UI.notifyCriticalEvent(
      'RUNNER IN RANGE',
      `⚡ Runner nearby: ${runnerName} (${distRounded}m, ${cardinal})`,
      'warning'
    );

    // 4. Native Android / system notification if app is in background
    if (window.AndroidNative && typeof window.AndroidNative.showNotification === 'function') {
      try {
        window.AndroidNative.showNotification(
          'RUNNER IN RANGE',
          `Runner ${runnerName} is ${distRounded}m away (${cardinal})!`
        );
      } catch (e) {}
    } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification('Manhunt - Runner Nearby', {
          body: `${runnerName} is ${distRounded}m away (${cardinal})!`,
          icon: 'assets/icon-192.png',
          tag: 'hunter-proximity'
        });
      } catch (e) {}
    }
  }

  /**
   * Broadcast a Runner ping snapshot to all players
   */
  broadcastRunnerPing(coords, isManualFlare = false) {
    this.lastRunnerPingTime = Date.now();
    Network.broadcast('telemetry', {
      lat: coords.lat,
      lng: coords.lng,
      role: 'runner',
      isPingSnapshot: true,
      isManualFlare: isManualFlare,
      nickname: this.nickname,
      timestamp: Date.now()
    });

    UI.playAudioCue('ping');
    UI.triggerPingPulseAnimation();
    if (isManualFlare) {
      UI.showToast('📍 Flare fired! Position revealed to Seekers.', 'warning');
      MapController.triggerFlareAnimation(coords.lat, coords.lng, this.nickname || 'You');
    }
  }

  /**
   * Runner manual flare with cooldown
   */
  triggerFlare() {
    if (this.role !== 'runner') return;
    if (this.isTagged) return;
    if (!this.lastSelfCoords) {
      UI.showToast('Acquiring GPS fix before firing flare...', 'warning');
      return;
    }

    const cooldownSec = Config.settings.flareCooldownSeconds || 60;
    const cooldownMs = cooldownSec * 1000;
    const now = Date.now();
    const elapsed = now - this.lastFlareTimestamp;

    if (elapsed < cooldownMs) {
      const remaining = Math.ceil((cooldownMs - elapsed) / 1000);
      UI.showToast(`Flare recharging: ${remaining}s remaining`, 'warning');
      return;
    }

    this.lastFlareTimestamp = now;
    this.broadcastRunnerPing(this.lastSelfCoords, true);
    UI.startFlareCooldown(cooldownSec);
  }

  processLocationTick(coords) {
    this.lastSelfCoords = coords;
    if (this.isPaused) return;

    // Out of Bounds Detection against Host's fixed global boundaryCenter
    if (this.boundaryCenter && this.boundaryRadiusMeters > 0 && (this.state === 'ACTIVE' || this.state === 'GRACE_PERIOD')) {
      const distFromCenter = GeoEngine.getDistance(coords.lat, coords.lng, this.boundaryCenter.lat, this.boundaryCenter.lng);
      if (distFromCenter > this.boundaryRadiusMeters) {
        const metersOOB = Math.round(distFromCenter - this.boundaryRadiusMeters);
        UI.setOutOfBoundsState(true, metersOOB);
        if (!this.isOutOfBounds) {
          this.isOutOfBounds = true;
          UI.notifyCriticalEvent('OUT OF BOUNDS!', `⚠️ OUT OF BOUNDS! You left the operation area (${metersOOB}m out). Return immediately!`, 'danger');
          UI.playAudioCue('siren');
          UI.vibrate([200, 100, 200, 100, 400]);
        }
      } else {
        if (this.isOutOfBounds) {
          this.isOutOfBounds = false;
          UI.showToast('✅ Back inside operation boundary', 'info');
        }
        UI.setOutOfBoundsState(false, 0);
      }
    }

    // 1. Continuous Live Telemetry for Runners (Other runners track squad teammates live; dynamic 1s polling when near seekers)
    if (this.role === 'runner' && (this.state === 'ACTIVE' || this.state === 'GRACE_PERIOD') && !this.isTagged) {
      const now = Date.now();
      const broadcastInterval = this.getDynamicBroadcastInterval();
      if (now - (this.lastRunnerLiveSend || 0) >= broadcastInterval) {
        this.lastRunnerLiveSend = now;
        Network.broadcast('telemetry', {
          lat: coords.lat,
          lng: coords.lng,
          role: 'runner',
          isLiveRunnerBroadcast: true,
          isPingSnapshot: false,
          speed: coords.speed,
          heading: coords.heading,
          nickname: this.nickname,
          timestamp: now
        });
      }
    }

    // 2. Seeker Continuous Live Telemetry (when configured for live mode)
    if (this.role === 'seeker' && this.state === 'ACTIVE' && Config.settings.seekerTrackingMode === 'live') {
      const now = Date.now();
      const broadcastInterval = this.getDynamicBroadcastInterval();
      if (now - (this.lastSeekerSend || 0) >= broadcastInterval) {
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
    const { playerId, lat, lng, role, isPingSnapshot, isReconSweep, isLiveRunnerBroadcast, nickname } = data;

    // 1. Silently record TRUE live position in the background for live proximity evaluations
    if (playerId && lat != null && lng != null) {
      this.trueLivePositions.set(playerId, {
        lat: Number(lat),
        lng: Number(lng),
        role: role,
        timestamp: Date.now(),
        nickname: nickname || 'Operative'
      });
    }

    if (role === 'runner' && !this.taggedRunners.has(playerId)) {
      this.activeRunners.add(playerId);
    } else if (role === 'seeker') {
      this.activeSeekers.add(playerId);
    }

    if (role === 'runner') {
      if (this.role === 'runner') {
        // RUNNER PERSPECTIVE:
        // Runners see their own location and the locations of ALL other runners in real-time (live tracking)!
        this.lastKnownPositions.set(playerId, { lat, lng, role, timestamp: Date.now(), nickname });
        MapController.updatePeerLocation(playerId, lat, lng, 'runner', nickname || 'Runner', isPingSnapshot || isReconSweep);
        if (isPingSnapshot || isReconSweep) {
          UI.playAudioCue('radar-blip');
          if (data.isManualFlare) {
            UI.showToast(`📍 Teammate ${nickname || 'Runner'} triggered a Flare!`, 'warning');
            MapController.triggerFlareAnimation(lat, lng, nickname || 'Runner');
          }
        }
      } else if (this.role === 'seeker') {
        // SEEKER PERSPECTIVE:
        // Seekers ONLY receive location updates for runners strictly based on the host's ping interval, flares, or recon sweeps!
        if (isPingSnapshot || isReconSweep || data.isManualFlare) {
          this.lastKnownPositions.set(playerId, { lat, lng, role, timestamp: Date.now(), nickname });
          MapController.updatePeerLocation(playerId, lat, lng, 'runner', nickname || 'Runner', true);
          if (data.isManualFlare) {
            UI.playAudioCue('siren');
            UI.notifyCriticalEvent('FLARE', `📍 ${nickname || 'Runner'} triggered a Flare!`, 'warning');
            MapController.triggerFlareAnimation(lat, lng, nickname || 'Runner');
          } else {
            UI.playAudioCue('radar-blip');
          }
        }
      }
    } else if (role === 'seeker') {
      this.lastKnownPositions.set(playerId, { lat, lng, role, timestamp: Date.now(), nickname });
      const isLiveSeeker = Config.settings.seekerTrackingMode === 'live';
      if (isLiveSeeker || isPingSnapshot || isReconSweep || this.role === 'seeker') {
        MapController.updatePeerLocation(playerId, lat, lng, 'seeker', nickname || 'Seeker', isPingSnapshot || isReconSweep);
      }
    }

    this.evaluateDistances();
  }

  selectTarget(targetId, targetNickname = null) {
    this.lockedTargetId = targetId;
    if (targetId) {
      UI.showToast(`🎯 Locked onto: ${targetNickname || 'Target'}`, 'info');
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
      UI.notifyCriticalEvent('OPERATION SUSPENDED', '⏸️ Operation suspended by Host', 'warning');
    } else if (cmd === 'resume') {
      this.isPaused = false;
      UI.setPauseState(false, this.isHost);
      UI.playAudioCue('start');
      UI.notifyCriticalEvent('OPERATION RESUMED', '▶️ Operation resumed by Host', 'info');
    } else if (cmd === 'recon_sweep') {
      UI.playAudioCue('siren');
      UI.notifyCriticalEvent('SATELLITE RECON SWEEP', '🛰️ Satellite recon sweep active! All coordinates revealed!', 'danger');
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
      UI.notifyCriticalEvent('OPERATION TERMINATED', `🛑 Operation terminated by Host: ${data && data.reason ? data.reason : 'Host aborted match'}`, 'danger');
      UI.playAudioCue('tag');
    }
  }

  /**
   * Authoritative administrative command processor
   */
  handleAdminCommand(packet) {
    if (!packet || typeof packet !== 'object') return;
    
    // Check if command is targeting a specific room
    if (packet.roomCode && packet.roomCode !== 'GLOBAL' && this.roomCode && packet.roomCode !== this.roomCode) {
      return;
    }

    const { type, cmd, data, targetPlayerId, newRole, settings, message, reason } = packet;
    const commandType = type || cmd;

    console.log('⚡ Admin Command received:', commandType, packet);

    switch (commandType) {
      case 'force_pause':
      case 'pause':
        this.isPaused = true;
        UI.setPauseState(true, this.isHost);
        UI.playAudioCue('warning');
        UI.notifyCriticalEvent('ADMIN OVERRIDE', '⏸️ Operation paused by System Administrator', 'warning');
        break;

      case 'force_resume':
      case 'resume':
        this.isPaused = false;
        UI.setPauseState(false, this.isHost);
        UI.playAudioCue('start');
        UI.notifyCriticalEvent('ADMIN OVERRIDE', '▶️ Operation resumed by System Administrator', 'info');
        break;

      case 'force_end':
      case 'emergency_stop':
        this.isPaused = false;
        UI.setPauseState(false, this.isHost);
        this.leaveMatch();
        UI.notifyCriticalEvent('ADMIN OVERRIDE', `🛑 Operation terminated by System Administrator${reason ? ': ' + reason : ''}`, 'danger');
        UI.playAudioCue('tag');
        break;

      case 'set_role': {
        const roleToSet = newRole || (data && data.newRole);
        if (!roleToSet || (roleToSet !== 'runner' && roleToSet !== 'seeker')) break;

        // 1. If target is self, apply role change immediately and broadcast presence
        if (targetPlayerId === Network.playerId) {
          this.role = roleToSet;
          Network.role = roleToSet;
          UI.updateRoleDisplay(this.role);
          UI.adaptHUDForRole(this.role);
          if (this.lastSelfCoords) {
            MapController.updateSelfLocation(this.lastSelfCoords.lat, this.lastSelfCoords.lng, this.role, this.lastSelfCoords.heading);
          }
          UI.notifyCriticalEvent('ROLE ASSIGNED', `👑 Administrator assigned your role to ${roleToSet.toUpperCase()}`, 'info');
          UI.playAudioCue('start');
          Network.sendPresence();
        }

        // 2. On all squad members, update the peer's role record
        if (typeof Network !== 'undefined' && Network.peers && Network.peers.has(targetPlayerId)) {
          const peer = Network.peers.get(targetPlayerId);
          peer.role = roleToSet;
          Network.peers.set(targetPlayerId, peer);
        }

        // 3. Update squad active role sets
        if (roleToSet === 'seeker') {
          this.activeSeekers.add(targetPlayerId);
          this.activeRunners.delete(targetPlayerId);
        } else {
          this.activeRunners.add(targetPlayerId);
          this.activeSeekers.delete(targetPlayerId);
        }

        this.updatePlayerRoster();

        // 4. If host, emit authoritative beacon with updated roster so nobody reverts the role
        if (this.isHost) {
          Network.emitHostBeacon();
        }
        break;
      }

      case 'kick_player':
        if (targetPlayerId === Network.playerId) {
          this.leaveMatch();
          UI.notifyCriticalEvent('ACCESS REVOKED', `👢 You have been removed from the operation by a System Administrator${reason ? ' (' + reason + ')' : ''}`, 'danger');
          alert(`You have been removed from the room by an Administrator${reason ? ': ' + reason : ''}`);
        }
        break;

      case 'ban_player':
        if (targetPlayerId === Network.playerId) {
          try { localStorage.setItem('manhunt_banned', 'true'); } catch (e) {}
          this.leaveMatch();
          alert(`ACCESS BANNED: You have been permanently banned by a System Administrator${reason ? ' for: ' + reason : ''}.`);
          location.reload();
        }
        break;

      case 'override_settings': {
        const newSettings = settings || data;
        if (newSettings && typeof newSettings === 'object') {
          Config.save(newSettings);
          UI.populateSettingsUI();
          UI.updateLobbyRulesDisplay(newSettings);
          if (newSettings.boundaryRadiusMeters) {
            this.boundaryRadiusMeters = newSettings.boundaryRadiusMeters;
            if (this.boundaryCenter) {
              MapController.drawBoundary(this.boundaryCenter.lat, this.boundaryCenter.lng, this.boundaryRadiusMeters);
            }
          }
          UI.notifyCriticalEvent('SETTINGS OVERRIDE', '⚙️ Match settings updated by System Administrator', 'info');
        }
        break;
      }

      case 'global_announcement': {
        const text = message || (data && (data.message || data.text)) || packet.text || (typeof data === 'string' ? data : 'Administrative Alert');
        UI.notifyCriticalEvent('ADMIN BROADCAST', `📢 ${text}`, 'warning');
        UI.playAudioCue('countdown');
        break;
      }
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

    if (isSeeker) {
      // Seekers look for active, untagged Runners across all tracked players (decoupled from ping interval)
      const candidateIds = new Set([...this.lastKnownPositions.keys(), ...this.trueLivePositions.keys()]);
      for (const id of candidateIds) {
        if (this.taggedRunners.has(id)) continue;
        const lastKnown = this.lastKnownPositions.get(id);
        const truePos = this.trueLivePositions.get(id);
        const role = (truePos && truePos.role) || (lastKnown && lastKnown.role);
        if (role !== 'runner') continue;

        const nickname = (truePos && truePos.nickname) || (lastKnown && lastKnown.nickname) || 'Runner';
        const effective = this.getEffectiveRunnerDistance(id, lastKnown, selfLat, selfLng);

        if (effective.distance !== Infinity) {
          const targetObj = {
            id,
            nickname: nickname,
            distance: effective.distance,
            bearing: effective.bearing,
            isLive: effective.isLive,
            source: effective.source
          };
          runnerTargets.push(targetObj);

          if (this.lockedTargetId === id) {
            closestOpponent = targetObj;
            closestDistance = effective.distance;
            closestBearing = effective.bearing;
          }
        }
      }

      runnerTargets.sort((a, b) => a.distance - b.distance);

      if (!closestOpponent && runnerTargets.length > 0) {
        closestOpponent = runnerTargets[0];
        closestDistance = closestOpponent.distance;
        closestBearing = closestOpponent.bearing;
      }

      // Check Tag Range for Seeker using customized setting (instant decoupled check)
      const tagRange = Config.settings.tagDistanceMeters || 15;
      if (closestOpponent && closestOpponent.distance <= tagRange) {
        tagCandidate = closestOpponent;
      }

      UI.renderTargetList(runnerTargets, this.lockedTargetId);

      // Hunter Proximity Warning Alarm
      const hunterProxLimit = Config.settings.hunterProximityAlertMeters || 75;
      if (hunterProxLimit > 0 && closestDistance <= hunterProxLimit) {
        const now = Date.now();
        const cooldownMs = (Config.settings.hunterProximityAlertInterval || 10) * 1000;
        if (now - this.lastHunterProximityAlertTime >= cooldownMs) {
          this.triggerHunterProximityAlert(closestOpponent.nickname, closestDistance, closestBearing);
        }
      }
    } else {
      // Runners watch for Seekers
      for (const [id, pos] of this.lastKnownPositions.entries()) {
        if (pos.role === 'seeker') {
          const dist = GeoEngine.getDistance(selfLat, selfLng, pos.lat, pos.lng);
          if (dist < closestDistance) {
            closestDistance = dist;
            closestBearing = GeoEngine.getBearing(selfLat, selfLng, pos.lat, pos.lng);
            closestOpponent = { id, nickname: pos.nickname || 'Seeker', distance: dist, bearing: closestBearing };
          }
        }
      }

      // Runner Proximity Warning Alarm
      const proxLimit = Config.settings.proximityAlertMeters;
      if (proxLimit > 0 && closestDistance <= proxLimit) {
        const now = Date.now();
        if (now - this.lastProximityAlertTime >= (Config.settings.proximityAlertInterval * 1000)) {
          this.lastProximityAlertTime = now;
          UI.triggerProximityAlert(closestDistance, GeoEngine.getCardinalDirection(closestBearing));
        }
      }
    }

    this.nearestOpponentDistance = closestDistance !== Infinity ? closestDistance : null;
    this.nearestOpponentBearing = closestBearing;

    // Update Proximity HUD
    UI.updateProximityHUD(closestDistance !== Infinity ? closestDistance : null, closestBearing, closestOpponent, this.lockedTargetId !== null);

    // Seeker Tag Action Button trigger
    if (isSeeker) {
      UI.updateTagButtonState(tagCandidate);
    }
  }

  /**
   * Seeker initiates tag
   */
  tagRunner(targetPlayerId, runnerNickname) {
    if (this.role !== 'seeker') return false;

    if (this.taggedRunners.has(targetPlayerId)) {
      UI.showToast(`${runnerNickname} has already been caught!`, 'info');
      return false;
    }

    const now = Date.now();
    if (now - this.lastTagAttemptTime < 1500) {
      return false; // Debounce rapid tag clicks
    }
    this.lastTagAttemptTime = now;

    // Check seeker live GPS
    const selfLat = this.lastSelfCoords ? this.lastSelfCoords.lat : null;
    const selfLng = this.lastSelfCoords ? this.lastSelfCoords.lng : null;
    if (selfLat == null || selfLng == null) {
      UI.showToast('GPS position unavailable', 'warning');
      return false;
    }

    const maxCatchRadius = Config.settings.tagDistanceMeters || 15;
    const lastPos = this.lastKnownPositions.get(targetPlayerId);

    // Decoupled real-time runner distance check
    const effective = this.getEffectiveRunnerDistance(targetPlayerId, lastPos, selfLat, selfLng);
    const trueDistance = effective.distance;

    // Stale Ping Catch Exploit Protection:
    // If seeker attempts to catch near a stale ping marker, but the runner's TRUE live location
    // is outside the catch radius, reject the catch and display the alert:
    if (trueDistance > maxCatchRadius) {
      UI.showToast('The target is no longer here.', 'warning');
      UI.playAudioCue('radar-blip');
      return false;
    }

    const tagDistance = Math.round(trueDistance);
    const tagData = {
      seekerId: Network.playerId,
      seekerName: this.nickname,
      runnerId: targetPlayerId,
      runnerName: runnerNickname,
      tagDistance: tagDistance,
      seekerLat: selfLat,
      seekerLng: selfLng,
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
    return true;
  }

  /**
   * Runner receives tag request prompt
   */
  handleTagRequest(data) {
    if (data.runnerId !== Network.playerId) return;

    // Gate tag event: if already caught, or role already converted, or already tagged, ignore
    if (this.isCaught || this.isTagged || this.role === 'seeker' || this.taggedRunners.has(Network.playerId)) {
      return;
    }

    // Double check on runner: if seeker transmitted seekerLat/seekerLng, verify live distance
    if (data.seekerLat != null && data.seekerLng != null && this.lastSelfCoords) {
      const liveDist = GeoEngine.getDistance(this.lastSelfCoords.lat, this.lastSelfCoords.lng, data.seekerLat, data.seekerLng);
      const maxLeniency = (Config.settings.tagDistanceMeters || 15) + 12; // Buffer for GPS drift
      if (liveDist > maxLeniency) {
        console.warn(`Tag rejected by runner: live distance ${liveDist}m exceeds allowed range`);
        return;
      }
    }

    // Debounce duplicate prompts for identical tag within 5 seconds
    if (this.pendingTagRequest && this.pendingTagRequest.seekerId === data.seekerId && (Date.now() - (this.pendingTagRequest.timestamp || 0) < 5000)) {
      return;
    }

    this.pendingTagRequest = data;
    if (Config.settings.requireTagConfirmation) {
      UI.notifyCriticalEvent('TAG VERIFICATION REQUIRED', `🚨 Seeker ${data.seekerName} claims to have tagged you! Confirm on phone.`, 'danger');
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
    if (this.isCaught || this.taggedRunners.has(Network.playerId)) return;
    this.isCaught = true;

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
      UI.notifyCriticalEvent('TAG DISPUTED', `❌ ${data.runnerName} disputed your tag!`, 'danger');
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
    if (this.taggedRunners.has(targetPlayerId)) return;

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
    UI.notifyCriticalEvent('HOST FORCE TAG', `👑 Host confirmed tag on ${runnerNickname}`, 'info');
    this.populateHostControlsModal();
  }

  /**
   * Process confirmed tag across all clients
   */
  onRemoteTagConfirmed(data) {
    const { seekerName, runnerId, runnerName } = data;

    // Prevent duplicate processing & notification spam from burst retransmissions
    if (this.taggedRunners.has(runnerId)) {
      return;
    }
    this.taggedRunners.add(runnerId);

    const isSelf = runnerId === Network.playerId;
    if (isSelf) {
      this.isCaught = true;
      if (this.pendingTagRequest) {
        this.pendingTagRequest = null;
        UI.closeModal('modal-runner-tag-confirm');
      }
    }

    UI.playAudioCue('tag');

    const isInfection = Config.settings.runnerCaptureMode === 'infection';

    if (isSelf) {
      if (isInfection) {
        // Converted to Seeker!
        this.role = 'seeker';
        Network.role = 'seeker';
        UI.adaptHUDForRole('seeker');
        UI.playAudioCue('siren');
        UI.notifyCriticalEvent('INFECTION - CONVERTED TO SEEKER', '🧬 YOU WERE CAUGHT! You are now a SEEKER! Hunt surviving runners!', 'danger');
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
        UI.notifyCriticalEvent('YOU WERE ELIMINATED', `🎯 Tagged by ${seekerName}! You are now a spectator.`, 'danger');
        UI.showCapturedModal();
      }
    } else {
      // Critical match event alert broadcast to squad
      UI.notifyCriticalEvent('RUNNER CAUGHT!', `🎯 ${runnerName} was tagged by ${seekerName}!`, 'danger');
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
    if (this.state === 'GAME_OVER' || this.state === 'LOBBY' || this.state === 'WAITING') return;

    // Use initialRunners if populated; fallback to activeRunners or Network peers
    const runnerPool = (this.initialRunners && this.initialRunners.size > 0) ? this.initialRunners : this.activeRunners;

    let untaggedCount = 0;
    for (const runnerId of runnerPool) {
      if (!this.taggedRunners.has(runnerId)) {
        untaggedCount++;
      }
    }

    // Also check if any peer in Network is an untagged runner
    for (const [id, peer] of Network.peers.entries()) {
      if (peer.role === 'runner' && !this.taggedRunners.has(id)) {
        if (!runnerPool.has(id)) {
          untaggedCount++;
        }
      }
    }

    // Also check self if local player is runner
    if (this.role === 'runner' && !this.taggedRunners.has(Network.playerId)) {
      if (!runnerPool.has(Network.playerId)) {
        untaggedCount++;
      }
    }

    const totalRunnersCount = Math.max(runnerPool.size, this.taggedRunners.size);

    console.log(`[VICTORY CHECK] Untagged runners remaining: ${untaggedCount}, Total match runners: ${totalRunnersCount}`);

    // If all runners have been tagged and there was at least 1 runner in the match
    if (untaggedCount === 0 && totalRunnersCount > 0) {
      const gameOverPayload = {
        winner: 'Seekers',
        reason: 'all_runners_tagged',
        message: Config.settings.runnerCaptureMode === 'infection'
          ? 'Infection complete! All runners were hunted down and converted!'
          : 'All runners were captured by the seekers!',
        duration: Math.round((Date.now() - this.matchStartTimestamp) / 1000),
        totalRunners: totalRunnersCount,
        taggedCount: this.taggedRunners.size,
        timestamp: Date.now()
      };

      // Broadcast to all clients across the room with burst reliability
      Network.broadcast('match_over', gameOverPayload, true);

      // Conclude local game
      this.endGame(gameOverPayload);
    }
  }

  onRemoteGameOver(data) {
    if (this.state === 'GAME_OVER') return;
    console.log('🏆 Global match_over broadcast received:', data);
    this.endGame(data);
  }

  endGame(payloadOrReason) {
    if (this.state === 'GAME_OVER') return;
    this.state = 'GAME_OVER';

    if (this.gameLoopInterval) {
      clearInterval(this.gameLoopInterval);
      this.gameLoopInterval = null;
    }

    let winner = 'Seekers';
    let message = '';
    let duration = Math.round((Date.now() - this.matchStartTimestamp) / 1000);
    const runnerPool = (this.initialRunners && this.initialRunners.size > 0) ? this.initialRunners : this.activeRunners;
    let totalRunners = runnerPool.size;
    let taggedCount = this.taggedRunners.size;

    if (typeof payloadOrReason === 'object' && payloadOrReason !== null) {
      winner = payloadOrReason.winner || 'Seekers';
      message = payloadOrReason.message || '';
      duration = payloadOrReason.duration || duration;
      totalRunners = payloadOrReason.totalRunners || totalRunners;
      taggedCount = payloadOrReason.taggedCount || taggedCount;
      this.lastGameOverData = payloadOrReason;
    } else {
      const reason = payloadOrReason;
      if (reason === 'all_runners_tagged') {
        winner = 'Seekers';
        message = Config.settings.runnerCaptureMode === 'infection'
          ? 'Infection complete! All runners were hunted down and converted!'
          : 'All runners were captured by the seekers!';
      } else if (reason === 'time_expired') {
        winner = 'Runners';
        message = 'Time expired! Surviving runners successfully evaded pursuit!';
      } else if (reason === 'admin_terminated') {
        winner = 'Operation Aborted';
        message = 'Match terminated by System Administrator.';
      }
      this.lastGameOverData = {
        winner,
        reason,
        message,
        duration,
        totalRunners: Math.max(totalRunners, taggedCount),
        taggedCount
      };
    }

    UI.playAudioCue('victory');

    UI.notifyCriticalEvent(
      'OPERATION CONCLUDED',
      `🏆 VICTORY: ${winner} won! ${message}`,
      'info'
    );

    // Pull ALL players (runners and seekers) out of the active map and show Game Over screen
    UI.showGameOverScreen({
      winner,
      message,
      duration,
      totalRunners: Math.max(totalRunners, taggedCount),
      taggedCount
    });
  }

  leaveMatch() {
    Geo.stopTracking();
    Network.disconnect();
    this.resetMatchState();
    this.state = 'LOBBY';
    UI.releaseWakeLock();
    UI.setPauseState(false);
    UI.showScreen('screen-lobby');
    UI.showToast('Exited operation. Returned to lobby.', 'info');
  }
}

// Global ManhuntGame singleton
const Game = new ManhuntGame();
