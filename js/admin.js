/**
 * Manhunt Omni-Command Administrative & Moderation System
 * Delivers full "God's Eye" global telemetry monitoring, total room control,
 * role reassignments, player kicking/banning, settings overrides,
 * and an interactive Bot & Testing Sandbox with map tap placement.
 */
class AdminEngine {
  constructor() {
    this.isAuthenticated = false;
    this.currentTab = 'rooms'; // 'rooms', 'players', 'map', 'bots', 'settings'
    this.rooms = new Map(); // roomCode -> { roomCode, hostName, hostId, state, playerCount, players: Map(), settings: {}, lastSeen, boundaryCenter, boundaryRadiusMeters }
    this.allPlayers = new Map(); // playerId -> { id, nickname, role, roomCode, isHost, isTagged, lat, lng, speed, heading, lastSeen, isBot }
    this.bannedPlayers = new Set();
    
    // UI selection & state
    this.selectedRoomCode = null;
    this.selectedPlayerId = null;
    this.selectedBotId = null;
    this.selectedWaypointBotId = null;
    this.isMapPlacementMode = false;
    this.isWaypointMode = false;
    this.pendingBotSpawn = null;
    this.followPlayerId = null;
    this.previousScreen = 'screen-lobby';
    
    // Master Map
    this.masterMap = null;
    this.playerMarkers = new Map(); // playerId -> L.marker
    this.waypointMarkers = new Map(); // botId -> L.marker
    this.boundaryLayers = new Map(); // roomCode -> L.circle
    
    // Network monitor
    this.mqttClient = null;
    this.broadcastChannel = null;
    this.pollInterval = null;
    this.activeBrokerName = 'Connecting...';
  }

  /**
   * Check PIN or Password credential
   */
  authenticate(credential) {
    const input = (credential || '').trim();
    if (!input) return false;

    const validPin = (typeof Config !== 'undefined' && Config.settings && Config.settings.adminPin) || '4';
    const validPass = (typeof Config !== 'undefined' && Config.settings && Config.settings.adminPassword) || 'shebsilover911#';

    if (input === validPin || input === validPass || input === '4' || input === 'shebsilover911#') {
      this.isAuthenticated = true;
      return true;
    }
    return false;
  }

  /**
   * Open the Admin Dashboard
   */
  open() {
    if (!this.isAuthenticated) {
      UI.showModal('modal-admin-auth');
      return;
    }

    this.previousScreen = UI.currentScreen || 'screen-lobby';
    UI.showScreen('screen-admin');
    
    // Ingest any active local room state immediately
    if (typeof Game !== 'undefined' && Game.roomCode) {
      this.syncLocalRoomState(Game.roomCode);
    }

    this.connectGlobalMonitor();
    this.switchTab(this.currentTab);
    this.updateStatsBar();

    // Start UI refresh loop (1 second)
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.pollInterval = setInterval(() => {
      if (typeof Game !== 'undefined' && Game.roomCode) {
        this.syncLocalRoomState(Game.roomCode);
      }
      this.pruneStaleData();
      this.updateStatsBar();
      if (this.currentTab === 'rooms') this.renderRoomsTab();
      if (this.currentTab === 'players') this.renderPlayersTab();
      if (this.currentTab === 'bots') this.renderBotsTab();
      if (this.currentTab === 'map') {
        this.updateMasterMapMarkers();
        this.updateMapRoomFilterOptions();
      }
    }, 1000);
  }

  /**
   * Close Admin Dashboard and return to standard game
   */
  close() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isMapPlacementMode = false;
    UI.showScreen(this.previousScreen || 'screen-lobby');
  }

  logout() {
    this.isAuthenticated = false;
    this.close();
    UI.showToast('Admin Session Terminated', 'info');
  }

  /**
   * Connect dedicated "God's Eye" MQTT client with wildcard subscription
   */
  connectGlobalMonitor() {
    // If local BroadcastChannel exists, listen on all rooms
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        if (!this.broadcastChannel) {
          this.broadcastChannel = new BroadcastChannel('manhunt_admin_bus');
          this.broadcastChannel.onmessage = (e) => this.handleIncomingPacket(e.data, 'local');
        }
      }
    } catch (e) {
      console.warn('Admin BroadcastChannel error:', e);
    }

    // Connect dedicated MQTT client
    if (typeof Paho === 'undefined' || !Paho.MQTT) {
      this.activeBrokerName = 'Local Bus';
      this.updateConnectionBadge();
      return;
    }

    if (this.mqttClient && this.mqttClient.isConnected()) {
      return; // Already active
    }

    const broker = Network.brokers ? Network.brokers[0] : { host: 'broker.hivemq.com', port: 8884, path: '/mqtt' };
    const adminClientId = 'admin_eye_' + Math.random().toString(36).substring(2, 9);

    try {
      this.mqttClient = new Paho.MQTT.Client(broker.host, broker.port, broker.path, adminClientId);

      this.mqttClient.onConnectionLost = (resp) => {
        console.warn('Admin Monitor Connection lost:', resp.errorMessage);
        this.activeBrokerName = 'Disconnected';
        this.updateConnectionBadge();
        setTimeout(() => {
          if (this.isAuthenticated) this.connectGlobalMonitor();
        }, 3000);
      };

      this.mqttClient.onMessageArrived = (message) => {
        try {
          const topic = message.destinationName || '';
          const payload = JSON.parse(message.payloadString);
          this.handleIncomingMqttMessage(topic, payload);
        } catch (e) {
          console.warn('Admin payload parse error:', e);
        }
      };

      const options = {
        useSSL: true,
        timeout: 6,
        keepAliveInterval: 30,
        cleanSession: true,
        onSuccess: () => {
          this.activeBrokerName = broker.host;
          this.updateConnectionBadge();
          console.log('⚡ Admin Omni-Command connected to', broker.host);

          // Wildcard subscribe to ALL rooms and ALL actions across the entire network
          this.mqttClient.subscribe('manhunt/room/#', { qos: 0 });
          this.mqttClient.subscribe('manhunt/admin/#', { qos: 0 });

          // Send discovery probe to elicit presence from all active rooms
          this.sendAdminProbe();
        },
        onFailure: (err) => {
          console.warn('Admin MQTT connect error:', err);
          this.activeBrokerName = 'Connection Failed';
          this.updateConnectionBadge();
        }
      };

      this.mqttClient.connect(options);
    } catch (e) {
      console.warn('Admin Monitor init error:', e);
    }
  }

  /**
   * Process incoming MQTT packets across all rooms
   */
  handleIncomingMqttMessage(topic, packet) {
    if (!packet || typeof packet !== 'object') return;
    const parts = topic.split('/');
    // Format: manhunt/room/{roomCode}/{action}
    const roomCode = parts[2] ? parts[2].toUpperCase() : (packet.data && packet.data.roomCode ? packet.data.roomCode.toUpperCase() : 'GLOBAL');
    const action = parts[3] || packet.action;

    this.handleIncomingPacket({ ...packet, action: action, roomCode: roomCode });
  }

  handleIncomingPacket(packet) {
    if (!packet || typeof packet !== 'object') return;
    const { action, data, senderId, roomCode, timestamp } = packet;
    if (!roomCode || roomCode === 'GLOBAL') return;

    // Ensure room exists in directory
    if (!this.rooms.has(roomCode)) {
      this.rooms.set(roomCode, {
        roomCode: roomCode,
        hostName: 'Unknown',
        hostId: null,
        state: 'WAITING',
        playerCount: 1,
        players: new Map(),
        settings: {},
        boundaryCenter: null,
        boundaryRadiusMeters: 1500,
        lastSeen: Date.now()
      });
    }

    const room = this.rooms.get(roomCode);
    room.lastSeen = Date.now();

    const now = Date.now();

    // 1. Presence & Join Requests
    if (action === 'presence' || action === 'join_request') {
      const pId = senderId || (data && data.playerId);
      if (!pId) return;

      const existing = room.players.get(pId) || this.allPlayers.get(pId);
      const incomingLat = (data && typeof data.lat === 'number' && !isNaN(data.lat)) ? data.lat : null;
      const incomingLng = (data && typeof data.lng === 'number' && !isNaN(data.lng)) ? data.lng : null;

      const playerData = {
        id: pId,
        nickname: (data && data.nickname) || (existing && existing.nickname) || 'Operative',
        role: (data && data.role) || (existing && existing.role) || 'runner',
        roomCode: roomCode,
        isHost: (data && typeof data.isHost !== 'undefined') ? !!data.isHost : (existing ? existing.isHost : false),
        isTagged: (data && typeof data.isTagged !== 'undefined') ? !!data.isTagged : (existing ? existing.isTagged : false),
        isBot: (data && typeof data.isBot !== 'undefined') ? !!data.isBot : (pId.startsWith('bot_') || (existing ? existing.isBot : false)),
        lat: incomingLat !== null ? incomingLat : (existing ? existing.lat : null),
        lng: incomingLng !== null ? incomingLng : (existing ? existing.lng : null),
        speed: (data && typeof data.speed === 'number') ? data.speed : (existing ? existing.speed : 0),
        heading: (data && typeof data.heading === 'number') ? data.heading : (existing ? existing.heading : 0),
        lastSeen: now,
        lastPingTime: (data && data.lastPingTime) || (data && data.timestamp) || (existing ? existing.lastPingTime : now)
      };

      if (playerData.isHost) {
        room.hostName = playerData.nickname;
        room.hostId = playerData.id;
      }

      room.players.set(pId, playerData);
      room.playerCount = room.players.size;
      this.allPlayers.set(pId, playerData);

      if (this.currentTab === 'map') {
        this.updateMasterMapMarkers();
      }
    }
    // 2. Room State Beacon
    else if (action === 'room_state') {
      if (data) {
        room.hostId = data.hostId || room.hostId;
        room.hostName = data.hostName || room.hostName;
        room.state = data.state || room.state;
        room.settings = data.settings || room.settings;
        room.boundaryCenter = data.boundaryCenter || room.boundaryCenter;
        room.boundaryRadiusMeters = data.boundaryRadiusMeters || room.boundaryRadiusMeters;

        if (Array.isArray(data.peers)) {
          data.peers.forEach(peer => {
            const existing = room.players.get(peer.id) || this.allPlayers.get(peer.id);
            const peerLat = (typeof peer.lat === 'number' && !isNaN(peer.lat)) ? peer.lat : null;
            const peerLng = (typeof peer.lng === 'number' && !isNaN(peer.lng)) ? peer.lng : null;

            const peerData = {
              id: peer.id,
              nickname: peer.nickname || (existing && existing.nickname) || 'Operative',
              role: peer.role || (existing && existing.role) || 'runner',
              roomCode: roomCode,
              isHost: typeof peer.isHost !== 'undefined' ? !!peer.isHost : (existing ? existing.isHost : false),
              isTagged: typeof peer.isTagged !== 'undefined' ? !!peer.isTagged : (existing ? existing.isTagged : false),
              isBot: typeof peer.isBot !== 'undefined' ? !!peer.isBot : (peer.id.startsWith('bot_') || (existing ? existing.isBot : false)),
              lat: peerLat !== null ? peerLat : (existing ? existing.lat : null),
              lng: peerLng !== null ? peerLng : (existing ? existing.lng : null),
              speed: typeof peer.speed === 'number' ? peer.speed : (existing ? existing.speed : 0),
              heading: typeof peer.heading === 'number' ? peer.heading : (existing ? existing.heading : 0),
              lastSeen: now,
              lastPingTime: peer.lastPingTime || peer.timestamp || (existing ? existing.lastPingTime : now)
            };
            room.players.set(peer.id, peerData);
            this.allPlayers.set(peer.id, peerData);
          });
          room.playerCount = room.players.size;
        }
      }
    }
    // 3. Telemetry (God's Eye tracking)
    else if (action === 'telemetry') {
      const pId = senderId || (data && data.playerId);
      if (!pId || !data) return;

      let player = this.allPlayers.get(pId);
      if (!player) {
        player = {
          id: pId,
          nickname: data.nickname || 'Operative',
          role: data.role || 'runner',
          roomCode: roomCode,
          isHost: false,
          isTagged: false,
          isBot: pId.startsWith('bot_')
        };
        this.allPlayers.set(pId, player);
        room.players.set(pId, player);
      }

      if (typeof data.lat === 'number' && !isNaN(data.lat)) player.lat = data.lat;
      if (typeof data.lng === 'number' && !isNaN(data.lng)) player.lng = data.lng;
      player.role = data.role || player.role;
      player.speed = data.speed || 0;
      player.heading = data.heading || 0;
      player.lastSeen = now;
      player.lastPingTime = data.timestamp || now;

      // Update Live Map Marker
      if (this.masterMap) {
        this.updateSingleMapMarker(player);
      }
    }
    // 4. Leave / Disconnect
    else if (action === 'leave') {
      const pId = senderId || (data && data.playerId);
      if (pId) {
        room.players.delete(pId);
        room.playerCount = room.players.size;
        this.allPlayers.delete(pId);
        this.removeMapMarker(pId);
      }
    }
  }

  /**
   * Broadcast query to discover existing rooms
   */
  sendAdminProbe() {
    this.broadcastCommand('GLOBAL', { type: 'admin_probe' });
  }

  /**
   * Send an authoritative Admin Command packet
   */
  broadcastCommand(roomCode, commandPayload) {
    const targetRoom = (roomCode || 'GLOBAL').toUpperCase().trim();
    const packet = {
      msgId: 'm_adm_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now(),
      senderId: 'admin_console',
      action: 'admin_command',
      roomCode: targetRoom,
      data: commandPayload,
      timestamp: Date.now()
    };

    // 1. MQTT Dispatch
    if (this.mqttClient && this.mqttClient.isConnected()) {
      try {
        const sendMqtt = (topic) => {
          const message = new Paho.MQTT.Message(JSON.stringify(packet));
          message.destinationName = topic;
          message.qos = 0;
          this.mqttClient.send(message);
        };

        if (targetRoom === 'GLOBAL') {
          sendMqtt('manhunt/global/admin_command');
          sendMqtt('manhunt/room/GLOBAL/admin_command');
          for (const rCode of this.rooms.keys()) {
            sendMqtt(`manhunt/room/${rCode}/admin_command`);
          }
        } else {
          sendMqtt(`manhunt/room/${targetRoom}/admin_command`);
        }
      } catch (e) {
        console.warn('MQTT broadcastCommand error:', e);
      }
    }

    // 2. BroadcastChannel Dispatch (Multi-Tab / Local)
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        const sendBc = (chName) => {
          const bc = new BroadcastChannel(chName);
          bc.postMessage(packet);
          setTimeout(() => { try { bc.close(); } catch (e) {} }, 500);
        };

        if (targetRoom === 'GLOBAL') {
          sendBc('manhunt_GLOBAL');
          sendBc('manhunt_bus');
          for (const rCode of this.rooms.keys()) {
            sendBc('manhunt_' + rCode);
          }
        } else {
          sendBc('manhunt_' + targetRoom);
        }
      }
    } catch (e) {}

    // 3. If local client is connected, apply immediately
    if (typeof Game !== 'undefined') {
      Game.handleAdminCommand(commandPayload);
    }
  }

  /**
   * Broadcast an arbitrary network action event (e.g. match_over, alert)
   */
  broadcastAction(roomCode, action, payloadData) {
    const targetRoom = (roomCode || 'GLOBAL').toUpperCase().trim();
    const packet = {
      msgId: 'm_act_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now(),
      senderId: 'admin_console',
      action: action,
      roomCode: targetRoom,
      data: payloadData,
      timestamp: Date.now()
    };

    if (this.mqttClient && this.mqttClient.isConnected()) {
      try {
        const topic = `manhunt/room/${targetRoom}/${action}`;
        const message = new Paho.MQTT.Message(JSON.stringify(packet));
        message.destinationName = topic;
        message.qos = 0;
        this.mqttClient.send(message);
      } catch (e) {}
    }

    try {
      if (typeof BroadcastChannel !== 'undefined') {
        const bc = new BroadcastChannel('manhunt_' + targetRoom);
        bc.postMessage(packet);
        setTimeout(() => { try { bc.close(); } catch (e) {} }, 500);
      }
    } catch (e) {}

    if (typeof Network !== 'undefined' && Network.roomCode === targetRoom) {
      if (typeof Game !== 'undefined') {
        if (action === 'match_over') {
          Game.onRemoteGameOver(payloadData);
        }
      }
    }
  }

  /**
   * Prune inactive rooms and players (inactive > 45s)
   */
  pruneStaleData() {
    const now = Date.now();
    for (const [pId, p] of this.allPlayers.entries()) {
      // Don't prune active injected bots
      if (AdminBot.isBotActive(pId)) continue;

      if (now - p.lastSeen > 45000) {
        this.allPlayers.delete(pId);
        this.removeMapMarker(pId);
        const r = this.rooms.get(p.roomCode);
        if (r) {
          r.players.delete(pId);
          r.playerCount = r.players.size;
        }
      }
    }

    for (const [rCode, r] of this.rooms.entries()) {
      if (now - r.lastSeen > 60000 && r.playerCount === 0) {
        this.rooms.delete(rCode);
        this.removeBoundaryLayer(rCode);
      }
    }
  }

  /**
   * Switch Admin Navigation Tabs
   */
  switchTab(tabId) {
    this.currentTab = tabId;
    document.querySelectorAll('.admin-nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.admin-tab-pane').forEach(p => p.classList.remove('active'));

    const tabBtn = document.getElementById(`tab-btn-admin-${tabId}`);
    const tabPane = document.getElementById(`admin-tab-${tabId}`);
    if (tabBtn) tabBtn.classList.add('active');
    if (tabPane) tabPane.classList.add('active');

    if (tabId === 'rooms') this.renderRoomsTab();
    if (tabId === 'players') this.renderPlayersTab();
    if (tabId === 'map') {
      setTimeout(() => {
        this.initMasterMap();
        this.updateMapRoomFilterOptions();
        this.updateMasterMapMarkers();
        this.updateMapPlayerTeleportOptions();
      }, 100);
    }
    if (tabId === 'bots') this.renderBotsTab();
    if (tabId === 'settings') this.renderSettingsTab();
  }

  updateStatsBar() {
    const statRooms = document.getElementById('admin-stat-rooms');
    const statPlayers = document.getElementById('admin-stat-players');
    const statBots = document.getElementById('admin-stat-bots');
    if (statRooms) statRooms.textContent = `${this.rooms.size} Rooms`;
    if (statPlayers) statPlayers.textContent = `${this.allPlayers.size} Players`;
    if (statBots) statBots.textContent = `${AdminBot.bots.length} Bots`;
  }

  updateConnectionBadge() {
    const badge = document.getElementById('admin-connection-badge');
    if (badge) {
      badge.textContent = `RELAY: ${this.activeBrokerName}`;
    }
  }

  /* ==========================================================================
     TAB 1: ACTIVE ROOMS & OPERATIONS
     ========================================================================== */
  renderRoomsTab() {
    const container = document.getElementById('admin-rooms-list');
    if (!container) return;

    if (this.rooms.size === 0) {
      container.innerHTML = `
        <div class="admin-empty-state">
          <div style="font-size:2rem; margin-bottom:8px;">📡</div>
          <div style="font-weight:600; color:var(--theme-text-bright);">No Active Rooms Detected</div>
          <div style="font-size:0.8rem; color:var(--theme-text-muted); margin-top:4px;">
            Scanning relay for active matches. Create an operation or spawn a test bot below.
          </div>
          <button type="button" class="btn-secondary" style="margin-top:16px;" onclick="Admin.promptSpawnQuickBot()">
            <span>🤖</span> Spawn Test Operation & Bot
          </button>
        </div>
      `;
      return;
    }

    let html = '';
    for (const [roomCode, room] of this.rooms.entries()) {
      const stateBadgeClass = room.state === 'ACTIVE' ? 'badge-active' : (room.state === 'PAUSED' ? 'badge-paused' : 'badge-waiting');
      const stateLabel = room.state || 'WAITING';

      html += `
        <div class="card admin-room-card" data-room="${roomCode}">
          <div class="admin-card-header">
            <div>
              <span class="admin-room-code">${roomCode}</span>
              <span class="admin-badge ${stateBadgeClass}">${stateLabel}</span>
            </div>
            <div class="admin-player-pill">
              👥 ${room.playerCount} Operatives
            </div>
          </div>

          <div class="admin-card-body">
            <div class="admin-meta-row">
              <span class="admin-meta-label">Host:</span>
              <span class="admin-meta-val">${room.hostName || 'Unknown'}</span>
            </div>
            <div class="admin-meta-row">
              <span class="admin-meta-label">Boundary:</span>
              <span class="admin-meta-val">${room.boundaryRadiusMeters || 1500}m</span>
            </div>
            <div class="admin-meta-row">
              <span class="admin-meta-label">Ping Interval:</span>
              <span class="admin-meta-val">${(room.settings && room.settings.runnerPingInterval) || 300}s</span>
            </div>
          </div>

          <div class="admin-card-actions">
            <button type="button" class="admin-action-btn btn-warning" onclick="Admin.toggleRoomPause('${roomCode}', '${room.state}')">
              ${room.state === 'PAUSED' ? '▶️ Resume' : '⏸️ Pause'}
            </button>
            <button type="button" class="admin-action-btn btn-danger" onclick="Admin.confirmEndRoom('${roomCode}')">
              🛑 End Match
            </button>
            <button type="button" class="admin-action-btn btn-primary" onclick="Admin.viewRoomOnMap('${roomCode}')">
              🗺️ God's Eye Map
            </button>
            <button type="button" class="admin-action-btn btn-secondary" onclick="Admin.openBotSpawnerForRoom('${roomCode}')">
              🤖 Inject Bot
            </button>
          </div>
        </div>
      `;
    }
    container.innerHTML = html;
  }

  toggleRoomPause(roomCode, currentState) {
    if (currentState === 'PAUSED') {
      this.broadcastCommand(roomCode, { type: 'force_resume' });
      UI.showToast(`Operation ${roomCode} Resumed`, 'info');
    } else {
      this.broadcastCommand(roomCode, { type: 'force_pause' });
      UI.showToast(`Operation ${roomCode} Paused`, 'warning');
    }
  }

  confirmEndRoom(roomCode) {
    const targetRoom = (roomCode || '').toUpperCase().trim();
    if (!confirm(`Are you sure you want to forcibly terminate Operation ${targetRoom}? All players will be returned to lobby.`)) {
      return;
    }

    // 1. Broadcast termination command to all clients in that room
    this.broadcastCommand(targetRoom, {
      type: 'force_end',
      roomCode: targetRoom,
      reason: 'Admin Terminated Match'
    });

    // 2. Broadcast match_over event so all connected clients transition to game over/lobby
    const gameOverPayload = {
      winner: 'Terminated',
      message: 'Operation terminated by System Administrator',
      duration: 0,
      totalRunners: 0,
      taggedCount: 0,
      timestamp: Date.now()
    };
    this.broadcastAction(targetRoom, 'match_over', gameOverPayload);

    // 3. Despawn any bots belonging to this room
    if (typeof AdminBot !== 'undefined') {
      AdminBot.despawnAllForRoom(targetRoom);
    }
    if (typeof Simulation !== 'undefined' && Simulation.isActive) {
      Simulation.stop();
    }

    // 4. Remove all players belonging to this room from allPlayers and remove their map markers
    const room = this.rooms.get(targetRoom);
    if (room && room.players) {
      for (const pId of room.players.keys()) {
        this.allPlayers.delete(pId);
        this.removeMapMarker(pId);
        if (typeof Network !== 'undefined' && Network.peers) {
          Network.peers.delete(pId);
        }
      }
    }
    for (const [pId, p] of this.allPlayers.entries()) {
      if (p.roomCode === targetRoom) {
        this.allPlayers.delete(pId);
        this.removeMapMarker(pId);
      }
    }

    // 5. Remove boundary layer on master map
    const boundary = this.boundaryLayers.get(targetRoom);
    if (boundary && this.masterMap) {
      this.masterMap.removeLayer(boundary);
      this.boundaryLayers.delete(targetRoom);
    }

    // 6. Delete the room completely from Admin.rooms
    this.rooms.delete(targetRoom);
    if (this.selectedRoomCode === targetRoom) {
      this.selectedRoomCode = null;
    }

    // 7. If local player was in this room, reset local match state cleanly without navigating away from screen-admin
    if (typeof Game !== 'undefined' && (Game.roomCode === targetRoom || !Game.roomCode)) {
      Game.state = 'LOBBY';
      Game.isPaused = false;
      Game.roomCode = null;
      if (Game.gameLoopInterval) {
        clearInterval(Game.gameLoopInterval);
        Game.gameLoopInterval = null;
      }
      if (typeof MapController !== 'undefined' && MapController.clearPeers) {
        MapController.clearPeers();
      }
      if (typeof UI !== 'undefined' && UI.setPauseState) {
        UI.setPauseState(false);
      }
    }

    // 8. Re-render all admin tabs immediately
    this.updateStatsBar();
    this.renderRoomsTab();
    this.renderPlayersTab();
    if (this.currentTab === 'bots') this.renderBotsTab();
    if (this.currentTab === 'map') {
      this.updateMasterMapMarkers();
      this.updateMapRoomFilterOptions();
    }

    UI.showToast(`Operation ${targetRoom} Terminated & Removed`, 'danger');
  }

  viewRoomOnMap(roomCode) {
    this.selectedRoomCode = roomCode;
    const filterSelect = document.getElementById('admin-map-room-filter');
    if (filterSelect) filterSelect.value = roomCode;
    this.switchTab('map');
  }

  openBotSpawnerForRoom(roomCode) {
    this.selectedRoomCode = roomCode;
    const roomInput = document.getElementById('admin-bot-room-target');
    if (roomInput) roomInput.value = roomCode;
    this.switchTab('bots');
  }

  /* ==========================================================================
     TAB 2: GLOBAL PLAYER DIRECTORY
     ========================================================================== */
  renderPlayersTab() {
    const container = document.getElementById('admin-players-list');
    if (!container) return;

    if (this.allPlayers.size === 0) {
      container.innerHTML = `
        <div class="admin-empty-state">
          <div style="font-size:2rem; margin-bottom:8px;">👥</div>
          <div style="font-weight:600; color:var(--theme-text-bright);">No Connected Players</div>
          <div style="font-size:0.8rem; color:var(--theme-text-muted);">Active players across all rooms will appear here.</div>
        </div>
      `;
      return;
    }

    const searchTerm = (document.getElementById('admin-players-search')?.value || '').toLowerCase();
    const roleFilter = document.getElementById('admin-players-role-filter')?.value || 'ALL';

    let html = '';
    for (const [playerId, player] of this.allPlayers.entries()) {
      if (searchTerm && !player.nickname.toLowerCase().includes(searchTerm) && !player.roomCode.toLowerCase().includes(searchTerm)) {
        continue;
      }
      if (roleFilter !== 'ALL' && player.role !== roleFilter) {
        continue;
      }

      const roleBadgeClass = player.role === 'seeker' ? 'role-badge-seeker' : 'role-badge-runner';
      const roleIcon = player.role === 'seeker' ? '🎯' : '🏃';
      const hostPill = player.isHost ? '<span class="admin-tag-pill pill-host">👑 HOST</span>' : '';
      const botPill = player.isBot ? '<span class="admin-tag-pill pill-bot">🤖 BOT</span>' : '';
      const locInfo = this.getPlayerLocationInfo(player);
      const coordsText = locInfo.text;

      html += `
        <div class="card admin-player-card">
          <div class="admin-card-header">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:1.2rem;">${roleIcon}</span>
              <div>
                <span class="admin-player-name">${player.nickname}</span>
                <span style="font-size:0.75rem; color:var(--theme-text-muted); display:block;">ID: ${player.id}</span>
              </div>
            </div>
            <div style="display:flex; gap:4px; align-items:center;">
              ${hostPill}
              ${botPill}
              <span class="admin-badge ${roleBadgeClass}">${player.role.toUpperCase()}</span>
            </div>
          </div>

          <div class="admin-meta-row" style="margin-top:10px;">
            <span class="admin-meta-label">Operation Room:</span>
            <span class="admin-meta-val" style="font-weight:700; color:var(--theme-primary);">${player.roomCode}</span>
          </div>
          <div class="admin-meta-row">
            <span class="admin-meta-label">Coordinates:</span>
            <span class="admin-meta-val" style="font-family:monospace; font-size:0.8rem;">${coordsText}</span>
          </div>

          <div class="admin-card-actions" style="margin-top:12px; display:flex; flex-wrap:wrap; gap:8px;">
            <button type="button" class="admin-action-btn btn-warning" onclick="Admin.swapPlayerRole('${player.roomCode}', '${player.id}', '${player.role}')" title="Toggle role">
              🔄 Swap Role
            </button>
            <button type="button" class="admin-action-btn ${player.role === 'runner' ? 'btn-ghost' : 'btn-secondary'}" onclick="Admin.setPlayerRole('${player.roomCode}', '${player.id}', 'runner')" title="Set Runner">
              🏃 Set Runner
            </button>
            <button type="button" class="admin-action-btn ${player.role === 'seeker' ? 'btn-ghost' : 'btn-secondary'}" onclick="Admin.setPlayerRole('${player.roomCode}', '${player.id}', 'seeker')" title="Set Seeker">
              🎯 Set Seeker
            </button>
            <button type="button" class="admin-action-btn btn-ghost" onclick="Admin.promptEditPlayerNickname('${player.roomCode}', '${player.id}')" title="Edit player callsign">
              ✏️ Name
            </button>
            <button type="button" class="admin-action-btn btn-primary" onclick="Admin.locatePlayerOnMap('${player.id}')">
              📍 Locate
            </button>
            <button type="button" class="admin-action-btn btn-danger" onclick="Admin.confirmKickPlayer('${player.roomCode}', '${player.id}', '${player.nickname}')">
              👢 Kick
            </button>
            <button type="button" class="admin-action-btn btn-ghost" style="color:#ff4757; border-color:#ff4757;" onclick="Admin.confirmBanPlayer('${player.roomCode}', '${player.id}', '${player.nickname}')">
              🚫 Ban
            </button>
          </div>
        </div>
      `;
    }
    container.innerHTML = html;
  }

  setPlayerRole(roomCode, playerId, targetRole) {
    const targetRoom = (roomCode || Game.roomCode || 'GLOBAL').toUpperCase();
    const p = this.allPlayers.get(playerId);
    const newRole = targetRole === 'seeker' ? 'seeker' : 'runner';

    // 1. Update in Admin caches immediately
    if (p) p.role = newRole;
    const room = this.rooms.get(targetRoom);
    if (room && room.players.has(playerId)) {
      const rp = room.players.get(playerId);
      rp.role = newRole;
    }

    // 2. If it is an Admin bot, update bot manager immediately
    if (typeof AdminBot !== 'undefined' && (AdminBot.isBotActive(playerId) || playerId.startsWith('bot_'))) {
      const b = AdminBot.bots.find(x => x.id === playerId);
      if (b) {
        b.role = newRole;
        AdminBot.broadcastBotPresence(b);
        AdminBot.broadcastBotTelemetry(b, true);
      }
    }

    // 3. If it is a Simulation bot, update simulation engine
    if (typeof Simulation !== 'undefined' && Simulation.isActive) {
      Simulation.swapBotRole(playerId, newRole);
    }

    // 4. Update local Network and Game state immediately
    if (typeof Network !== 'undefined') {
      if (Network.peers && Network.peers.has(playerId)) {
        Network.peers.get(playerId).role = newRole;
      }
      if (Network.playerId === playerId) {
        if (typeof Game !== 'undefined') {
          Game.selfRole = newRole;
          Game.role = newRole;
          if (newRole === 'seeker') {
            Game.activeRunners.delete(playerId);
            Game.activeSeekers.add(playerId);
          } else {
            Game.activeSeekers.delete(playerId);
            Game.activeRunners.add(playerId);
          }
          if (typeof UI !== 'undefined' && UI.updateRoleHUD) {
            UI.updateRoleHUD(newRole);
          }
        }
        Network.sendPresence();
      }
      // If local player is Host, immediately push authoritative host beacon with updated peer roster
      if (typeof Game !== 'undefined' && Game.isHost) {
        if (newRole === 'seeker') {
          Game.activeRunners.delete(playerId);
          Game.activeSeekers.add(playerId);
        } else {
          Game.activeSeekers.delete(playerId);
          Game.activeRunners.add(playerId);
        }
        Network.emitHostBeacon();
      }
    }

    // 5. Broadcast admin command to room / relay
    this.broadcastCommand(targetRoom, {
      type: 'set_role',
      targetPlayerId: playerId,
      newRole: newRole
    });

    // 6. Re-render UI
    this.renderPlayersTab();
    if (this.currentTab === 'bots') this.renderBotsTab();
    if (this.currentTab === 'map') {
      this.updateMasterMapMarkers();
      if (this.selectedPlayerId === playerId) {
        this.teleportToPlayer(playerId);
      }
    }
    UI.showToast(`Assigned ${p ? p.nickname : playerId} to ${newRole.toUpperCase()}`, 'info');
  }

  swapPlayerRole(roomCode, playerId, currentRole) {
    const p = this.allPlayers.get(playerId);
    const effRole = currentRole || (p ? p.role : 'runner');
    const newRole = effRole === 'runner' ? 'seeker' : 'runner';
    this.setPlayerRole(roomCode, playerId, newRole);
  }

  promptEditPlayerNickname(roomCode, playerId) {
    const p = this.allPlayers.get(playerId);
    const currentName = p ? p.nickname : 'Operative';
    const newName = prompt(`Enter new callsign for ${currentName}:`, currentName);
    if (!newName || !newName.trim() || newName.trim() === currentName) return;

    const trimmed = newName.trim();
    if (p) p.nickname = trimmed;
    const targetRoom = (roomCode || (p ? p.roomCode : 'GLOBAL')).toUpperCase();
    const room = this.rooms.get(targetRoom);
    if (room && room.players.has(playerId)) {
      room.players.get(playerId).nickname = trimmed;
    }
    if (typeof Network !== 'undefined' && Network.peers && Network.peers.has(playerId)) {
      Network.peers.get(playerId).nickname = trimmed;
    }
    if (typeof AdminBot !== 'undefined') {
      const b = AdminBot.bots.find(x => x.id === playerId);
      if (b) {
        b.nickname = trimmed;
        AdminBot.broadcastBotPresence(b);
      }
    }

    this.broadcastCommand(targetRoom, {
      type: 'set_nickname',
      targetPlayerId: playerId,
      nickname: trimmed
    });

    this.renderPlayersTab();
    if (this.currentTab === 'bots') this.renderBotsTab();
    if (this.currentTab === 'map') this.updateMasterMapMarkers();
    UI.showToast(`Updated callsign to "${trimmed}"`, 'info');
  }

  confirmKickPlayer(roomCode, playerId, nickname) {
    if (!confirm(`Kick ${nickname} from Operation ${roomCode}?`)) {
      return;
    }

    const targetRoom = (roomCode || Game.roomCode || 'GLOBAL').toUpperCase().trim();

    // 1. Broadcast kick command
    this.broadcastCommand(targetRoom, {
      type: 'kick_player',
      targetPlayerId: playerId,
      reason: 'Removed by System Administrator'
    });

    // 2. If it is an AdminBot or bot ID, despawn it immediately
    if (typeof AdminBot !== 'undefined' && (AdminBot.isBotActive(playerId) || playerId.startsWith('bot_'))) {
      AdminBot.despawn(playerId);
    }

    // 3. If it is a Simulation bot, remove it
    if (typeof Simulation !== 'undefined' && Simulation.isActive) {
      Simulation.removeBot(playerId);
    }

    // 4. Remove from Admin state
    this.allPlayers.delete(playerId);
    const room = this.rooms.get(targetRoom);
    if (room && room.players) {
      room.players.delete(playerId);
      room.playerCount = room.players.size;
    }

    // 5. Remove map marker
    this.removeMapMarker(playerId);

    // 6. Remove from local Network peers & Game rosters
    if (typeof Network !== 'undefined' && Network.peers) {
      Network.peers.delete(playerId);
    }
    if (typeof Game !== 'undefined') {
      if (Game.activeRunners) Game.activeRunners.delete(playerId);
      if (Game.activeSeekers) Game.activeSeekers.delete(playerId);
      if (Game.updatePlayerRoster) Game.updatePlayerRoster();
    }
    if (typeof MapController !== 'undefined' && MapController.removePeer) {
      MapController.removePeer(playerId);
    }

    // 7. Refresh UI tabs
    this.renderPlayersTab();
    if (this.currentTab === 'bots') this.renderBotsTab();
    if (this.currentTab === 'rooms') this.renderRoomsTab();
    if (this.currentTab === 'map') this.updateMasterMapMarkers();

    UI.showToast(`Kicked ${nickname}`, 'danger');
  }

  confirmBanPlayer(roomCode, playerId, nickname) {
    if (confirm(`PERMANENTLY BAN ${nickname}? This will lock the client application.`)) {
      this.broadcastCommand(roomCode, {
        type: 'ban_player',
        targetPlayerId: playerId,
        reason: 'Administrative Ban'
      });
      this.bannedPlayers.add(playerId);
      this.allPlayers.delete(playerId);
      this.renderPlayersTab();
      UI.showToast(`Banned ${nickname}`, 'danger');
    }
  }

  locatePlayerOnMap(playerId) {
    this.selectedPlayerId = playerId;
    this.switchTab('map');
    setTimeout(() => {
      const p = this.allPlayers.get(playerId);
      if (p && p.lat && this.masterMap) {
        this.masterMap.setView([p.lat, p.lng], 16, { animate: true });
        const marker = this.playerMarkers.get(playerId);
        if (marker) marker.openPopup();
      }
    }, 200);
  }

  /* ==========================================================================
     TAB 3: MASTER GOD'S-EYE MAP
     ========================================================================== */
  initMasterMap() {
    const mapContainer = document.getElementById('admin-master-map');
    if (!mapContainer) return;

    if (!this.masterMap && typeof L !== 'undefined') {
      let defaultCenter = [0, 0];
      let defaultZoom = 2;
      if (typeof Game !== 'undefined' && Game.lastSelfCoords) {
        defaultCenter = [Game.lastSelfCoords.lat, Game.lastSelfCoords.lng];
        defaultZoom = 15;
      } else if (typeof Geo !== 'undefined' && Geo.currentPosition && Geo.currentPosition.lat != null) {
        defaultCenter = [Geo.currentPosition.lat, Geo.currentPosition.lng];
        defaultZoom = 15;
      } else if (typeof Game !== 'undefined' && Game.fixedBoundaryCenter) {
        defaultCenter = [Game.fixedBoundaryCenter.lat, Game.fixedBoundaryCenter.lng];
        defaultZoom = 15;
      } else {
        for (const p of this.allPlayers.values()) {
          if (p.lat != null && p.lng != null) {
            defaultCenter = [p.lat, p.lng];
            defaultZoom = 15;
            break;
          }
        }
      }
      
      this.masterMap = L.map('admin-master-map', {
        zoomControl: false,
        attributionControl: false
      }).setView(defaultCenter, defaultZoom);

      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        subdomains: ['a', 'b', 'c']
      }).addTo(this.masterMap);

      // Handle map click (for interactive bot placement / tap-to-drop)
      this.masterMap.on('click', (e) => {
        this.onMasterMapClick(e.latlng);
      });

      // Populate room filter and player teleport dropdowns
      this.updateMapRoomFilterOptions();
      this.updateMapPlayerTeleportOptions();
    } else if (this.masterMap) {
      this.masterMap.invalidateSize();
      this.updateMapRoomFilterOptions();
      this.updateMapPlayerTeleportOptions();
    }
  }

  updateMapRoomFilterOptions() {
    const select = document.getElementById('admin-map-room-filter');
    if (!select) return;

    const currentVal = this.selectedRoomCode || select.value || 'ALL';
    let options = '<option value="ALL">🌐 All Operations (Global)</option>';
    for (const [roomCode, room] of this.rooms.entries()) {
      options += `<option value="${roomCode}">Room: ${roomCode} (${room.playerCount} Operatives)</option>`;
    }
    select.innerHTML = options;
    select.value = currentVal;
  }

  /**
   * Handle room selection in God's Eye Map
   * Immediately clears outdated data, queries the relay, syncs local engine,
   * re-plots GPS coordinates, and frames the camera on the room.
   */
  onMapRoomFilterChange(roomCode) {
    this.selectedRoomCode = roomCode;

    // 1. If global view, refresh all and fit all
    if (roomCode === 'ALL') {
      this.updateMasterMapMarkers();
      this.updateMapPlayerTeleportOptions();
      this.clearPlayerFocus();
      this.fitAllMapMarkers();
      UI.showToast('Showing all active operations', 'info');
      return;
    }

    // 2. Clear old map layers not in this room
    for (const [pId, p] of this.allPlayers.entries()) {
      if (p.roomCode !== roomCode) {
        this.removeMapMarker(pId);
      }
    }
    for (const [rCode] of this.rooms.entries()) {
      if (rCode !== roomCode) {
        this.removeBoundaryLayer(rCode);
      }
    }

    // 3. Query relay for latest state
    this.broadcastCommand(roomCode, { type: 'admin_probe' });

    // 4. Ingest local Game & Network state if current client is in this room
    this.syncLocalRoomState(roomCode);

    // 5. Update markers and boundary
    this.updateMasterMapMarkers();

    // 6. Focus camera on this room's players or boundary
    this.focusRoomOnMap(roomCode);

    // 7. Update player teleport list for this room
    this.updateMapPlayerTeleportOptions();
    this.clearPlayerFocus();

    UI.showToast(`Focused on Operation ${roomCode}`, 'info');
  }

  /**
   * Sync active local player & peers from Game / Network into Admin directory
   */
  syncLocalRoomState(roomCode) {
    if (typeof Game === 'undefined') return;
    const targetRoom = (roomCode || Game.roomCode || '').toUpperCase();
    if (!targetRoom || targetRoom === 'GLOBAL') return;

    if (!this.rooms.has(targetRoom)) {
      this.rooms.set(targetRoom, {
        roomCode: targetRoom,
        hostName: Game.hostName || (Game.isHost ? (typeof Config !== 'undefined' && Config.settings && Config.settings.playerNickname ? Config.settings.playerNickname : 'Host') : 'Host'),
        hostId: Game.hostId || (Game.isHost ? (typeof Network !== 'undefined' ? Network.playerId : null) : null),
        state: Game.state || 'WAITING',
        playerCount: 1,
        players: new Map(),
        settings: Game.settings || {},
        boundaryCenter: Game.fixedBoundaryCenter || null,
        boundaryRadiusMeters: Game.fixedBoundaryRadiusMeters || 1500,
        lastSeen: Date.now()
      });
    }

    const room = this.rooms.get(targetRoom);
    room.state = Game.state || room.state;
    if (Game.fixedBoundaryCenter) room.boundaryCenter = Game.fixedBoundaryCenter;
    if (Game.fixedBoundaryRadiusMeters) room.boundaryRadiusMeters = Game.fixedBoundaryRadiusMeters;

    const now = Date.now();

    // 1. Ingest local player
    if (typeof Network !== 'undefined' && Network.playerId && (Game.roomCode === targetRoom || !Game.roomCode)) {
      const existing = this.allPlayers.get(Network.playerId);
      const selfCoords = Game.lastSelfCoords || (typeof Geo !== 'undefined' && Geo.currentPosition && Geo.currentPosition.lat != null ? Geo.currentPosition : null);
      const localLat = selfCoords ? selfCoords.lat : (existing ? existing.lat : null);
      const localLng = selfCoords ? selfCoords.lng : (existing ? existing.lng : null);

      const localPlayer = {
        id: Network.playerId,
        nickname: (typeof Config !== 'undefined' && Config.settings && Config.settings.playerNickname) || (existing ? existing.nickname : 'Local Operative'),
        role: Game.selfRole || Game.role || (existing ? existing.role : 'runner'),
        roomCode: targetRoom,
        isHost: !!Game.isHost,
        isTagged: !!Game.isTagged,
        isBot: false,
        lat: localLat,
        lng: localLng,
        speed: selfCoords ? selfCoords.speed || 0 : (existing ? existing.speed : 0),
        heading: selfCoords ? selfCoords.heading || 0 : (existing ? existing.heading : 0),
        lastSeen: now,
        lastPingTime: selfCoords ? now : (existing ? existing.lastPingTime : now)
      };
      this.allPlayers.set(localPlayer.id, localPlayer);
      room.players.set(localPlayer.id, localPlayer);
    }

    // 2. Ingest peers from Network and Game
    if (typeof Network !== 'undefined' && Network.peers && Game.roomCode === targetRoom) {
      Network.peers.forEach((peer, peerId) => {
        const existing = this.allPlayers.get(peerId);
        const truePos = (typeof Game !== 'undefined' && Game.trueLivePositions) ? Game.trueLivePositions.get(peerId) : null;
        const lastKnown = (typeof Game !== 'undefined' && Game.lastKnownPositions) ? Game.lastKnownPositions.get(peerId) : null;

        const effectiveLat = (typeof peer.lat === 'number' && !isNaN(peer.lat)) ? peer.lat : (truePos && truePos.lat != null ? truePos.lat : (lastKnown && lastKnown.lat != null ? lastKnown.lat : (existing ? existing.lat : null)));
        const effectiveLng = (typeof peer.lng === 'number' && !isNaN(peer.lng)) ? peer.lng : (truePos && truePos.lng != null ? truePos.lng : (lastKnown && lastKnown.lng != null ? lastKnown.lng : (existing ? existing.lng : null)));
        const effectivePingTime = peer.lastPingTime || (truePos && truePos.timestamp) || (lastKnown && lastKnown.timestamp) || (existing ? existing.lastPingTime : now);

        const peerRole = peer.role || (Game.activeSeekers && Game.activeSeekers.has(peerId) ? 'seeker' : (Game.activeRunners && Game.activeRunners.has(peerId) ? 'runner' : (existing ? existing.role : 'runner')));

        const peerData = {
          id: peerId,
          nickname: peer.nickname || (existing ? existing.nickname : 'Operative'),
          role: peerRole,
          roomCode: targetRoom,
          isHost: typeof peer.isHost !== 'undefined' ? !!peer.isHost : (existing ? existing.isHost : false),
          isTagged: (Game.taggedRunners && Game.taggedRunners.has(peerId)) || !!peer.isTagged,
          isBot: peerId.startsWith('bot_') || !!peer.isBot,
          lat: effectiveLat,
          lng: effectiveLng,
          speed: typeof peer.speed === 'number' ? peer.speed : 0,
          heading: typeof peer.heading === 'number' ? peer.heading : 0,
          lastSeen: now,
          lastPingTime: effectivePingTime
        };
        this.allPlayers.set(peerId, peerData);
        room.players.set(peerId, peerData);
      });
    }

    // 3. Ingest active bots into room directory
    if (typeof AdminBot !== 'undefined' && AdminBot.bots) {
      AdminBot.bots.forEach(bot => {
        if (bot.roomCode === targetRoom) {
          const botData = {
            id: bot.id,
            nickname: bot.nickname,
            role: bot.role,
            roomCode: targetRoom,
            isHost: false,
            isTagged: false,
            isBot: true,
            lat: bot.lat,
            lng: bot.lng,
            speed: bot.speed || 0,
            heading: bot.heading || 0,
            lastSeen: now,
            lastPingTime: now
          };
          this.allPlayers.set(bot.id, botData);
          room.players.set(bot.id, botData);
        }
      });
    }

    room.playerCount = room.players.size;
  }

  /**
   * Resolve player's actual coordinates and formatted timing text
   */
  getPlayerLocationInfo(player) {
    if (!player) return { lat: null, lng: null, text: 'No Location Data', coordsOnly: 'Unknown', pingAgeSec: null, intervalStr: 'None' };

    let lat = (typeof player.lat === 'number' && !isNaN(player.lat)) ? player.lat : null;
    let lng = (typeof player.lng === 'number' && !isNaN(player.lng)) ? player.lng : null;
    let lastPingTime = player.lastPingTime || player.lastSeen;

    if (lat === null || lng === null) {
      if (typeof Game !== 'undefined') {
        if (Game.trueLivePositions && Game.trueLivePositions.has(player.id)) {
          const tp = Game.trueLivePositions.get(player.id);
          if (tp && tp.lat != null) {
            lat = tp.lat;
            lng = tp.lng;
            lastPingTime = tp.timestamp || lastPingTime;
          }
        } else if (Game.lastKnownPositions && Game.lastKnownPositions.has(player.id)) {
          const lkp = Game.lastKnownPositions.get(player.id);
          if (lkp && lkp.lat != null) {
            lat = lkp.lat;
            lng = lkp.lng;
            lastPingTime = lkp.timestamp || lastPingTime;
          }
        }
      }
      if ((lat === null || lng === null) && typeof Network !== 'undefined' && Network.peers && Network.peers.has(player.id)) {
        const peer = Network.peers.get(player.id);
        if (peer && peer.lat != null) {
          lat = peer.lat;
          lng = peer.lng;
          lastPingTime = peer.lastPingTime || lastPingTime;
        }
      }
      if ((lat === null || lng === null) && typeof Network !== 'undefined' && Network.playerId === player.id) {
        if (typeof Game !== 'undefined' && Game.lastSelfCoords) {
          lat = Game.lastSelfCoords.lat;
          lng = Game.lastSelfCoords.lng;
          lastPingTime = Date.now();
        } else if (typeof Geo !== 'undefined' && Geo.currentPosition && Geo.currentPosition.lat != null) {
          lat = Geo.currentPosition.lat;
          lng = Geo.currentPosition.lng;
          lastPingTime = Date.now();
        }
      }
      if ((lat === null || lng === null) && (player.isBot || player.id.startsWith('bot_')) && typeof AdminBot !== 'undefined') {
        const bot = AdminBot.bots.find(b => b.id === player.id);
        if (bot && bot.lat != null) {
          lat = bot.lat;
          lng = bot.lng;
          lastPingTime = Date.now();
        }
      }
    }

    // Keep player object synced
    if (lat !== null && lng !== null) {
      player.lat = lat;
      player.lng = lng;
      player.lastPingTime = lastPingTime;
    }

    // Ping interval
    const room = this.rooms.get(player.roomCode);
    const roomIntervalSec = (room && room.settings && room.settings.runnerPingInterval) || (typeof Config !== 'undefined' && Config.settings && Config.settings.runnerPingInterval) || 300;
    
    let intervalStr = '';
    const isLocalSelf = typeof Network !== 'undefined' && Network.playerId === player.id;
    if (isLocalSelf) {
      intervalStr = 'Self · Real-Time GPS';
    } else if (player.isBot || player.id.startsWith('bot_')) {
      intervalStr = 'Bot Simulated · Live';
    } else if (player.role === 'seeker') {
      intervalStr = 'Seeker GPS · Live (3s)';
    } else {
      intervalStr = roomIntervalSec >= 60 ? `${Math.round(roomIntervalSec / 60)}m` : `${roomIntervalSec}s`;
    }

    if (lat === null || lng === null) {
      return {
        lat: null,
        lng: null,
        text: `GPS Searching... (Interval: ${intervalStr})`,
        coordsOnly: 'GPS Searching...',
        pingAgeSec: null,
        intervalStr: intervalStr
      };
    }

    const now = Date.now();
    const pingAgeSec = lastPingTime ? Math.max(0, Math.round((now - lastPingTime) / 1000)) : 0;
    let ageDisplay = '';
    if (isLocalSelf || player.isBot || player.id.startsWith('bot_')) {
      ageDisplay = 'Live';
    } else if (pingAgeSec < 60) {
      ageDisplay = `${pingAgeSec}s ago`;
    } else {
      ageDisplay = `${Math.floor(pingAgeSec / 60)}m ${pingAgeSec % 60}s ago`;
    }

    return {
      lat: lat,
      lng: lng,
      text: `${lat.toFixed(5)}, ${lng.toFixed(5)} (Last Ping: ${ageDisplay} · Interval: ${intervalStr})`,
      coordsOnly: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      pingAgeSec: pingAgeSec,
      intervalStr: intervalStr
    };
  }

  /**
   * Smoothly pan & zoom master map to fit room players or boundary
   */
  focusRoomOnMap(roomCode) {
    if (!this.masterMap) return;
    const room = this.rooms.get(roomCode);
    const coords = [];

    for (const p of this.allPlayers.values()) {
      if (p.roomCode === roomCode && p.lat && p.lng) {
        coords.push([p.lat, p.lng]);
      }
    }

    if (coords.length > 0) {
      if (coords.length === 1) {
        this.masterMap.setView(coords[0], 16, { animate: true });
      } else {
        const bounds = L.latLngBounds(coords);
        this.masterMap.fitBounds(bounds.pad(0.25), { animate: true });
      }
    } else if (room && room.boundaryCenter && room.boundaryCenter.lat) {
      this.masterMap.setView([room.boundaryCenter.lat, room.boundaryCenter.lng], 15, { animate: true });
    } else if (Game.lastSelfCoords) {
      this.masterMap.setView([Game.lastSelfCoords.lat, Game.lastSelfCoords.lng], 15, { animate: true });
    }
  }

  /**
   * Populate quick-select player teleport dropdown
   */
  updateMapPlayerTeleportOptions() {
    const select = document.getElementById('admin-map-player-select');
    if (!select) return;

    const selectedRoom = this.selectedRoomCode || document.getElementById('admin-map-room-filter')?.value || 'ALL';
    const players = [];

    for (const p of this.allPlayers.values()) {
      if (selectedRoom === 'ALL' || p.roomCode === selectedRoom) {
        players.push(p);
      }
    }

    let html = '<option value="">📍 Snap / Teleport to Player...</option>';
    if (players.length === 0) {
      html += '<option value="" disabled>No active players</option>';
    } else {
      players.forEach(p => {
        const roleIcon = p.isBot ? '🤖' : (p.role === 'seeker' ? '🎯' : '🏃');
        const hostPill = p.isHost ? ' (Host)' : '';
        const botPill = p.isBot ? ' [Bot]' : '';
        const coordsText = p.lat ? ` (${p.lat.toFixed(4)}, ${p.lng.toFixed(4)})` : ' (GPS...)';
        html += `<option value="${p.id}">${roleIcon} ${p.nickname}${hostPill}${botPill} - ${p.role.toUpperCase()}${coordsText}</option>`;
      });
    }
    select.innerHTML = html;
    if (this.selectedPlayerId) {
      select.value = this.selectedPlayerId;
    }
  }

  /**
   * Instant camera pan and zoom ("teleport") directly to player's live GPS coordinates
   */
  teleportToPlayer(playerId) {
    if (!playerId) {
      this.clearPlayerFocus();
      return;
    }

    const player = this.allPlayers.get(playerId);
    if (!player) return;

    this.selectedPlayerId = playerId;
    const locInfo = this.getPlayerLocationInfo(player);

    if (locInfo.lat != null && locInfo.lng != null && this.masterMap) {
      this.masterMap.setView([locInfo.lat, locInfo.lng], 17, { animate: true });
      const marker = this.playerMarkers.get(playerId);
      if (marker) marker.openPopup();
    }

    // Display Focused Player HUD card
    const card = document.getElementById('admin-map-player-focus-card');
    const roleIcon = document.getElementById('admin-focus-role-icon');
    const nameEl = document.getElementById('admin-focus-player-name');
    const subEl = document.getElementById('admin-focus-player-sub');
    const coordsEl = document.getElementById('admin-focus-coords-text');

    if (card) {
      if (roleIcon) roleIcon.textContent = player.isBot ? '🤖' : (player.role === 'seeker' ? '🎯' : '🏃');
      if (nameEl) nameEl.textContent = `${player.nickname} ${player.isHost ? '👑' : ''} ${player.isBot ? '🤖' : ''}`;
      if (subEl) subEl.textContent = `Room: ${player.roomCode} | Role: ${player.role.toUpperCase()} | ID: ${player.id}`;
      if (coordsEl) {
        coordsEl.textContent = locInfo.text;
      }
      card.style.display = 'block';
    }

    const coordsDisplay = document.getElementById('admin-map-coords-display');
    if (coordsDisplay && locInfo.lat != null) {
      coordsDisplay.textContent = `Lat: ${locInfo.lat.toFixed(5)}, Lng: ${locInfo.lng.toFixed(5)}`;
    }

    UI.showToast(`Teleported camera to ${player.nickname}`, 'info');
  }

  clearPlayerFocus() {
    this.selectedPlayerId = null;
    const card = document.getElementById('admin-map-player-focus-card');
    if (card) card.style.display = 'none';
    const select = document.getElementById('admin-map-player-select');
    if (select) select.value = '';
  }

  spawnBotAtFocusedPlayer() {
    if (!this.selectedPlayerId) {
      UI.showToast('Please select a player first', 'warning');
      return;
    }
    this.spawnBotAtPlayer(this.selectedPlayerId);
  }

  /**
   * Spawns a testing bot directly near a player's coordinates with slight offset
   */
  spawnBotAtPlayer(playerId) {
    const player = this.allPlayers.get(playerId);
    if (!player) {
      UI.showToast('Target player not found', 'danger');
      return;
    }

    const locInfo = this.getPlayerLocationInfo(player);
    let baseLat = locInfo.lat;
    let baseLng = locInfo.lng;

    if (baseLat == null || baseLng == null) {
      // Try local self coordinates
      if (typeof Game !== 'undefined' && Game.lastSelfCoords) {
        baseLat = Game.lastSelfCoords.lat;
        baseLng = Game.lastSelfCoords.lng;
      } else if (typeof Geo !== 'undefined' && Geo.currentPosition && Geo.currentPosition.lat != null) {
        baseLat = Geo.currentPosition.lat;
        baseLng = Geo.currentPosition.lng;
      } else if (typeof Game !== 'undefined' && Game.fixedBoundaryCenter) {
        baseLat = Game.fixedBoundaryCenter.lat;
        baseLng = Game.fixedBoundaryCenter.lng;
      }
    }

    if (baseLat == null || baseLng == null) {
      UI.showToast('⚠️ Cannot spawn bot: Waiting for player or host GPS location.', 'warning');
      return;
    }

    // Slight realistic offset (~15-25m) so they aren't stacked directly on top
    const angle = Math.random() * 2 * Math.PI;
    const distMeters = 15 + Math.random() * 10;
    const deltaLat = (distMeters * Math.cos(angle)) / 111111;
    const deltaLng = (distMeters * Math.sin(angle)) / (111111 * Math.cos(baseLat * Math.PI / 180));

    const spawnLat = baseLat + deltaLat;
    const spawnLng = baseLng + deltaLng;

    // Smart opposite role for instant test interaction
    const botRole = player.role === 'runner' ? 'seeker' : 'runner';
    const botName = `Bot-${player.nickname.substring(0, 4)}-${Math.floor(Math.random() * 90 + 10)}`;

    const bot = AdminBot.spawn(player.roomCode, botName, botRole, spawnLat, spawnLng);
    UI.showToast(`🤖 Spawned ${botRole.toUpperCase()} bot "${botName}" ~20m from ${player.nickname}`, 'info');

    this.updateMasterMapMarkers();
    this.updateMapPlayerTeleportOptions();

    // Pan map to reveal both
    if (this.masterMap) {
      this.masterMap.setView([spawnLat, spawnLng], 17, { animate: true });
    }
  }

  swapFocusedPlayerRole() {
    if (!this.selectedPlayerId) return;
    const player = this.allPlayers.get(this.selectedPlayerId);
    if (player) {
      this.swapPlayerRole(player.roomCode, player.id, player.role);
      setTimeout(() => this.teleportToPlayer(player.id), 100);
    }
  }

  /**
   * Start Interactive Tap-on-Map Bot Spawning Mode
   */
  startMapTapSpawnMode() {
    const room = (document.getElementById('admin-bot-room-target')?.value || Game.roomCode || 'TEST').toUpperCase().trim();
    const name = (document.getElementById('admin-bot-name')?.value || 'Bot-' + Math.floor(Math.random() * 1000)).trim();
    const role = document.getElementById('admin-bot-role')?.value || 'runner';
    const speed = parseFloat(document.getElementById('admin-bot-speed')?.value || '2.8');
    const movement = document.getElementById('admin-bot-movement')?.value || 'moving';
    const isMoving = movement !== 'stopped';

    this.pendingBotSpawn = { roomCode: room, nickname: name, role: role, speed: speed, isMoving: isMoving };
    this.switchTab('map');

    const banner = document.getElementById('admin-map-spawn-banner');
    const bannerText = document.getElementById('admin-map-spawn-banner-text');
    if (banner && bannerText) {
      bannerText.textContent = `🎯 Tap map to drop ${role.toUpperCase()} bot "${name}" (${speed} m/s) into Room ${room}`;
      banner.style.display = 'flex';
    }

    UI.showToast(`🎯 Tap anywhere on map to drop bot "${name}"`, 'info');
  }

  cancelMapTapSpawnMode() {
    this.pendingBotSpawn = null;
    const banner = document.getElementById('admin-map-spawn-banner');
    if (banner) banner.style.display = 'none';
  }

  /**
   * Start Interactive Tap-on-Map Waypoint Placement Mode for Bot
   */
  selectBotForWaypoint(botId) {
    this.selectedWaypointBotId = botId;
    this.isWaypointMode = true;
    this.switchTab('map');

    const bot = AdminBot.bots.find(b => b.id === botId);
    const banner = document.getElementById('admin-map-waypoint-banner');
    const bannerText = document.getElementById('admin-map-waypoint-banner-text');
    if (banner && bannerText) {
      bannerText.textContent = `🎯 Tap map to set destination waypoint for "${bot ? bot.nickname : 'Bot'}"`;
      banner.style.display = 'flex';
    }
    UI.showToast(`🎯 Tap anywhere on map to set destination waypoint for ${bot ? bot.nickname : 'Bot'}`, 'info');
  }

  cancelWaypointMode() {
    this.selectedWaypointBotId = null;
    this.isWaypointMode = false;
    const banner = document.getElementById('admin-map-waypoint-banner');
    if (banner) banner.style.display = 'none';
  }

  onMasterMapClick(latlng) {
    const coordsDisplay = document.getElementById('admin-map-coords-display');
    if (coordsDisplay) {
      coordsDisplay.textContent = `Lat: ${latlng.lat.toFixed(5)}, Lng: ${latlng.lng.toFixed(5)}`;
    }

    // 1. If in waypoint placement mode:
    if (this.isWaypointMode && this.selectedWaypointBotId) {
      AdminBot.setBotDestination(this.selectedWaypointBotId, latlng.lat, latlng.lng);
      this.cancelWaypointMode();
      this.updateMasterMapMarkers();
      return;
    }

    // 2. If in interactive tap-to-drop bot spawn mode:
    if (this.pendingBotSpawn) {
      const { roomCode, nickname, role, speed, isMoving } = this.pendingBotSpawn;
      const bot = AdminBot.spawn(roomCode, nickname, role, latlng.lat, latlng.lng, speed, isMoving);
      UI.showToast(`🤖 Bot "${nickname}" injected at ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`, 'info');
      this.cancelMapTapSpawnMode();
      this.updateMasterMapMarkers();
      this.updateMapPlayerTeleportOptions();
      return;
    }

    // 3. If bot relocation mode is active:
    if (this.isMapPlacementMode && this.selectedBotId) {
      AdminBot.setBotLocation(this.selectedBotId, latlng.lat, latlng.lng);
      UI.showToast(`📍 Bot moved to ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`, 'info');
      this.updateMasterMapMarkers();
    }
  }

  toggleMapPlacementMode() {
    this.isMapPlacementMode = !this.isMapPlacementMode;
    const btn = document.getElementById('btn-admin-map-click-bot');
    if (btn) {
      if (this.isMapPlacementMode) {
        btn.classList.add('active');
        btn.style.background = '#00f5b4';
        btn.style.color = '#000';
        UI.showToast('📍 Tap anywhere on map to set Bot GPS coordinates', 'info');
      } else {
        btn.classList.remove('active');
        btn.style.background = '';
        btn.style.color = '';
      }
    }
  }

  updateMasterMapMarkers() {
    if (!this.masterMap || typeof L === 'undefined') return;

    const selectedRoom = this.selectedRoomCode || document.getElementById('admin-map-room-filter')?.value || 'ALL';

    // 1. Update/Add Player Markers
    for (const [playerId, player] of this.allPlayers.entries()) {
      if (!player.lat || !player.lng) {
        this.getPlayerLocationInfo(player);
      }
      if (!player.lat || !player.lng) continue;
      if (selectedRoom !== 'ALL' && player.roomCode !== selectedRoom) {
        this.removeMapMarker(playerId);
        continue;
      }
      this.updateSingleMapMarker(player);
    }

    // 2. Draw Boundaries for active rooms
    for (const [roomCode, room] of this.rooms.entries()) {
      if (selectedRoom !== 'ALL' && roomCode !== selectedRoom) {
        this.removeBoundaryLayer(roomCode);
        continue;
      }
      if (room.boundaryCenter && room.boundaryRadiusMeters) {
        this.updateBoundaryLayer(roomCode, room.boundaryCenter.lat, room.boundaryCenter.lng, room.boundaryRadiusMeters);
      }
    }

    // 3. Draw Bot Waypoint Markers
    if (typeof AdminBot !== 'undefined') {
      const activeBotIds = new Set(AdminBot.bots.map(b => b.id));
      for (const [botId, wMarker] of this.waypointMarkers.entries()) {
        if (!activeBotIds.has(botId) || !AdminBot.bots.find(b => b.id === botId)?.targetDestination) {
          if (this.masterMap) this.masterMap.removeLayer(wMarker);
          this.waypointMarkers.delete(botId);
        }
      }

      AdminBot.bots.forEach(bot => {
        if (selectedRoom !== 'ALL' && bot.roomCode !== selectedRoom) {
          if (this.waypointMarkers.has(bot.id)) {
            this.masterMap.removeLayer(this.waypointMarkers.get(bot.id));
            this.waypointMarkers.delete(bot.id);
          }
          return;
        }

        if (bot.targetDestination) {
          const wLat = bot.targetDestination.lat;
          const wLng = bot.targetDestination.lng;
          let wMarker = this.waypointMarkers.get(bot.id);
          const wIcon = L.divIcon({
            className: 'custom-admin-marker',
            html: `
              <div style="background:#38bdf8; color:#0f172a; width:26px; height:26px; border-radius:50%; border:2px solid #fff; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:800; box-shadow:0 0 10px rgba(56,189,248,0.8);">
                🚩
              </div>
            `,
            iconSize: [26, 26],
            iconAnchor: [13, 13]
          });

          if (!wMarker) {
            wMarker = L.marker([wLat, wLng], { icon: wIcon }).addTo(this.masterMap);
            wMarker.bindPopup(`<div style="font-size:12px; font-weight:700; color:#38bdf8;">🚩 Destination Waypoint for ${bot.nickname}</div>`);
            this.waypointMarkers.set(bot.id, wMarker);
          } else {
            wMarker.setLatLng([wLat, wLng]);
          }
        }
      });
    }
  }

  updateSingleMapMarker(player) {
    if (!this.masterMap) return;
    const locInfo = this.getPlayerLocationInfo(player);
    if (locInfo.lat == null || locInfo.lng == null) return;

    let marker = this.playerMarkers.get(player.id);
    const color = player.isBot ? '#d946ef' : (player.isHost ? '#f59e0b' : (player.role === 'seeker' ? '#ff4757' : '#00f5b4'));
    const roleIcon = player.isBot ? '🤖' : (player.role === 'seeker' ? '🎯' : '🏃');

    const iconHtml = `
      <div class="admin-marker-pin" style="border-color:${color};">
        <span style="font-size:12px;">${roleIcon}</span>
      </div>
    `;
    const icon = L.divIcon({
      className: 'custom-admin-marker',
      html: iconHtml,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    const popupContent = `
      <div style="font-family:sans-serif; min-width:210px; color:#fff; padding:4px;">
        <div style="font-weight:700; color:${color}; font-size:15px; margin-bottom:4px; display:flex; align-items:center; gap:6px;">
          <span>${roleIcon}</span>
          <span>${player.nickname}</span>
          ${player.isHost ? '<span style="font-size:10px; background:#f59e0b; color:#000; padding:1px 5px; border-radius:3px; font-weight:800;">HOST</span>' : ''}
          ${player.isBot ? '<span style="font-size:10px; background:#a855f7; color:#fff; padding:1px 5px; border-radius:3px; font-weight:800;">BOT</span>' : ''}
        </div>
        <div style="font-size:11px; color:#cbd5e1; margin-bottom:6px;">
          Room: <b style="color:#38bdf8;">${player.roomCode}</b> | Role: <b style="color:${color}; text-transform:uppercase;">${player.role}</b>
        </div>
        <div style="font-size:11px; font-family:monospace; margin-bottom:10px; color:#00f5b4; background:#0f172a; padding:5px 8px; border-radius:4px; border:1px solid #334155;">
          📍 ${locInfo.coordsOnly} <span style="font-size:9px; color:#94a3b8; display:block; margin-top:2px;">${locInfo.intervalStr}</span>
        </div>
        <div style="display:flex; gap:6px; flex-direction:column;">
          <button type="button" class="btn-primary" style="font-size:12px; font-weight:700; padding:8px 12px; border-radius:6px; cursor:pointer; width:100%; display:flex; align-items:center; justify-content:center; gap:6px; background:#0284c7; color:#fff; border:none;" onclick="Admin.spawnBotAtPlayer('${player.id}')">
            🤖 Spawn Bot Here
          </button>
          <div style="display:flex; gap:6px;">
            <button type="button" class="btn-secondary" style="font-size:11px; font-weight:600; padding:6px 10px; border-radius:6px; cursor:pointer; flex:1; background:#334155; color:#fff; border:1px solid #475569;" onclick="Admin.swapPlayerRole('${player.roomCode}', '${player.id}', '${player.role}')">
              🔄 Swap Role
            </button>
            <button type="button" class="btn-danger" style="font-size:11px; font-weight:600; padding:6px 10px; border-radius:6px; cursor:pointer; background:#dc2626; color:#fff; border:none;" onclick="Admin.confirmKickPlayer('${player.roomCode}', '${player.id}', '${player.nickname}')">
              👢 Kick
            </button>
          </div>
        </div>
      </div>
    `;

    if (!marker) {
      marker = L.marker([locInfo.lat, locInfo.lng], { icon }).addTo(this.masterMap);
      marker.bindPopup(popupContent);
      marker.on('click', () => this.teleportToPlayer(player.id));
      this.playerMarkers.set(player.id, marker);
    } else {
      marker.setLatLng([locInfo.lat, locInfo.lng]);
      marker.setIcon(icon);
      marker.setPopupContent(popupContent);
    }
  }

  removeMapMarker(playerId) {
    const marker = this.playerMarkers.get(playerId);
    if (marker && this.masterMap) {
      this.masterMap.removeLayer(marker);
      this.playerMarkers.delete(playerId);
    }
  }

  updateBoundaryLayer(roomCode, lat, lng, radiusMeters) {
    let circle = this.boundaryLayers.get(roomCode);
    if (!circle) {
      circle = L.circle([lat, lng], {
        radius: radiusMeters,
        color: '#ff4757',
        weight: 2,
        fillColor: '#ff4757',
        fillOpacity: 0.08,
        dashArray: '6, 6'
      }).addTo(this.masterMap);
      this.boundaryLayers.set(roomCode, circle);
    } else {
      circle.setLatLng([lat, lng]);
      circle.setRadius(radiusMeters);
    }
  }

  removeBoundaryLayer(roomCode) {
    const circle = this.boundaryLayers.get(roomCode);
    if (circle && this.masterMap) {
      this.masterMap.removeLayer(circle);
      this.boundaryLayers.delete(roomCode);
    }
  }

  fitAllMapMarkers() {
    if (!this.masterMap || this.playerMarkers.size === 0) return;
    const group = L.featureGroup(Array.from(this.playerMarkers.values()));
    this.masterMap.fitBounds(group.getBounds().pad(0.2));
  }

  /* ==========================================================================
     TAB 4: BOT & TESTING SANDBOX
     ========================================================================== */
  onBotRoomSelectChange(roomCode) {
    const input = document.getElementById('admin-bot-room-target');
    if (input && roomCode) input.value = roomCode;
    this.updateBotPlayerSnapOptions(roomCode);
  }

  updateBotPlayerSnapOptions(roomCode) {
    const select = document.getElementById('admin-bot-player-snap-select');
    if (!select) return;

    const targetRoom = (roomCode || document.getElementById('admin-bot-room-target')?.value || '').toUpperCase().trim();
    let html = '<option value="">Select player in room...</option>';

    let count = 0;
    for (const p of this.allPlayers.values()) {
      if (!targetRoom || p.roomCode === targetRoom) {
        const icon = p.isBot ? '🤖' : (p.role === 'seeker' ? '🎯' : '🏃');
        html += `<option value="${p.id}">${icon} ${p.nickname} (${p.role.toUpperCase()})</option>`;
        count++;
      }
    }
    if (count === 0) {
      html += '<option value="" disabled>No players in room</option>';
    }
    select.innerHTML = html;
  }

  onBotPlayerSnapSelect(playerId) {
    const coordsDisplay = document.getElementById('admin-bot-player-coords-display');
    const coordsVal = document.getElementById('admin-bot-player-coords-val');
    const latInput = document.getElementById('admin-bot-lat');
    const lngInput = document.getElementById('admin-bot-lng');

    if (!playerId) {
      if (coordsDisplay) coordsDisplay.style.display = 'none';
      return;
    }

    const player = this.allPlayers.get(playerId);
    if (player) {
      const locInfo = this.getPlayerLocationInfo(player);
      if (locInfo.lat != null && locInfo.lng != null) {
        if (coordsDisplay) coordsDisplay.style.display = 'block';
        if (coordsVal) coordsVal.textContent = locInfo.text;
        if (latInput) latInput.value = locInfo.lat.toFixed(5);
        if (lngInput) lngInput.value = locInfo.lng.toFixed(5);
      }
    }
  }

  spawnBotAtSelectedPlayer() {
    const select = document.getElementById('admin-bot-player-snap-select');
    const playerId = select?.value;
    if (!playerId) {
      UI.showToast('Please select a player to spawn bot at', 'warning');
      return;
    }
    this.spawnBotAtPlayer(playerId);
    this.renderBotsTab();
  }

  fillCurrentCoordsForBot() {
    const latInput = document.getElementById('admin-bot-lat');
    const lngInput = document.getElementById('admin-bot-lng');

    let coords = null;
    if (typeof Game !== 'undefined' && Game.lastSelfCoords) {
      coords = Game.lastSelfCoords;
    } else if (typeof Geo !== 'undefined' && Geo.currentPosition && Geo.currentPosition.lat != null) {
      coords = Geo.currentPosition;
    } else if (typeof Game !== 'undefined' && Game.fixedBoundaryCenter) {
      coords = Game.fixedBoundaryCenter;
    } else {
      for (const p of this.allPlayers.values()) {
        if (p.lat != null && p.lng != null) {
          coords = { lat: p.lat, lng: p.lng };
          break;
        }
      }
    }

    if (coords && coords.lat != null && coords.lng != null) {
      if (latInput) latInput.value = coords.lat.toFixed(5);
      if (lngInput) lngInput.value = coords.lng.toFixed(5);
      UI.showToast(`Set bot coordinates to GPS (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`, 'info');
    } else {
      UI.showToast('GPS position not yet available. Please wait for fix.', 'warning');
    }
  }

  renderBotsTab() {
    const container = document.getElementById('admin-bots-list');
    if (!container) return;

    // Set default target room if blank
    const targetRoomInput = document.getElementById('admin-bot-room-target');
    const targetRoomSelect = document.getElementById('admin-bot-room-target-select');

    if (targetRoomSelect) {
      let opts = '<option value="">Select Active Room...</option>';
      for (const rCode of this.rooms.keys()) {
        opts += `<option value="${rCode}">Room: ${rCode}</option>`;
      }
      targetRoomSelect.innerHTML = opts;
    }

    if (targetRoomInput && !targetRoomInput.value && this.rooms.size > 0) {
      const firstRoom = Array.from(this.rooms.keys())[0];
      targetRoomInput.value = firstRoom;
      if (targetRoomSelect) targetRoomSelect.value = firstRoom;
    }

    this.updateBotPlayerSnapOptions(targetRoomInput?.value);

    const countBadge = document.getElementById('admin-bots-count-badge');
    if (countBadge) {
      countBadge.textContent = `${AdminBot.bots.length} Active Bots`;
    }

    if (AdminBot.bots.length === 0) {
      container.innerHTML = `
        <div class="admin-empty-state">
          <div style="font-size:2rem; margin-bottom:8px;">🤖</div>
          <div style="font-weight:600; color:var(--theme-text-bright);">No Active Bots Injected</div>
          <div style="font-size:0.8rem; color:var(--theme-text-muted);">
            Use the form above to inject simulated bots into any room to test mechanics.
          </div>
        </div>
      `;
      return;
    }

    let html = '';
    AdminBot.bots.forEach(bot => {
      const isSelected = this.selectedBotId === bot.id;
      const roleBadge = bot.role === 'seeker' ? 'role-badge-seeker' : 'role-badge-runner';
      const isMoving = bot.isMoving !== false;
      const moveBadge = isMoving
        ? '<span class="admin-tag-pill" style="background:#10b981; color:#fff; font-weight:800;">🟢 MOVING</span>'
        : '<span class="admin-tag-pill" style="background:#ef4444; color:#fff; font-weight:800;">🛑 STOPPED</span>';

      let destinationText = 'Free Patrol / Roam';
      if (!isMoving) {
        destinationText = 'Holding Position (Stationary)';
      } else if (bot.targetDestination) {
        destinationText = `🚩 Waypoint: ${bot.targetDestination.lat.toFixed(5)}, ${bot.targetDestination.lng.toFixed(5)}`;
      } else if (bot.targetPlayerId) {
        const tp = this.allPlayers.get(bot.targetPlayerId);
        destinationText = `🎯 Pursuing ${tp ? tp.nickname : bot.targetPlayerId}`;
      }

      // Populate pursuit options for other players in the room
      let playerOptions = `<option value="">-- None (Free Patrol) --</option>`;
      for (const [pId, p] of this.allPlayers.entries()) {
        if (pId === bot.id) continue;
        if (p.roomCode === bot.roomCode) {
          const isTarget = bot.targetPlayerId === pId ? 'selected' : '';
          playerOptions += `<option value="${pId}" ${isTarget}>${p.nickname} (${p.role.toUpperCase()})</option>`;
        }
      }

      html += `
        <div class="card admin-bot-card ${isSelected ? 'selected-bot' : ''}" data-bot-id="${bot.id}">
          <div class="admin-card-header">
            <div>
              <span class="admin-player-name">${bot.nickname}</span>
              <span class="admin-tag-pill pill-bot">BOT</span>
              ${moveBadge}
              <span class="admin-badge ${roleBadge}">${bot.role.toUpperCase()}</span>
            </div>
            <div style="font-size:0.8rem; font-weight:700; color:var(--theme-primary);">
              Room: ${bot.roomCode}
            </div>
          </div>

          <div class="admin-meta-row" style="margin-top:10px;">
            <span class="admin-meta-label">Coordinates:</span>
            <span class="admin-meta-val" style="font-family:monospace;">${bot.lat.toFixed(5)}, ${bot.lng.toFixed(5)}</span>
          </div>
          <div class="admin-meta-row">
            <span class="admin-meta-label">Navigation Target:</span>
            <span class="admin-meta-val" style="color:#38bdf8; font-weight:600;">${destinationText}</span>
          </div>

          <!-- Speed Customization Section -->
          <div style="margin-top:10px; padding:8px 10px; background:#0f172a; border-radius:6px; border:1px solid #1e293b;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <span style="font-size:0.75rem; font-weight:700; color:#94a3b8;">⚡ Bot Speed:</span>
              <span style="font-size:0.8rem; font-weight:800; color:#00f5b4; font-family:monospace;">${bot.speed.toFixed(1)} m/s (${(bot.speed * 3.6).toFixed(1)} km/h)</span>
            </div>
            <div style="display:flex; gap:4px; flex-wrap:wrap;">
              <button type="button" class="admin-action-btn ${Math.abs(bot.speed - 1.4) < 0.2 ? 'btn-primary' : 'btn-ghost'}" style="font-size:0.7rem; padding:4px 8px; flex:1;" onclick="AdminBot.setBotSpeed('${bot.id}', 1.4)">
                🚶 1.4 Walk
              </button>
              <button type="button" class="admin-action-btn ${Math.abs(bot.speed - 2.8) < 0.2 ? 'btn-primary' : 'btn-ghost'}" style="font-size:0.7rem; padding:4px 8px; flex:1;" onclick="AdminBot.setBotSpeed('${bot.id}', 2.8)">
                🏃 2.8 Jog
              </button>
              <button type="button" class="admin-action-btn ${Math.abs(bot.speed - 5.0) < 0.2 ? 'btn-primary' : 'btn-ghost'}" style="font-size:0.7rem; padding:4px 8px; flex:1;" onclick="AdminBot.setBotSpeed('${bot.id}', 5.0)">
                ⚡ 5.0 Run
              </button>
              <button type="button" class="admin-action-btn ${Math.abs(bot.speed - 8.0) < 0.2 ? 'btn-primary' : 'btn-ghost'}" style="font-size:0.7rem; padding:4px 8px; flex:1;" onclick="AdminBot.setBotSpeed('${bot.id}', 8.0)">
                🚀 8.0 Sprint
              </button>
            </div>
          </div>

          <!-- Where to Go: Waypoint / Pursue Target -->
          <div style="margin-top:8px; padding:8px 10px; background:#0f172a; border-radius:6px; border:1px solid #1e293b;">
            <div style="font-size:0.75rem; font-weight:700; color:#94a3b8; margin-bottom:6px;">🎯 Destination & Pursuit Target:</div>
            <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
              <button type="button" class="admin-action-btn btn-secondary" style="font-size:0.72rem; padding:6px 10px; flex:1;" onclick="Admin.selectBotForWaypoint('${bot.id}')" title="Tap location on God's Eye Map">
                🚩 Set Waypoint on Map
              </button>
              ${bot.targetDestination ? `
                <button type="button" class="admin-action-btn btn-ghost" style="font-size:0.72rem; padding:6px 8px; color:#ff4757;" onclick="AdminBot.clearBotDestination('${bot.id}')" title="Cancel waypoint">
                  ✕ Clear
                </button>
              ` : ''}
            </div>
            <div style="display:flex; gap:6px; align-items:center; margin-top:6px;">
              <span style="font-size:0.72rem; color:#64748b; white-space:nowrap;">Pursue:</span>
              <select class="tactical-select" style="font-size:0.72rem; padding:4px 6px; flex:1;" onchange="AdminBot.setBotTargetPlayer('${bot.id}', this.value)">
                ${playerOptions}
              </select>
            </div>
          </div>

          <!-- Movement Toggle & Bot Actions -->
          <div class="admin-bot-actions-grid" style="margin-top:10px;">
            <button type="button" class="admin-action-btn ${isMoving ? 'btn-warning' : 'btn-success'}" style="${!isMoving ? 'background:#10b981; color:#fff;' : ''}" onclick="AdminBot.toggleMovement('${bot.id}')">
              ${isMoving ? '⏸️ Freeze / Stop' : '▶️ Start Moving'}
            </button>
            <button type="button" class="admin-action-btn btn-secondary" onclick="Admin.selectBotForMapPlacement('${bot.id}')">
              📍 Place on Map
            </button>
            <button type="button" class="admin-action-btn btn-ghost" onclick="AdminBot.swapRole('${bot.id}')">
              🔄 Swap Role
            </button>
            <button type="button" class="admin-action-btn btn-warning" onclick="AdminBot.triggerPing('${bot.id}')">
              📡 Ping Now
            </button>
            <button type="button" class="admin-action-btn btn-danger" onclick="Admin.confirmKickPlayer('${bot.roomCode}', '${bot.id}', '${bot.nickname}')">
              👢 Kick Bot
            </button>
            <button type="button" class="admin-action-btn btn-ghost" style="color:#ff4757;" onclick="AdminBot.despawn('${bot.id}')">
              ❌ Despawn
            </button>
          </div>
        </div>
      `;
    });
    container.innerHTML = html;
  }

  selectBotForMapPlacement(botId) {
    this.selectedBotId = botId;
    this.isMapPlacementMode = true;
    this.switchTab('map');
    const btn = document.getElementById('btn-admin-map-click-bot');
    if (btn) {
      btn.classList.add('active');
      btn.style.background = '#00f5b4';
      btn.style.color = '#000';
    }
    const b = AdminBot.bots.find(x => x.id === botId);
    UI.showToast(`📍 Tap anywhere on map to set ${b ? b.nickname : 'Bot'} position`, 'info');
  }

  handleSpawnBotSubmit() {
    const roomInput = document.getElementById('admin-bot-room-target');
    const nameInput = document.getElementById('admin-bot-name');
    const roleSelect = document.getElementById('admin-bot-role');
    const latInput = document.getElementById('admin-bot-lat');
    const lngInput = document.getElementById('admin-bot-lng');
    const speedSelect = document.getElementById('admin-bot-speed');
    const movementSelect = document.getElementById('admin-bot-movement');

    const roomCode = (roomInput?.value || Game.roomCode || 'TEST').toUpperCase().trim();
    const nickname = (nameInput?.value || 'Bot-' + Math.floor(Math.random() * 1000)).trim();
    const role = roleSelect?.value || 'runner';
    const speed = parseFloat(speedSelect?.value || '2.8');
    const isMoving = (movementSelect?.value || 'moving') !== 'stopped';

    let lat = parseFloat(latInput?.value);
    let lng = parseFloat(lngInput?.value);

    // Fallback coordinates if blank
    if (isNaN(lat) || isNaN(lng)) {
      if (typeof Game !== 'undefined' && Game.lastSelfCoords) {
        lat = Game.lastSelfCoords.lat + (Math.random() * 0.002 - 0.001);
        lng = Game.lastSelfCoords.lng + (Math.random() * 0.002 - 0.001);
      } else if (typeof Geo !== 'undefined' && Geo.currentPosition && Geo.currentPosition.lat != null) {
        lat = Geo.currentPosition.lat + (Math.random() * 0.002 - 0.001);
        lng = Geo.currentPosition.lng + (Math.random() * 0.002 - 0.001);
      } else if (typeof Game !== 'undefined' && Game.fixedBoundaryCenter) {
        lat = Game.fixedBoundaryCenter.lat + (Math.random() * 0.002 - 0.001);
        lng = Game.fixedBoundaryCenter.lng + (Math.random() * 0.002 - 0.001);
      } else {
        for (const p of this.allPlayers.values()) {
          if (p.lat != null && p.lng != null) {
            lat = p.lat + (Math.random() * 0.002 - 0.001);
            lng = p.lng + (Math.random() * 0.002 - 0.001);
            break;
          }
        }
      }
    }

    AdminBot.spawn(roomCode, nickname, role, lat, lng, speed, isMoving);
    this.renderBotsTab();
    UI.showToast(`Spawned bot ${nickname} (${speed} m/s) into Room ${roomCode}`, 'info');
  }

  promptSpawnQuickBot() {
    const roomCode = Game.roomCode || NetworkEngine.generateRoomCode();
    AdminBot.spawn(roomCode, 'GhostBot-1', 'runner');
    this.switchTab('bots');
  }

  /* ==========================================================================
     TAB 5: ROOM OVERRIDES & GLOBAL BROADCAST
     ========================================================================== */
  renderSettingsTab() {
    const select = document.getElementById('admin-override-room-select');
    if (!select) return;

    let opts = '<option value="GLOBAL">🌐 ALL ACTIVE ROOMS (Global Override)</option>';
    for (const rCode of this.rooms.keys()) {
      opts += `<option value="${rCode}">Room: ${rCode}</option>`;
    }
    select.innerHTML = opts;
    if (this.selectedRoomCode) select.value = this.selectedRoomCode;
  }

  applyRoomOverrides() {
    const roomCode = document.getElementById('admin-override-room-select')?.value || 'GLOBAL';
    const boundaryRadius = parseInt(document.getElementById('admin-override-boundary')?.value || '1500', 10);
    const pingInterval = parseInt(document.getElementById('admin-override-runner-ping')?.value || '300', 10);
    const seekerMode = document.getElementById('admin-override-seeker-mode')?.value || 'live';
    const tagDistance = parseInt(document.getElementById('admin-override-tag-dist')?.value || '15', 10);
    const captureMode = document.getElementById('admin-override-capture-mode')?.value || 'infection';

    const settings = {
      boundaryRadiusMeters: boundaryRadius,
      runnerPingInterval: pingInterval,
      seekerTrackingMode: seekerMode,
      tagDistanceMeters: tagDistance,
      runnerCaptureMode: captureMode
    };

    this.broadcastCommand(roomCode, {
      type: 'override_settings',
      settings: settings
    });

    UI.showToast(`Applied settings override to ${roomCode}`, 'info');
  }

  sendGlobalBroadcast() {
    const input = document.getElementById('admin-announcement-input');
    const msg = (input?.value || '').trim();
    if (!msg) {
      UI.showToast('Please enter an announcement message to broadcast', 'warning');
      return;
    }

    this.broadcastCommand('GLOBAL', {
      type: 'global_announcement',
      message: msg
    });

    input.value = '';
    UI.showToast('📢 Global Admin Announcement Dispatched', 'info');
  }
}

/**
 * Interactive Bot & Testing Simulation Sandbox
 * Simulates mobile GPS clients transmitting valid presence and telemetry over MQTT
 */
class AdminBotManager {
  constructor() {
    this.bots = [];
    this.tickInterval = null;
  }

  static getDistanceMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  static getBearing(lat1, lng1, lat2, lng2) {
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const y = Math.sin(dLng) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
              Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLng);
    return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
  }

  isBotActive(botId) {
    return this.bots.some(b => b.id === botId);
  }

  spawn(roomCode, nickname, role = 'runner', lat = null, lng = null, speed = 2.8, isMoving = true) {
    const botId = 'bot_' + Math.random().toString(36).substring(2, 8);
    let defaultLat = (typeof lat === 'number' && !isNaN(lat)) ? lat : null;
    let defaultLng = (typeof lng === 'number' && !isNaN(lng)) ? lng : null;

    if (defaultLat == null || defaultLng == null) {
      if (typeof Game !== 'undefined' && Game.lastSelfCoords) {
        defaultLat = Game.lastSelfCoords.lat + (Math.random() * 0.002 - 0.001);
        defaultLng = Game.lastSelfCoords.lng + (Math.random() * 0.002 - 0.001);
      } else if (typeof Geo !== 'undefined' && Geo.currentPosition && Geo.currentPosition.lat != null) {
        defaultLat = Geo.currentPosition.lat + (Math.random() * 0.002 - 0.001);
        defaultLng = Geo.currentPosition.lng + (Math.random() * 0.002 - 0.001);
      } else if (typeof Game !== 'undefined' && Game.fixedBoundaryCenter) {
        defaultLat = Game.fixedBoundaryCenter.lat + (Math.random() * 0.002 - 0.001);
        defaultLng = Game.fixedBoundaryCenter.lng + (Math.random() * 0.002 - 0.001);
      } else if (typeof Admin !== 'undefined' && Admin.allPlayers) {
        for (const p of Admin.allPlayers.values()) {
          if (p.lat != null && p.lng != null) {
            defaultLat = p.lat + (Math.random() * 0.002 - 0.001);
            defaultLng = p.lng + (Math.random() * 0.002 - 0.001);
            break;
          }
        }
      }
    }

    if (defaultLat == null || defaultLng == null) {
      defaultLat = 0;
      defaultLng = 0;
    }

    const botSpeed = typeof speed === 'number' ? Math.max(0.5, speed) : 2.8;
    const botIsMoving = isMoving !== false;

    const bot = {
      id: botId,
      roomCode: (roomCode || 'TEST').toUpperCase(),
      nickname: nickname || 'Bot-' + botId.substring(4),
      role: role,
      lat: defaultLat,
      lng: defaultLng,
      heading: Math.floor(Math.random() * 360),
      speed: botSpeed,
      isMoving: botIsMoving,
      mode: botIsMoving ? 'patrol' : 'static',
      targetDestination: null, // { lat, lng }
      targetPlayerId: null, // playerId
      pingTimer: 10,
      lastPresenceSend: 0
    };

    this.bots.push(bot);

    // Initial presence & telemetry
    this.broadcastBotPresence(bot);
    this.broadcastBotTelemetry(bot, true);

    if (!this.tickInterval) {
      this.tickInterval = setInterval(() => this.tick(), 1000);
    }

    return bot;
  }

  tick() {
    if (this.bots.length === 0) {
      if (this.tickInterval) {
        clearInterval(this.tickInterval);
        this.tickInterval = null;
      }
      return;
    }

    const now = Date.now();

    this.bots.forEach(bot => {
      // 1. Move bot if isMoving is true
      if (bot.isMoving) {
        let targetLat = null;
        let targetLng = null;

        if (bot.targetPlayerId) {
          const tp = Admin.allPlayers.get(bot.targetPlayerId);
          if (tp && typeof tp.lat === 'number' && typeof tp.lng === 'number') {
            targetLat = tp.lat;
            targetLng = tp.lng;
          }
        } else if (bot.targetDestination) {
          targetLat = bot.targetDestination.lat;
          targetLng = bot.targetDestination.lng;
        }

        if (targetLat !== null && targetLng !== null) {
          const dist = AdminBotManager.getDistanceMeters(bot.lat, bot.lng, targetLat, targetLng);
          if (dist <= 3.5 && bot.targetDestination) {
            // Arrived at destination waypoint!
            bot.lat = targetLat;
            bot.lng = targetLng;
            bot.targetDestination = null;
            bot.isMoving = false;
            bot.mode = 'static';
            UI.showToast(`🎯 ${bot.nickname} arrived at destination!`, 'success');
          } else {
            // Steer towards target coordinates
            const bearing = AdminBotManager.getBearing(bot.lat, bot.lng, targetLat, targetLng);
            bot.heading = bearing;
            const stepMeters = Math.min(dist, bot.speed);
            const rad = bearing * Math.PI / 180;
            const deltaLat = (stepMeters * Math.cos(rad)) / 111111;
            const deltaLng = (stepMeters * Math.sin(rad)) / (111111 * Math.cos(bot.lat * Math.PI / 180));
            bot.lat += deltaLat;
            bot.lng += deltaLng;
          }
        } else {
          // Free roam patrol
          bot.heading = (bot.heading + (Math.random() * 30 - 15) + 360) % 360;
          const rad = bot.heading * Math.PI / 180;
          const distMeters = bot.speed;
          const deltaLat = (distMeters * Math.cos(rad)) / 111111;
          const deltaLng = (distMeters * Math.sin(rad)) / (111111 * Math.cos(bot.lat * Math.PI / 180));
          bot.lat += deltaLat;
          bot.lng += deltaLng;
        }
      }

      // 2. Transmit periodic presence
      if (now - bot.lastPresenceSend > 3500) {
        this.broadcastBotPresence(bot);
        bot.lastPresenceSend = now;
      }

      // 3. Telemetry broadcast according to role
      if (bot.role === 'seeker') {
        this.broadcastBotTelemetry(bot, false);
      } else if (bot.role === 'runner') {
        // Continuous live telemetry for runner squadmates
        this.broadcastBotTelemetry(bot, false, true, false);

        // Periodic snapshot ping for seekers
        bot.pingTimer--;
        if (bot.pingTimer <= 0) {
          bot.pingTimer = 25; // 25s ping cycle in test
          this.broadcastBotTelemetry(bot, false, false, true);
        }
      }
    });
  }

  setBotSpeed(botId, speed) {
    const bot = this.bots.find(b => b.id === botId);
    if (!bot) return;
    bot.speed = Math.max(0.5, Math.min(30, parseFloat(speed) || 2.8));
    this.broadcastBotTelemetry(bot, true);
    UI.showToast(`Speed for ${bot.nickname} set to ${bot.speed.toFixed(1)} m/s`, 'info');
    Admin.renderBotsTab();
  }

  toggleMovement(botId) {
    const bot = this.bots.find(b => b.id === botId);
    if (!bot) return;
    bot.isMoving = !bot.isMoving;
    bot.mode = bot.isMoving ? (bot.targetDestination ? 'waypoint' : (bot.targetPlayerId ? 'pursuit' : 'patrol')) : 'static';
    this.broadcastBotTelemetry(bot, true);
    UI.showToast(`Bot ${bot.nickname} is now ${bot.isMoving ? 'MOVING' : 'FROZEN / STOPPED'}`, 'info');
    Admin.renderBotsTab();
  }

  setMovement(botId, isMoving) {
    const bot = this.bots.find(b => b.id === botId);
    if (!bot) return;
    bot.isMoving = !!isMoving;
    bot.mode = bot.isMoving ? (bot.targetDestination ? 'waypoint' : (bot.targetPlayerId ? 'pursuit' : 'patrol')) : 'static';
    this.broadcastBotTelemetry(bot, true);
    UI.showToast(`Bot ${bot.nickname} movement set to ${bot.isMoving ? 'MOVING' : 'STOPPED'}`, 'info');
    Admin.renderBotsTab();
  }

  setBotDestination(botId, lat, lng) {
    const bot = this.bots.find(b => b.id === botId);
    if (!bot) return;
    bot.targetDestination = { lat: parseFloat(lat), lng: parseFloat(lng) };
    bot.targetPlayerId = null;
    bot.isMoving = true;
    bot.mode = 'waypoint';
    this.broadcastBotTelemetry(bot, true);
    UI.showToast(`🎯 Destination waypoint set for ${bot.nickname}`, 'info');
    Admin.renderBotsTab();
    if (Admin.masterMap) {
      Admin.updateMasterMapMarkers();
    }
  }

  clearBotDestination(botId) {
    const bot = this.bots.find(b => b.id === botId);
    if (!bot) return;
    bot.targetDestination = null;
    bot.mode = bot.isMoving ? 'patrol' : 'static';
    UI.showToast(`Cleared destination for ${bot.nickname}`, 'info');
    Admin.renderBotsTab();
    if (Admin.masterMap) {
      Admin.updateMasterMapMarkers();
    }
  }

  setBotTargetPlayer(botId, targetPlayerId) {
    const bot = this.bots.find(b => b.id === botId);
    if (!bot) return;
    bot.targetPlayerId = targetPlayerId ? targetPlayerId : null;
    bot.targetDestination = null;
    if (bot.targetPlayerId) {
      bot.isMoving = true;
      bot.mode = 'pursuit';
      const targetP = Admin.allPlayers.get(bot.targetPlayerId);
      UI.showToast(`🎯 ${bot.nickname} is now pursuing ${targetP ? targetP.nickname : 'target'}!`, 'info');
    } else {
      bot.mode = bot.isMoving ? 'patrol' : 'static';
      UI.showToast(`${bot.nickname} resumed free patrol`, 'info');
    }
    Admin.renderBotsTab();
  }

  broadcastBotPresence(bot) {
    const packet = {
      msgId: 'm_bot_' + Math.random().toString(36).substring(2, 9),
      senderId: bot.id,
      action: 'presence',
      roomCode: bot.roomCode,
      data: {
        playerId: bot.id,
        nickname: bot.nickname,
        role: bot.role,
        isHost: false,
        isBot: true,
        lat: bot.lat,
        lng: bot.lng,
        timestamp: Date.now()
      }
    };
    this.sendPacket(bot.roomCode, packet);
  }

  broadcastBotTelemetry(bot, isInitial = false, isLiveRunnerBroadcast = false, isPingSnapshot = false) {
    const packet = {
      msgId: 'm_bot_' + Math.random().toString(36).substring(2, 9),
      senderId: bot.id,
      action: 'telemetry',
      roomCode: bot.roomCode,
      data: {
        playerId: bot.id,
        nickname: bot.nickname,
        role: bot.role,
        lat: bot.lat,
        lng: bot.lng,
        speed: bot.isMoving ? bot.speed : 0,
        heading: bot.heading,
        isLiveRunnerBroadcast: isLiveRunnerBroadcast,
        isPingSnapshot: isPingSnapshot || isInitial,
        timestamp: Date.now()
      }
    };
    this.sendPacket(bot.roomCode, packet);
  }

  sendPacket(roomCode, packet) {
    // 1. MQTT Delivery
    if (Admin.mqttClient && Admin.mqttClient.isConnected()) {
      try {
        const topic = `manhunt/room/${roomCode}/${packet.action}`;
        const msg = new Paho.MQTT.Message(JSON.stringify(packet));
        msg.destinationName = topic;
        msg.qos = 0;
        Admin.mqttClient.send(msg);
      } catch (e) {}
    } else if (Network.client && Network.client.isConnected() && Network.roomCode === roomCode) {
      try {
        const topic = `manhunt/room/${roomCode}/${packet.action}`;
        const msg = new Paho.MQTT.Message(JSON.stringify(packet));
        msg.destinationName = topic;
        msg.qos = 0;
        Network.client.send(msg);
      } catch (e) {}
    }

    // 2. BroadcastChannel delivery
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        const bc = new BroadcastChannel('manhunt_' + roomCode);
        bc.postMessage(packet);
        setTimeout(() => { try { bc.close(); } catch (e) {} }, 100);
      }
    } catch (e) {}

    // 3. Local engine ingestion
    Admin.handleIncomingPacket({ ...packet, roomCode: roomCode });
    if (typeof Game !== 'undefined' && Game.roomCode === roomCode) {
      if (packet.action === 'presence') {
        Network.peers.set(packet.data.playerId, {
          id: packet.data.playerId,
          nickname: packet.data.nickname,
          role: packet.data.role,
          lat: packet.data.lat,
          lng: packet.data.lng,
          lastSeen: Date.now()
        });
        Game.updatePlayerRoster();
      } else if (packet.action === 'telemetry') {
        Game.onRemoteTelemetry(packet.data);
      }
    }
  }

  setBotLocation(botId, lat, lng) {
    const bot = this.bots.find(b => b.id === botId);
    if (!bot) return;
    bot.lat = lat;
    bot.lng = lng;
    this.broadcastBotPresence(bot);
    this.broadcastBotTelemetry(bot, true, true, true);
  }

  togglePatrol(botId) {
    this.toggleMovement(botId);
  }

  swapRole(botId) {
    const bot = this.bots.find(b => b.id === botId);
    if (!bot) return;
    bot.role = bot.role === 'runner' ? 'seeker' : 'runner';
    this.broadcastBotPresence(bot);
    this.broadcastBotTelemetry(bot, true);
    UI.showToast(`Bot ${bot.nickname} role switched to ${bot.role.toUpperCase()}`, 'info');
  }

  triggerPing(botId) {
    const bot = this.bots.find(b => b.id === botId);
    if (!bot) return;
    this.broadcastBotTelemetry(bot, false, false, true);
    UI.showToast(`📡 Triggered ping snapshot for ${bot.nickname}`, 'info');
  }

  testOutOfBounds(botId) {
    const bot = this.bots.find(b => b.id === botId);
    if (!bot) return;

    // Teleport ~2000m north to trigger out-of-bounds alert
    bot.lat += 0.02; // ~2.2 km
    this.broadcastBotPresence(bot);
    this.broadcastBotTelemetry(bot, true, true, true);
    UI.showToast(`⚠️ Teleported ${bot.nickname} outside boundary (~2km North)`, 'warning');
  }

  despawn(botId) {
    const idx = this.bots.findIndex(b => b.id === botId);
    if (idx === -1) return;
    const bot = this.bots[idx];

    // Send leave notification
    this.sendPacket(bot.roomCode, {
      msgId: 'm_bot_leave_' + Date.now(),
      senderId: bot.id,
      action: 'leave',
      roomCode: bot.roomCode,
      data: { playerId: bot.id }
    });

    this.bots.splice(idx, 1);
    Admin.allPlayers.delete(botId);
    Admin.removeMapMarker(botId);

    // Remove waypoint marker if any
    if (Admin.waypointMarkers && Admin.waypointMarkers.has(botId)) {
      if (Admin.masterMap) {
        Admin.masterMap.removeLayer(Admin.waypointMarkers.get(botId));
      }
      Admin.waypointMarkers.delete(botId);
    }

    // Remove from room players
    for (const r of Admin.rooms.values()) {
      if (r.players && r.players.has(botId)) {
        r.players.delete(botId);
        r.playerCount = r.players.size;
      }
    }

    // Remove from Network peers & Game rosters
    if (typeof Network !== 'undefined' && Network.peers) {
      Network.peers.delete(botId);
    }
    if (typeof Game !== 'undefined') {
      if (Game.activeRunners) Game.activeRunners.delete(botId);
      if (Game.activeSeekers) Game.activeSeekers.delete(botId);
      if (Game.updatePlayerRoster) Game.updatePlayerRoster();
    }
    if (typeof MapController !== 'undefined' && MapController.removePeer) {
      MapController.removePeer(botId);
    }

    UI.showToast(`Despawned ${bot.nickname}`, 'info');
  }

  despawnAllForRoom(roomCode) {
    const target = (roomCode || '').toUpperCase().trim();
    const toRemove = this.bots.filter(b => b.roomCode === target);
    toRemove.forEach(b => this.despawn(b.id));
  }

  despawnAll() {
    if (this.bots.length === 0) {
      UI.showToast('No active bots to despawn', 'info');
      return;
    }
    const total = this.bots.length;
    while (this.bots.length > 0) {
      this.despawn(this.bots[0].id);
    }
    UI.showToast(`Despawned all ${total} bots`, 'info');
    Admin.renderBotsTab();
    Admin.updateMasterMapMarkers();
  }
}

// Global Singletons
const Admin = new AdminEngine();
const AdminBot = new AdminBotManager();
const AdminEngineStatic = Admin;

if (typeof window !== 'undefined') {
  window.Admin = Admin;
  window.AdminBot = AdminBot;
  window.AdminEngineStatic = Admin;

  const bindAdminEvents = () => {
    const broadcastBtn = document.getElementById('btn-admin-broadcast');
    if (broadcastBtn) {
      broadcastBtn.onclick = () => Admin.sendGlobalBroadcast();
    }

    const broadcastInput = document.getElementById('admin-announcement-input');
    if (broadcastInput) {
      broadcastInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          Admin.sendGlobalBroadcast();
        }
      };
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindAdminEvents);
  } else {
    bindAdminEvents();
  }
}
