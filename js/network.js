/**
 * Manhunt Real-Time Networking Engine
 * Uses public encrypted MQTT over WebSockets for zero-cost, serverless global multiplayer,
 * with automatic fallback to BroadcastChannel for local/multi-tab testing.
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
    this.peers = new Map(); // id -> { id, nickname, role, lastSeen, lat, lng, isTagged }
    this.heartbeatTimer = null;
    this.broadcastChannel = null;

    // Public SSL MQTT brokers (no accounts or auth required)
    this.brokers = [
      { host: 'broker.emqx.io', port: 8084, path: '/mqtt' },
      { host: 'broker.hivemq.com', port: 8884, path: '/mqtt' }
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

    // Enable BroadcastChannel for instant local-tab testing
    try {
      if (typeof BroadcastChannel !== 'undefined') {
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
    const clientId = 'mh_' + this.playerId + '_' + Math.floor(Math.random() * 1000);

    try {
      if (typeof Paho === 'undefined' || !Paho.MQTT) {
        console.warn('Paho MQTT library not loaded, using local BroadcastChannel mode');
        this.isConnected = true;
        this.emit('connected', { mode: 'local' });
        this.startHeartbeat();
        this.sendPresence();
        return;
      }

      this.client = new Paho.MQTT.Client(broker.host, broker.port, broker.path, clientId);

      this.client.onConnectionLost = (responseObject) => {
        this.isConnected = false;
        console.warn('MQTT Connection lost:', responseObject.errorMessage);
        this.emit('disconnected', { reason: responseObject.errorMessage });
        // Auto-reconnect with next broker after 3s
        setTimeout(() => {
          if (this.roomCode) {
            this.currentBrokerIdx = (this.currentBrokerIdx + 1) % this.brokers.length;
            this.connectMqtt();
          }
        }, 3000);
      };

      this.client.onMessageArrived = (message) => {
        try {
          const payload = JSON.parse(message.payloadString);
          this.handleIncomingRaw(payload);
        } catch (e) {
          console.warn('Failed to parse incoming message payload:', e);
        }
      };

      const options = {
        useSSL: true,
        timeout: 5,
        keepAliveInterval: 30,
        cleanSession: true,
        onSuccess: () => {
          this.isConnected = true;
          console.log(`Connected to Manhunt Relay (${broker.host})`);
          
          // Subscribe to room topics
          const topic = `manhunt/room/${this.roomCode}/#`;
          this.client.subscribe(topic, { qos: 0 });

          this.emit('connected', { mode: 'cloud', broker: broker.host });
          this.startHeartbeat();
          this.sendPresence();
        },
        onFailure: (err) => {
          console.warn('MQTT Connect failed on', broker.host, err);
          // Try next broker or fallback
          this.currentBrokerIdx = (this.currentBrokerIdx + 1) % this.brokers.length;
          setTimeout(() => {
            if (this.roomCode) this.connectMqtt();
          }, 2000);
        }
      };

      this.client.connect(options);
    } catch (e) {
      console.warn('MQTT initialization error, falling back to local mode:', e);
      this.isConnected = true;
      this.emit('connected', { mode: 'local' });
      this.startHeartbeat();
      this.sendPresence();
    }
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
    }, 10000);
  }

  pruneStalePeers() {
    const now = Date.now();
    for (const [id, peer] of this.peers.entries()) {
      // If no heartbeat for 35 seconds, mark disconnected
      if (now - peer.lastSeen > 35000) {
        this.peers.delete(id);
        this.emit('player_left', { playerId: id, nickname: peer.nickname });
      }
    }
  }

  /**
   * Broadcast message to room peers
   */
  broadcast(action, data) {
    const packet = {
      senderId: this.playerId,
      action: action,
      data: data,
      timestamp: Date.now()
    };

    // Broadcast to local channel
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(packet);
      } catch (e) {}
    }

    // Publish to MQTT broker
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
  }

  handleIncomingRaw(packet) {
    if (!packet || typeof packet !== 'object') return;
    if (packet.senderId === this.playerId) return; // Ignore own messages

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
      } else {
        this.emit('player_updated', peerData);
      }
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
