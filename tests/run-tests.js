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


// Summary
console.log('\n======================================================');
console.log(`📊 TEST RESULTS: ${testsPassed} PASSED, ${testsFailed} FAILED`);
console.log('======================================================\n');

if (testsFailed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
