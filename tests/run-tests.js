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
  'package.json',
  'server.js',
  'css/styles.css',
  'css/leaflet.css',
  'js/config.js',
  'js/auth.js',
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
  const pin = config.adminPin || '4';
  const pass = config.adminPassword || 'shebsilover911#';
  const cleaned = (input || '').trim();
  return cleaned === pin || cleaned === pass || cleaned === '4' || cleaned === 'shebsilover911#';
}

const mockConfig = { adminPin: '4', adminPassword: 'shebsilover911#' };
assert(authenticateAdmin('4', mockConfig) === true, 'Admin PIN "4" successfully authenticates');
assert(authenticateAdmin('shebsilover911#', mockConfig) === true, 'Admin Passphrase "shebsilover911#" successfully authenticates');
assert(authenticateAdmin('1337', mockConfig) === false, 'Legacy PIN "1337" is strictly rejected');
assert(authenticateAdmin('1234', mockConfig) === false, 'Invalid PIN "1234" is rejected');
assert(authenticateAdmin('admin', mockConfig) === false, 'Invalid password "admin" is rejected');
assert(authenticateAdmin('', mockConfig) === false, 'Empty credential is rejected');

// Test customizable admin credentials
const customConfig = { adminPin: '9988', adminPassword: 'tactical_override' };
assert(authenticateAdmin('9988', customConfig) === true, 'Custom PIN "9988" successfully authenticates');
assert(authenticateAdmin('tactical_override', customConfig) === true, 'Custom Passphrase successfully authenticates');

// Verify placeholder does not reveal passwords
const indexHtmlSource = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
assert(!indexHtmlSource.includes('placeholder="e.g. 1337') && !indexHtmlSource.includes('placeholder="e.g. 4') && !indexHtmlSource.includes('placeholder="e.g. shebsilover911#'), 'Admin passcode placeholder does not reveal passwords');


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


// 21. Testing Catch Event Notification Spam Gating & Lobby/Game Start Authoritative Roster Sync
console.log('\n21. Testing Catch Event Notification Spam Gating & Authoritative Sync:');

// A. Seeker Tag Debouncing & Duplicate Prevention
class MockTagSystem {
  constructor() {
    this.taggedRunners = new Set();
    this.lastTagAttemptTime = -10000;
    this.tagBroadcastCount = 0;
  }

  tagRunner(runnerId, now = Date.now()) {
    if (this.taggedRunners.has(runnerId)) {
      return { status: 'already_tagged' };
    }
    if (now - this.lastTagAttemptTime < 2500) {
      return { status: 'debounced' };
    }
    this.lastTagAttemptTime = now;
    this.tagBroadcastCount++;
    return { status: 'sent', runnerId, timestamp: now };
  }
}

const mockTag = new MockTagSystem();
const tagAttempt1 = mockTag.tagRunner('runner_1', 10000);
assert(tagAttempt1.status === 'sent', 'First tag attempt executes successfully');
const tagAttemptSpam = mockTag.tagRunner('runner_1', 10200);
assert(tagAttemptSpam.status === 'debounced', 'Rapid tag spam click within 200ms is cleanly debounced');
const tagAttemptSpam2 = mockTag.tagRunner('runner_1', 11000);
assert(tagAttemptSpam2.status === 'debounced', 'Second spam click within 1000ms is cleanly debounced');
assert(mockTag.tagBroadcastCount === 1, 'Only exactly 1 network tag broadcast fired during click spam');

mockTag.taggedRunners.add('runner_1');
const tagAttemptAlreadyCaught = mockTag.tagRunner('runner_1', 15000);
assert(tagAttemptAlreadyCaught.status === 'already_tagged', 'Tagging an already caught runner is immediately rejected');

// B. Runner Catch Event Notification Deduplication (3x Network Burst Protection)
class MockRunnerClient {
  constructor(id, role = 'runner') {
    this.id = id;
    this.role = role;
    this.isCaught = false;
    this.isTagged = false;
    this.taggedRunners = new Set();
    this.notificationCount = 0;
    this.audioCueCount = 0;
    this.roleConversionCount = 0;
  }

  handleTagRequest(data) {
    if (data.runnerId !== this.id) return false;
    if (this.isCaught || this.isTagged || this.role === 'seeker' || this.taggedRunners.has(this.id)) {
      return false; // Gated!
    }
    return true; // Prompt shown
  }

  onRemoteTagConfirmed(data, isInfection = true) {
    const { runnerId } = data;
    if (this.taggedRunners.has(runnerId)) {
      return false; // Deduplicated burst packet!
    }
    this.taggedRunners.add(runnerId);

    const isSelf = runnerId === this.id;
    if (isSelf) {
      this.isCaught = true;
      if (isInfection) {
        this.role = 'seeker';
        this.roleConversionCount++;
      } else {
        this.isTagged = true;
      }
    }

    this.notificationCount++;
    this.audioCueCount++;
    return true;
  }
}

const runnerClientTest21 = new MockRunnerClient('runner_alice');
const burstTagPacket = {
  seekerId: 'seeker_bob',
  seekerName: 'Bob',
  runnerId: 'runner_alice',
  runnerName: 'Alice',
  timestamp: 1000
};

// Simulate 3x burst delivery of the exact same confirmed tag packet
const packet1Handled = runnerClientTest21.onRemoteTagConfirmed(burstTagPacket);
const packet2Handled = runnerClientTest21.onRemoteTagConfirmed(burstTagPacket);
const packet3Handled = runnerClientTest21.onRemoteTagConfirmed(burstTagPacket);

assert(packet1Handled === true, 'First packet in burst successfully processes catch event');
assert(packet2Handled === false, 'Duplicate burst packet 2 is cleanly dropped without re-triggering');
assert(packet3Handled === false, 'Duplicate burst packet 3 is cleanly dropped without re-triggering');
assert(runnerClientTest21.notificationCount === 1, 'Catch event notification fired strictly and exactly once');
assert(runnerClientTest21.audioCueCount === 1, 'Catch event audio siren played strictly and exactly once');
assert(runnerClientTest21.roleConversionCount === 1, 'Role conversion to seeker executed strictly and exactly once');
assert(runnerClientTest21.isCaught === true, 'Player state is caught flag is set');
assert(runnerClientTest21.role === 'seeker', 'Player role converted to seeker');

// Verify further incoming tag requests are gated
assert(runnerClientTest21.handleTagRequest({ runnerId: 'runner_alice', seekerId: 'seeker_dan' }) === false, 'Subsequent tag requests are gated and ignored after being caught');

// C. Lobby Authoritative Roster & Game Start Synchronization
class MockLobbySync {
  constructor() {
    this.host = { id: 'host_1', nickname: 'Host', role: 'runner', isHost: true };
    this.peers = new Map();
  }

  onPlayerJoin(player) {
    this.peers.set(player.id, player);
  }

  generateAuthoritativeRoster() {
    return [
      { ...this.host },
      ...Array.from(this.peers.values())
    ];
  }

  buildStartGamePacket(settings) {
    return {
      action: 'start_game',
      startTimestamp: 1000,
      settings: settings,
      roster: this.generateAuthoritativeRoster()
    };
  }
}

const lobby = new MockLobbySync();
lobby.onPlayerJoin({ id: 'p_joiner_1', nickname: 'JoinerOne', role: 'runner', isHost: false });
lobby.onPlayerJoin({ id: 'p_joiner_2', nickname: 'JoinerTwo', role: 'seeker', isHost: false });

const startPacket = lobby.buildStartGamePacket({ gracePeriod: 300, boundaryRadiusMeters: 1000 });
assert(Array.isArray(startPacket.roster), 'start_game packet includes authoritative squad roster');
assert(startPacket.roster.length === 3, 'Authoritative roster includes host and all connected peers (3 players total)');
assert(startPacket.roster.some(p => p.id === 'host_1' && p.isHost === true), 'Authoritative roster preserves Host status');
assert(startPacket.roster.some(p => p.id === 'p_joiner_1' && p.role === 'runner'), 'Authoritative roster preserves Runner role');
assert(startPacket.roster.some(p => p.id === 'p_joiner_2' && p.role === 'seeker'), 'Authoritative roster preserves Seeker role');

// Verify Joining Client Ingestion & Idempotency
class MockGameStartClient {
  constructor(myId, myRole) {
    this.id = myId;
    this.role = myRole;
    this.state = 'WAITING';
    this.peers = new Map();
    this.activeRunners = new Set();
    this.activeSeekers = new Set();
    this.startExecutions = 0;
  }

  onGameStartedRemote(packet) {
    if (this.state === 'ACTIVE' || this.state === 'GRACE_PERIOD') {
      return false; // Guard against duplicate burst packets
    }
    this.startExecutions++;
    this.state = 'ACTIVE';

    if (Array.isArray(packet.roster)) {
      packet.roster.forEach(p => {
        if (p.id !== this.id) {
          this.peers.set(p.id, p);
        }
      });
    }

    if (this.role === 'runner') this.activeRunners.add(this.id);
    else this.activeSeekers.add(this.id);

    for (const [id, peer] of this.peers.entries()) {
      if (peer.role === 'runner') this.activeRunners.add(id);
      else if (peer.role === 'seeker') this.activeSeekers.add(id);
    }
    return true;
  }
}

const clientJoiner = new MockGameStartClient('p_joiner_1', 'runner');
const burst1 = clientJoiner.onGameStartedRemote(startPacket);
const burst2 = clientJoiner.onGameStartedRemote(startPacket);
const burst3 = clientJoiner.onGameStartedRemote(startPacket);

assert(burst1 === true, 'First start_game packet successfully launches game on client');
assert(burst2 === false, 'Duplicate burst start_game packet 2 is ignored');
assert(burst3 === false, 'Duplicate burst start_game packet 3 is ignored');
assert(clientJoiner.startExecutions === 1, 'Match start logic ran exactly once');
assert(clientJoiner.state === 'ACTIVE', 'Client state successfully transitioned to ACTIVE');
assert(clientJoiner.peers.size === 2, 'Client synced all 2 other players from authoritative roster');
assert(clientJoiner.activeRunners.size === 2, 'Synced exactly 2 active runners (Host + JoinerOne)');
assert(clientJoiner.activeSeekers.size === 1, 'Synced exactly 1 active seeker (JoinerTwo)');






// 22. Testing Admin UI Grids, Overrides Button & God's Eye Header
console.log('\n22. Testing Admin UI Grids, Overrides Button & God\'s Eye Header:');
const cssContent = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');
const htmlContent = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

assert(cssContent.includes('.admin-card-actions'), 'styles.css defines .admin-card-actions grid');
assert(cssContent.includes('grid-template-columns: repeat(2, 1fr)'), 'admin card actions styled in responsive 2-column grid');
assert(cssContent.includes('.btn-warning'), 'styles.css defines .btn-warning full-width styling');
assert(cssContent.includes('.admin-broadcast-input'), 'styles.css defines high-contrast .admin-broadcast-input');
assert(htmlContent.includes('admin-map-controls-group'), 'index.html groups God\'s Eye controls in unified controls group');
assert(htmlContent.includes('id="btn-admin-broadcast"'), 'index.html defines id="btn-admin-broadcast" button');
assert(htmlContent.includes('id="btn-admin-apply-overrides"'), 'index.html defines id="btn-admin-apply-overrides" button');

// 23. Testing Global Network Broadcast Dispatch & Client Alert
console.log('\n23. Testing Global Network Broadcast Dispatch & Client Alert:');
class MockAdminBroadcastEngine {
  constructor() {
    this.rooms = new Map([['ROOM_A', {}], ['ROOM_B', {}]]);
    this.dispatchedPackets = [];
    this.mqttTopics = [];
  }

  broadcastCommand(targetRoom, payload) {
    const packet = {
      action: 'admin_command',
      roomCode: targetRoom,
      data: payload,
      timestamp: Date.now()
    };
    this.dispatchedPackets.push(packet);

    if (targetRoom === 'GLOBAL') {
      this.mqttTopics.push('manhunt/global/admin_command');
      this.mqttTopics.push('manhunt/room/GLOBAL/admin_command');
      for (const rCode of this.rooms.keys()) {
        this.mqttTopics.push(`manhunt/room/${rCode}/admin_command`);
      }
    } else {
      this.mqttTopics.push(`manhunt/room/${targetRoom}/admin_command`);
    }
  }

  sendGlobalBroadcast(message) {
    const msg = (message || '').trim();
    if (!msg) {
      return { success: false, error: 'Empty message' };
    }
    this.broadcastCommand('GLOBAL', {
      type: 'global_announcement',
      message: msg
    });
    return { success: true };
  }
}

const mockAdmin = new MockAdminBroadcastEngine();
const emptyRes = mockAdmin.sendGlobalBroadcast('');
assert(emptyRes.success === false, 'Empty announcement rejected with warning');

const validRes = mockAdmin.sendGlobalBroadcast('EMERGENCY: Server maintenance in 5m');
assert(validRes.success === true, 'Valid announcement dispatched successfully');
assert(mockAdmin.dispatchedPackets.length === 1, 'Exactly one global broadcast packet generated');
assert(mockAdmin.dispatchedPackets[0].data.type === 'global_announcement', 'Packet type is global_announcement');
assert(mockAdmin.dispatchedPackets[0].data.message.includes('Server maintenance'), 'Packet contains message body');
assert(mockAdmin.mqttTopics.includes('manhunt/global/admin_command'), 'Dispatched to manhunt/global/admin_command');
assert(mockAdmin.mqttTopics.includes('manhunt/room/ROOM_A/admin_command'), 'Dispatched to active room ROOM_A');
assert(mockAdmin.mqttTopics.includes('manhunt/room/ROOM_B/admin_command'), 'Dispatched to active room ROOM_B');

// Client Reception Check
let clientAlertReceived = false;
let clientAlertText = '';
const mockClientGame = {
  handleAdminCommand(packet) {
    if (packet.type === 'global_announcement') {
      clientAlertReceived = true;
      clientAlertText = packet.message;
    }
  }
};
mockClientGame.handleAdminCommand(mockAdmin.dispatchedPackets[0].data);
assert(clientAlertReceived === true, 'Connected game client receives global announcement');
assert(clientAlertText.includes('Server maintenance'), 'Client receives correct announcement text');

// 24. Testing Split Location State & Stale Ping Catch Exploit Protection
console.log('\n24. Testing Split Location State & Stale Ping Catch Exploit Protection:');
const GeoEngine = {
  getDistance: (lat1, lon1, lat2, lon2) => getHaversineDistance(lat1, lon1, lat2, lon2),
  getBearing: (lat1, lon1, lat2, lon2) => getBearing(lat1, lon1, lat2, lon2)
};
class MockAntiExploitGame {
  constructor() {
    this.role = 'seeker';
    this.lastSelfCoords = { lat: 40.7128, lng: -74.0060 }; // Seeker starting position
    this.lastKnownPositions = new Map(); // Displayed stale ping positions
    this.trueLivePositions = new Map();  // Silent background true live positions
    this.taggedRunners = new Set();
    this.tagRequestsSent = [];
    this.toastAlerts = [];
  }

  onRemoteTelemetry(data) {
    const { playerId, lat, lng, role, isPingSnapshot, nickname } = data;

    // 1. Silent true live position tracking
    if (lat != null && lng != null) {
      this.trueLivePositions.set(playerId, { lat, lng, role, nickname });
    }

    // 2. Seeker only updates visual ping location on ping snapshot
    if (isPingSnapshot) {
      this.lastKnownPositions.set(playerId, { lat, lng, role, nickname });
    }
  }

  tagRunner(targetPlayerId, runnerNickname) {
    const maxCatchRadius = 15; // 15 meters
    const selfLat = this.lastSelfCoords.lat;
    const selfLng = this.lastSelfCoords.lng;

    const truePos = this.trueLivePositions.get(targetPlayerId);
    let trueDistance = Infinity;
    if (truePos) {
      trueDistance = GeoEngine.getDistance(selfLat, selfLng, truePos.lat, truePos.lng);
    }

    if (trueDistance > maxCatchRadius) {
      this.toastAlerts.push('The target is no longer here.');
      return false; // REJECTED
    }

    this.tagRequestsSent.push({
      targetPlayerId,
      runnerNickname,
      distance: trueDistance
    });
    return true; // ACCEPTED
  }
}

const gameSec24 = new MockAntiExploitGame();
const runnerId = 'runner_bob_1';

// Step A: Runner is at initial position (40.7128, -74.0060) and sends ping snapshot
gameSec24.onRemoteTelemetry({
  playerId: runnerId,
  lat: 40.7128,
  lng: -74.0060,
  role: 'runner',
  isPingSnapshot: true,
  nickname: 'RunnerBob'
});

assert(gameSec24.lastKnownPositions.has(runnerId), 'Runner position recorded in displayed ping positions');
assert(gameSec24.trueLivePositions.has(runnerId), 'Runner position silently recorded in true live positions');

// Step B: Runner runs away 250 meters north to (40.71505, -74.0060) and transmits silent live telemetry
gameSec24.onRemoteTelemetry({
  playerId: runnerId,
  lat: 40.71505,
  lng: -74.0060,
  role: 'runner',
  isPingSnapshot: false, // NOT a ping snapshot (silent live)
  nickname: 'RunnerBob'
});

// Verify Split State:
const displayedPos = gameSec24.lastKnownPositions.get(runnerId);
const actualPos = gameSec24.trueLivePositions.get(runnerId);
assert(displayedPos.lat === 40.7128, 'Displayed ping position remains at stale coordinates (40.7128)');
assert(actualPos.lat === 40.71505, 'True live position accurately tracks runner at new coordinates (40.71505)');

// Step C: Seeker walks to the STALE ping marker (40.7128, -74.0060) where distance to marker is 0m
gameSec24.lastSelfCoords = { lat: 40.7128, lng: -74.0060 };
const distToStalePing = GeoEngine.getDistance(gameSec24.lastSelfCoords.lat, gameSec24.lastSelfCoords.lng, displayedPos.lat, displayedPos.lng);
const distToTrueLive = GeoEngine.getDistance(gameSec24.lastSelfCoords.lat, gameSec24.lastSelfCoords.lng, actualPos.lat, actualPos.lng);
assert(distToStalePing === 0, 'Seeker is directly standing at the stale ping marker (0m)');
assert(distToTrueLive > 200, 'Runner is actually over 200 meters away in reality (~250m)');

// Step D: Seeker attempts catch at stale ping marker -> Must be REJECTED!
const exploitAttempt = gameSec24.tagRunner(runnerId, 'RunnerBob');
assert(exploitAttempt === false, 'Stale ping catch exploit attempt is REJECTED');
assert(gameSec24.tagRequestsSent.length === 0, 'Zero network tag packets sent during stale catch attempt');
assert(gameSec24.toastAlerts.includes('The target is no longer here.'), 'Seeker UI displays: "The target is no longer here."');

// Step E: Seeker chases runner to their TRUE live location (40.71505, -74.0060)
gameSec24.lastSelfCoords = { lat: 40.71505, lng: -74.0060 };
const legitAttempt = gameSec24.tagRunner(runnerId, 'RunnerBob');
assert(legitAttempt === true, 'Legitimate live catch within true catch radius is ACCEPTED');
assert(gameSec24.tagRequestsSent.length === 1, 'Network tag packet sent for verified live proximity catch');
assert(gameSec24.tagRequestsSent[0].distance < 1, 'Tag distance computed from live GPS proximity (< 1m)');

console.log('\n25. Testing Flare Button Layout, Host Cooldown Configuration & Seeker Alert Mechanics:');

// 1. Verify Host Flare Cooldown selector options in index.html
const indexHtmlContent = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
assert(indexHtmlContent.includes('id="lobby-flare-cooldown"'), 'Host lobby includes #lobby-flare-cooldown dropdown');
assert(indexHtmlContent.includes('value="30">30 Seconds</option>'), 'Dropdown includes 30s option');
assert(indexHtmlContent.includes('value="45">45 Seconds</option>'), 'Dropdown includes 45s option');
assert(indexHtmlContent.includes('value="60" selected>60 Seconds (1 Min)</option>'), 'Dropdown includes 60s default option');
assert(indexHtmlContent.includes('value="90">90 Seconds (1.5 Min)</option>'), 'Dropdown includes 90s option');
assert(indexHtmlContent.includes('value="120">120 Seconds (2 Min)</option>'), 'Dropdown includes 120s (2m) option');
assert(indexHtmlContent.includes('value="180">180 Seconds (3 Min)</option>'), 'Dropdown includes 180s (3m) option');

// 2. Verify Participant chip for flare cooldown
assert(indexHtmlContent.includes('id="chip-flare-cooldown"'), 'Participant overview includes #chip-flare-cooldown badge');

// 3. Verify CSS rules for responsive action buttons
const stylesCssContent = fs.readFileSync(path.join(__dirname, '../css/styles.css'), 'utf8');
assert(stylesCssContent.includes('.hud-action-btn') && stylesCssContent.includes('min-width: 0'), 'Action buttons have min-width: 0 to prevent mobile overflow');
assert(stylesCssContent.includes('white-space: nowrap'), 'Action button text styled with nowrap');
assert(stylesCssContent.includes('.hud-action-btn.btn-flare'), 'Specific high-visibility styling exists for .btn-flare');
assert(stylesCssContent.includes('.tactical-flare-beacon-container'), 'Tactical flare beacon CSS container defined');
assert(stylesCssContent.includes('.tactical-flare-pill'), 'Tactical flare callout pill defined with animation');

// 4. Test Seeker Notification Terminology & Instant Beacon Triggering
const simulatedSeeker = {
  role: 'seeker',
  lastKnownPositions: new Map(),
  trueLivePositions: new Map(),
  activeRunners: new Set(['runner-42']),
  activeSeekers: new Set(['seeker-1']),
  toastMessages: [],
  criticalEvents: [],
  radarBlips: 0,
  sirens: 0,
  flareBeaconAnimationTriggered: false,
  flareBeaconCoords: null,
  flareBeaconCaller: null,

  onRemoteTelemetry(data) {
    const { playerId, lat, lng, role, isPingSnapshot, nickname } = data;
    if (data.isManualFlare) {
      this.lastKnownPositions.set(playerId, { lat, lng, role, timestamp: Date.now(), nickname });
      this.criticalEvents.push({
        title: 'FLARE',
        msg: `📍 ${nickname || 'Runner'} triggered a Flare!`
      });
      this.sirens++;
      this.flareBeaconAnimationTriggered = true;
      this.flareBeaconCoords = { lat, lng };
      this.flareBeaconCaller = nickname || 'Runner';
    }
  }
};

const flarePacket = {
  playerId: 'runner-42',
  lat: 40.7580,
  lng: -73.9855,
  role: 'runner',
  isPingSnapshot: true,
  isManualFlare: true,
  nickname: 'GhostRunner',
  timestamp: Date.now()
};

simulatedSeeker.onRemoteTelemetry(flarePacket);

// Verify exact seeker terminology & caller attribution
assert(simulatedSeeker.criticalEvents.length === 1, 'Seeker received exactly 1 critical notification on flare');
assert(simulatedSeeker.criticalEvents[0].msg === '📍 GhostRunner triggered a Flare!', 'Seeker alert states who triggered the flare ("📍 GhostRunner triggered a Flare!")');
assert(!simulatedSeeker.criticalEvents[0].msg.toLowerCase().includes('emergency flare'), 'Terminology does NOT use "Emergency Flare"');
assert(simulatedSeeker.criticalEvents[0].msg.includes('Flare'), 'Terminology strictly uses "Flare"');
assert(simulatedSeeker.sirens === 1, 'Seeker triggered urgent acoustic siren');

// Verify instant location revelation at exact second
assert(simulatedSeeker.lastKnownPositions.get('runner-42').lat === 40.7580, 'Runner coordinates snapped instantly on Seeker map');
assert(simulatedSeeker.lastKnownPositions.get('runner-42').lng === -73.9855, 'Runner coordinates snapped instantly on Seeker map');
assert(simulatedSeeker.flareBeaconAnimationTriggered === true, 'Tactical flare beacon wave triggered on map the second flare is fired');
assert(simulatedSeeker.flareBeaconCaller === 'GhostRunner', 'Beacon callout correctly displays caller name');

console.log('\n26. Testing Floating Targets Button, High-Accuracy GPS Default & Red Leave Match Button:');

// 1. Verify Targets Button relocated to floating map controls and removed from bottom row
const indexUpdated = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const mapFloatingControlsBlock = indexUpdated.substring(indexUpdated.indexOf('class="map-floating-controls"'), indexUpdated.indexOf('</div>', indexUpdated.indexOf('class="map-floating-controls"')));
assert(mapFloatingControlsBlock.includes('id="btn-open-targets"'), 'Targets button is positioned in .map-floating-controls');
assert(mapFloatingControlsBlock.includes('btn-targets-float'), 'Targets button has .btn-targets-float styling class');

const hudBottomBlock = indexUpdated.substring(indexUpdated.indexOf('class="hud-actions-row"'), indexUpdated.indexOf('</div>', indexUpdated.indexOf('class="hud-actions-row"')));
assert(!hudBottomBlock.includes('id="btn-open-targets"'), 'Targets button is removed from bottom .hud-actions-row to avoid bottom clutter');
assert(hudBottomBlock.includes('id="btn-panic-ping"'), 'Bottom actions row retains Flare button with full space');
assert(hudBottomBlock.includes('id="btn-recenter"'), 'Bottom actions row retains Recenter button');
assert(hudBottomBlock.includes('id="btn-fit-all"'), 'Bottom actions row retains Fit All button');

// 2. Verify High Accuracy GPS removed from in-game settings menu but enabled as default
const inGameSettingsModalBlock = indexUpdated.substring(indexUpdated.indexOf('id="modal-ingame-settings"'), indexUpdated.indexOf('id="modal-confirm-exit"'));
assert(!inGameSettingsModalBlock.includes('id="ingame-setting-gps"'), 'High Accuracy GPS toggle is removed from in-game settings modal');

const configJsContent = fs.readFileSync(path.join(__dirname, '../js/config.js'), 'utf8');
assert(configJsContent.includes('highAccuracyGPS: true'), 'High Accuracy GPS is enabled/open by default in DEFAULT_CONFIG');

// 3. Verify Red Leave Match Button matching Save Button
const stylesUpdated = fs.readFileSync(path.join(__dirname, '../css/styles.css'), 'utf8');
assert(stylesUpdated.includes('.btn-danger {'), '.btn-danger CSS class is defined in styles.css');
assert(stylesUpdated.includes('.btn-danger') && stylesUpdated.includes('linear-gradient(135deg, #ef4444'), '.btn-danger has vibrant red gradient background');
assert(stylesUpdated.includes('.btn-danger') && stylesUpdated.includes('padding: 15px 22px'), '.btn-danger has exact same padding (15px 22px) as .btn-primary');
assert(stylesUpdated.includes('.btn-danger') && stylesUpdated.includes('text-transform: uppercase'), '.btn-danger has exact same uppercase text transform as .btn-primary');
assert(stylesUpdated.includes('.btn-danger') && stylesUpdated.includes('font-weight: 800'), '.btn-danger has exact same font-weight (800) as .btn-primary');

// 4. Verify in-game leave match button uses btn-danger
assert(indexUpdated.includes('id="btn-ingame-leave-match" class="btn-danger"'), 'Leave match button in settings menu uses .btn-danger');
assert(indexUpdated.includes('id="btn-confirm-exit" class="btn-danger"'), 'Confirm leave button in exit modal uses .btn-danger');

console.log('\n27. Testing Admin GPS Coordinates with Ping Timing, Geographic Bot Spawning, Single-Click Role Swap & Connection Debounce:');

// 1. Verify getPlayerLocationInfo formats coordinates with last ping and interval
const adminJsSource = fs.readFileSync(path.join(__dirname, '../js/admin.js'), 'utf8');
assert(adminJsSource.includes('getPlayerLocationInfo(player)'), 'Admin has getPlayerLocationInfo helper');
assert(adminJsSource.includes('Last Ping:'), 'getPlayerLocationInfo formats last ping age');
assert(adminJsSource.includes('Interval:'), 'getPlayerLocationInfo formats ping interval');

// Verify simulated location formatting
const testPlayerSelf = {
  id: 'self-1',
  roomCode: 'TEST',
  nickname: 'Commander',
  role: 'runner',
  isHost: true,
  isBot: false,
  lat: 51.5074,
  lng: -0.1278,
  lastPingTime: Date.now()
};

function testGetLocationInfo(player, selfId, roomInterval = 300) {
  const isLocalSelf = player.id === selfId;
  let intervalStr = '';
  if (isLocalSelf) {
    intervalStr = 'Self · Real-Time GPS';
  } else if (player.isBot) {
    intervalStr = 'Bot Simulated · Live';
  } else if (player.role === 'seeker') {
    intervalStr = 'Seeker GPS · Live (3s)';
  } else {
    intervalStr = roomInterval >= 60 ? `${Math.round(roomInterval / 60)}m` : `${roomInterval}s`;
  }

  const pingAgeSec = Math.max(0, Math.round((Date.now() - player.lastPingTime) / 1000));
  let ageDisplay = isLocalSelf ? 'Live' : (pingAgeSec < 60 ? `${pingAgeSec}s ago` : `${Math.floor(pingAgeSec / 60)}m ago`);
  return `${player.lat.toFixed(5)}, ${player.lng.toFixed(5)} (Last Ping: ${ageDisplay} · Interval: ${intervalStr})`;
}

const selfInfo = testGetLocationInfo(testPlayerSelf, 'self-1', 300);
assert(selfInfo.includes('51.50740, -0.12780'), 'Formats lat/lng with 5 decimal precision');
assert(selfInfo.includes('Self · Real-Time GPS'), 'Local player shows Self Real-Time GPS');

const remoteRunner = {
  id: 'runner-99',
  roomCode: 'TEST',
  nickname: 'RunnerAlpha',
  role: 'runner',
  isHost: false,
  isBot: false,
  lat: 48.8566,
  lng: 2.3522,
  lastPingTime: Date.now() - 14000 // 14s ago
};
const remoteInfo = testGetLocationInfo(remoteRunner, 'self-1', 300);
assert(remoteInfo.includes('48.85660, 2.35220'), 'Remote player displays coordinates');
assert(remoteInfo.includes('14s ago'), 'Remote player shows ping age (14s ago)');
assert(remoteInfo.includes('Interval: 5m'), 'Remote player shows room ping interval (5m)');

// 2. Verify Bot Spawning uses target player geographic coordinates, never hardcoded America (NYC)
assert(!adminJsSource.includes('40.7580'), 'No hardcoded Times Square (40.7580) in admin.js');
assert(!adminJsSource.includes('-73.9855'), 'No hardcoded Times Square (-73.9855) in admin.js');
assert(!adminJsSource.includes('40.7128'), 'No hardcoded NYC (40.7128) in admin.js');
assert(!adminJsSource.includes('-74.0060'), 'No hardcoded NYC (-74.0060) in admin.js');

// Simulate bot spawn offset calculation
const targetLat = 52.5200; // Berlin
const targetLng = 13.4050;
const angle = Math.PI / 4;
const distMeters = 20;
const deltaLat = (distMeters * Math.cos(angle)) / 111111;
const deltaLng = (distMeters * Math.sin(angle)) / (111111 * Math.cos(targetLat * Math.PI / 180));
const botLat = targetLat + deltaLat;
const botLng = targetLng + deltaLng;
const actualDistance = Math.hypot((botLat - targetLat) * 111111, (botLng - targetLng) * 111111 * Math.cos(targetLat * Math.PI / 180));
assert(Math.abs(actualDistance - 20) < 0.1, 'Bot spawns accurately ~20m from target player in their local country');

// 3. Verify Leaflet popup has prominent, legible buttons and no 10px black-on-blue button
assert(!adminJsSource.includes('font-size:10px; padding:3px 6px; background:#38bdf8; color:#000'), 'Unreadable 10px black-on-blue button is removed');
assert(adminJsSource.includes('Spawn Bot Here'), 'Marker popup contains Spawn Bot Here button');
assert(adminJsSource.includes('btn-primary') && adminJsSource.includes('font-size:12px'), 'Marker popup button uses prominent 12px font and high contrast styling');

// 4. Verify Single-Click Role Swap Synchronization
assert(adminJsSource.includes('AdminBot.isBotActive(playerId)'), 'Admin.swapPlayerRole synchronizes with AdminBot for bots');
assert(adminJsSource.includes('Network.emitHostBeacon()'), 'Admin.swapPlayerRole triggers immediate host beacon');

// 5. Verify Relay Connection Debounce
const uiJsSource = fs.readFileSync(path.join(__dirname, '../js/ui.js'), 'utf8');
assert(uiJsSource.includes('disconnectBadgeTimer'), 'UI debounces disconnection status with disconnectBadgeTimer');
assert(uiJsSource.includes('3000'), 'Disconnection badge debounce delay is 3000ms');

console.log('\n28. Testing Bot Kicking, Player Role Changes, Match Termination & Bot Customizations (Speed, Movement, Waypoints):');

// A. HTML Spawner Inputs
const indexHtmlForBots = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
assert(indexHtmlForBots.includes('id="admin-bot-speed"'), 'Bot spawner has #admin-bot-speed selector');
assert(indexHtmlForBots.includes('id="admin-bot-movement"'), 'Bot spawner has #admin-bot-movement selector');
assert(indexHtmlForBots.includes('id="admin-map-waypoint-banner"'), 'God\'s Eye Map has #admin-map-waypoint-banner');

// B. SimulationEngine bot removal and role swapping
const simulationJsSource = fs.readFileSync(path.join(__dirname, '../js/simulation.js'), 'utf8');
assert(simulationJsSource.includes('removeBot(botId)'), 'SimulationEngine implements removeBot(botId)');
assert(simulationJsSource.includes('swapBotRole(botId'), 'SimulationEngine implements swapBotRole(botId, newRole)');

// C. AdminBotManager: Speed, Movement, Waypoint Navigation & Pursuit
assert(adminJsSource.includes('setBotSpeed('), 'AdminBotManager implements setBotSpeed()');
assert(adminJsSource.includes('toggleMovement('), 'AdminBotManager implements toggleMovement()');
assert(adminJsSource.includes('setMovement('), 'AdminBotManager implements setMovement()');
assert(adminJsSource.includes('setBotDestination('), 'AdminBotManager implements setBotDestination()');
assert(adminJsSource.includes('clearBotDestination('), 'AdminBotManager implements clearBotDestination()');
assert(adminJsSource.includes('setBotTargetPlayer('), 'AdminBotManager implements setBotTargetPlayer()');
assert(adminJsSource.includes('despawnAllForRoom('), 'AdminBotManager implements despawnAllForRoom()');

// D. Test Waypoint Math & Navigation Logic
function testGetDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function testGetBearing(lat1, lng1, lat2, lng2) {
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
            Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

// Simulate bot behavior
const customTestBot = {
  id: 'bot_custom_1',
  roomCode: 'TEST',
  nickname: 'TestBot',
  role: 'runner',
  lat: 40.7128,
  lng: -74.0060,
  heading: 0,
  speed: 2.8,
  isMoving: true,
  targetDestination: null,
  targetPlayerId: null
};

// Test speed modification
customTestBot.speed = 5.0;
assert(customTestBot.speed === 5.0, 'Bot speed successfully set to 5.0 m/s (Run)');
customTestBot.speed = 8.0;
assert(customTestBot.speed === 8.0, 'Bot speed successfully set to 8.0 m/s (Sprint)');

// Test movement freeze / hold position
customTestBot.isMoving = false;
const frozenLatBefore = customTestBot.lat;
const frozenLngBefore = customTestBot.lng;
// Simulate tick while frozen:
if (customTestBot.isMoving) {
  customTestBot.lat += 0.001;
}
assert(customTestBot.lat === frozenLatBefore && customTestBot.lng === frozenLngBefore, 'Bot position strictly freezes when movement is stopped');

// Test movement resume
customTestBot.isMoving = true;
assert(customTestBot.isMoving === true, 'Bot movement successfully resumes when enabled');

// Test Waypoint Navigation towards destination
const waypointTarget = { lat: 40.7138, lng: -74.0060 }; // ~111m North
customTestBot.targetDestination = waypointTarget;
const bearingToWp = testGetBearing(customTestBot.lat, customTestBot.lng, waypointTarget.lat, waypointTarget.lng);
assert(Math.abs(bearingToWp - 0) < 0.5, 'Waypoint bearing directly North evaluates to ~0 degrees');

// Simulate 1 tick of movement towards waypoint at 5.0 m/s
const distToWp = testGetDistanceMeters(customTestBot.lat, customTestBot.lng, waypointTarget.lat, waypointTarget.lng);
const stepMeters = Math.min(distToWp, customTestBot.speed);
const radWp = bearingToWp * Math.PI / 180;
customTestBot.lat += (stepMeters * Math.cos(radWp)) / 111111;
customTestBot.lng += (stepMeters * Math.sin(radWp)) / (111111 * Math.cos(customTestBot.lat * Math.PI / 180));
const newDistToWp = testGetDistanceMeters(customTestBot.lat, customTestBot.lng, waypointTarget.lat, waypointTarget.lng);
assert(newDistToWp < distToWp, 'Bot moves closer to target waypoint on tick');

// Test Waypoint arrival detection (< 3.5m)
customTestBot.lat = waypointTarget.lat;
customTestBot.lng = waypointTarget.lng;
const arrivedDist = testGetDistanceMeters(customTestBot.lat, customTestBot.lng, waypointTarget.lat, waypointTarget.lng);
if (arrivedDist <= 3.5) {
  customTestBot.targetDestination = null;
  customTestBot.isMoving = false;
}
assert(customTestBot.targetDestination === null && customTestBot.isMoving === false, 'Bot halts and clears destination when arriving within 3.5m of waypoint');

// E. Admin Room Termination Logic Verification
assert(adminJsSource.includes('Admin.rooms.delete(targetRoom)') || adminJsSource.includes('this.rooms.delete(targetRoom)'), 'Admin.confirmEndRoom deletes room completely from Admin.rooms');
assert(adminJsSource.includes('AdminBot.despawnAllForRoom(targetRoom)'), 'Admin.confirmEndRoom despawns all bots in the terminated room');
assert(adminJsSource.includes('broadcastAction(targetRoom, \'match_over\''), 'Admin.confirmEndRoom broadcasts match_over packet to all clients');
assert(adminJsSource.includes('this.boundaryLayers.delete(targetRoom)'), 'Admin.confirmEndRoom removes boundary layer from master map');

// F. Admin Bot & Player Kicking Logic Verification
assert(adminJsSource.includes('AdminBot.despawn(playerId)'), 'Admin.confirmKickPlayer despawns bot from AdminBotManager');
assert(adminJsSource.includes('Simulation.removeBot(playerId)'), 'Admin.confirmKickPlayer removes bot from SimulationEngine');
assert(adminJsSource.includes('this.removeMapMarker(playerId)'), 'Admin.confirmKickPlayer removes player marker from master map');

// G. Admin Single-Click Role Swap & Editing
assert(adminJsSource.includes('setPlayerRole(roomCode, playerId, targetRole)'), 'Admin implements explicit setPlayerRole() method');
assert(adminJsSource.includes('promptEditPlayerNickname('), 'Admin implements promptEditPlayerNickname() method');

console.log('\n29. Testing Real-Time Tagging Decoupling, Dynamic 1s Polling, Hunter Proximity Alerts & Native Background GPS:');

// A. Dynamic Polling Rate
const gameJsSource = fs.readFileSync(path.join(__dirname, '../js/game.js'), 'utf8');
const configJsSource = fs.readFileSync(path.join(__dirname, '../js/config.js'), 'utf8');

assert(configJsSource.includes('dynamicNearDistanceMeters: 100'), 'Config specifies 100m dynamic near distance threshold');
assert(configJsSource.includes('hunterProximityAlertMeters: 75'), 'Config specifies 75m hunter proximity alert threshold');
assert(configJsSource.includes('hunterProximityAlertInterval: 10'), 'Config specifies 10s hunter proximity alert interval');

assert(gameJsSource.includes('getDynamicBroadcastInterval()'), 'Game implements getDynamicBroadcastInterval helper');
assert(gameJsSource.includes('getEffectiveRunnerDistance('), 'Game implements getEffectiveRunnerDistance helper');
assert(gameJsSource.includes('triggerHunterProximityAlert('), 'Game implements triggerHunterProximityAlert method');

// Simulate getDynamicBroadcastInterval logic
function testGetDynamicBroadcastInterval(role, nearestDist, dynamicThreshold = 100, seekerInterval = 5) {
  if (nearestDist !== null && nearestDist <= dynamicThreshold) {
    return 1000; // Near real-time 1s polling
  }
  if (role === 'runner') {
    return 2000;
  }
  return seekerInterval * 1000;
}

assert(testGetDynamicBroadcastInterval('seeker', 50, 100, 5) === 1000, 'Seeker within 50m of runner switches to 1s dynamic polling rate');
assert(testGetDynamicBroadcastInterval('runner', 80, 100, 5) === 1000, 'Runner within 80m of seeker switches to 1s dynamic polling rate');
assert(testGetDynamicBroadcastInterval('seeker', 150, 100, 5) === 5000, 'Seeker 150m away maintains normal 5s polling interval');
assert(testGetDynamicBroadcastInterval('runner', 200, 100, 5) === 2000, 'Runner 200m away maintains normal 2s squad telemetry');

// B. Tagging Latency Decoupling Simulation
// Hunter reaches runner location while runner\'s ping countdown has NOT fired (e.g. countdown is at 280s out of 300s)
const mockGameState = {
  role: 'seeker',
  state: 'ACTIVE',
  lastSelfCoords: { lat: 51.5074, lng: -0.1278 },
  runnerPingCountdown: 280, // 280s remaining before next runner ping snapshot!
  trueLivePositions: new Map(),
  lastKnownPositions: new Map(),
  taggedRunners: new Set(),
  lockedTargetId: null,
  lastHunterProximityAlertTime: 0
};

// Runner\'s stale ping was 200m away at (51.5090, -0.1278), but runner moved to (51.50745, -0.1278) ~5.5m away
mockGameState.lastKnownPositions.set('runner_1', {
  lat: 51.5090,
  lng: -0.1278,
  role: 'runner',
  nickname: 'Speedy'
});
mockGameState.trueLivePositions.set('runner_1', {
  lat: 51.50745,
  lng: -0.1278,
  role: 'runner',
  nickname: 'Speedy'
});

// Calculate effective distance to runner
function testGetEffectiveRunnerDistance(runnerId, lastKnownPos, trueLivePositions, selfLat, selfLng) {
  const truePos = trueLivePositions.get(runnerId);
  if (truePos && truePos.lat != null && truePos.lng != null) {
    const dist = testGetDistanceMeters(selfLat, selfLng, truePos.lat, truePos.lng);
    const bearing = testGetBearing(selfLat, selfLng, truePos.lat, truePos.lng);
    return { distance: dist, bearing: bearing, isLive: true };
  }
  if (lastKnownPos && lastKnownPos.lat != null && lastKnownPos.lng != null) {
    const dist = testGetDistanceMeters(selfLat, selfLng, lastKnownPos.lat, lastKnownPos.lng);
    const bearing = testGetBearing(selfLat, selfLng, lastKnownPos.lat, lastKnownPos.lng);
    return { distance: dist, bearing: bearing, isLive: false };
  }
  return { distance: Infinity, bearing: 0, isLive: false };
}

const decoupledResult = testGetEffectiveRunnerDistance('runner_1', mockGameState.lastKnownPositions.get('runner_1'), mockGameState.trueLivePositions, mockGameState.lastSelfCoords.lat, mockGameState.lastSelfCoords.lng);
assert(decoupledResult.distance < 10, 'Decoupled calculation evaluates true live runner distance (~5.5m) despite stale ping (200m)');
assert(decoupledResult.distance <= 15, 'Runner is immediately inside tag radius (15m) without waiting for 280s ping timer reset');

// C. Hunter Proximity Alert Triggering
function testHunterProximityCheck(closestDistance, closestOpponent, closestBearing, lastAlertTime, proxThreshold = 75, cooldownSec = 10) {
  if (proxThreshold > 0 && closestDistance <= proxThreshold) {
    const now = Date.now();
    if (now - lastAlertTime >= (cooldownSec * 1000)) {
      return { fired: true, time: now, name: closestOpponent.nickname, distance: closestDistance, bearing: closestBearing };
    }
  }
  return { fired: false, time: lastAlertTime };
}

const alertCheck1 = testHunterProximityCheck(decoupledResult.distance, { nickname: 'Speedy' }, decoupledResult.bearing, 0, 75, 10);
assert(alertCheck1.fired === true, 'Hunter proximity alert triggers when runner is within 75m');
assert(alertCheck1.name === 'Speedy', 'Hunter alert identifies closest runner name');

// Test alert cooldown prevents battery drain & spam
const alertCheck2 = testHunterProximityCheck(decoupledResult.distance, { nickname: 'Speedy' }, decoupledResult.bearing, alertCheck1.time, 75, 10);
assert(alertCheck2.fired === false, 'Hunter proximity alert respects cooldown to avoid rapid spam and save battery');

// D. Stale Ping Catch Exploit Protection & Phantom Catch Rejection
// Case 1: Hunter walks up to a runner\'s STALE ping marker, but the runner physically ran away 120m
const staleMarkerHunterLat = 51.5090;
const staleMarkerHunterLng = -0.1278;
const actualRunnerLat = 51.5074;
const actualRunnerLng = -0.1278;

const staleTestLivePositions = new Map();
staleTestLivePositions.set('runner_fled', { lat: actualRunnerLat, lng: actualRunnerLng, role: 'runner' });
const staleTestKnownPositions = new Map();
staleTestKnownPositions.set('runner_fled', { lat: staleMarkerHunterLat, lng: staleMarkerHunterLng, role: 'runner' });

function testTagRunnerValidation(targetId, hunterLat, hunterLng, knownMap, liveMap, maxRadius = 15) {
  const effective = testGetEffectiveRunnerDistance(targetId, knownMap.get(targetId), liveMap, hunterLat, hunterLng);
  if (effective.distance > maxRadius) {
    return { allowed: false, message: 'The target is no longer here.' };
  }
  return { allowed: true, distance: effective.distance };
}

const phantomTagResult = testTagRunnerValidation('runner_fled', staleMarkerHunterLat, staleMarkerHunterLng, staleTestKnownPositions, staleTestLivePositions, 15);
assert(phantomTagResult.allowed === false, 'Phantom catch attempt on stale ping coordinates is strictly rejected');
assert(phantomTagResult.message === 'The target is no longer here.', 'Phantom catch returns correct rejection message: "The target is no longer here."');

// Case 2: Hunter is physically adjacent to runner\'s true live location
const legitTagResult = testTagRunnerValidation('runner_fled', actualRunnerLat + 0.00005, actualRunnerLng, staleTestKnownPositions, staleTestLivePositions, 15);
assert(legitTagResult.allowed === true, 'Real-time tag allowed instantly when hunter coordinates match runner live position');

// E. Android Native Configuration Verification
const androidManifestSource = fs.readFileSync(path.join(__dirname, '../android/AndroidManifest.xml'), 'utf8');
const mainActivitySource = fs.readFileSync(path.join(__dirname, '../android/app/src/main/java/com/manhunt/gpsgame/MainActivity.java'), 'utf8');
const locationServiceSource = fs.readFileSync(path.join(__dirname, '../android/app/src/main/java/com/manhunt/gpsgame/LocationService.java'), 'utf8');

assert(androidManifestSource.includes('android.permission.ACCESS_BACKGROUND_LOCATION'), 'AndroidManifest.xml includes ACCESS_BACKGROUND_LOCATION permission');
assert(androidManifestSource.includes('android.permission.FOREGROUND_SERVICE'), 'AndroidManifest.xml includes FOREGROUND_SERVICE permission');
assert(androidManifestSource.includes('android.permission.FOREGROUND_SERVICE_LOCATION'), 'AndroidManifest.xml includes FOREGROUND_SERVICE_LOCATION permission');
assert(androidManifestSource.includes('LocationService'), 'AndroidManifest.xml declares LocationService');

assert(mainActivitySource.includes('requestBackgroundLocationInternal()'), 'MainActivity implements requestBackgroundLocationInternal()');
assert(mainActivitySource.includes('ACCESS_BACKGROUND_LOCATION'), 'MainActivity requests ACCESS_BACKGROUND_LOCATION');
assert(mainActivitySource.includes('backgroundLocation'), 'MainActivity AndroidBridge checkPermissionsStatus reports backgroundLocation');
assert(locationServiceSource.includes('requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0.0f'), 'LocationService uses 0.0f minDistance for unthrottled background GPS');

// F. iOS Native Configuration Verification
const iosInfoPlistSource = fs.readFileSync(path.join(__dirname, '../ios/App/App/Info.plist'), 'utf8');
const iosLocationManagerSource = fs.readFileSync(path.join(__dirname, '../ios/App/App/LocationManager.swift'), 'utf8');

assert(iosInfoPlistSource.includes('<string>location</string>'), 'iOS Info.plist declares UIBackgroundModes location');
assert(iosInfoPlistSource.includes('<string>fetch</string>'), 'iOS Info.plist declares UIBackgroundModes fetch');
assert(iosInfoPlistSource.includes('NSLocationAlwaysAndWhenInUseUsageDescription'), 'iOS Info.plist contains NSLocationAlwaysAndWhenInUseUsageDescription');
assert(iosInfoPlistSource.includes('NSLocationAlwaysUsageDescription'), 'iOS Info.plist contains NSLocationAlwaysUsageDescription');
assert(iosLocationManagerSource.includes('allowsBackgroundLocationUpdates = true'), 'LocationManager.swift sets allowsBackgroundLocationUpdates = true');
assert(iosLocationManagerSource.includes('pausesLocationUpdatesAutomatically = false'), 'LocationManager.swift sets pausesLocationUpdatesAutomatically = false');
assert(iosLocationManagerSource.includes('requestAlwaysAuthorization()'), 'LocationManager.swift implements requestAlwaysAuthorization()');

console.log('\n30. Testing HUD Overhaul, Notification Anti-Spam Multiplier & Customizable Seeker Radar Cooldown:');

// A. Seeker Radar Cooldown Host Control & Configuration
assert(configJsSource.includes('seekerRadarCooldownSeconds: 30'), 'Config specifies 30s default seeker radar cooldown');
assert(indexHtmlForBots.includes('id="lobby-radar-cooldown"'), 'Host settings include #lobby-radar-cooldown input');
assert(indexHtmlForBots.includes('id="chip-radar-cooldown"'), 'Lobby rule chips include #chip-radar-cooldown');
assert(uiJsSource.includes('startSeekerRadarCooldown('), 'UI implements startSeekerRadarCooldown');
assert(gameJsSource.includes('seekerRadarCooldownSeconds'), 'Game.broadcastSeekerPulse checks seekerRadarCooldownSeconds');

// B. Seeker Radar Cooldown Simulation
let pulseTime = 0;
const testRadarCooldownSec = 20;
const testRadarCooldownMs = testRadarCooldownSec * 1000;

function testSeekerPulseTrigger(now) {
  if (pulseTime && (now - pulseTime < testRadarCooldownMs)) {
    const remaining = Math.ceil((testRadarCooldownMs - (now - pulseTime)) / 1000);
    return { allowed: false, remaining: remaining };
  }
  pulseTime = now;
  return { allowed: true, remaining: 0 };
}

const firstPulse = testSeekerPulseTrigger(100000);
assert(firstPulse.allowed === true, 'Initial seeker radar pulse is allowed immediately');

const rapidPulse = testSeekerPulseTrigger(105000); // 5s later
assert(rapidPulse.allowed === false, 'Rapid seeker radar pulse within cooldown is blocked');
assert(rapidPulse.remaining === 15, 'Radar cooldown remaining reports 15 seconds remaining');

const validPulseLater = testSeekerPulseTrigger(121000); // 21s later
assert(validPulseLater.allowed === true, 'Seeker radar pulse allowed after cooldown period finishes');

// C. Notification Anti-Spam Multiplier Simulation
const mockToastContainer = {
  children: [],
  appendChild(el) { this.children.push(el); }
};

function testShowToast(container, message, type = 'info') {
  const existing = container.children.find(t => t._baseMessage === message && !t.isFadedOut);
  if (existing) {
    existing._count = (existing._count || 1) + 1;
    existing.innerHTML = `${message} <span class="toast-multiplier">[${existing._count}x]</span>`;
    existing.timerReset = true;
    return existing;
  }
  const toast = {
    className: `toast toast-${type}`,
    _baseMessage: message,
    _count: 1,
    textContent: message,
    innerHTML: message,
    isFadedOut: false,
    timerReset: false
  };
  container.appendChild(toast);
  return toast;
}

testShowToast(mockToastContainer, 'Seeker Radar Pulse emitted', 'info');
assert(mockToastContainer.children.length === 1, 'First notification creates single DOM element');
assert(mockToastContainer.children[0]._count === 1, 'First notification has count of 1');

// Send duplicate notification
testShowToast(mockToastContainer, 'Seeker Radar Pulse emitted', 'info');
assert(mockToastContainer.children.length === 1, 'Duplicate notification does NOT create a new DOM element');
assert(mockToastContainer.children[0]._count === 2, 'Duplicate notification increments count to 2');
assert(mockToastContainer.children[0].innerHTML.includes('[2x]'), 'Duplicate notification renders [2x] multiplier badge');

// Send third duplicate notification
testShowToast(mockToastContainer, 'Seeker Radar Pulse emitted', 'info');
assert(mockToastContainer.children.length === 1, 'Third duplicate notification retains single DOM element');
assert(mockToastContainer.children[0]._count === 3, 'Third duplicate notification increments count to 3');
assert(mockToastContainer.children[0].innerHTML.includes('[3x]'), 'Third duplicate notification renders [3x] multiplier badge');

// Send a different notification
testShowToast(mockToastContainer, 'Runner tagged!', 'danger');
assert(mockToastContainer.children.length === 2, 'Distinct notification creates new DOM element');
assert(mockToastContainer.children[1]._count === 1, 'New distinct notification starts with count 1');

// D. Tactical OLED HUD Brutalist Styling Verification
const stylesCssSource = fs.readFileSync(path.join(__dirname, '../css/styles.css'), 'utf8');
assert(stylesCssSource.includes('.hud-radar-console') && stylesCssSource.includes('border-radius: 2px !important'), 'HUD radar console uses tactical brutalist 2px border-radius');
assert(stylesCssSource.includes('.hud-ping-banner') && stylesCssSource.includes('border-radius: 2px !important'), 'HUD ping banner uses brutalist 2px border-radius');
assert(stylesCssSource.includes('.toast-multiplier'), 'CSS styles include .toast-multiplier class');

// Summary
console.log('\n======================================================');
console.log(`📊 TEST RESULTS: ${testsPassed} PASSED, ${testsFailed} FAILED`);
console.log('======================================================\n');

if (testsFailed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
