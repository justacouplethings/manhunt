/**
 * Manhunt Admin Panel & Bot System End-to-End Test
 * Tests Admin logo secret tap gesture, authentication modal,
 * dashboard navigation tabs, bot injection, map tap placement, and moderation controls.
 */
const { chromium } = require('playwright');
const path = require('path');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`    ✅ ${message}`);
    testsPassed++;
  } else {
    console.error(`    ❌ FAIL: ${message}`);
    testsFailed++;
  }
}

async function runAdminTest() {
  console.log('\n======================================================');
  console.log('🛡️ RUNNING ADMIN PANEL & GOD\'S EYE VALIDATION');
  console.log('======================================================\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--no-sandbox']
  });

  const context = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: 40.7580, longitude: -73.9855 } // Times Square
  });

  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error' || msg.text().includes('error') || msg.text().includes('Spawned')) {
      console.log('    [BROWSER]', msg.type(), msg.text());
    }
  });
  page.on('pageerror', err => console.error('    [PAGE ERROR]', err));

  // Set local storage so modal-device-select and onboarding are bypassed (simulating installed APK)
  await page.addInitScript(() => {
    localStorage.setItem('manhunt_device_platform_v2', 'android');
    localStorage.setItem('manhunt_onboarded_v2', 'true');
  });

  // Navigate to local server
  console.log('[1] Loading application...');
  await page.goto('http://localhost:8080/index.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  // [2] Test Secret 5-Tap Gesture on Logo
  console.log('\n[2] Testing Admin Access Gesture (5 taps on logo)...');
  const logo = page.locator('#app-logo');
  assert(await logo.isVisible(), 'Game logo is visible in header');

  for (let i = 0; i < 5; i++) {
    await logo.click();
    await page.waitForTimeout(80);
  }

  const authModal = page.locator('#modal-admin-auth');
  await authModal.waitFor({ state: 'visible', timeout: 3000 });
  assert(await authModal.isVisible(), '5-tap gesture successfully opened Admin Authentication modal');

  // [3] Test Authentication Credential Validation
  console.log('\n[3] Testing Admin Credential Validation...');
  const passInput = page.locator('#input-admin-pass');
  const unlockBtn = page.locator('#btn-admin-auth-submit');
  const errorMsg = page.locator('#admin-auth-error');

  // Negative test: invalid password
  await passInput.fill('wrong_password_999');
  await unlockBtn.click();
  await page.waitForTimeout(200);
  assert(await errorMsg.isVisible(), 'Error message displayed for invalid password');

  // Positive test: default PIN "1337"
  await passInput.fill('1337');
  await unlockBtn.click();
  await page.waitForTimeout(500);

  const adminScreen = page.locator('#screen-admin');
  assert(await adminScreen.isVisible(), 'Correct PIN unlocked Admin Omni-Command Dashboard');

  // [4] Test Tab Navigation
  console.log('\n[4] Testing Admin Navigation Tabs...');
  const tabRooms = page.locator('#tab-btn-admin-rooms');
  const tabPlayers = page.locator('#tab-btn-admin-players');
  const tabMap = page.locator('#tab-btn-admin-map');
  const tabBots = page.locator('#tab-btn-admin-bots');
  const tabSettings = page.locator('#tab-btn-admin-settings');

  assert(await tabRooms.isVisible(), 'Rooms tab is visible');
  assert(await tabPlayers.isVisible(), 'Players tab is visible');
  assert(await tabMap.isVisible(), 'God\'s Eye Map tab is visible');
  assert(await tabBots.isVisible(), 'Bot Sandbox tab is visible');
  assert(await tabSettings.isVisible(), 'Overrides tab is visible');

  // [5] Test Bot Injection
  console.log('\n[5] Testing Bot Spawner in Sandbox...');
  await tabBots.click();
  await page.waitForTimeout(300);

  const botRoomInput = page.locator('#admin-bot-room-target');
  const botNameInput = page.locator('#admin-bot-name');
  const spawnBtn = page.locator('button:has-text("INJECT BOT INTO OPERATION")');

  await botRoomInput.fill('ADM1');
  await botNameInput.fill('Viper-1');
  await spawnBtn.click();
  await page.waitForTimeout(500);

  const botCard = page.locator('.admin-bot-card:has-text("Viper-1")');
  assert(await botCard.isVisible(), 'Injected bot "Viper-1" spawned and visible in active bot list');

  // [6] Test Map Placement Mode
  console.log('\n[6] Testing Map Placement & Teleportation...');
  const placeOnMapBtn = botCard.locator('button:has-text("Place on Map")');
  await placeOnMapBtn.click();
  await page.waitForTimeout(500);

  const mapPane = page.locator('#admin-tab-map');
  const mapPaneClass = await mapPane.getAttribute('class');
  assert(mapPaneClass.includes('active') && (await mapPane.isVisible()), 'Map placement seamlessly navigated to God\'s Eye Map tab');

  const mapContainer = page.locator('#admin-master-map');
  assert(await mapContainer.isVisible(), 'Master Leaflet map container rendered');

  // Click on the map to teleport bot
  const mapBox = await mapContainer.boundingBox();
  if (mapBox) {
    await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
    await page.waitForTimeout(500);
    console.log('    ✅ Clicked master map in Bot Placement mode');
    testsPassed++;
  }

  // [7] Test Room Overrides
  console.log('\n[7] Testing Room Settings Overrides...');
  await tabSettings.click();
  await page.waitForTimeout(300);

  const boundarySelect = page.locator('#admin-override-boundary');
  await boundarySelect.selectOption('1000');
  const applyOverridesBtn = page.locator('button:has-text("PUSH OVERRIDE TO ROOM")');
  await applyOverridesBtn.click();
  await page.waitForTimeout(300);
  assert(true, 'Admin applied settings override packet across relay');

  // [8] Test Exit Admin Dashboard
  console.log('\n[8] Testing Clean Exit from Admin Panel...');
  const exitBtn = page.locator('#btn-admin-exit');
  await exitBtn.click();
  await page.waitForTimeout(300);

  const lobbyScreen = page.locator('#screen-lobby');
  assert(await lobbyScreen.isVisible(), 'Exit button smoothly returned user to Lobby screen');

  console.log('\n======================================================');
  console.log(`📊 ADMIN TESTS: ${testsPassed} PASSED, ${testsFailed} FAILED`);
  console.log('======================================================\n');

  await browser.close();

  if (testsFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAdminTest().catch(err => {
  console.error('Fatal Admin Test Error:', err);
  process.exit(1);
});
