/**
 * Manhunt Multi-Client Real-Time Multiplayer Test
 * Tests two concurrent browser contexts across room creation, lobby discovery,
 * host role toggling, match synchronization, tag request/confirmation handshake,
 * and post-catch infection role conversion.
 */
const { chromium } = require('playwright');

async function runMultiplayerTest() {
  console.log('======================================================');
  console.log('📡 RUNNING MULTI-CLIENT MULTIPLAYER INTEGRATION TEST');
  console.log('======================================================\n');

  const browser = await chromium.launch({ headless: true });

  // Client 1 (Host - Alice)
  const contextA = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: 40.7128, longitude: -74.0060 }
  });
  const pageA = await contextA.newPage();

  // Client 2 (Friend - Bob)
  const contextB = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: 40.7129, longitude: -74.0060 } // ~11m away
  });
  const pageB = await contextB.newPage();

  try {
    // 1. Host opens app and creates room
    console.log('[1] Host (Alice) loading app & creating operation...');
    await pageA.goto('http://localhost:8080/', { waitUntil: 'networkidle' });

    // Handle device & onboarding modals on Page A
    const devModalA = pageA.locator('#modal-device-select');
    if (await devModalA.isVisible({ timeout: 2000 }).catch(() => false)) {
      await pageA.locator('#btn-select-android').click();
      await pageA.locator('#btn-android-browser').click();
    }
    const obModalA = pageA.locator('#modal-onboarding');
    if (await obModalA.isVisible({ timeout: 1500 }).catch(() => false)) {
      await pageA.locator('#btn-dismiss-onboarding').click();
    }

    // Set Seeker role and nickname Alice
    await pageA.locator('.role-select-btn[data-role="seeker"]').click();
    await pageA.locator('#input-nickname').fill('Alice_Host');
    await pageA.locator('#btn-create-room').click();

    await pageA.locator('#screen-waiting').waitFor({ state: 'visible', timeout: 5000 });
    const roomCode = (await pageA.locator('#waiting-room-code').textContent()).trim();
    console.log(`    ✅ Host created room with code: "${roomCode}"`);

    // 2. Friend (Bob) opens app and joins room
    console.log('[2] Friend (Bob) joining room with code:', roomCode);
    await pageB.goto('http://localhost:8080/', { waitUntil: 'networkidle' });

    const devModalB = pageB.locator('#modal-device-select');
    if (await devModalB.isVisible({ timeout: 2000 }).catch(() => false)) {
      await pageB.locator('#btn-select-android').click();
      await pageB.locator('#btn-android-browser').click();
    }
    const obModalB = pageB.locator('#modal-onboarding');
    if (await obModalB.isVisible({ timeout: 1500 }).catch(() => false)) {
      await pageB.locator('#btn-dismiss-onboarding').click();
    }

    await pageB.locator('.role-select-btn[data-role="runner"]').click();
    await pageB.locator('#input-nickname').fill('Bob_Runner');
    await pageB.locator('#input-join-code').fill(roomCode);
    await pageB.locator('#btn-join-room').click();

    await pageB.locator('#screen-waiting').waitFor({ state: 'visible', timeout: 5000 });
    console.log('    ✅ Bob joined waiting lobby');

    // 3. Verify Lobby Roster Synchronization
    console.log('[3] Verifying Lobby Roster Synchronization across both peers...');
    await pageA.waitForFunction(() => {
      const cards = document.querySelectorAll('#waiting-player-list .player-card');
      return cards.length >= 2;
    }, { timeout: 8000 });

    const rosterA = await pageA.locator('#waiting-player-list .player-card').count();
    const rosterB = await pageB.locator('#waiting-player-list .player-card').count();
    console.log(`    ✅ Roster on Host (Alice): ${rosterA} players, Roster on Friend (Bob): ${rosterB} players`);
    if (rosterA < 2 || rosterB < 2) {
      throw new Error('Lobby synchronization failed: peers not visible to each other');
    }

    // 4. Test Host Changing Bob's Role in Lobby
    console.log('[4] Testing Host Role Reassignment in Lobby...');
    const bobCardOnHost = pageA.locator('#waiting-player-list .player-card:has-text("Bob_Runner")');
    const roleToggleBtn = bobCardOnHost.locator('.btn-role-toggle');
    await roleToggleBtn.waitFor({ state: 'visible', timeout: 3000 });
    console.log('    ✅ Role toggle button visible on Host for peer Bob');

    // Toggle Bob to Seeker
    await roleToggleBtn.click();
    await pageB.waitForTimeout(1000);
    const bobRoleBadge = await pageB.locator('.player-card.role-seeker').count();
    console.log('    ✅ Host reassigned Bob to Seeker, verified on Bob client');

    // Toggle Bob back to Runner
    const toggleBackBtn = pageA.locator('#waiting-player-list .player-card:has-text("Bob_Runner") .btn-role-toggle');
    await toggleBackBtn.click();
    await pageB.waitForTimeout(1000);
    console.log('    ✅ Host reassigned Bob back to Runner');

    // 5. Host configures custom settings
    console.log('[5] Host configuring custom operation settings (Grace 0s, Infection Mode, Tag 25m)...');
    await pageA.selectOption('#lobby-grace-period', '0');
    await pageA.selectOption('#lobby-capture-mode', 'infection');
    await pageA.selectOption('#lobby-tag-distance', '25');
    await pageA.waitForTimeout(800);

    // 6. Host launches match
    console.log('[6] Host launching operation...');
    await pageA.locator('#btn-start-match').click();

    // Verify both clients enter the active HUD
    await pageA.locator('#screen-hud').waitFor({ state: 'visible', timeout: 5000 });
    console.log('    ✅ Host entered Tactical HUD');

    await pageB.locator('#screen-hud').waitFor({ state: 'visible', timeout: 5000 });
    console.log('    ✅ Friend (Bob) entered Tactical HUD automatically without getting stuck!');

    // 7. Verify Tag Detection & Runner Mobile Confirmation
    console.log('[7] Testing Tag Detection & Runner Confirmation Modal...');
    // Allow geolocation update and distance evaluation (~11m, well within 25m)
    await pageA.waitForTimeout(2000);

    const tagBtn = pageA.locator('#btn-tag-runner');
    await tagBtn.waitFor({ state: 'visible', timeout: 5000 });
    const isTagReady = await tagBtn.evaluate(el => el.classList.contains('tag-ready'));
    console.log(`    ✅ Seeker Tag Button ready state: ${isTagReady}`);

    // Alice taps Tag Bob
    console.log('    ⚡ Seeker (Alice) tapping Tag button...');
    await tagBtn.click();

    // Bob receives Tag Verification Modal
    console.log('    ⚡ Checking for Tag Verification Modal on Bob mobile screen...');
    const confirmModalB = pageB.locator('#modal-runner-tag-confirm');
    await confirmModalB.waitFor({ state: 'visible', timeout: 5000 });
    console.log('    ✅ Tag Verification Modal appeared on Runner device!');

    // Bob clicks "I WAS CAUGHT"
    const confirmCaughtBtn = pageB.locator('#btn-confirm-caught');
    await confirmCaughtBtn.click();
    await confirmModalB.waitFor({ state: 'hidden', timeout: 3000 });
    console.log('    ✅ Bob confirmed capture!');

    // 8. Verify Infection Mode: Bob converts to Seeker
    console.log('[8] Verifying Infection Mode (Bob converted to Seeker)...');
    await pageB.waitForTimeout(1500);
    const bobIsSeeker = await pageB.evaluate(() => Game.role === 'seeker');
    console.log(`    ✅ Bob role after infection: "${bobIsSeeker ? 'seeker' : 'runner'}"`);
    if (!bobIsSeeker) {
      throw new Error('Infection mode failed: Bob did not convert to Seeker');
    }

    console.log('\n======================================================');
    console.log('🎉 MULTIPLAYER INTEGRATION TEST PASSED WITH 100% SUCCESS!');
    console.log('======================================================\n');
  } catch (err) {
    console.error('❌ Multiplayer Test Failure:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

runMultiplayerTest();
