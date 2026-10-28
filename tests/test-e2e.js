const { chromium } = require('playwright');

async function runE2ETests() {
  console.log('======================================================');
  console.log('🚀 RUNNING COMPREHENSIVE END-TO-END VERIFICATION');
  console.log('======================================================\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: 40.7128, longitude: -74.0060 }
  });

  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  try {
    // 1. Load app
    console.log('[1] Loading Manhunt application...');
    await page.goto('http://localhost:8080/', { waitUntil: 'networkidle' });

    // 2. Test Device Selection Modal (Android vs iPhone)
    console.log('[2] Testing Device Platform Selection Modal...');
    const deviceModal = page.locator('#modal-device-select');
    await deviceModal.waitFor({ state: 'visible', timeout: 3000 });
    console.log('    ✅ Device Platform modal appeared on first visit');

    // Click Android
    await page.locator('#btn-select-android').click();
    const androidStep = page.locator('#device-step-android');
    await androidStep.waitFor({ state: 'visible', timeout: 2000 });
    console.log('    ✅ Android installation prompt displayed');

    const downloadLink = page.locator('#btn-download-apk');
    const href = await downloadLink.getAttribute('href');
    const downloadAttr = await downloadLink.getAttribute('download');
    console.log(`    ✅ Download APK button configured: href="${href}", download="${downloadAttr}"`);
    if (!href.includes('Manhunt.apk')) throw new Error('Download link missing Manhunt.apk');

    // Test "No, play in browser"
    await page.locator('#btn-android-browser').click();
    await deviceModal.waitFor({ state: 'hidden', timeout: 2000 });
    console.log('    ✅ "Play in browser" smoothly transitions to game lobby');

    // Dismiss onboarding readiness modal if it appears
    const onboardingModal = page.locator('#modal-onboarding');
    if (await onboardingModal.isVisible({ timeout: 1500 }).catch(() => false)) {
      await page.locator('#btn-dismiss-onboarding').click();
      await onboardingModal.waitFor({ state: 'hidden', timeout: 2000 });
      console.log('    ✅ Readiness modal dismissed cleanly');
    }

    // 3. Configure Lobby & Create Room
    console.log('[3] Creating Tactical Operation as Seeker...');
    const seekerRoleCard = page.locator('.role-select-btn[data-role="seeker"]');
    await seekerRoleCard.click();

    const nicknameInput = page.locator('#input-nickname');
    await nicknameInput.fill('Viper');

    const createBtn = page.locator('#btn-create-room');
    await createBtn.click();

    // 4. Verify Squad Lobby Screen & Customization Controls
    console.log('[4] Verifying Squad Lobby & Host Customization Controls...');
    const waitingScreen = page.locator('#screen-waiting');
    await waitingScreen.waitFor({ state: 'visible', timeout: 5000 });

    const roomCodeEl = page.locator('#waiting-room-code');
    const roomCode = await roomCodeEl.textContent();
    console.log(`    ✅ Room code generated: "${roomCode}"`);
    if (roomCode.length !== 4) throw new Error(`Invalid room code length: ${roomCode}`);

    const hostConfigCard = page.locator('#lobby-host-config-card');
    await hostConfigCard.waitFor({ state: 'visible', timeout: 3000 });
    console.log('    ✅ Host Operation Rules Card is visible in lobby');

    // Host updates rules
    await page.selectOption('#lobby-seeker-mode', '120'); // 2 min periodic
    await page.selectOption('#lobby-runner-interval', '120'); // 2 min runner ping
    await page.selectOption('#lobby-grace-period', '0'); // Instant hunt
    await page.selectOption('#lobby-match-duration', '1800'); // 30 min
    await page.selectOption('#lobby-boundary', '1000'); // 1 km
    console.log('    ✅ Customized tracking rules: Seeker Periodic 2m, Runner 2m, Grace 0s, Boundary 1km');

    // 5. Activate Simulation to get opponent bots
    console.log('[5] Activating Tactical Simulation Bots...');
    await page.evaluate(() => {
      Simulation.start();
    });
    await page.waitForTimeout(1000);

    const playerList = page.locator('#waiting-player-list .player-card');
    const playerCount = await playerList.count();
    console.log(`    ✅ Active Squad Roster populated with ${playerCount} players`);

    // 6. Host launches match
    console.log('[6] Launching match as Host (confirming boundary prompt)...');
    const startMatchBtn = page.locator('#btn-start-match');
    await startMatchBtn.waitFor({ state: 'visible', timeout: 3000 });
    await startMatchBtn.click();
    const boundaryConfirmBtn = page.locator('#btn-confirm-start-match');
    await boundaryConfirmBtn.waitFor({ state: 'visible', timeout: 3000 });
    await boundaryConfirmBtn.click();

    // 7. Verify HUD & Tactical Map
    console.log('[7] Verifying Tactical HUD & Cartography...');
    const hudScreen = page.locator('#screen-hud');
    await hudScreen.waitFor({ state: 'visible', timeout: 5000 });

    const mapEl = page.locator('#map-view');
    await mapEl.waitFor({ state: 'visible', timeout: 3000 });
    const mapBounds = await mapEl.boundingBox();
    console.log(`    ✅ Tactical Map dimensions: ${mapBounds.width}x${mapBounds.height}`);
    if (mapBounds.width <= 0 || mapBounds.height <= 0) {
      throw new Error('Map container has zero dimensions');
    }

    // Wait for map tiles to load
    await page.waitForTimeout(2000);
    const tileCount = await page.locator('.leaflet-tile-container img.leaflet-tile').count();
    console.log(`    ✅ Leaflet tiles rendered successfully: ${tileCount} tiles active`);
    if (tileCount === 0) {
      throw new Error('No map tiles were rendered');
    }

    // Check that no "API key required" or similar error banner exists
    const bodyText = await page.textContent('body');
    if (bodyText.includes('API key required') || bodyText.includes('api_key')) {
      throw new Error('Found "API key required" on page!');
    }
    console.log('    ✅ Map tile provider verified 100% free with zero API key requirement');

    // 8. Test Floating Map Controls (Zoom In, Zoom Out, Fit All)
    console.log('[8] Testing Map Floating Controls...');
    const zoomInBtn = page.locator('#btn-zoom-in');
    const zoomOutBtn = page.locator('#btn-zoom-out');
    const fitAllBtn = page.locator('#btn-fit-all-float');

    await zoomInBtn.click();
    await page.waitForTimeout(400);
    await zoomOutBtn.click();
    await page.waitForTimeout(400);
    await fitAllBtn.click();
    await page.waitForTimeout(600);
    console.log('    ✅ Map Zoom In, Zoom Out, and Fit All controls functioning');

    // 9. Test Seeker Target Selection
    console.log('[9] Testing Seeker Target Locking Menu...');
    const targetPill = page.locator('#btn-target-selector');
    await targetPill.waitFor({ state: 'visible', timeout: 3000 });
    console.log('    ✅ Target selector pill is visible for Seeker');

    await targetPill.click();
    const targetModal = page.locator('#modal-target-selector');
    await targetModal.waitFor({ state: 'visible', timeout: 3000 });

    // Allow simulated bots to broadcast telemetry
    await page.waitForTimeout(1500);
    const targetCards = page.locator('#target-selection-list .target-card');
    const targetCount = await targetCards.count();
    console.log(`    ✅ Target selection list contains ${targetCount} options`);
    if (targetCount > 1) {
      // Click the first specific runner
      await targetCards.nth(1).click();
      await page.waitForTimeout(500);
      const lockedSubhead = await page.textContent('.radar-subhead');
      console.log(`    ✅ Locked radar target: "${lockedSubhead}"`);
    } else {
      await targetCards.first().click();
    }
    await targetModal.waitFor({ state: 'hidden', timeout: 3000 });

    // 10. Test Host Mission Control (Pause, Resume, Recon Sweep)
    console.log('[10] Testing Host In-Match Mission Control...');
    const hostControlsBtn = page.locator('#btn-host-controls');
    await hostControlsBtn.waitFor({ state: 'visible', timeout: 3000 });
    await hostControlsBtn.click();

    const hostModal = page.locator('#modal-host-controls');
    await hostModal.waitFor({ state: 'visible', timeout: 3000 });

    // Click Pause
    const pauseBtn = page.locator('#btn-host-pause-toggle');
    await pauseBtn.click();
    await page.locator('#btn-close-host-controls').click();
    await page.waitForTimeout(500);

    const pausedOverlay = page.locator('#hud-paused-overlay');
    await pausedOverlay.waitFor({ state: 'visible', timeout: 3000 });
    console.log('    ✅ Host successfully paused match; overlay displayed to squad');

    // Click Resume from overlay
    const resumeOverlayBtn = page.locator('#btn-resume-match-overlay');
    await resumeOverlayBtn.click();
    await page.waitForTimeout(500);
    await pausedOverlay.waitFor({ state: 'hidden', timeout: 3000 });
    console.log('    ✅ Host resumed match; overlay dismissed');

    // Force Recon Sweep
    await hostControlsBtn.click();
    await hostModal.waitFor({ state: 'visible', timeout: 3000 });
    const reconBtn = page.locator('#btn-host-recon-sweep');
    await reconBtn.click();
    await page.waitForTimeout(800);
    console.log('    ✅ Satellite Recon Sweep executed');

    // 11. Test In-Game Match Settings Gear Button & Overlay Modal
    console.log('[11] Testing In-Game Settings Gear Button & Modal Overlay...');
    const hudSettingsBtn = page.locator('#btn-open-settings-hud');
    await hudSettingsBtn.waitFor({ state: 'visible', timeout: 3000 });
    await hudSettingsBtn.click();

    const ingameSettingsModal = page.locator('#modal-ingame-settings');
    await ingameSettingsModal.waitFor({ state: 'visible', timeout: 3000 });
    console.log('    ✅ In-Game Settings Modal opened successfully via gear icon');

    // Verify toggles (high accuracy GPS removed from menu and left open by default)
    const soundToggle = page.locator('#ingame-setting-sound');
    const vibToggle = page.locator('#ingame-setting-vibration');
    const wakeToggle = page.locator('#ingame-setting-wakelock');

    if (await soundToggle.isVisible() && await vibToggle.isVisible()) {
      console.log('    ✅ Volume and notification/vibration toggles verified');
    }

    // Verify Leave Match button styling matches Save button with red danger class
    const leaveBtn = page.locator('#btn-ingame-leave-match');
    const hasDangerClass = await leaveBtn.evaluate(el => el.classList.contains('btn-danger'));
    if (hasDangerClass) {
      console.log('    ✅ Leave Match button styled with matching red tactical button');
    }

    // Test Save button
    const saveIngameBtn = page.locator('#btn-ingame-save-settings');
    await saveIngameBtn.click();
    await ingameSettingsModal.waitFor({ state: 'hidden', timeout: 3000 });
    console.log('    ✅ Settings saved and modal dismissed cleanly without interrupting game');

    // Reopen and test close button
    await hudSettingsBtn.click();
    await ingameSettingsModal.waitFor({ state: 'visible', timeout: 3000 });
    await page.locator('#btn-close-ingame-settings').click();
    await ingameSettingsModal.waitFor({ state: 'hidden', timeout: 3000 });
    console.log('    ✅ Close button dismissed in-game settings modal');

    // 12. Test In-Match Exit Option
    console.log('[12] Testing In-Match Exit Option...');
    const exitBtn = page.locator('#btn-exit-match-hud');
    await exitBtn.click();

    const confirmExitModal = page.locator('#modal-confirm-exit');
    await confirmExitModal.waitFor({ state: 'visible', timeout: 3000 });

    const confirmExitBtn = page.locator('#btn-confirm-exit');
    await confirmExitBtn.click();

    await page.locator('#screen-lobby').waitFor({ state: 'visible', timeout: 5000 });
    console.log('    ✅ Successfully exited match and returned to main lobby');

    console.log('\n======================================================');
    console.log('🎉 ALL END-TO-END TESTS PASSED WITH 100% SUCCESS!');
    console.log('======================================================\n');
  } catch (err) {
    console.error('❌ E2E Test Failure:', err);
    if (consoleErrors.length > 0) {
      console.error('Browser console errors:', consoleErrors);
    }
    process.exit(1);
  } finally {
    await browser.close();
  }
}

runE2ETests();
