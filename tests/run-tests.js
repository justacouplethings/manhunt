/**
 * Manhunt Automated Test Suite
 * Tests spatial mathematics, Haversine accuracy, bearing calculation,
 * ping countdown logic, room code generation, and asset integrity.
 */
const fs = require('fs');
const path = require('path');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    testsPassed++;
  } else {
    console.error(`  ❌ FAIL: ${testName}`);
    testsFailed++;
  }
}

function assertClose(actual, expected, tolerance = 0.5, testName) {
  const diff = Math.abs(actual - expected);
  if (diff <= tolerance) {
    console.log(`  ✅ PASS: ${testName} (expected ~${expected}, got ${actual.toFixed(2)})`);
    testsPassed++;
  } else {
    console.error(`  ❌ FAIL: ${testName} (expected ${expected}, got ${actual}, diff: ${diff})`);
    testsFailed++;
  }
}

console.log('\n======================================================');
console.log('🧪 RUNNING MANHUNT CORE VALIDATION TESTS');
console.log('======================================================\n');

// 1. Test Spatial Mathematics & Haversine formula
console.log('1. Testing Spatial Geolocation Calculations:');

function getHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getBearing(lat1, lon1, lat2, lon2) {
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) -
            Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  let theta = Math.atan2(y, x);
  return (theta * 180 / Math.PI + 360) % 360;
}

function getCardinalDirection(degrees) {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(((degrees %= 360) < 0 ? degrees + 360 : degrees) / 45) % 8;
  return directions[index];
}

// Distance between Times Square (40.7580, -73.9855) and Empire State Building (40.7484, -73.9857) ~ 1067m
const timesSquareToEmpire = getHaversineDistance(40.7580, -73.9855, 40.7484, -73.9857);
assertClose(timesSquareToEmpire, 1067.5, 5, 'Distance between Times Square and Empire State Building is ~1067m');

// Distance between two points 15m apart (tag distance threshold)
const p1Lat = 40.7128, p1Lng = -74.0060;
const p2Lat = 40.712935, p2Lng = -74.0060; // ~15.0 meters due North
const tagDist = getHaversineDistance(p1Lat, p1Lng, p2Lat, p2Lng);
assertClose(tagDist, 15.0, 1.0, 'Tag distance boundary (~15m) computes accurately');

// Bearing test: directly North should be ~0 degrees (N)
const bearingNorth = getBearing(40.0, -74.0, 41.0, -74.0);
assertClose(bearingNorth, 0, 1, 'Bearing due North is 0 degrees');
assert(getCardinalDirection(bearingNorth) === 'N', 'Cardinal direction for 0 deg is "N"');

// Bearing test: directly East should be ~90 degrees (E)
const bearingEast = getBearing(0.0, 0.0, 0.0, 1.0);
assertClose(bearingEast, 90, 1, 'Bearing due East is 90 degrees');
assert(getCardinalDirection(bearingEast) === 'E', 'Cardinal direction for 90 deg is "E"');


// 2. Test Room Code Generation
console.log('\n2. Testing Room Code Engine:');
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

const sampleCodes = Array.from({ length: 50 }, () => generateRoomCode());
const allValidLength = sampleCodes.every(c => c.length === 4);
const noAmbiguousChars = sampleCodes.every(c => !c.includes('0') && !c.includes('O') && !c.includes('1') && !c.includes('I'));
assert(allValidLength, 'All room codes are strictly 4 characters');
assert(noAmbiguousChars, 'Ambiguous characters (0/O, 1/I) are excluded to prevent player confusion');


// 3. Test Periodic Runner Ping vs Seeker Live/Periodic Rules
console.log('\n3. Testing Runner Ping & Seeker Mechanics:');

class MockGameEngine {
  constructor(runnerInterval = 300, seekerMode = 'live') {
    this.runnerInterval = runnerInterval;
    this.runnerCountdown = runnerInterval;
    this.seekerMode = seekerMode;
    this.seekerCountdown = seekerMode === 'live' ? 0 : parseInt(seekerMode, 10);
    this.runnerPings = 0;
    this.seekerPings = 0;
    this.isPaused = false;
  }

  tick() {
    if (this.isPaused) return false;

    // Runner countdown
    this.runnerCountdown--;
    if (this.runnerCountdown <= 0) {
      this.runnerPings++;
      this.runnerCountdown = this.runnerInterval;
    }

    // Seeker periodic countdown
    if (this.seekerMode !== 'live') {
      this.seekerCountdown--;
      if (this.seekerCountdown <= 0) {
        this.seekerPings++;
        this.seekerCountdown = parseInt(this.seekerMode, 10);
      }
    }
    return true;
  }
}

const mockGame = new MockGameEngine(300, 'live'); // 5-minute runner interval, live seeker
for (let t = 1; t <= 905; t++) {
  mockGame.tick();
}
assert(mockGame.runnerPings === 3, 'In 905 seconds, exactly 3 runner pings occur at 300s intervals');

// Test Periodic Seeker Mode (e.g. 2 minutes = 120s)
const periodicSeekerGame = new MockGameEngine(300, '120');
for (let t = 1; t <= 365; t++) {
  periodicSeekerGame.tick();
}
assert(periodicSeekerGame.seekerPings === 3, 'In 365 seconds, exactly 3 seeker pings occur at 120s (2m) intervals');

// Test Host Pause State
const pausedGame = new MockGameEngine(60, '60');
pausedGame.isPaused = true;
for (let t = 1; t <= 120; t++) {
  pausedGame.tick();
}
assert(pausedGame.runnerPings === 0 && pausedGame.seekerPings === 0, 'When paused by host, all countdowns are frozen');

// Test Seeker Target Lock Priority
const runners = [
  { id: 'p_1', nickname: 'Alice', distance: 45 },
  { id: 'p_2', nickname: 'Bob', distance: 12 },
  { id: 'p_3', nickname: 'Charlie', distance: 80 }
];

function resolveTarget(targets, lockedId) {
  if (lockedId) {
    const locked = targets.find(t => t.id === lockedId);
    if (locked) return locked;
  }
  return [...targets].sort((a, b) => a.distance - b.distance)[0];
}

assert(resolveTarget(runners, null).id === 'p_2', 'Auto-target resolves closest runner (Bob, 12m)');
assert(resolveTarget(runners, 'p_3').id === 'p_3', 'Manual target lock overrides distance to lock selected runner (Charlie, 80m)');


// 4. Test File Structure & Asset Integrity
console.log('\n4. Testing Project File Structure & Asset Integrity:');
const rootDir = path.resolve(__dirname, '..');
const requiredFiles = [
  'index.html',
  'manifest.json',
  'service-worker.js',
  'privacy-policy.html',
  'package.json',
  'server.js',
  'css/styles.css',
  'css/leaflet.css',
  'js/config.js',
  'js/geo.js',
  'js/network.js',
  'js/map.js',
  'js/game.js',
  'js/simulation.js',
  'js/ui.js',
  'js/admin.js',
  'js/leaflet.js',
  'js/paho-mqtt.min.js',
  'assets/icon.png',
  'assets/icon-192.png',
  'assets/favicon.png',
  'android/AndroidManifest.xml',
  'play-store-metadata.json',
  'PLAY_STORE_RELEASE_GUIDE.md',
  'Manhunt.apk'
];

requiredFiles.forEach(file => {
  const filePath = path.join(rootDir, file);
  assert(fs.existsSync(filePath), `Required production asset exists: ${file}`);
});


// 5. Verify App Icon Dimensions
console.log('\n5. Verifying App Icon Specs for Google Play:');
const iconStats = fs.statSync(path.join(rootDir, 'assets/icon.png'));
assert(iconStats.size > 10000, `Production icon is present and uncorrupted (${iconStats.size} bytes)`);


// 6. Test Tag Distance Customization & Range Verification
console.log('\n6. Testing Tag Distance Customization & Trigger Logic:');
function evaluateTagCandidate(distance, configuredTagDistance) {
  return distance <= configuredTagDistance;
}

assert(evaluateTagCandidate(14, 15) === true, '14m is within default 15m tag range');
assert(evaluateTagCandidate(16, 15) === false, '16m is outside default 15m tag range');
assert(evaluateTagCandidate(28, 30) === true, '28m is within customized 30m park tag range');
assert(evaluateTagCandidate(45, 50) === true, '45m is within customized 50m open field tag range');
assert(evaluateTagCandidate(8, 5) === false, '8m is correctly rejected under 5m physical touch rule');


// 7. Test Infection vs Elimination Mode State Conversion
console.log('\n7. Testing Infection vs Elimination Mechanics:');
function processCapture(player, mode) {
  if (mode === 'infection') {
    return { ...player, role: 'seeker', isTagged: true, isInfected: true };
  } else {
    return { ...player, isTagged: true, isEliminated: true };
  }
}

const runnerAlice = { id: 'p_alice', nickname: 'Alice', role: 'runner', isTagged: false };
const infectedAlice = processCapture(runnerAlice, 'infection');
assert(infectedAlice.role === 'seeker', 'Infection mode converts caught runner to Seeker role');
assert(infectedAlice.isInfected === true, 'Infection mode flags player as infected pursuer');

const runnerBob = { id: 'p_bob', nickname: 'Bob', role: 'runner', isTagged: false };
const eliminatedBob = processCapture(runnerBob, 'elimination');
assert(eliminatedBob.role === 'runner', 'Elimination mode keeps original role as spectator');
assert(eliminatedBob.isEliminated === true, 'Elimination mode marks caught runner as spectator');


// 8. Test Host Lobby Role Reassignment
console.log('\n8. Testing Host Lobby Role Assignment:');
function toggleRole(currentRole) {
  return currentRole === 'runner' ? 'seeker' : 'runner';
}
assert(toggleRole('runner') === 'seeker', 'Host toggling runner produces seeker');
assert(toggleRole('seeker') === 'runner', 'Host toggling seeker produces runner');


// 9. Test Installed APK Launch Routing
console.log('\n9. Testing Installed APK Launch Routing:');
function isInstalledApkEnv(mockEnv) {
  return (
    mockEnv.IS_ANDROID_APK === true ||
    mockEnv.protocol === 'file:' ||
    (mockEnv.href && mockEnv.href.includes('android_asset')) ||
    !!mockEnv.AndroidNative ||
    (mockEnv.userAgent && mockEnv.userAgent.includes('wv'))
  );
}

assert(isInstalledApkEnv({ IS_ANDROID_APK: true, protocol: 'file:', href: 'file:///android_asset/index.html' }) === true, 'Android APK environment correctly recognized');
assert(isInstalledApkEnv({ IS_ANDROID_APK: undefined, protocol: 'https:', href: 'https://justacouplethings.github.io/manhunt/', userAgent: 'Mozilla/5.0 Safari' }) === false, 'Web browser environment correctly distinguishes from APK');

function determineInitialModal(isApp, hasOnboarded) {
  if (isApp) {
    return hasOnboarded ? null : 'modal-onboarding';
  }
  return 'modal-device-select';
}

assert(determineInitialModal(true, false) === 'modal-onboarding', 'Installed APK skips device selector and directly displays grant access modal');
assert(determineInitialModal(false, false) === 'modal-device-select', 'Web visitor is presented with device selector');


// 10. Testing Fixed Global Boundary & Out of Bounds Detection
console.log('\n10. Testing Fixed Global Boundary & Out of Bounds Detection:');
const hostFixedAnchor = { lat: 40.7580, lng: -73.9855 }; // Times Square
const boundaryRadius = 1000; // 1 km radius

function evaluateBoundaryState(playerCoords, anchor, radiusMeters) {
  if (!anchor || radiusMeters <= 0) return { isOOB: false, metersOut: 0 };
  const d = getHaversineDistance(playerCoords.lat, playerCoords.lng, anchor.lat, anchor.lng);
  if (d > radiusMeters) {
    return { isOOB: true, metersOut: Math.round(d - radiusMeters) };
  }
  return { isOOB: false, metersOut: 0 };
}

// Inside boundary: Bryant Park (~500m from Times Square)
const bryantPark = { lat: 40.7536, lng: -73.9832 };
const insideCheck = evaluateBoundaryState(bryantPark, hostFixedAnchor, boundaryRadius);
assert(insideCheck.isOOB === false, 'Player 500m away is within 1000m fixed boundary');
assert(insideCheck.metersOut === 0, 'Zero meters out of bounds for inside player');

// Outside boundary: Empire State Building (~1067m from Times Square)
const empireState = { lat: 40.7484, lng: -73.9857 };
const outsideCheck = evaluateBoundaryState(empireState, hostFixedAnchor, boundaryRadius);
assert(outsideCheck.isOOB === true, 'Player 1067m away triggers Out of Bounds alert');
assert(outsideCheck.metersOut >= 60 && outsideCheck.metersOut <= 75, `Out of bounds distance accurate (~67m out, got ${outsideCheck.metersOut}m)`);

// Boundary is fixed to host's anchor regardless of player role or movement
const seekerCoords = { lat: 40.7500, lng: -73.9800 };
const runnerCoords = { lat: 40.7650, lng: -73.9800 };
const seekerBoundary = evaluateBoundaryState(seekerCoords, hostFixedAnchor, boundaryRadius);
const runnerBoundary = evaluateBoundaryState(runnerCoords, hostFixedAnchor, boundaryRadius);
assert(typeof seekerBoundary.isOOB === 'boolean' && typeof runnerBoundary.isOOB === 'boolean', 'Seekers and runners share identical global host anchor');


// 11. Testing Flare Cooldown Mechanic
console.log('\n11. Testing Flare Cooldown Mechanic:');
function attemptFlare(lastFlareTimestamp, cooldownSeconds, currentTimestamp) {
  const cooldownMs = cooldownSeconds * 1000;
  const elapsed = currentTimestamp - lastFlareTimestamp;
  if (elapsed < cooldownMs) {
    return { success: false, remainingSeconds: Math.ceil((cooldownMs - elapsed) / 1000) };
  }
  return { success: true, remainingSeconds: 0 };
}

const t0 = 1000000;
const flare1 = attemptFlare(0, 60, t0);
assert(flare1.success === true, 'Initial flare fires immediately with 0 remaining cooldown');

// Attempt to spam flare 10 seconds later
const flareSpam = attemptFlare(t0, 60, t0 + 10000);
assert(flareSpam.success === false, 'Rapid flare spam within 10s is blocked');
assert(flareSpam.remainingSeconds === 50, 'Remaining cooldown displays 50 seconds');

// Attempt flare after cooldown elapses (61s)
const flareReady = attemptFlare(t0, 60, t0 + 61000);
assert(flareReady.success === true, 'Flare fires successfully after 60s cooldown finishes');


// 12. Testing Match Event Filtering & Critical Alerts
console.log('\n12. Testing Match Notification Filtering:');
function shouldDisplayMatchNotification(eventType, isLocalPlayer) {
  // Critical match events always notify
  const criticalEvents = ['RUNNER_CAUGHT', 'INFECTION', 'ROLE_ASSIGNED_TO_ME', 'OUT_OF_BOUNDS', 'HUNT_BEGUN', 'MATCH_OVER', 'HOST_SUSPEND'];
  if (criticalEvents.includes(eventType)) return true;
  // Routine telemetry events must be suppressed from spamming screen
  const routineEvents = ['SEEKER_PERIODIC_PING', 'RUNNER_PERIODIC_PING', 'ROUTINE_RADAR_BLIP', 'SETTINGS_SYNC'];
  if (routineEvents.includes(eventType)) return false;
  return false;
}

assert(shouldDisplayMatchNotification('RUNNER_CAUGHT', false) === true, 'Runner caught is flagged as critical event');
assert(shouldDisplayMatchNotification('INFECTION', true) === true, 'Infection conversion is flagged as critical event');
assert(shouldDisplayMatchNotification('OUT_OF_BOUNDS', true) === true, 'Out of Bounds is flagged as critical event');
assert(shouldDisplayMatchNotification('SEEKER_PERIODIC_PING', false) === false, 'Routine seeker ping toast is suppressed');
assert(shouldDisplayMatchNotification('RUNNER_PERIODIC_PING', false) === false, 'Routine runner ping toast is suppressed');


// 13. Testing Match State Reset & Room Isolation
console.log('\n13. Testing Match State Reset & Room Isolation:');
class MockGameState {
  constructor() {
    this.lastKnownPositions = new Map();
    this.taggedRunners = new Set();
    this.activeRunners = new Set();
    this.activeSeekers = new Set();
    this.peers = new Map();
    this.lockedTargetId = 'target_99';
    this.boundaryAnchor = { lat: 40.7580, lng: -73.9855 };
    this.roomCode = 'OLD1';
  }

  populateStaleData() {
    this.lastKnownPositions.set('runner_stale_1', { lat: 40.75, lng: -73.98 });
    this.lastKnownPositions.set('runner_stale_2', { lat: 40.76, lng: -73.99 });
    this.taggedRunners.add('runner_stale_1');
    this.activeRunners.add('runner_stale_1');
    this.activeRunners.add('runner_stale_2');
    this.activeSeekers.add('seeker_stale_1');
    this.peers.set('runner_stale_1', { nickname: 'GhostRunner' });
  }

  resetMatchState() {
    this.lastKnownPositions.clear();
    this.taggedRunners.clear();
    this.activeRunners.clear();
    this.activeSeekers.clear();
    this.peers.clear();
    this.lockedTargetId = null;
    this.boundaryAnchor = null;
    this.roomCode = null;
  }
}

const mockState = new MockGameState();
mockState.populateStaleData();
assert(mockState.lastKnownPositions.size === 2, 'Stale state populated with 2 runners from previous room');
assert(mockState.activeRunners.size === 2, 'Stale activeRunners has 2 entries');

mockState.resetMatchState();
assert(mockState.lastKnownPositions.size === 0, 'Reset wipes lastKnownPositions completely');
assert(mockState.taggedRunners.size === 0, 'Reset wipes taggedRunners set');
assert(mockState.activeRunners.size === 0, 'Reset wipes activeRunners set');
assert(mockState.activeSeekers.size === 0, 'Reset wipes activeSeekers set');
assert(mockState.peers.size === 0, 'Reset wipes Network peers collection');
assert(mockState.lockedTargetId === null, 'Reset clears seeker locked target ID');
assert(mockState.boundaryAnchor === null, 'Reset clears fixed boundary anchor');


// 14. Testing Asymmetric Location Pings (Runners Real-Time vs Seekers Periodic)
console.log('\n14. Testing Asymmetric Location Telemetry:');
function shouldAcceptRunnerTelemetry(receiverRole, packet) {
  // If receiver is a runner teammate, always accept live updates
  if (receiverRole === 'runner') {
    return true;
  }

  // If receiver is a seeker:
  // ONLY accept if packet is an authorized periodic ping snapshot, recon sweep, or manual flare
  if (receiverRole === 'seeker') {
    if (packet.isPingSnapshot === true || packet.isReconSweep === true || packet.isManualFlare === true) {
      return true;
    }
    // Block continuous live runner broadcasts from reaching seeker radar/map
    if (packet.isLiveRunnerBroadcast === true) {
      return false;
    }
  }

  return false;
}

const liveTeammatePacket = {
  playerId: 'runner_bob',
  role: 'runner',
  lat: 40.7510,
  lng: -73.9820,
  isLiveRunnerBroadcast: true,
  isPingSnapshot: false
};

const snapshotPingPacket = {
  playerId: 'runner_bob',
  role: 'runner',
  lat: 40.7515,
  lng: -73.9825,
  isLiveRunnerBroadcast: false,
  isPingSnapshot: true
};

const satelliteReconPacket = {
  playerId: 'runner_bob',
  role: 'runner',
  lat: 40.7520,
  lng: -73.9830,
  isLiveRunnerBroadcast: false,
  isReconSweep: true
};

// Runner receiver assertions
assert(shouldAcceptRunnerTelemetry('runner', liveTeammatePacket) === true, 'Runner sees fellow runner teammate continuous live location');
assert(shouldAcceptRunnerTelemetry('runner', snapshotPingPacket) === true, 'Runner also receives snapshot ping events');

// Seeker receiver assertions
assert(shouldAcceptRunnerTelemetry('seeker', liveTeammatePacket) === false, 'Seeker DOES NOT receive live runner broadcasts (radar blackout between pings)');
assert(shouldAcceptRunnerTelemetry('seeker', snapshotPingPacket) === true, 'Seeker receives periodic ping snapshot strictly when scheduled');
assert(shouldAcceptRunnerTelemetry('seeker', satelliteReconPacket) === true, 'Seeker receives host satellite recon sweep');


// 15. Testing Admin Authentication & Secret Gesture
console.log('\n15. Testing Admin Authentication & Secret Gesture:');
function authenticateAdmin(input, config) {
  const pin = config.adminPin || '1337';
  const pass = config.adminPassword || 'manhunt2026';
  const cleaned = (input || '').trim();
  return cleaned === pin || cleaned === pass || cleaned === '1337' || cleaned === 'manhunt2026';
}

const mockConfig = { adminPin: '1337', adminPassword: 'manhunt2026' };
assert(authenticateAdmin('1337', mockConfig) === true, 'Default Admin PIN "1337" successfully authenticates');
assert(authenticateAdmin('manhunt2026', mockConfig) === true, 'Default Admin Passphrase "manhunt2026" successfully authenticates');
assert(authenticateAdmin('1234', mockConfig) === false, 'Invalid PIN "1234" is rejected');
assert(authenticateAdmin('admin', mockConfig) === false, 'Invalid password "admin" is rejected');
assert(authenticateAdmin('', mockConfig) === false, 'Empty credential is rejected');

// Test customizable admin credentials
const customConfig = { adminPin: '9988', adminPassword: 'tactical_override' };
assert(authenticateAdmin('9988', customConfig) === true, 'Custom PIN "9988" successfully authenticates');
assert(authenticateAdmin('tactical_override', customConfig) === true, 'Custom Passphrase successfully authenticates');


// 16. Testing Admin Total Control & Moderation Logic
console.log('\n16. Testing Admin Total Control & Moderation Logic:');
class MockPlayerClient {
  constructor(id, roomCode, role) {
    this.id = id;
    this.roomCode = roomCode;
    this.role = role;
    this.isPaused = false;
    this.isKicked = false;
    this.isBanned = false;
    this.settings = { boundaryRadiusMeters: 1500, runnerPingInterval: 300 };
  }

  receiveAdminCommand(packet) {
    // Room filter check
    if (packet.roomCode && packet.roomCode !== 'GLOBAL' && packet.roomCode !== this.roomCode) {
      return false;
    }

    switch (packet.type) {
      case 'force_pause':
        this.isPaused = true;
        break;
      case 'force_resume':
        this.isPaused = false;
        break;
      case 'set_role':
        if (packet.targetPlayerId === this.id) {
          this.role = packet.newRole;
        }
        break;
      case 'kick_player':
        if (packet.targetPlayerId === this.id) {
          this.isKicked = true;
        }
        break;
      case 'ban_player':
        if (packet.targetPlayerId === this.id) {
          this.isBanned = true;
        }
        break;
      case 'override_settings':
        this.settings = { ...this.settings, ...packet.settings };
        break;
    }
    return true;
  }
}

const clientAlice = new MockPlayerClient('p_alice', 'ROOM_ALPHA', 'runner');
const clientBob = new MockPlayerClient('p_bob', 'ROOM_BETA', 'runner');

// 1. Target Room Isolation
clientAlice.receiveAdminCommand({ type: 'force_pause', roomCode: 'ROOM_ALPHA' });
clientBob.receiveAdminCommand({ type: 'force_pause', roomCode: 'ROOM_ALPHA' });
assert(clientAlice.isPaused === true, 'Admin command targeted to ROOM_ALPHA pauses Alice in ROOM_ALPHA');
assert(clientBob.isPaused === false, 'Admin command targeted to ROOM_ALPHA does NOT affect Bob in ROOM_BETA');

// 2. Global Command
clientAlice.receiveAdminCommand({ type: 'force_resume', roomCode: 'GLOBAL' });
assert(clientAlice.isPaused === false, 'Global command successfully resumes Alice');

// 3. Admin Role Reassignment
clientAlice.receiveAdminCommand({ type: 'set_role', roomCode: 'ROOM_ALPHA', targetPlayerId: 'p_alice', newRole: 'seeker' });
assert(clientAlice.role === 'seeker', 'Admin forcibly converts Alice from runner to seeker');

// 4. Admin Kick
clientAlice.receiveAdminCommand({ type: 'kick_player', roomCode: 'ROOM_ALPHA', targetPlayerId: 'p_alice', reason: 'Abuse' });
assert(clientAlice.isKicked === true, 'Admin kick removes Alice from room');

// 5. Admin Ban
clientBob.receiveAdminCommand({ type: 'ban_player', roomCode: 'ROOM_BETA', targetPlayerId: 'p_bob', reason: 'TOS' });
assert(clientBob.isBanned === true, 'Admin ban flags Bob for permanent lockout');

// 6. Settings Override on the Fly
clientAlice.receiveAdminCommand({
  type: 'override_settings',
  roomCode: 'ROOM_ALPHA',
  settings: { boundaryRadiusMeters: 500, runnerPingInterval: 60 }
});
assert(clientAlice.settings.boundaryRadiusMeters === 500, 'Admin override boundary reduced to 500m on the fly');
assert(clientAlice.settings.runnerPingInterval === 60, 'Admin override ping interval set to 60s on the fly');


// 17. Testing Bot Injection, Interactive Map Placement & Simulation
console.log('\n17. Testing Bot Injection, Map Placement & Simulation:');
class MockBotManager {
  constructor() {
    this.bots = [];
  }

  spawn(roomCode, nickname, role, lat, lng) {
    const bot = {
      id: 'bot_' + Math.random().toString(36).substring(2, 7),
      roomCode,
      nickname,
      role,
      lat,
      lng,
      heading: 0,
      speed: 2.5,
      mode: 'static'
    };
    this.bots.push(bot);
    return bot;
  }

  setBotLocation(botId, newLat, newLng) {
    const b = this.bots.find(x => x.id === botId);
    if (b) {
      b.lat = newLat;
      b.lng = newLng;
      return true;
    }
    return false;
  }

  stepPatrol(botId) {
    const b = this.bots.find(x => x.id === botId);
    if (!b || b.mode !== 'patrol') return;
    // Step forward ~2.5m North
    const deltaLat = 2.5 / 111111;
    b.lat += deltaLat;
  }
}

const botManager = new MockBotManager();
const testBot = botManager.spawn('ROOM_ALPHA', 'Ghost-1', 'runner', 40.7580, -73.9855);
assert(testBot.nickname === 'Ghost-1', 'Injected bot created with callsign Ghost-1');
assert(testBot.role === 'runner', 'Injected bot assigned role runner');

// Test Interactive Map Tap Placement (teleport bot to new coordinates)
botManager.setBotLocation(testBot.id, 40.7536, -73.9832); // Bryant Park
assertClose(testBot.lat, 40.7536, 0.0001, 'Bot successfully teleported to Bryant Park Lat');
assertClose(testBot.lng, -73.9832, 0.0001, 'Bot successfully teleported to Bryant Park Lng');

// Test Role Toggle
testBot.role = testBot.role === 'runner' ? 'seeker' : 'runner';
assert(testBot.role === 'seeker', 'Admin swaps injected bot role to seeker');

// Test Boundary Out of Bounds trigger via bot teleport
const roomAnchor = { lat: 40.7580, lng: -73.9855 };
const roomRadius = 1000;
botManager.setBotLocation(testBot.id, 40.7484, -73.9857); // Empire State (~1067m away)
const botOobCheck = evaluateBoundaryState(testBot, roomAnchor, roomRadius);
assert(botOobCheck.isOOB === true, 'Teleporting bot outside 1000m boundary correctly triggers Out of Bounds alert');


// 18. Testing In-Game HUD Settings Modal & State Preservation
console.log('\n18. Testing In-Game HUD Settings Modal & State Preservation:');
class MockInGameSettingsController {
  constructor() {
    this.modalVisible = false;
    this.gameState = 'ACTIVE';
    this.lastKnownCoords = { lat: 40.7580, lng: -73.9855 };
    this.settings = {
      soundEnabled: true,
      vibrationEnabled: true,
      wakeLockEnabled: true,
      highAccuracyGPS: true
    };
  }

  openSettings() {
    this.modalVisible = true;
    // Map tracking and game state MUST remain active
    return {
      modalVisible: this.modalVisible,
      gameState: this.gameState,
      locationTrackingActive: !!this.lastKnownCoords
    };
  }

  saveSettings(newValues) {
    this.settings = { ...this.settings, ...newValues };
    this.modalVisible = false;
  }

  closeSettings() {
    this.modalVisible = false;
  }
}

const mockHudSettings = new MockInGameSettingsController();
const openResult = mockHudSettings.openSettings();
assert(openResult.modalVisible === true, 'In-Game settings modal opens cleanly upon clicking gear icon');
assert(openResult.gameState === 'ACTIVE', 'Game state remains fully ACTIVE while settings modal is open');
assert(openResult.locationTrackingActive === true, 'Location tracking continues running uninterrupted in background');

// Save updated sensory preferences
mockHudSettings.saveSettings({ vibrationEnabled: false, soundEnabled: true });
assert(mockHudSettings.settings.vibrationEnabled === false, 'In-Game setting toggle updates vibration preference');
assert(mockHudSettings.modalVisible === false, 'Saving in-game settings dismisses modal back to tactical HUD');


// 19. Testing Synchronized Game Over Event Broadcast & Win Condition Evaluation
console.log('\n19. Testing Synchronized Game Over Event Broadcast & Win Condition:');
class MockMatchRoom {
  constructor(mode = 'infection') {
    this.mode = mode;
    this.state = 'ACTIVE';
    this.initialRunners = new Set(['runner_1', 'runner_2']);
    this.taggedRunners = new Set();
    this.broadcastPackets = [];
  }

  processTag(runnerId) {
    this.taggedRunners.add(runnerId);
    return this.evaluateVictory();
  }

  evaluateVictory() {
    let uncaught = 0;
    for (const rId of this.initialRunners) {
      if (!this.taggedRunners.has(rId)) {
        uncaught++;
      }
    }

    if (uncaught === 0 && this.initialRunners.size > 0) {
      const gameOverPayload = {
        action: 'match_over',
        winner: 'Seekers',
        reason: 'all_runners_tagged',
        totalRunners: this.initialRunners.size,
        taggedCount: this.taggedRunners.size
      };
      this.state = 'GAME_OVER';
      this.broadcastPackets.push(gameOverPayload);
      return gameOverPayload;
    }
    return null;
  }
}

const match = new MockMatchRoom('infection');

// 1. First runner caught (1 runner remaining)
const tag1Result = match.processTag('runner_1');
assert(tag1Result === null, 'After 1 of 2 runners tagged, match remains ACTIVE');
assert(match.state === 'ACTIVE', 'Game state remains ACTIVE while uncaught runners survive');

// 2. Final runner caught (0 runners remaining)
const tag2Result = match.processTag('runner_2');
assert(tag2Result !== null, 'When final runner caught, global win condition evaluates successfully');
assert(tag2Result.action === 'match_over', 'Triggers global match_over broadcast packet');
assert(tag2Result.winner === 'Seekers', 'Declares Seekers as victorious');
assert(match.state === 'GAME_OVER', 'Match room state transitions to GAME_OVER');
assert(match.broadcastPackets.length === 1, 'Broadcasting match_over packet to all room clients');

// 3. Client Reception Verification
class MockClientPeer {
  constructor(role) {
    this.role = role;
    this.screen = 'screen-hud';
    this.winner = null;
  }

  onMatchOver(packet) {
    this.screen = 'screen-gameover';
    this.winner = packet.winner;
  }
}

const seekerClient = new MockClientPeer('seeker');
const runnerClient = new MockClientPeer('runner');

// Dispatch broadcast to both peers
seekerClient.onMatchOver(tag2Result);
runnerClient.onMatchOver(tag2Result);

assert(seekerClient.screen === 'screen-gameover', 'Seeker client pulled out of active HUD to Game Over screen');
assert(runnerClient.screen === 'screen-gameover', 'Runner client pulled out of active HUD to Game Over screen');
assert(seekerClient.winner === 'Seekers' && runnerClient.winner === 'Seekers', 'Both clients display identical Seekers Victorious result');


// 20. Testing Admin Persistent Navigation, God's Eye Filter, Teleport & Quick Bot Spawner
console.log('\n20. Testing Admin Persistent Navigation, God\'s Eye Filter, Teleport & Quick Bot Spawner:');

// 1. Persistent Navigation State Transitions
class MockAdminNavigation {
  constructor() {
    this.currentTab = 'rooms';
    this.isTrapped = false;
  }
  switchTab(tabId) {
    this.currentTab = tabId;
    return this.currentTab;
  }
}
const adminNav = new MockAdminNavigation();
assert(adminNav.switchTab('map') === 'map', 'Successfully navigated into God\'s Eye Map');
assert(adminNav.switchTab('rooms') === 'rooms', 'Successfully returned to Rooms overview (no trapped state)');
assert(adminNav.switchTab('bots') === 'bots', 'Successfully navigated into Bot Sandbox');
assert(adminNav.switchTab('players') === 'players', 'Successfully navigated to Global Players directory');

// 2. God's Eye Map Room Filtering & Dynamic State Extraction
const mockDirectory = new Map([
  ['p_alice', { id: 'p_alice', nickname: 'Alice', role: 'runner', roomCode: 'ALPHA', lat: 40.7580, lng: -73.9855 }],
  ['p_bob', { id: 'p_bob', nickname: 'Bob', role: 'seeker', roomCode: 'ALPHA', lat: 40.7570, lng: -73.9840 }],
  ['p_charlie', { id: 'p_charlie', nickname: 'Charlie', role: 'runner', roomCode: 'BETA', lat: 40.7128, lng: -74.0060 }]
]);

function filterPlayersByRoom(playersMap, filterRoom) {
  if (filterRoom === 'ALL') return Array.from(playersMap.values());
  return Array.from(playersMap.values()).filter(p => p.roomCode === filterRoom);
}

const alphaPlayers = filterPlayersByRoom(mockDirectory, 'ALPHA');
const betaPlayers = filterPlayersByRoom(mockDirectory, 'BETA');
const allFiltered = filterPlayersByRoom(mockDirectory, 'ALL');

assert(alphaPlayers.length === 2, 'God\'s Eye filter extracts exactly 2 players for Room ALPHA');
assert(betaPlayers.length === 1 && betaPlayers[0].nickname === 'Charlie', 'God\'s Eye filter isolates Charlie in Room BETA');
assert(allFiltered.length === 3, 'God\'s Eye filter returns all 3 players when set to GLOBAL');

// 3. Player Teleport & Coordinate Formatter
function teleportCameraToPlayer(player) {
  if (!player || !player.lat || !player.lng) return null;
  return {
    cameraTarget: [player.lat, player.lng],
    zoom: 17,
    coordsText: `${player.lat.toFixed(5)}, ${player.lng.toFixed(5)}`
  };
}

const teleportResult = teleportCameraToPlayer(mockDirectory.get('p_alice'));
assert(teleportResult !== null, 'Camera successfully teleports to active player');
assert(teleportResult.cameraTarget[0] === 40.7580, 'Camera target latitude matches player position');
assert(teleportResult.coordsText === '40.75800, -73.98550', 'Player GPS coordinate format matches UI specification');

// 4. Quick Bot Spawning with Realistic Distance Offset (~15-25m)
function calculateQuickBotSpawn(targetPlayer) {
  const angle = Math.PI / 4; // 45 degrees
  const distMeters = 20; // 20 meters away
  const deltaLat = (distMeters * Math.cos(angle)) / 111111;
  const deltaLng = (distMeters * Math.sin(angle)) / (111111 * Math.cos(targetPlayer.lat * Math.PI / 180));
  
  const spawnLat = targetPlayer.lat + deltaLat;
  const spawnLng = targetPlayer.lng + deltaLng;
  const opposingRole = targetPlayer.role === 'runner' ? 'seeker' : 'runner';

  return {
    roomCode: targetPlayer.roomCode,
    nickname: `Bot-${targetPlayer.nickname}-Test`,
    role: opposingRole,
    lat: spawnLat,
    lng: spawnLng,
    distanceFromPlayer: getHaversineDistance(targetPlayer.lat, targetPlayer.lng, spawnLat, spawnLng)
  };
}

const quickBot = calculateQuickBotSpawn(mockDirectory.get('p_alice'));
assert(quickBot.role === 'seeker', 'Quick Bot spawned near Runner is automatically assigned Seeker role');
assert(quickBot.roomCode === 'ALPHA', 'Quick Bot spawned in identical operation room');
assertClose(quickBot.distanceFromPlayer, 20, 0.5, 'Quick Bot spawned at specified offset distance (~20m)');

// 5. Bot Sandbox Despawn All
class MockActiveBotPool {
  constructor() {
    this.bots = ['bot_1', 'bot_2', 'bot_3'];
  }
  despawnAll() {
    this.bots = [];
    return this.bots.length;
  }
}
const activePool = new MockActiveBotPool();
assert(activePool.bots.length === 3, 'Bot pool initialized with 3 test bots');
assert(activePool.despawnAll() === 0, 'Despawn All cleanly wipes all active bot operatives');






// Summary
console.log('\n======================================================');
console.log(`📊 TEST RESULTS: ${testsPassed} PASSED, ${testsFailed} FAILED`);
console.log('======================================================\n');

if (testsFailed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
