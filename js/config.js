/**
 * Manhunt Configuration & Settings Manager
 * All settings are 100% customizable in-app without requiring external installations.
 */
const DEFAULT_CONFIG = {
  // Gameplay Timers & Tracking Modes
  runnerPingInterval: 300,        // Seconds (Default: 5 minutes: 30s, 60s, 120s, 180s, 300s, 600s, 900s)
  seekerTrackingMode: 'live',     // 'live' (2s continuous) or interval seconds (60, 120, 300, 600)
  seekerPingInterval: 3,          // Seconds (Used when in live mode: 2, 3, 5, 10)
  gracePeriod: 180,               // Seconds (Head start: 0, 30, 60, 120, 180, 300, 600)
  gameDuration: 2700,             // Seconds (Game length: 600, 900, 1800, 2700, 3600, 5400, 0 = unlimited)

  // Tactical Rules & Detection
  tagDistanceMeters: 15,          // Tag radius in meters (5, 10, 15, 20, 25, 30, 50)
  runnerCaptureMode: 'infection', // 'infection' (turns into seeker) or 'elimination' (spectator)
  requireTagConfirmation: true,   // true (runner confirms on mobile) or false (instant tag)
  proximityAlertMeters: 100,      // Proximity alarm triggers within meters (0 = off, 25, 50, 75, 100, 150, 200)
  proximityAlertInterval: 10,     // Beep interval in seconds when seeker is near
  boundaryRadiusMeters: 1500,     // Play boundary (0 = off, 250, 500, 1000, 1500, 2000, 3000, 5000)
  flareCooldownSeconds: 60,       // Cooldown duration between manual runner flares (prevents notification spam)

  // Sensory & Hardware
  soundEnabled: true,             // Tactical audio synthesizer
  vibrationEnabled: true,         // Haptic pulse alerts
  wakeLockEnabled: true,          // Prevent screen dimming during match
  highAccuracyGPS: true,          // Use GPS high accuracy

  // Visual Theme & Cartography
  theme: 'theme-night-vision',    // Default: Tactical phosphor HUD
  mapTileProvider: 'voyager',     // 'voyager', 'osm', 'dark'

  // Development / Offline Simulation
  simulationMode: false,          // Test mode with simulated bots

  // Admin & Moderation Credentials
  adminPin: '4',                  // Quick access numeric PIN
  adminPassword: 'shebsilover911#' // Alpha-numeric administrative passphrase
};

const THEMES = [
  {
    id: 'theme-night-vision',
    name: 'Tactical HUD (Night Vision)',
    description: 'Phosphor mint & cyber-cyan with tactical HUD filters',
    primary: '#00f5b4',
    bg: '#07090e',
    card: 'rgba(18, 24, 38, 0.75)',
    mapTile: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
  },
  {
    id: 'theme-stealth-oled',
    name: 'Midnight Stealth (OLED Black)',
    description: 'Deep pure pitch black to maximize battery endurance',
    primary: '#38bdf8',
    bg: '#000000',
    card: 'rgba(14, 17, 23, 0.85)',
    mapTile: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
  },
  {
    id: 'theme-cyberpunk',
    name: 'Cyberpunk Neon',
    description: 'Vibrant electric cyan and neon magenta pursuit palette',
    primary: '#00f0ff',
    bg: '#070210',
    card: 'rgba(24, 8, 44, 0.85)',
    mapTile: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
  },
  {
    id: 'theme-daylight',
    name: 'Daylight High-Visibility',
    description: 'High-contrast light interface optimized for bright outdoor sunlight',
    primary: '#0284c7',
    bg: '#f8fafc',
    card: 'rgba(255, 255, 255, 0.95)',
    mapTile: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
  },
  {
    id: 'theme-camo',
    name: 'Forest Camo & Recon',
    description: 'Military olive drab and earth tone field styling',
    primary: '#a3e635',
    bg: '#0e120d',
    card: 'rgba(22, 30, 20, 0.85)',
    mapTile: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
  }
];

class ConfigManager {
  constructor() {
    this.settings = { ...DEFAULT_CONFIG };
    this.load();
  }

  load() {
    try {
      const stored = localStorage.getItem('manhunt_settings');
      if (stored) {
        this.settings = { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
      }
    } catch (e) {
      console.warn('Could not read saved settings from localStorage', e);
    }
    return this.settings;
  }

  save(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    try {
      localStorage.setItem('manhunt_settings', JSON.stringify(this.settings));
    } catch (e) {
      console.warn('Could not save settings to localStorage', e);
    }
    this.applyTheme();
    return this.settings;
  }

  reset() {
    this.settings = { ...DEFAULT_CONFIG };
    try {
      localStorage.removeItem('manhunt_settings');
    } catch (e) {}
    this.applyTheme();
    return this.settings;
  }

  applyTheme() {
    const currentTheme = this.settings.theme || 'theme-night-vision';
    THEMES.forEach(t => document.body.classList.remove(t.id));
    document.body.classList.add(currentTheme);
  }

  getCurrentThemeDetails() {
    return THEMES.find(t => t.id === this.settings.theme) || THEMES[0];
  }
}

// Global configuration singleton
const Config = new ConfigManager();
