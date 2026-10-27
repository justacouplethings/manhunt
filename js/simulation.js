/**
 * Manhunt Testing & Offline Simulation Sandbox
 * Simulates mobile GPS movement, multiple runners and seekers,
 * and allows end-to-end verification without requiring physical outdoor travel.
 */
class SimulationEngine {
  constructor() {
    this.isActive = false;
    this.intervalId = null;
    this.simulatedBots = [];
    this.centerLat = 40.7128;
    this.centerLng = -74.0060;
  }

  start(centerCoords = null) {
    if (this.isActive) return;

    if (centerCoords) {
      this.centerLat = centerCoords.lat;
      this.centerLng = centerCoords.lng;
    } else if (Game.lastSelfCoords) {
      this.centerLat = Game.lastSelfCoords.lat;
      this.centerLng = Game.lastSelfCoords.lng;
    }

    this.isActive = true;
    console.log('--- Simulation Sandbox Started at', this.centerLat, this.centerLng, '---');

    // Create 3 simulated bots: 2 Runners and 1 Seeker
    this.simulatedBots = [
      {
        id: 'bot_runner_1',
        nickname: 'Ghost Runner (Bot)',
        role: 'runner',
        lat: this.centerLat + 0.0012,
        lng: this.centerLng + 0.0008,
        heading: 45,
        speed: 2.8,
        isTagged: false,
        pingTimer: 10 // Pings faster in simulation for immediate testing
      },
      {
        id: 'bot_runner_2',
        nickname: 'Sprint Fox (Bot)',
        role: 'runner',
        lat: this.centerLat - 0.0015,
        lng: this.centerLng + 0.0010,
        heading: 120,
        speed: 3.2,
        isTagged: false,
        pingTimer: 15
      },
      {
        id: 'bot_seeker_1',
        nickname: 'Viper Hunter (Bot)',
        role: 'seeker',
        lat: this.centerLat - 0.0008,
        lng: this.centerLng - 0.0012,
        heading: 310,
        speed: 3.5,
        isTagged: false
      }
    ];

    // Register simulated bots in game
    this.simulatedBots.forEach(bot => {
      Network.peers.set(bot.id, {
        id: bot.id,
        nickname: bot.nickname,
        role: bot.role,
        isHost: false,
        lat: bot.lat,
        lng: bot.lng,
        isTagged: false,
        lastSeen: Date.now()
      });
    });

    Game.updatePlayerRoster();

    // Simulation loop (ticks every 1s)
    this.intervalId = setInterval(() => {
      this.tick();
    }, 1000);
  }

  tick() {
    if (!this.isActive) return;

    // Move bots around center
    this.simulatedBots.forEach(bot => {
      // Small random turn
      bot.heading = (bot.heading + (Math.random() * 40 - 20) + 360) % 360;
      const rad = bot.heading * Math.PI / 180;
      
      // Speed in meters / second converted to lat/lng delta
      const distMeters = bot.speed;
      const deltaLat = (distMeters * Math.cos(rad)) / 111111;
      const deltaLng = (distMeters * Math.sin(rad)) / (111111 * Math.cos(bot.lat * Math.PI / 180));

      bot.lat += deltaLat;
      bot.lng += deltaLng;

      // Handle telemetry according to role
      if (bot.role === 'seeker') {
        // Seekers broadcast live
        Game.onRemoteTelemetry({
          playerId: bot.id,
          nickname: bot.nickname,
          lat: bot.lat,
          lng: bot.lng,
          role: 'seeker',
          speed: bot.speed,
          heading: bot.heading,
          isPingSnapshot: false
        });
      } else if (bot.role === 'runner') {
        // Runners only ping when their timer expires
        bot.pingTimer--;
        if (bot.pingTimer <= 0) {
          bot.pingTimer = 20; // Simulated ping cycle: 20s
          Game.onRemoteTelemetry({
            playerId: bot.id,
            nickname: bot.nickname,
            lat: bot.lat,
            lng: bot.lng,
            role: 'runner',
            speed: bot.speed,
            heading: bot.heading,
            isPingSnapshot: true
          });
        }
      }
    });

    // If device doesn't have real GPS, simulate gentle movement for self too!
    if (!Game.lastSelfCoords) {
      const mockSelf = {
        lat: this.centerLat,
        lng: this.centerLng,
        accuracy: 5,
        speed: 2.5,
        heading: 90,
        timestamp: Date.now()
      };
      Geo.notifyLocation(mockSelf);
    }
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.simulatedBots.forEach(bot => {
      Network.peers.delete(bot.id);
      MapController.removePeer(bot.id);
    });
    this.simulatedBots = [];
    this.isActive = false;
    Game.updatePlayerRoster();
    console.log('--- Simulation Sandbox Stopped ---');
  }

  toggle() {
    if (this.isActive) {
      this.stop();
      UI.showToast('Simulation Mode Stopped', 'info');
    } else {
      this.start();
      UI.showToast('Simulation Mode Started (Bots Active)', 'info');
    }
  }
}

// Global Simulation singleton
const Simulation = new SimulationEngine();
