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
          }, 2000);
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
        keepAliveInterval: 25,
        cleanSession: true,
        onSuccess: () => {
          this.isConnected = true;
          this.reconnectAttempts = 0;
          console.log(`Connected to Manhunt Relay (${broker.host}) for room ${this.roomCode}`);

          // Wildcard subscription for all room messages
          const topic = `manhunt/room/${this.roomCode}/#`;
          this.client.subscribe(topic, { qos: 0 });

          this.emit('connected', { mode: 'cloud', broker: broker.host });
          this.startHeartbeat();

          // Handshake initiation
          if (this.isHost) {
            this.startHostBeacon();
            this.sendPresence();
          } else {
            this.startJoinHandshake();
          }
        },
        onFailure: (err) => {
          console.warn(`MQTT Connect failed on ${broker.host}:`, err);
          this.reconnectAttempts++;
          if (this.reconnectAttempts >= 3) {
            this.currentBrokerIdx = (this.currentBrokerIdx + 1) % this.brokers.length;
            this.reconnectAttempts = 0;
          }
          setTimeout(() => {
            if (this.roomCode) this.connectMqtt();
          }, 2500);
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
    }, 2500);
  }

  emitHostBeacon() {
    if (!this.isHost || !this.roomCode) return;
    this.broadcast('room_state', {
      hostId: this.playerId,
      hostName: this.nickname,
      state: Game ? Game.state : 'WAITING',
      matchStartTimestamp: Game ? Game.matchStartTimestamp : 0,
      settings: typeof Config !== 'undefined' ? Config.settings : {},
      peers: Array.from(this.peers.values())
    });
  }

  /**
   * Start joiner handshake retry
   */
  startJoinHandshake() {
    if (this.joinRetryTimer) clearInterval(this.joinRetryTimer);
    let attempts = 0;
    this.sendPresence();

    this.joinRetryTimer = setInterval(() => {
      attempts++;
      if (!this.roomCode || attempts > 15) {
        clearInterval(this.joinRetryTimer);
        this.joinRetryTimer = null;
        return;
      }
      this.broadcast('join_request', {
        playerId: this.playerId,
        nickname: this.nickname,
        role: this.role
      });
    }, 2000);
  }

  sendPresence() {
    this.broadcast('presence', {
      playerId: this.playerId,
      nickname: this.nickname,
      role: this.role,
      isHost: this.isHost,
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
    }, 4000);
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

    // Critical actions retransmit twice with short delays to eliminate mobile cellular packet loss
    const criticalActions = ['start_game', 'host_command', 'role_assigned', 'tag_request', 'tag_confirmed', 'tag_disputed', 'settings_sync'];
    if (isCritical || criticalActions.includes(action)) {
      setTimeout(sendSingle, 250);
      setTimeout(sendSingle, 600);
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
      const peerData = {
        id: senderId,
        nickname: data.nickname || 'Unknown',
        role: data.role || 'runner',
        isHost: !!data.isHost,
        lastSeen: Date.now(),
        lat: data.lat || null,
        lng: data.lng || null,
        isTagged: !!data.isTagged
      };
      this.peers.set(senderId, { ...(this.peers.get(senderId) || {}), ...peerData });

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
      const peerData = {
        id: senderId,
        nickname: data.nickname || 'Unknown',
        role: data.role || 'runner',
        isHost: false,
        lastSeen: Date.now()
      };
      const isNew = !this.peers.has(senderId);
      this.peers.set(senderId, { ...(this.peers.get(senderId) || {}), ...peerData });
      if (isNew) this.emit('player_joined', peerData);

      // Reply with presence and full room state if host
      this.sendPresence();
      if (this.isHost) {
        this.emitHostBeacon();
      }
    } else if (action === 'room_state') {
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
    } else if (action === 'start_game') {
      this.emit('game_started', data);
    } else if (action === 'host_command') {
      this.emit('host_command', data);
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
