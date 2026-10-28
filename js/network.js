/**
 * Manhunt Real-Time Networking Engine
 * Bulletproof, zero-cost, serverless global multiplayer over SSL WebSockets.
 * Features deterministic broker coordination, burst packet retransmission,
 * periodic room-state beacons, join handshakes, and duplicate message filtering.
 */
class NetworkEngine {
  constructor() {
    this.client = null;
    this.roomCode = null;
    this.playerId = 'p_' + Math.random().toString(36).substring(2, 9);
    this.nickname = 'Player';
    this.role = 'runner'; // 'runner' or 'seeker'
    this.isHost = false;
    this.isConnected = false;
    this.handlers = {};
    this.peers = new Map(); // id -> { id, nickname, role, lastSeen, lat, lng, isTagged, isHost }
    this.heartbeatTimer = null;
    this.beaconTimer = null;
    this.joinRetryTimer = null;
    this.broadcastChannel = null;
    this.processedMsgIds = new Set();
    this.reconnectAttempts = 0;
    this.activeBrokerName = '';

    // Public SSL MQTT brokers (HiveMQ as rock-solid primary)
    this.brokers = [
      { host: 'broker.hivemq.com', port: 8884, path: '/mqtt' },
      { host: 'broker.emqx.io', port: 8084, path: '/mqtt' }
    ];
    this.currentBrokerIdx = 0;
  }

  /**
   * Register an event listener
   */
  on(event, handler) {
    if (!this.handlers[event]) {
      this.handlers[event] = [];
    }
    this.handlers[event].push(handler);
  }

  /**
   * Emit an event locally
   */
  emit(event, data) {
    if (this.handlers[event]) {
      for (const handler of this.handlers[event]) {
        try { handler(data); } catch (e) { console.error(`Handler error for ${event}:`, e); }
      }
    }
  }

  /**
   * Connect to a game room
   */
  connect(roomCode, nickname, role, isHost = false) {
    this.roomCode = roomCode.toUpperCase().trim();
    this.nickname = nickname.trim() || 'Player';
    this.role = role || 'runner';
    this.isHost = isHost;
    this.reconnectAttempts = 0;
    this.currentBrokerIdx = 0; // Always start on the primary broker

    // Enable BroadcastChannel for instant local testing / multi-tab cross play
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        if (this.broadcastChannel) this.broadcastChannel.close();
        this.broadcastChannel = new BroadcastChannel('manhunt_' + this.roomCode);
        this.broadcastChannel.onmessage = (event) => {
          this.handleIncomingRaw(event.data);
        };

        if (this.globalBroadcastChannel) this.globalBroadcastChannel.close();
        this.globalBroadcastChannel = new BroadcastChannel('manhunt_GLOBAL');
        this.globalBroadcastChannel.onmessage = (event) => {
          this.handleIncomingRaw(event.data);
        };
      }
    } catch (e) {
      console.warn('BroadcastChannel not supported', e);
    }

    this.connectMqtt();
  }

  connectMqtt() {
    const broker = this.brokers[this.currentBrokerIdx];
    this.activeBrokerName = broker.host;
    const clientId = 'mh_' + this.playerId + '_' + Math.floor(Math.random() * 10000);

    try {
      if (typeof Paho === 'undefined' || !Paho.MQTT) {
        console.warn('Paho MQTT library not loaded, using local BroadcastChannel mode');
        this.isConnected = true;
        this.emit('connected', { mode: 'local', broker: 'LocalChannel' });
        this.startHeartbeat();
        this.sendPresence();
        return;
      }

      if (this.client) {
        try { this.client.disconnect(); } catch (e) {}
        this.client = null;
      }

      this.client = new Paho.MQTT.Client(broker.host, broker.port, broker.path, clientId);

      this.client.onConnectionLost = (responseObject) => {
        this.isConnected = false;
        console.warn(`MQTT Connection lost on ${broker.host}:`, responseObject.errorMessage);
        this.emit('disconnected', { reason: responseObject.errorMessage, broker: broker.host });

        // Auto-reconnect with primary broker first, failover only after multiple attempts
        if (this.roomCode) {
          this.reconnectAttempts++;
          if (this.reconnectAttempts >= 4) {
            this.currentBrokerIdx = (this.currentBrokerIdx + 1) % this.brokers.length;
            this.reconnectAttempts = 0;
          }
          setTimeout(() => {
            if (this.roomCode) this.connectMqtt();
          }, 800);
        }
      };

      this.client.onMessageArrived = (message) => {
        try {
          const payload = JSON.parse(message.payloadString);
          this.handleIncomingRaw(payload);
        } catch (e) {
          console.warn('Failed to parse incoming MQTT payload:', e);
        }
      };

      const options = {
        useSSL: true,
        timeout: 6,
        keepAliveInterval: 45,
        cleanSession: true,
        onSuccess: () => {
          this.isConnected = true;
          this.reconnectAttempts = 0;
          console.log(`Connected to Manhunt Relay (${broker.host}) for room ${this.roomCode}`);

          // Wildcard subscription for all room messages + global admin messages
          const topic = `manhunt/room/${this.roomCode}/#`;
          this.client.subscribe(topic, {
            qos: 0,
            onSuccess: () => {
              console.log(`Subscribed to topic ${topic}`);
              try {
                this.client.subscribe('manhunt/global/#', { qos: 0 });
                this.client.subscribe('manhunt/room/GLOBAL/#', { qos: 0 });
              } catch (e) {}
              this.emit('connected', { mode: 'cloud', broker: broker.host });
              this.startHeartbeat();

              // Handshake initiation once subscription is confirmed
              if (this.isHost) {
                this.startHostBeacon();
                this.sendPresence();
              } else {
                this.startJoinHandshake();
              }
            },
            onFailure: (subErr) => {
              console.warn('Subscription warning, proceeding anyway:', subErr);
              this.emit('connected', { mode: 'cloud', broker: broker.host });
              this.startHeartbeat();
              if (this.isHost) {
                this.startHostBeacon();
                this.sendPresence();
              } else {
                this.startJoinHandshake();
              }
            }
          });
        },
        onFailure: (err) => {
          console.warn(`MQTT Connect failed on ${broker.host}:`, err);
          this.reconnectAttempts++;
          if (this.reconnectAttempts >= 6) {
            this.currentBrokerIdx = (this.currentBrokerIdx + 1) % this.brokers.length;
            this.reconnectAttempts = 0;
          }
          setTimeout(() => {
            if (this.roomCode) this.connectMqtt();
          }, 2000);
        }
      };

      this.client.connect(options);
    } catch (e) {
      console.warn('MQTT initialization error, falling back to local mode:', e);
      this.isConnected = true;
      this.emit('connected', { mode: 'local', broker: 'LocalChannel' });
      this.startHeartbeat();
      this.sendPresence();
    }
  }

  /**
   * Start host room state beacon broadcast
   */
  startHostBeacon() {
    if (this.beaconTimer) clearInterval(this.beaconTimer);
    this.beaconTimer = setInterval(() => {
      if (this.roomCode && this.isHost) {
        this.emitHostBeacon();
      }
    }, 2000);
  }

  emitHostBeacon() {
    if (!this.isHost || !this.roomCode) return;

    const selfCoords = (typeof Game !== 'undefined' && Game.lastSelfCoords) ||
                       (typeof Geo !== 'undefined' && Geo.currentPosition) || null;

    // Build the complete authoritative roster including the host and all known peers with coordinates
    const roster = [
      {
        id: this.playerId,
        nickname: this.nickname,
        role: this.role,
        isHost: true,
        lat: selfCoords ? selfCoords.lat : null,
        lng: selfCoords ? selfCoords.lng : null,
        lastPingTime: Date.now(),
        lastSeen: Date.now()
      },
      ...Array.from(this.peers.values()).map(p => {
        const pLat = p.lat != null ? p.lat :
                     ((typeof Game !== 'undefined' && Game.trueLivePositions && Game.trueLivePositions.get(p.id)?.lat) ||
                      (typeof Game !== 'undefined' && Game.lastKnownPositions && Game.lastKnownPositions.get(p.id)?.lat) || null);
        const pLng = p.lng != null ? p.lng :
                     ((typeof Game !== 'undefined' && Game.trueLivePositions && Game.trueLivePositions.get(p.id)?.lng) ||
                      (typeof Game !== 'undefined' && Game.lastKnownPositions && Game.lastKnownPositions.get(p.id)?.lng) || null);
        const pPing = p.lastPingTime ||
                      ((typeof Game !== 'undefined' && Game.lastKnownPositions && Game.lastKnownPositions.get(p.id)?.timestamp) ||
                       (typeof Game !== 'undefined' && Game.trueLivePositions && Game.trueLivePositions.get(p.id)?.timestamp) || p.lastSeen);
        return {
          id: p.id,
          nickname: p.nickname,
          role: p.role,
          isHost: false,
          isTagged: !!p.isTagged,
          lat: pLat,
          lng: pLng,
          lastPingTime: pPing,
          lastSeen: p.lastSeen
        };
      })
    ];

    this.broadcast('room_state', {
      hostId: this.playerId,
      hostName: this.nickname,
      hostRole: this.role,
      state: typeof Game !== 'undefined' ? Game.state : 'WAITING',
      matchStartTimestamp: typeof Game !== 'undefined' ? Game.matchStartTimestamp : 0,
      boundaryCenter: typeof Game !== 'undefined' ? Game.boundaryCenter : null,
      boundaryRadiusMeters: typeof Config !== 'undefined' ? Config.settings.boundaryRadiusMeters : 1500,
      settings: typeof Config !== 'undefined' ? Config.settings : {},
      peers: roster,
      roster: roster,
      matchConfig: typeof Game !== 'undefined' && Game.currentMatchConfig ? Game.currentMatchConfig : null,
      lastGameOverData: typeof Game !== 'undefined' ? Game.lastGameOverData : null
    });
  }

  /**
   * Start joiner handshake retry
   */
  startJoinHandshake() {
    if (this.joinRetryTimer) clearInterval(this.joinRetryTimer);
    let attempts = 0;

    const sendJoin = () => {
      this.broadcast('join_request', {
        playerId: this.playerId,
        nickname: this.nickname,
        role: this.role
      }, true);
      this.sendPresence();
    };

    sendJoin();

    this.joinRetryTimer = setInterval(() => {
      attempts++;
      if (!this.roomCode || attempts > 25) {
        clearInterval(this.joinRetryTimer);
        this.joinRetryTimer = null;
        return;
      }
      sendJoin();
    }, 1500);
  }

  sendPresence() {
    const selfCoords = (typeof Game !== 'undefined' && Game.lastSelfCoords) ||
                       (typeof Geo !== 'undefined' && Geo.currentPosition) || null;
    this.broadcast('presence', {
      playerId: this.playerId,
      nickname: this.nickname,
      role: this.role,
      isHost: this.isHost,
      lat: selfCoords ? selfCoords.lat : null,
      lng: selfCoords ? selfCoords.lng : null,
      timestamp: Date.now()
    });
  }

  startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (this.roomCode) {
        this.sendPresence();
        this.pruneStalePeers();
      }
    }, 3500);
  }

  pruneStalePeers() {
    const now = Date.now();
    for (const [id, peer] of this.peers.entries()) {
      // If no heartbeat for 45 seconds, mark disconnected
      if (now - peer.lastSeen > 45000) {
        this.peers.delete(id);
        this.emit('player_left', { playerId: id, nickname: peer.nickname });
      }
    }
  }

  /**
   * Broadcast message to room peers with automatic burst redundancy for critical actions
   */
  broadcast(action, data, isCritical = false) {
    const msgId = 'm_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now();
    const packet = {
      msgId: msgId,
      senderId: this.playerId,
      action: action,
      data: data,
      timestamp: Date.now()
    };

    const sendSingle = () => {
      // Local channel delivery
      if (this.broadcastChannel) {
        try {
          this.broadcastChannel.postMessage(packet);
        } catch (e) {}
      }

      // MQTT broker delivery
      if (this.client && this.client.isConnected()) {
        try {
          const topic = `manhunt/room/${this.roomCode}/${action}`;
          const message = new Paho.MQTT.Message(JSON.stringify(packet));
          message.destinationName = topic;
          message.qos = 0;
          this.client.send(message);
        } catch (e) {
          console.warn('Broadcast send error:', e);
        }
      }
    };

    sendSingle();

    // Critical actions retransmit with short delays to eliminate mobile cellular packet loss
    const criticalActions = ['start_game', 'match_over', 'game_over', 'host_command', 'admin_command', 'role_assigned', 'tag_request', 'tag_confirmed', 'tag_disputed', 'settings_sync', 'join_request'];
    if (isCritical || criticalActions.includes(action)) {
      setTimeout(sendSingle, 150);
      setTimeout(sendSingle, 350);
      setTimeout(sendSingle, 700);
    }
  }

  handleIncomingRaw(packet) {
    if (!packet || typeof packet !== 'object') return;
    if (packet.senderId === this.playerId) return; // Ignore own messages

    // Deduplicate burst packets
    if (packet.msgId) {
      if (this.processedMsgIds.has(packet.msgId)) return;
      this.processedMsgIds.add(packet.msgId);
      if (this.processedMsgIds.size > 400) {
        // Prune oldest half of set
        const arr = Array.from(this.processedMsgIds);
        this.processedMsgIds = new Set(arr.slice(arr.length - 200));
      }
    }

    const { action, data, senderId } = packet;

    if (action === 'presence') {
      const isNew = !this.peers.has(senderId);
      const existing = this.peers.get(senderId) || {};
      const peerData = {
        ...existing,
        id: senderId,
        nickname: data.nickname || existing.nickname || 'Unknown',
        role: data.role || existing.role || 'runner',
        isHost: !!data.isHost,
        lastSeen: Date.now(),
        isTagged: !!data.isTagged
      };
      if (data.lat != null && data.lng != null) {
        peerData.lat = Number(data.lat);
        peerData.lng = Number(data.lng);
        peerData.lastPingTime = data.timestamp || Date.now();
      }
      this.peers.set(senderId, peerData);

      if (isNew) {
        this.emit('player_joined', peerData);
        // Reply with our presence so the new joiner immediately learns about us
        this.sendPresence();
        if (this.isHost) {
          this.emitHostBeacon();
        }
      } else {
        this.emit('player_updated', peerData);
      }
    } else if (action === 'join_request') {
      const existing = this.peers.get(senderId) || {};
      const peerData = {
        ...existing,
        id: senderId,
        nickname: data.nickname || existing.nickname || 'Unknown',
        role: data.role || existing.role || 'runner',
        isHost: false,
        lastSeen: Date.now()
      };
      if (data.lat != null && data.lng != null) {
        peerData.lat = Number(data.lat);
        peerData.lng = Number(data.lng);
        peerData.lastPingTime = data.timestamp || Date.now();
      }
      const isNew = !this.peers.has(senderId);
      this.peers.set(senderId, peerData);
      
      if (isNew) {
        this.emit('player_joined', peerData);
      } else {
        this.emit('player_updated', peerData);
      }

      // Reply with presence and full room state if host
      this.sendPresence();
      if (this.isHost) {
        this.emitHostBeacon();
      }
    } else if (action === 'room_state') {
      if (data) {
        // Ensure host is registered in peers on joining clients
        if (data.hostId && data.hostId !== this.playerId) {
          const existingHost = this.peers.get(data.hostId) || {};
          const hostPeer = {
            ...existingHost,
            id: data.hostId,
            nickname: data.hostName || existingHost.nickname || 'Host',
            role: data.hostRole || existingHost.role || 'runner',
            isHost: true,
            lastSeen: Date.now()
          };
          if (data.hostLat != null && data.hostLng != null) {
            hostPeer.lat = Number(data.hostLat);
            hostPeer.lng = Number(data.hostLng);
          }
          const isNewHost = !this.peers.has(data.hostId);
          this.peers.set(data.hostId, hostPeer);
          if (isNewHost) this.emit('player_joined', hostPeer);
          else this.emit('player_updated', hostPeer);
        }

        // Ingest full roster/peers array from host beacon
        const roster = data.roster || data.peers;
        if (Array.isArray(roster)) {
          roster.forEach(p => {
            if (p.id !== this.playerId) {
              const existing = this.peers.get(p.id) || {};
              const peerRecord = {
                ...existing,
                ...p,
                lastSeen: Date.now()
              };
              if (p.lat != null && p.lng != null) {
                peerRecord.lat = Number(p.lat);
                peerRecord.lng = Number(p.lng);
                peerRecord.lastPingTime = p.lastPingTime || Date.now();
              } else if (existing.lat != null) {
                peerRecord.lat = existing.lat;
                peerRecord.lng = existing.lng;
                peerRecord.lastPingTime = existing.lastPingTime;
              }
              const isNew = !this.peers.has(p.id);
              this.peers.set(p.id, peerRecord);
              if (isNew) this.emit('player_joined', peerRecord);
              else this.emit('player_updated', peerRecord);
            }
          });
        }
      }
      this.emit('room_state', data);
    } else if (action === 'role_assigned') {
      this.emit('role_assigned', data);
    } else if (action === 'tag_request') {
      this.emit('tag_request', data);
    } else if (action === 'tag_confirmed') {
      this.emit('tag_confirmed', data);
    } else if (action === 'tag_disputed') {
      this.emit('tag_disputed', data);
    } else if (action === 'telemetry') {
      const peer = this.peers.get(senderId) || { id: senderId };
      peer.lat = data.lat;
      peer.lng = data.lng;
      peer.role = data.role;
      peer.speed = data.speed;
      peer.heading = data.heading;
      peer.lastPingTime = data.timestamp;
      peer.lastSeen = Date.now();
      this.peers.set(senderId, peer);
      this.emit('telemetry', { playerId: senderId, ...data });
    } else if (action === 'start_game' || action === 'game_started') {
      // Ingest authoritative roster if provided in start packet
      const roster = data.roster || data.peers;
      if (Array.isArray(roster)) {
        roster.forEach(p => {
          if (p.id !== this.playerId) {
            this.peers.set(p.id, { ...(this.peers.get(p.id) || {}), ...p, lastSeen: Date.now() });
          }
        });
      }
      this.emit('game_started', data);
      this.emit('start_game', data);
    } else if (action === 'host_command') {
      this.emit('host_command', data);
    } else if (action === 'admin_command') {
      this.emit('admin_command', data);
    } else if (action === 'match_over' || action === 'game_over') {
      this.emit('match_over', data);
    } else if (action === 'tag_event') {
      this.emit('tag_event', data);
    } else if (action === 'settings_sync') {
      this.emit('settings_synced', data);
    } else if (action === 'chat') {
      this.emit('chat_message', data);
    }
  }

  disconnect() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.beaconTimer) {
      clearInterval(this.beaconTimer);
      this.beaconTimer = null;
    }
    if (this.joinRetryTimer) {
      clearInterval(this.joinRetryTimer);
      this.joinRetryTimer = null;
    }
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }
    if (this.globalBroadcastChannel) {
      this.globalBroadcastChannel.close();
      this.globalBroadcastChannel = null;
    }
    if (this.client && this.client.isConnected()) {
      try {
        this.broadcast('leave', { playerId: this.playerId });
        this.client.disconnect();
      } catch (e) {}
    }
    this.peers.clear();
    this.isConnected = false;
    this.roomCode = null;
    this.emit('disconnected', { reason: 'user_left' });
  }

  /**
   * Dispatch authoritative administrative command to a specific room or global channel
   */
  sendAdminCommand(roomCode, command) {
    const targetRoom = (roomCode || this.roomCode || 'GLOBAL').toUpperCase().trim();
    const packet = {
      msgId: 'm_admin_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now(),
      senderId: 'admin_' + this.playerId,
      action: 'admin_command',
      data: { roomCode: targetRoom, ...command },
      timestamp: Date.now()
    };

    const sendSingle = () => {
      // Deliver over broadcast channel if active
      try {
        if (typeof BroadcastChannel !== 'undefined') {
          const bc = new BroadcastChannel('manhunt_' + targetRoom);
          bc.postMessage(packet);
          setTimeout(() => { try { bc.close(); } catch (e) {} }, 500);
        }
      } catch (e) {}

      // Deliver over MQTT
      if (this.client && this.client.isConnected()) {
        try {
          const topic = `manhunt/room/${targetRoom}/admin_command`;
          const message = new Paho.MQTT.Message(JSON.stringify(packet));
          message.destinationName = topic;
          message.qos = 0;
          this.client.send(message);
        } catch (e) {
          console.warn('Admin MQTT send error:', e);
        }
      }
    };

    sendSingle();
    setTimeout(sendSingle, 200);
    setTimeout(sendSingle, 500);
  }

  static generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid confusing O/0 and I/1
    let result = '';
    for (let i = 0; i < 4; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}

// Global Network singleton
const Network = new NetworkEngine();
