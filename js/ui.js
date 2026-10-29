/**
 * Manhunt Tactical UI, Audio Synthesizer & Sensory Manager
 * Delivers tactical HUD visuals, zero-dependency Web Audio sound effects,
 * vibration feedback, and smooth screen management.
 */
class UIManager {
  constructor() {
    this.audioCtx = null;
    this.currentScreen = 'screen-lobby';
  }

  init() {
    // Check if device is banned by Administrator
    try {
      if (localStorage.getItem('manhunt_banned') === 'true') {
        document.body.innerHTML = `
          <div style="background:#07090e; color:#ff4757; height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:24px; font-family:sans-serif;">
            <div style="font-size:3.5rem; margin-bottom:12px;">🚫</div>
            <h1 style="font-size:1.8rem; font-weight:900; letter-spacing:0.05em; margin-bottom:8px;">ACCESS RESTRICTED</h1>
            <p style="color:#94a3b8; max-width:380px; font-size:0.9rem; line-height:1.5;">This device has been permanently suspended from the Manhunt operations network by a System Administrator.</p>
          </div>
        `;
        return;
      }
    } catch (e) {}

    this.bindEvents();
    this.populateSettingsUI();
    Config.applyTheme();

    // Check for room code in URL query string (deep-linking)
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      const joinInput = document.getElementById('input-join-code');
      if (joinInput) joinInput.value = roomParam.toUpperCase();
    }

    // Check device readiness & battery optimization
    this.checkOnboardingReadiness();
  }

  isInstalledApk() {
    return (
      window.IS_ANDROID_APK === true ||
      window.location.protocol === 'file:' ||
      window.location.href.includes('android_asset') ||
      !!window.AndroidNative ||
      (typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.includes('wv')) ||
      (typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.includes('Android') && /Version\/[0-9.]+/i.test(navigator.userAgent))
    );
  }

  isAppEnvironment() {
    return (
      this.isInstalledApk() ||
      (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      (typeof navigator !== 'undefined' && window.navigator.standalone === true)
    );
  }

  checkOnboardingReadiness() {
    // If inside the installed APK or standalone app, NEVER prompt for Android/iPhone selection
    if (this.isAppEnvironment()) {
      localStorage.setItem('manhunt_device_platform_v2', 'android');
      const onboarded = localStorage.getItem('manhunt_onboarded_v2');
      if (!onboarded) {
        setTimeout(() => {
          this.showModal('modal-onboarding');
        }, 150);
      }
      this.refreshReadinessBadges();
      if (window.AndroidNative && window.AndroidNative.requestLocationPermissions) {
        window.AndroidNative.requestLocationPermissions();
      }
      return;
    }

    // Only for web visitors on desktop/Safari who haven't selected their device yet
    if (!localStorage.getItem('manhunt_device_platform_v2')) {
      setTimeout(() => {
        this.openPlatformModal();
      }, 400);
      return;
    }

    const onboarded = localStorage.getItem('manhunt_onboarded_v2');
    if (!onboarded) {
      setTimeout(() => {
        this.showModal('modal-onboarding');
      }, 500);
    }
    this.refreshReadinessBadges();
  }

  openPlatformModal() {
    // If running in the installed APK or standalone app, immediately abort
    if (this.isAppEnvironment()) return;

    const stepChoose = document.getElementById('device-step-choose');
    const stepAndroid = document.getElementById('device-step-android');
    const stepIos = document.getElementById('device-step-ios');
    const toast = document.getElementById('android-download-toast');

    if (stepChoose) stepChoose.style.display = 'block';
    if (stepAndroid) stepAndroid.style.display = 'none';
    if (stepIos) stepIos.style.display = 'none';
    if (toast) toast.style.display = 'none';

    this.showModal('modal-device-select');
  }

  refreshReadinessBadges() {
    if (window.AndroidNative && window.AndroidNative.checkPermissionsStatus) {
      try {
        const status = JSON.parse(window.AndroidNative.checkPermissionsStatus());
        const gpsItem = document.getElementById('readiness-item-gps');
        const gpsBtn = document.getElementById('btn-grant-gps');
        if (gpsItem && gpsBtn && status.location) {
          gpsItem.classList.add('granted');
          gpsBtn.classList.add('granted-badge');
          gpsBtn.textContent = status.backgroundLocation ? 'ALWAYS GRANTED' : 'GRANTED';
        }

        const battItem = document.getElementById('readiness-item-battery');
        const battBtn = document.getElementById('btn-grant-battery');
        if (battItem && battBtn && status.battery) {
          battItem.classList.add('granted');
          battBtn.classList.add('granted-badge');
          battBtn.textContent = 'EXEMPTED';
        }

        const notifItem = document.getElementById('readiness-item-notifs');
        const notifBtn = document.getElementById('btn-grant-notifs');
        if (notifItem && notifBtn && status.notifications) {
          notifItem.classList.add('granted');
          notifBtn.classList.add('granted-badge');
          notifBtn.textContent = 'ALLOWED';
        }
      } catch (e) {}
    }
  }

  showModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.style.display = 'flex';
  }

  closeModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.style.display = 'none';
  }

  /**
   * Lazily initialize Web Audio Context on first user tap & request iOS orientation
   */
  getAudioContext() {
    if (typeof Geo !== 'undefined' && Geo.requestIosCompassPermission) {
      Geo.requestIosCompassPermission();
    }
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  /**
   * Screen Wake Lock API (prevents iPhone & Android screens from sleeping during match)
   */
  async requestWakeLock() {
    if (!Config.settings.wakeLockEnabled) return;
    if ('wakeLock' in navigator) {
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
      } catch (e) {}
    }
  }

  releaseWakeLock() {
    if (this.wakeLock) {
      try {
        this.wakeLock.release();
        this.wakeLock = null;
      } catch (e) {}
    }
  }

  /**
   * Synthesize high-tech tactical audio cues using standard Web Audio oscillators
   */
  playAudioCue(type) {
    if (!Config.settings.soundEnabled) return;
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'ping' || type === 'radar-blip') {
        // Sonar ping
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(1760, now + 0.15);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
        osc.start(now);
        osc.stop(now + 0.4);
      } else if (type === 'warning') {
        // Double alert pulse
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.setValueAtTime(420, now + 0.1);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
      } else if (type === 'tag') {
        // Heavy impact tone
        osc.type = 'square';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.3);
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.35);
      } else if (type === 'siren' || type === 'start') {
        // Ascending alert
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.linearRampToValueAtTime(900, now + 0.5);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
        osc.start(now);
        osc.stop(now + 0.6);
      } else if (type === 'victory') {
        // Chime sequence
        [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
          const noteOsc = ctx.createOscillator();
          const noteGain = ctx.createGain();
          noteOsc.connect(noteGain);
          noteGain.connect(ctx.destination);
          noteOsc.frequency.setValueAtTime(freq, now + i * 0.12);
          noteGain.gain.setValueAtTime(0.25, now + i * 0.12);
          noteGain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.4);
          noteOsc.start(now + i * 0.12);
          noteOsc.stop(now + i * 0.12 + 0.4);
        });
      }
    } catch (e) {
      console.warn('Audio synthesis error:', e);
    }
  }

  /**
   * Device vibration feedback
   */
  vibrate(pattern = [100, 50, 100]) {
    if (!Config.settings.vibrationEnabled) return;
    if ('vibrate' in navigator) {
      try { navigator.vibrate(pattern); } catch (e) {}
    }
  }

  showScreen(screenId) {
    document.querySelectorAll('.app-screen').forEach(screen => {
      screen.classList.remove('active');
    });
    const target = document.getElementById(screenId);
    if (target) {
      target.classList.add('active');
      this.currentScreen = screenId;
    }
  }

  setRoomCodeDisplay(code) {
    const el = document.getElementById('waiting-room-code');
    if (el) el.textContent = code;
  }

  updateConnectionBadge(isConnected, broker = '') {
    const badge = document.getElementById('status-connection');
    if (!badge) return;

    if (isConnected) {
      if (this.disconnectBadgeTimer) {
        clearTimeout(this.disconnectBadgeTimer);
        this.disconnectBadgeTimer = null;
      }
      const brokerShort = broker.includes('hivemq') ? 'HIVEMQ' : (broker.includes('emqx') ? 'EMQX' : 'RELAY');
      const count = (typeof Network !== 'undefined' && Network.peers) ? Network.peers.size + 1 : 1;
      badge.textContent = `● ${brokerShort} (${count}P)`;
      badge.className = 'status-badge status-online';
    } else {
      // Debounce brief socket reconnects so players never see momentary "CONNECTING..." flicker
      if (!this.disconnectBadgeTimer) {
        this.disconnectBadgeTimer = setTimeout(() => {
          badge.textContent = 'CONNECTING...';
          badge.className = 'status-badge status-offline';
          this.disconnectBadgeTimer = null;
        }, 3000);
      }
    }
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 400);
    }, 3200);
  }

  /**
   * Dispatch notification for critical match state changes
   * (runner caught, infection, role assigned, out-of-bounds, match launch)
   */
  notifyCriticalEvent(title, message, toastType = 'danger') {
    this.showToast(message, toastType);
    if (window.AndroidNative && typeof window.AndroidNative.showNotification === 'function') {
      try {
        window.AndroidNative.showNotification(title, message);
      } catch (e) {
        console.warn('AndroidNative notification error:', e);
      }
    } else if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      try {
        new Notification(title, { body: message, icon: './assets/icon-192.png' });
      } catch (e) {}
    }
  }

  showBoundaryPromptModal() {
    const promptRadius = document.getElementById('prompt-boundary-radius');
    if (promptRadius) {
      promptRadius.value = (Config.settings.boundaryRadiusMeters || 1500).toString();
    }
    const coordsEl = document.getElementById('boundary-anchor-coords');
    if (coordsEl) {
      if (Game.lastSelfCoords) {
        coordsEl.textContent = `📍 Anchor Center: ${Game.lastSelfCoords.lat.toFixed(5)}, ${Game.lastSelfCoords.lng.toFixed(5)} (Your GPS)`;
      } else {
        coordsEl.textContent = '📍 Anchor Center: Acquiring GPS fix...';
      }
    }
    this.showModal('modal-boundary-confirm');
  }

  setOutOfBoundsState(isOOB, metersOut = 0) {
    const banner = document.getElementById('hud-oob-banner');
    const distEl = document.getElementById('hud-oob-distance');
    if (!banner) return;
    if (isOOB) {
      banner.style.display = 'block';
      if (distEl) distEl.textContent = `${metersOut}m OUT`;
    } else {
      banner.style.display = 'none';
    }
  }

  startFlareCooldown(seconds) {
    const btn = document.getElementById('btn-panic-ping');
    if (!btn) return;
    btn.classList.add('btn-cooldown');
    btn.disabled = true;
    let remaining = seconds;
    btn.innerHTML = `<span>⏳</span> ${remaining}s`;

    if (this.flareInterval) clearInterval(this.flareInterval);
    this.flareInterval = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(this.flareInterval);
        this.flareInterval = null;
        btn.classList.remove('btn-cooldown');
        btn.disabled = false;
        btn.innerHTML = `<span>📍</span> Flare`;
      } else {
        btn.innerHTML = `<span>⏳</span> ${remaining}s`;
      }
    }, 1000);
  }

  resetMatchUI() {
    const roster = document.getElementById('waiting-player-list');
    if (roster) roster.innerHTML = '';

    const targets = document.getElementById('target-selection-list');
    if (targets) targets.innerHTML = '';

    const forceTags = document.getElementById('host-force-tag-list');
    if (forceTags) forceTags.innerHTML = '';

    const distVal = document.getElementById('radar-distance-value');
    if (distVal) distVal.textContent = '--';

    const targetName = document.getElementById('radar-target-name');
    if (targetName) targetName.textContent = 'SCANNING SENSORS...';

    const arrow = document.getElementById('radar-direction-arrow');
    if (arrow) arrow.style.transform = 'rotate(0deg)';

    const oobBanner = document.getElementById('hud-oob-banner');
    if (oobBanner) oobBanner.style.display = 'none';

    const pauseOverlay = document.getElementById('hud-paused-overlay');
    if (pauseOverlay) pauseOverlay.style.display = 'none';

    const graceBanner = document.getElementById('grace-period-banner');
    if (graceBanner) graceBanner.style.display = 'none';

    const countBadge = document.getElementById('roster-count-badge');
    if (countBadge) countBadge.textContent = '1 SQUAD MEMBER';

    const targetPill = document.getElementById('btn-target-selector');
    if (targetPill) targetPill.innerHTML = '<span>🎯</span> TARGET: AUTO';

    const tagBtn = document.getElementById('btn-tag-runner');
    if (tagBtn) {
      tagBtn.disabled = true;
      tagBtn.classList.remove('tag-ready');
      tagBtn.innerHTML = `🎯 TAG RUNNER (RANGE: ${Config.settings.tagDistanceMeters}m)`;
    }

    ['modal-host-controls', 'modal-boundary-confirm', 'modal-runner-tag-confirm', 'modal-captured', 'modal-target-selector', 'modal-ingame-settings'].forEach(m => {
      this.closeModal(m);
    });
  }

  renderLobbyRoster(players, isHost) {
    const container = document.getElementById('waiting-player-list');
    if (!container) return;
    container.innerHTML = '';

    const countBadge = document.getElementById('roster-count-badge');
    if (countBadge) {
      const total = players.length;
      const runners = players.filter(p => p.role === 'runner').length;
      const seekers = players.filter(p => p.role === 'seeker').length;
      countBadge.textContent = `${total} SQUAD (${runners}R / ${seekers}S)`;
    }

    players.forEach(p => {
      const isSelf = p.id === Network.playerId;
      const item = document.createElement('div');
      item.className = `player-card role-${p.role}`;

      let actionsHtml = '';
      if (isHost && !isSelf) {
        const nextRole = p.role === 'runner' ? 'seeker' : 'runner';
        const nextRoleLabel = nextRole === 'seeker' ? 'SET SEEKER' : 'SET RUNNER';
        actionsHtml = `
          <button type="button" class="btn-role-toggle" onclick="Game.setPlayerRoleByHost('${p.id}', '${nextRole}')">
            <span>🔄</span> ${nextRoleLabel}
          </button>
        `;
      }

      item.innerHTML = `
        <div class="player-info">
          <span class="player-role-badge">${p.role.toUpperCase()}</span>
          <span class="player-name">${p.nickname}</span>
        </div>
        <div class="player-card-actions">
          ${p.isHost ? '<span class="host-badge">HOST</span>' : ''}
          ${actionsHtml}
        </div>
      `;
      container.appendChild(item);
    });

    // Toggle Host Rules Config vs Participant View
    const hostCard = document.getElementById('lobby-host-config-card');
    const participantCard = document.getElementById('lobby-participant-rules-card');
    if (hostCard) hostCard.style.display = isHost ? 'block' : 'none';
    if (participantCard) participantCard.style.display = isHost ? 'none' : 'block';

    this.updateLobbyRulesDisplay(Config.settings);

    // Update start match button for host
    const startBtn = document.getElementById('btn-start-match');
    if (startBtn) {
      startBtn.style.display = isHost ? 'block' : 'none';
    }
    const waitingText = document.getElementById('waiting-for-host-text');
    if (waitingText) {
      waitingText.style.display = isHost ? 'none' : 'block';
    }
  }

  updateLobbyRulesDisplay(settings) {
    // Populate host dropdowns
    const seekerModeSel = document.getElementById('lobby-seeker-mode');
    if (seekerModeSel && settings.seekerTrackingMode) seekerModeSel.value = settings.seekerTrackingMode;

    const runnerIntervalSel = document.getElementById('lobby-runner-interval');
    if (runnerIntervalSel && settings.runnerPingInterval) runnerIntervalSel.value = settings.runnerPingInterval;

    const graceSel = document.getElementById('lobby-grace-period');
    if (graceSel && settings.gracePeriod !== undefined) graceSel.value = settings.gracePeriod;

    const durationSel = document.getElementById('lobby-match-duration');
    if (durationSel && settings.gameDuration !== undefined) durationSel.value = settings.gameDuration;

    const tagDistSel = document.getElementById('lobby-tag-distance');
    if (tagDistSel && settings.tagDistanceMeters !== undefined) tagDistSel.value = settings.tagDistanceMeters;

    const captureModeSel = document.getElementById('lobby-capture-mode');
    if (captureModeSel && settings.runnerCaptureMode) captureModeSel.value = settings.runnerCaptureMode;

    const tagConfirmSel = document.getElementById('lobby-tag-confirm');
    if (tagConfirmSel && settings.requireTagConfirmation !== undefined) tagConfirmSel.value = String(settings.requireTagConfirmation);

    const boundarySel = document.getElementById('lobby-boundary');
    if (boundarySel && settings.boundaryRadiusMeters !== undefined) boundarySel.value = settings.boundaryRadiusMeters;

    const flareCooldownSel = document.getElementById('lobby-flare-cooldown');
    if (flareCooldownSel && settings.flareCooldownSeconds !== undefined) flareCooldownSel.value = settings.flareCooldownSeconds;

    // Update participant badges
    const chipSeeker = document.getElementById('chip-seeker-mode');
    if (chipSeeker) {
      chipSeeker.textContent = `SEEKER: ${settings.seekerTrackingMode === 'live' ? 'LIVE (2S)' : Math.round(parseInt(settings.seekerTrackingMode, 10)/60) + 'M PING'}`;
    }

    const chipRunner = document.getElementById('chip-runner-ping');
    if (chipRunner) {
      chipRunner.textContent = `RUNNER PING: ${Math.round(settings.runnerPingInterval / 60)}M`;
    }

    const chipFlare = document.getElementById('chip-flare-cooldown');
    if (chipFlare) {
      const fc = settings.flareCooldownSeconds !== undefined ? settings.flareCooldownSeconds : 60;
      chipFlare.textContent = `FLARE: ${fc >= 60 ? (fc % 60 === 0 ? (fc / 60) + 'M' : (fc / 60).toFixed(1) + 'M') : fc + 'S'}`;
    }

    const chipGrace = document.getElementById('chip-grace-period');
    if (chipGrace) {
      chipGrace.textContent = `GRACE: ${settings.gracePeriod === 0 ? 'INSTANT' : Math.round(settings.gracePeriod / 60) + 'M'}`;
    }

    const chipDuration = document.getElementById('chip-match-duration');
    if (chipDuration) {
      chipDuration.textContent = `DURATION: ${settings.gameDuration === 0 ? 'UNLIMITED' : Math.round(settings.gameDuration / 60) + 'M'}`;
    }

    const chipTag = document.getElementById('chip-tag-distance');
    if (chipTag) {
      chipTag.textContent = `TAG: ${settings.tagDistanceMeters || 15}M`;
    }

    const chipMode = document.getElementById('chip-capture-mode');
    if (chipMode) {
      chipMode.textContent = `MODE: ${(settings.runnerCaptureMode || 'infection').toUpperCase()}`;
    }

    const chipBoundary = document.getElementById('chip-boundary');
    if (chipBoundary) {
      chipBoundary.textContent = `BOUNDARY: ${settings.boundaryRadiusMeters === 0 ? 'OFF' : (settings.boundaryRadiusMeters >= 1000 ? (settings.boundaryRadiusMeters / 1000) + 'KM' : settings.boundaryRadiusMeters + 'M')}`;
    }
  }

  updateHostButtons(isHost) {
    const hostBtn = document.getElementById('btn-host-controls');
    if (hostBtn) {
      hostBtn.style.display = isHost ? 'inline-flex' : 'none';
    }
    const hostStatusBadge = document.getElementById('host-match-status-badge');
    if (hostStatusBadge) {
      hostStatusBadge.textContent = Game.isPaused ? 'PAUSED' : 'ACTIVE';
      hostStatusBadge.className = `host-stat-val ${Game.isPaused ? 'val-amber' : 'val-green'}`;
    }
    const squadCount = document.getElementById('host-squad-count');
    if (squadCount) {
      const count = Network.peers.size + 1;
      squadCount.textContent = `${count} PLAYERS`;
    }
    const boundaryVal = document.getElementById('host-boundary-val');
    if (boundaryVal) {
      const bMeters = Config.settings.boundaryRadiusMeters;
      boundaryVal.textContent = bMeters >= 1000 ? `${(bMeters / 1000).toFixed(1)}KM` : `${bMeters}M`;
    }
  }

  setPauseState(isPaused, isHost = false) {
    const overlay = document.getElementById('hud-paused-overlay');
    if (overlay) overlay.style.display = isPaused ? 'flex' : 'none';

    const resumeBtnContainer = document.getElementById('paused-host-resume-container');
    if (resumeBtnContainer) resumeBtnContainer.style.display = (isPaused && isHost) ? 'block' : 'none';

    const icon = document.getElementById('host-pause-icon');
    const title = document.getElementById('host-pause-title');
    if (icon) icon.textContent = isPaused ? '▶️' : '⏸️';
    if (title) title.textContent = isPaused ? 'RESUME OPERATION' : 'PAUSE OPERATION';

    const hostStatusBadge = document.getElementById('host-match-status-badge');
    if (hostStatusBadge) {
      hostStatusBadge.textContent = isPaused ? 'PAUSED' : 'ACTIVE';
      hostStatusBadge.className = `host-stat-val ${isPaused ? 'val-amber' : 'val-green'}`;
    }
  }

  setGracePeriodState(isActive, remainingSeconds = 0, role = 'runner') {
    const banner = document.getElementById('grace-period-banner');
    if (!banner) return;
    if (isActive) {
      banner.style.display = 'flex';
      const label = banner.querySelector('.grace-role-label');
      if (label) {
        label.textContent = role === 'seeker'
          ? 'STANDBY: Runners have a head start! Wait for timer.'
          : 'RUN! You have a head start to scatter before seekers release!';
      }
      this.updateGraceCountdown(remainingSeconds);
    } else {
      banner.style.display = 'none';
    }
  }

  updateGraceCountdown(seconds) {
    const timer = document.getElementById('grace-countdown-timer');
    if (timer) {
      const m = Math.floor(seconds / 60).toString().padStart(2, '0');
      const s = (seconds % 60).toString().padStart(2, '0');
      timer.textContent = `${m}:${s}`;
    }
  }

  updateMatchTimeRemaining(seconds) {
    const el = document.getElementById('hud-game-timer');
    if (el) {
      const m = Math.floor(seconds / 60).toString().padStart(2, '0');
      const s = (seconds % 60).toString().padStart(2, '0');
      el.textContent = `${m}:${s}`;
    }
  }

  updatePingCountdown(remaining, totalInterval, role) {
    const el = document.getElementById('hud-ping-timer');
    const bar = document.getElementById('hud-ping-progress');
    if (el) {
      const m = Math.floor(remaining / 60).toString().padStart(2, '0');
      const s = (remaining % 60).toString().padStart(2, '0');
      el.textContent = `${m}:${s}`;
    }
    if (bar && totalInterval > 0) {
      const percent = Math.max(0, Math.min(100, (remaining / totalInterval) * 100));
      bar.style.width = `${percent}%`;
    }
  }

  updateProximityHUD(distanceMeters, bearingDegrees, opponentInfo, isLocked = false) {
    const distEl = document.getElementById('radar-distance-value');
    const dirEl = document.getElementById('radar-direction-arrow');
    const nameEl = document.getElementById('radar-target-name');
    const subheadEl = document.querySelector('.radar-subhead');

    if (subheadEl) {
      if (isLocked) {
        subheadEl.textContent = '🔒 LOCKED TARGET';
        subheadEl.style.color = 'var(--theme-accent-cyan)';
      } else {
        subheadEl.textContent = Game.role === 'seeker' ? 'CLOSEST RUNNER (AUTO)' : 'CLOSEST PURSUER';
        subheadEl.style.color = 'var(--theme-text-secondary)';
      }
    }

    if (distanceMeters === null) {
      if (distEl) distEl.textContent = '--';
      if (nameEl) nameEl.textContent = 'SCANNING FOR SIGNALS...';
      if (dirEl) dirEl.style.transform = 'rotate(0deg)';
      return;
    }

    if (distEl) distEl.textContent = GeoEngine.formatDistance(distanceMeters);
    if (nameEl && opponentInfo) nameEl.textContent = `${opponentInfo.nickname.toUpperCase()}`;
    if (dirEl) {
      dirEl.style.transform = `rotate(${bearingDegrees}deg)`;
    }
  }

  renderTargetList(targets, lockedId) {
    const selectorPill = document.getElementById('btn-target-selector');
    if (selectorPill) {
      if (Game.role === 'seeker' && (Game.state === 'ACTIVE' || Game.state === 'GRACE_PERIOD')) {
        selectorPill.style.display = 'flex';
        const lockedTarget = targets.find(t => t.id === lockedId);
        selectorPill.innerHTML = `🎯 TARGET: ${lockedTarget ? lockedTarget.nickname.toUpperCase() : 'AUTO'}`;
      } else {
        selectorPill.style.display = 'none';
      }
    }

    const container = document.getElementById('target-selection-list');
    if (!container) return;
    container.innerHTML = '';

    // Auto option (closest runner)
    const autoCard = document.createElement('div');
    autoCard.className = `target-card ${lockedId === null ? 'locked' : ''}`;
    autoCard.innerHTML = `
      <div>
        <div style="font-weight:800; font-size:0.9rem;">Auto: Closest Runner</div>
        <div style="font-size:0.75rem; color:var(--theme-text-secondary);">Dynamic lock onto the nearest target</div>
      </div>
      <span class="status-badge ${lockedId === null ? 'status-online' : ''}">${lockedId === null ? 'ACTIVE' : 'SELECT'}</span>
    `;
    autoCard.onclick = () => {
      Game.selectTarget(null);
      this.closeModal('modal-target-selector');
    };
    container.appendChild(autoCard);

    // List each runner
    targets.forEach(t => {
      const isLocked = t.id === lockedId;
      const card = document.createElement('div');
      card.className = `target-card ${isLocked ? 'locked' : ''}`;
      card.innerHTML = `
        <div>
          <div style="font-weight:800; font-size:0.9rem;">${t.nickname}</div>
          <div style="font-size:0.75rem; color:var(--theme-text-secondary);">${GeoEngine.formatDistance(t.distance)} | ${GeoEngine.getCardinalDirection(t.bearing)} (${Math.round(t.bearing)}°)</div>
        </div>
        <span class="status-badge ${isLocked ? 'status-online' : ''}">${isLocked ? 'LOCKED' : 'LOCK ON'}</span>
      `;
      card.onclick = () => {
        Game.selectTarget(t.id, t.nickname);
        this.closeModal('modal-target-selector');
      };
      container.appendChild(card);
    });
  }

  updateTagButtonState(tagCandidate) {
    const tagBtn = document.getElementById('btn-tag-runner');
    if (!tagBtn) return;

    if (tagCandidate) {
      tagBtn.disabled = false;
      tagBtn.classList.add('tag-ready');
      tagBtn.innerHTML = `🎯 TAG ${tagCandidate.nickname.toUpperCase()} (${Math.round(tagCandidate.distance)}m)`;
      tagBtn.onclick = () => {
        Game.tagRunner(tagCandidate.id, tagCandidate.nickname);
      };
    } else {
      tagBtn.disabled = true;
      tagBtn.classList.remove('tag-ready');
      tagBtn.innerHTML = `🎯 TAG RUNNER (RANGE: ${Config.settings.tagDistanceMeters}m)`;
      tagBtn.onclick = null;
    }
  }

  triggerProximityAlert(distanceMeters, directionText) {
    this.playAudioCue('warning');
    this.vibrate([200, 100, 200]);
    this.showToast(`⚠️ SEEKER DETECTED! ${Math.round(distanceMeters)}m away (${directionText})!`, 'danger');
  }

  triggerPingPulseAnimation() {
    const pulseRing = document.getElementById('radar-ping-ring');
    if (pulseRing) {
      pulseRing.classList.remove('pulse-active');
      void pulseRing.offsetWidth; // Trigger reflow
      pulseRing.classList.add('pulse-active');
    }
  }

  showCapturedModal() {
    const modal = document.getElementById('modal-captured');
    if (modal) modal.style.display = 'flex';
  }

  showRunnerTagConfirmModal(seekerName, distanceMeters) {
    const nameEl = document.getElementById('tag-confirm-seeker-name');
    if (nameEl) nameEl.textContent = seekerName || 'Seeker';
    const distEl = document.getElementById('tag-confirm-distance');
    if (distEl) distEl.textContent = `${Math.round(distanceMeters || Config.settings.tagDistanceMeters)}m`;

    this.playAudioCue('siren');
    this.vibrate([300, 150, 300, 150, 400]);
    this.showModal('modal-runner-tag-confirm');
  }

  adaptHUDForRole(role) {
    const isSeeker = role === 'seeker';
    const tagBtn = document.getElementById('btn-tag-runner');
    if (tagBtn) tagBtn.style.display = isSeeker ? 'block' : 'none';

    const selectorPill = document.getElementById('btn-target-selector');
    if (selectorPill) selectorPill.style.display = isSeeker ? 'flex' : 'none';

    const openTargetsBtn = document.getElementById('btn-open-targets');
    if (openTargetsBtn) openTargetsBtn.style.display = 'flex';

    const flareBtn = document.getElementById('btn-panic-ping');
    if (flareBtn) flareBtn.style.display = isSeeker ? 'none' : 'flex';

    const radarContainer = document.querySelector('.radar-container');
    if (radarContainer) {
      if (isSeeker) {
        radarContainer.classList.add('seeker-radar');
      } else {
        radarContainer.classList.remove('seeker-radar');
      }
    }
  }

  showGameOverScreen(data) {
    // Close all open modals when transitioning to Game Over
    ['modal-runner-tag-confirm', 'modal-captured', 'modal-host-controls', 'modal-target-selector', 'modal-ingame-settings'].forEach(m => {
      this.closeModal(m);
    });

    this.showScreen('screen-gameover');
    const winnerEl = document.getElementById('gameover-winner');
    const descEl = document.getElementById('gameover-desc');
    const statsEl = document.getElementById('gameover-stats');

    if (winnerEl) winnerEl.textContent = `${data.winner.toUpperCase()} VICTORIOUS!`;
    if (descEl) descEl.textContent = data.message;
    if (statsEl) {
      const mins = Math.floor(data.duration / 60);
      const secs = data.duration % 60;
      statsEl.innerHTML = `
        <div class="stat-item"><span class="stat-num">${mins}m ${secs}s</span><span class="stat-lbl">Duration</span></div>
        <div class="stat-item"><span class="stat-num">${data.taggedCount} / ${data.totalRunners}</span><span class="stat-lbl">Runners Caught</span></div>
      `;
    }
  }

  populateSettingsUI() {
    // Ping Interval select
    const pingSelect = document.getElementById('setting-ping-interval');
    if (pingSelect) pingSelect.value = Config.settings.runnerPingInterval;

    // Grace Period select
    const graceSelect = document.getElementById('setting-grace-period');
    if (graceSelect) graceSelect.value = Config.settings.gracePeriod;

    // Game Duration select
    const durationSelect = document.getElementById('setting-game-duration');
    if (durationSelect) durationSelect.value = Config.settings.gameDuration;

    // Tag Distance select
    const tagSelect = document.getElementById('setting-tag-distance');
    if (tagSelect) tagSelect.value = Config.settings.tagDistanceMeters;

    // Post-Catch Mode select
    const captureSelect = document.getElementById('setting-capture-mode');
    if (captureSelect) captureSelect.value = Config.settings.runnerCaptureMode || 'infection';

    // Tag Confirm select
    const confirmSelect = document.getElementById('setting-tag-confirm');
    if (confirmSelect) confirmSelect.value = String(Config.settings.requireTagConfirmation !== false);

    // Proximity Alarm Distance select
    const proxSelect = document.getElementById('setting-proximity-distance');
    if (proxSelect) proxSelect.value = Config.settings.proximityAlertMeters !== undefined ? Config.settings.proximityAlertMeters : 100;

    // Boundary select
    const boundarySelect = document.getElementById('setting-boundary');
    if (boundarySelect) boundarySelect.value = Config.settings.boundaryRadiusMeters;

    // Toggles
    const soundToggle = document.getElementById('setting-sound');
    if (soundToggle) soundToggle.checked = Config.settings.soundEnabled;

    const vibToggle = document.getElementById('setting-vibration');
    if (vibToggle) vibToggle.checked = Config.settings.vibrationEnabled;

    const simToggle = document.getElementById('setting-simulation');
    if (simToggle) simToggle.checked = Simulation.isActive;

    // Render Theme Choices
    const themeGrid = document.getElementById('theme-picker-grid');
    if (themeGrid) {
      themeGrid.innerHTML = '';
      THEMES.forEach(t => {
        const isSelected = Config.settings.theme === t.id;
        const card = document.createElement('div');
        card.className = `theme-choice-card ${isSelected ? 'selected' : ''}`;
        card.style.borderColor = isSelected ? t.primary : 'rgba(255,255,255,0.1)';
        card.innerHTML = `
          <div class="theme-card-left">
            <div class="theme-name">${t.name}</div>
            <div class="theme-desc">${t.description}</div>
          </div>
          <div class="theme-color-dots">
            <span class="dot" style="background:${t.primary}"></span>
            <span class="dot" style="background:${t.bg}; border:1px solid rgba(255,255,255,0.2)"></span>
          </div>
        `;
        card.onclick = () => {
          Config.save({ theme: t.id });
          MapController.applyTileStyle();
          this.populateSettingsUI();
          this.showToast(`Theme changed to ${t.name}`, 'info');
        };
        themeGrid.appendChild(card);
      });
    }
  }

  bindEvents() {
    // Role selection in lobby
    document.querySelectorAll('.role-select-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.role-select-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        const role = btn.dataset.role;
        Game.role = role;
      };
    });

    // Create Room
    const createBtn = document.getElementById('btn-create-room');
    if (createBtn) {
      createBtn.onclick = () => {
        this.getAudioContext();
        const nickname = document.getElementById('input-nickname').value || 'Hunter';
        Game.createRoom(nickname, Game.role);
      };
    }

    // Join Room
    const joinBtn = document.getElementById('btn-join-room');
    if (joinBtn) {
      joinBtn.onclick = () => {
        this.getAudioContext();
        const nickname = document.getElementById('input-nickname').value || 'Scout';
        const code = document.getElementById('input-join-code').value;
        if (!code) {
          this.showToast('Please enter a 4-letter room code', 'warning');
          return;
        }
        Game.joinRoom(code, nickname, Game.role);
      };
    }

    // Host Start Match
    const startMatchBtn = document.getElementById('btn-start-match');
    if (startMatchBtn) {
      startMatchBtn.onclick = () => {
        Game.startMatch();
      };
    }

    // Modal Boundary Confirm / Host Launch Prompts
    const cancelBoundaryBtn = document.getElementById('btn-cancel-boundary-confirm');
    if (cancelBoundaryBtn) {
      cancelBoundaryBtn.onclick = () => this.closeModal('modal-boundary-confirm');
    }

    const confirmStartMatchBtn = document.getElementById('btn-confirm-start-match');
    if (confirmStartMatchBtn) {
      confirmStartMatchBtn.onclick = () => {
        const radiusSel = document.getElementById('prompt-boundary-radius');
        const radius = radiusSel ? parseInt(radiusSel.value, 10) : Config.settings.boundaryRadiusMeters;
        this.closeModal('modal-boundary-confirm');
        Game.confirmAndLaunchMatch(radius);
      };
    }

    // Copy Room Code / Share
    const copyBtn = document.getElementById('btn-copy-room');
    if (copyBtn) {
      copyBtn.onclick = () => {
        if (Game.roomCode) {
          navigator.clipboard.writeText(Game.roomCode).then(() => {
            this.showToast(`Room code ${Game.roomCode} copied to clipboard!`, 'info');
          }).catch(() => {
            this.showToast(`Room code: ${Game.roomCode}`, 'info');
          });
        }
      };
    }

    // Recenter Map
    const recenterBtn = document.getElementById('btn-recenter');
    if (recenterBtn) {
      recenterBtn.onclick = () => {
        MapController.recenter();
      };
    }

    // Fit All Map
    const fitAllBtn = document.getElementById('btn-fit-all');
    if (fitAllBtn) {
      fitAllBtn.onclick = () => {
        MapController.fitAll();
      };
    }

    // Floating Map Zoom & Fit Controls
    const zoomInBtn = document.getElementById('btn-zoom-in');
    if (zoomInBtn) zoomInBtn.onclick = () => MapController.zoomIn();

    const zoomOutBtn = document.getElementById('btn-zoom-out');
    if (zoomOutBtn) zoomOutBtn.onclick = () => MapController.zoomOut();

    const fitAllFloatBtn = document.getElementById('btn-fit-all-float');
    if (fitAllFloatBtn) fitAllFloatBtn.onclick = () => MapController.fitAll();

    // Lobby Host Rules Real-time Sync
    const handleLobbyConfigChange = () => {
      if (!Game.isHost) return;
      const seekerMode = document.getElementById('lobby-seeker-mode').value;
      const runnerInterval = parseInt(document.getElementById('lobby-runner-interval').value, 10);
      const gracePeriod = parseInt(document.getElementById('lobby-grace-period').value, 10);
      const matchDuration = parseInt(document.getElementById('lobby-match-duration').value, 10);
      const tagDistance = parseInt(document.getElementById('lobby-tag-distance').value, 10);
      const captureMode = document.getElementById('lobby-capture-mode').value;
      const tagConfirm = document.getElementById('lobby-tag-confirm').value === 'true';
      const boundary = parseInt(document.getElementById('lobby-boundary').value, 10);
      const flareCooldown = parseInt(document.getElementById('lobby-flare-cooldown')?.value, 10) || 60;

      const updated = {
        seekerTrackingMode: seekerMode,
        runnerPingInterval: runnerInterval,
        gracePeriod: gracePeriod,
        gameDuration: matchDuration,
        tagDistanceMeters: tagDistance,
        runnerCaptureMode: captureMode,
        requireTagConfirmation: tagConfirm,
        boundaryRadiusMeters: boundary,
        flareCooldownSeconds: flareCooldown
      };

      Config.save(updated);
      this.updateLobbyRulesDisplay(updated);
      Network.broadcast('settings_sync', updated, true);
      this.showToast('Tactical rules updated for squad', 'info');
    };

    ['lobby-seeker-mode', 'lobby-runner-interval', 'lobby-grace-period', 'lobby-match-duration', 'lobby-tag-distance', 'lobby-capture-mode', 'lobby-tag-confirm', 'lobby-boundary', 'lobby-flare-cooldown'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.onchange = handleLobbyConfigChange;
    });

    // Host Mission Control HUD & Modal
    const hostControlsBtn = document.getElementById('btn-host-controls');
    if (hostControlsBtn) hostControlsBtn.onclick = () => this.showModal('modal-host-controls');

    const closeHostControlsBtn = document.getElementById('btn-close-host-controls');
    if (closeHostControlsBtn) closeHostControlsBtn.onclick = () => this.closeModal('modal-host-controls');

    const pauseToggleBtn = document.getElementById('btn-host-pause-toggle');
    if (pauseToggleBtn) {
      pauseToggleBtn.onclick = () => {
        Game.sendHostCommand(Game.isPaused ? 'resume' : 'pause');
      };
    }

    const reconSweepBtn = document.getElementById('btn-host-recon-sweep');
    if (reconSweepBtn) {
      reconSweepBtn.onclick = () => {
        Game.sendHostCommand('recon_sweep');
        this.closeModal('modal-host-controls');
      };
    }

    const abortMatchBtn = document.getElementById('btn-host-abort-match');
    if (abortMatchBtn) {
      abortMatchBtn.onclick = () => {
        if (confirm('EMERGENCY ABORT: Are you sure you want to stop the match for all players?')) {
          Game.sendHostCommand('emergency_stop', { reason: 'Host terminated match' });
          this.closeModal('modal-host-controls');
        }
      };
    }

    const resumeOverlayBtn = document.getElementById('btn-resume-match-overlay');
    if (resumeOverlayBtn) {
      resumeOverlayBtn.onclick = () => {
        Game.sendHostCommand('resume');
      };
    }

    // Window focus & visibility listeners for automatic permission status refresh
    window.addEventListener('focus', () => this.refreshReadinessBadges());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.refreshReadinessBadges();
    });

    // Runner Manual Ping / Flare
    const panicPingBtn = document.getElementById('btn-panic-ping');
    if (panicPingBtn) {
      panicPingBtn.onclick = () => {
        Game.triggerFlare();
      };
    }

    // Settings Modal Open/Close (Lobby)
    const openSettingsBtn = document.getElementById('btn-open-settings');
    const closeSettingsBtn = document.getElementById('btn-close-settings');
    if (openSettingsBtn) openSettingsBtn.onclick = () => this.showScreen('screen-settings');
    if (closeSettingsBtn) closeSettingsBtn.onclick = () => {
      this.showScreen(Game.state === 'ACTIVE' || Game.state === 'GRACE_PERIOD' ? 'screen-hud' : (Game.state === 'WAITING' ? 'screen-waiting' : 'screen-lobby'));
    };

    // In-Game Tactical HUD Settings Button & Overlay Modal
    const openSettingsHudBtn = document.getElementById('btn-open-settings-hud');
    if (openSettingsHudBtn) {
      const handleOpenSettings = (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        this.openIngameSettings();
      };
      openSettingsHudBtn.onclick = handleOpenSettings;
      openSettingsHudBtn.addEventListener('touchend', (e) => {
        handleOpenSettings(e);
      }, { passive: false });
    }

    const closeIngameSettingsBtn = document.getElementById('btn-close-ingame-settings');
    if (closeIngameSettingsBtn) {
      closeIngameSettingsBtn.onclick = () => {
        this.closeModal('modal-ingame-settings');
      };
    }

    const saveIngameSettingsBtn = document.getElementById('btn-ingame-save-settings');
    if (saveIngameSettingsBtn) {
      saveIngameSettingsBtn.onclick = () => {
        const sound = document.getElementById('ingame-setting-sound')?.checked ?? true;
        const vib = document.getElementById('ingame-setting-vibration')?.checked ?? true;
        const wake = document.getElementById('ingame-setting-wakelock')?.checked ?? true;

        Config.save({
          soundEnabled: sound,
          vibrationEnabled: vib,
          wakeLockEnabled: wake,
          highAccuracyGPS: true // Precision hardware satellite positioning open by default
        });

        this.closeModal('modal-ingame-settings');
        this.showToast('Match settings saved', 'info');
      };
    }

    const ingameLeaveMatchBtn = document.getElementById('btn-ingame-leave-match');
    if (ingameLeaveMatchBtn) {
      ingameLeaveMatchBtn.onclick = () => {
        this.closeModal('modal-ingame-settings');
        this.showModal('modal-confirm-exit');
      };
    }

    // Save Settings (Themes & Sensory Config)
    const saveSettingsBtn = document.getElementById('btn-save-settings');
    if (saveSettingsBtn) {
      saveSettingsBtn.onclick = () => {
        const soundEl = document.getElementById('setting-sound');
        const vibEl = document.getElementById('setting-vibration');

        const newSettings = {
          soundEnabled: soundEl ? soundEl.checked : Config.settings.soundEnabled,
          vibrationEnabled: vibEl ? vibEl.checked : Config.settings.vibrationEnabled
        };

        Config.save(newSettings);

        // If host, sync to room peers
        if (Game.isHost && Game.roomCode) {
          Network.broadcast('settings_sync', newSettings, true);
        }

        this.showToast('Settings saved successfully', 'info');
        this.showScreen(Game.state === 'ACTIVE' || Game.state === 'GRACE_PERIOD' ? 'screen-hud' : (Game.state === 'WAITING' ? 'screen-waiting' : 'screen-lobby'));
      };
    }

    // Runner Tag Confirmation Modal
    const confirmCaughtBtn = document.getElementById('btn-confirm-caught');
    if (confirmCaughtBtn) confirmCaughtBtn.onclick = () => Game.confirmCaught();

    const disputeCaughtBtn = document.getElementById('btn-dispute-caught');
    if (disputeCaughtBtn) disputeCaughtBtn.onclick = () => Game.disputeCaught();

    const capturedContinueBtn = document.getElementById('btn-captured-continue');
    if (capturedContinueBtn) capturedContinueBtn.onclick = () => this.closeModal('modal-captured');

    // Simulation Toggle
    const simToggle = document.getElementById('setting-simulation');
    if (simToggle) {
      simToggle.onchange = (e) => {
        if (e.target.checked) {
          Simulation.start();
          this.showToast('Sandbox Bots activated', 'info');
        } else {
          Simulation.stop();
          this.showToast('Sandbox Bots deactivated', 'info');
        }
      };
    }

    // Privacy Policy in-app reader
    const openPrivacyBtn = document.getElementById('btn-open-privacy');
    const closePrivacyBtn = document.getElementById('btn-close-privacy');
    if (openPrivacyBtn) openPrivacyBtn.onclick = () => this.showScreen('screen-privacy');
    if (closePrivacyBtn) closePrivacyBtn.onclick = () => this.showScreen('screen-settings');

    // Reset Data
    const resetBtn = document.getElementById('btn-reset-data');
    if (resetBtn) {
      resetBtn.onclick = () => {
        if (confirm('Reset all game settings to default?')) {
          Config.reset();
          this.populateSettingsUI();
          this.showToast('Settings restored to defaults', 'info');
        }
      };
    }

    // Leave Match / Rematch
    const leaveBtn = document.getElementById('btn-leave-match');
    if (leaveBtn) leaveBtn.onclick = () => Game.leaveMatch();

    const rematchBtn = document.getElementById('btn-rematch');
    if (rematchBtn) rematchBtn.onclick = () => Game.leaveMatch();

    // Exit Match from HUD
    const exitHudBtn = document.getElementById('btn-exit-match-hud');
    if (exitHudBtn) exitHudBtn.onclick = () => this.showModal('modal-confirm-exit');

    const cancelExitBtn = document.getElementById('btn-cancel-exit');
    if (cancelExitBtn) cancelExitBtn.onclick = () => this.closeModal('modal-confirm-exit');

    const confirmExitBtn = document.getElementById('btn-confirm-exit');
    if (confirmExitBtn) {
      confirmExitBtn.onclick = () => {
        this.closeModal('modal-confirm-exit');
        Game.leaveMatch();
      };
    }

    // Seeker Target Selector Drawer
    const targetPillBtn = document.getElementById('btn-target-selector');
    if (targetPillBtn) targetPillBtn.onclick = () => this.showModal('modal-target-selector');

    const openTargetsBtn = document.getElementById('btn-open-targets');
    if (openTargetsBtn) openTargetsBtn.onclick = () => this.showModal('modal-target-selector');

    const closeTargetBtn = document.getElementById('btn-close-target-selector');
    if (closeTargetBtn) closeTargetBtn.onclick = () => this.closeModal('modal-target-selector');

    // Onboarding Readiness Actions
    const grantGpsBtn = document.getElementById('btn-grant-gps');
    if (grantGpsBtn) {
      grantGpsBtn.onclick = () => {
        if (window.AndroidNative) {
          if (window.AndroidNative.requestLocationPermissions) {
            window.AndroidNative.requestLocationPermissions();
          }
          if (window.AndroidNative.requestBackgroundLocation) {
            setTimeout(() => {
              window.AndroidNative.requestBackgroundLocation();
            }, 600);
          }
        }
        Geo.startTracking();
        setTimeout(() => this.refreshReadinessBadges(), 1200);
      };
    }

    const grantBatteryBtn = document.getElementById('btn-grant-battery');
    if (grantBatteryBtn) {
      grantBatteryBtn.onclick = () => {
        if (window.AndroidNative && window.AndroidNative.requestBatteryOptimization) {
          window.AndroidNative.requestBatteryOptimization();
        } else {
          this.showToast('Managed via Android System Settings', 'info');
        }
        setTimeout(() => this.refreshReadinessBadges(), 1500);
      };
    }

    const grantNotifsBtn = document.getElementById('btn-grant-notifs');
    if (grantNotifsBtn) {
      grantNotifsBtn.onclick = () => {
        if ('Notification' in window) {
          Notification.requestPermission();
        }
        setTimeout(() => this.refreshReadinessBadges(), 1000);
      };
    }

    const dismissOnboardingBtn = document.getElementById('btn-dismiss-onboarding');
    if (dismissOnboardingBtn) {
      dismissOnboardingBtn.onclick = () => {
        localStorage.setItem('manhunt_onboarded_v2', 'true');
        this.closeModal('modal-onboarding');
        this.getAudioContext();
      };
    }

    const capturedCloseBtn = document.getElementById('btn-captured-continue');
    if (capturedCloseBtn) {
      capturedCloseBtn.onclick = () => {
        document.getElementById('modal-captured').style.display = 'none';
      };
    }

    // Platform & Device Selector Handlers
    const openInstallBtn = document.getElementById('btn-open-install-modal');
    if (openInstallBtn) openInstallBtn.onclick = () => this.openPlatformModal();

    const selectAndroidBtn = document.getElementById('btn-select-android');
    if (selectAndroidBtn) {
      selectAndroidBtn.onclick = () => {
        const stepChoose = document.getElementById('device-step-choose');
        const stepAndroid = document.getElementById('device-step-android');
        if (stepChoose) stepChoose.style.display = 'none';
        if (stepAndroid) stepAndroid.style.display = 'block';
      };
    }

    const selectIosBtn = document.getElementById('btn-select-ios');
    if (selectIosBtn) {
      selectIosBtn.onclick = () => {
        const stepChoose = document.getElementById('device-step-choose');
        const stepIos = document.getElementById('device-step-ios');
        if (stepChoose) stepChoose.style.display = 'none';
        if (stepIos) stepIos.style.display = 'block';
      };
    }

    const backChooseAndroid = document.getElementById('btn-back-to-choose-android');
    if (backChooseAndroid) {
      backChooseAndroid.onclick = () => {
        const stepChoose = document.getElementById('device-step-choose');
        const stepAndroid = document.getElementById('device-step-android');
        if (stepChoose) stepChoose.style.display = 'block';
        if (stepAndroid) stepAndroid.style.display = 'none';
      };
    }

    const backChooseIos = document.getElementById('btn-back-to-choose-ios');
    if (backChooseIos) {
      backChooseIos.onclick = () => {
        const stepChoose = document.getElementById('device-step-choose');
        const stepIos = document.getElementById('device-step-ios');
        if (stepChoose) stepChoose.style.display = 'block';
        if (stepIos) stepIos.style.display = 'none';
      };
    }

    const downloadApkBtn = document.getElementById('btn-download-apk');
    if (downloadApkBtn) {
      downloadApkBtn.onclick = () => {
        localStorage.setItem('manhunt_device_platform_v2', 'android_apk');
        const toast = document.getElementById('android-download-toast');
        if (toast) toast.style.display = 'block';
        this.showToast('📥 Downloading Manhunt.apk... Check your notifications to install.', 'info');
      };
    }

    const androidBrowserBtn = document.getElementById('btn-android-browser');
    if (androidBrowserBtn) {
      androidBrowserBtn.onclick = () => {
        localStorage.setItem('manhunt_device_platform_v2', 'android_browser');
        this.closeModal('modal-device-select');
        this.showToast('Playing in mobile browser mode', 'info');
        if (!localStorage.getItem('manhunt_onboarded_v2')) {
          this.showModal('modal-onboarding');
        }
      };
    }

    const androidContinueBtn = document.getElementById('btn-android-continue-game');
    if (androidContinueBtn) {
      androidContinueBtn.onclick = () => {
        localStorage.setItem('manhunt_device_platform_v2', 'android_browser');
        this.closeModal('modal-device-select');
        if (!localStorage.getItem('manhunt_onboarded_v2')) {
          this.showModal('modal-onboarding');
        }
      };
    }

    const iosPlaySafariBtn = document.getElementById('btn-ios-play-safari');
    if (iosPlaySafariBtn) {
      iosPlaySafariBtn.onclick = () => {
        localStorage.setItem('manhunt_device_platform_v2', 'ios');
        this.closeModal('modal-device-select');
        this.showToast('Playing in Safari iOS mode', 'info');
        if (!localStorage.getItem('manhunt_onboarded_v2')) {
          this.showModal('modal-onboarding');
        }
      };
    }

    const skipPlatformBtn = document.getElementById('btn-skip-platform');
    if (skipPlatformBtn) {
      skipPlatformBtn.onclick = () => {
        localStorage.setItem('manhunt_device_platform_v2', 'skipped');
        this.closeModal('modal-device-select');
        if (!localStorage.getItem('manhunt_onboarded_v2')) {
          this.showModal('modal-onboarding');
        }
      };
    }

    // ========================================================================
    // ADMIN CONSOLE ACCESS & AUTHENTICATION HANDLERS
    // ========================================================================
    
    // Secret Gesture: Tap logo 5 times within 3 seconds
    const appLogo = document.getElementById('app-logo');
    let logoTapCount = 0;
    let lastLogoTapTime = 0;
    if (appLogo) {
      appLogo.onclick = () => {
        const now = Date.now();
        if (now - lastLogoTapTime > 3000) {
          logoTapCount = 0;
        }
        lastLogoTapTime = now;
        logoTapCount++;

        if (logoTapCount >= 5) {
          logoTapCount = 0;
          this.playAudioCue('start');
          this.openAdminAuthModal();
        } else if (logoTapCount >= 2) {
          this.playAudioCue('blip');
        }
      };
    }

    // Discreet Admin Console button in lobby footer
    const discreetAdminBtn = document.getElementById('btn-discreet-admin');
    if (discreetAdminBtn) {
      discreetAdminBtn.onclick = () => {
        this.openAdminAuthModal();
      };
    }

    // Admin Auth Modal Submit / Cancel / Enter key
    const adminAuthSubmit = document.getElementById('btn-admin-auth-submit');
    const adminAuthPassInput = document.getElementById('input-admin-pass');
    const adminAuthCancel = document.getElementById('btn-admin-auth-cancel');
    const adminAuthError = document.getElementById('admin-auth-error');

    if (adminAuthSubmit) {
      adminAuthSubmit.onclick = () => {
        const pass = adminAuthPassInput ? adminAuthPassInput.value : '';
        if (typeof Admin !== 'undefined' && Admin.authenticate(pass)) {
          if (adminAuthError) adminAuthError.style.display = 'none';
          if (adminAuthPassInput) adminAuthPassInput.value = '';
          this.closeModal('modal-admin-auth');
          this.playAudioCue('start');
          Admin.open();
        } else {
          if (adminAuthError) {
            adminAuthError.style.display = 'block';
            adminAuthError.textContent = '❌ Access Denied: Invalid Credential';
          }
          this.playAudioCue('warning');
        }
      };
    }

    if (adminAuthPassInput) {
      adminAuthPassInput.onkeydown = (e) => {
        if (e.key === 'Enter' && adminAuthSubmit) {
          adminAuthSubmit.click();
        }
      };
    }

    if (adminAuthCancel) {
      adminAuthCancel.onclick = () => {
        if (adminAuthError) adminAuthError.style.display = 'none';
        if (adminAuthPassInput) adminAuthPassInput.value = '';
        this.closeModal('modal-admin-auth');
      };
    }

    // Admin Console Exit Button
    const adminExitBtn = document.getElementById('btn-admin-exit');
    if (adminExitBtn) {
      adminExitBtn.onclick = () => {
        if (typeof Admin !== 'undefined') Admin.close();
      };
    }
  }

  openAdminAuthModal() {
    const errorEl = document.getElementById('admin-auth-error');
    const inputEl = document.getElementById('input-admin-pass');
    if (errorEl) errorEl.style.display = 'none';
    if (inputEl) {
      inputEl.value = '';
      setTimeout(() => inputEl.focus(), 200);
    }
    this.showModal('modal-admin-auth');
  }

  openIngameSettings() {
    const soundToggle = document.getElementById('ingame-setting-sound');
    const vibToggle = document.getElementById('ingame-setting-vibration');
    const wakeToggle = document.getElementById('ingame-setting-wakelock');

    if (soundToggle) soundToggle.checked = !!Config.settings.soundEnabled;
    if (vibToggle) vibToggle.checked = !!Config.settings.vibrationEnabled;
    if (wakeToggle) wakeToggle.checked = !!Config.settings.wakeLockEnabled;

    const roomEl = document.getElementById('ingame-info-room');
    const roleEl = document.getElementById('ingame-info-role');
    const boundaryEl = document.getElementById('ingame-info-boundary');

    if (roomEl) roomEl.textContent = Game.roomCode || '----';
    if (roleEl) {
      roleEl.textContent = (Game.role || 'runner').toUpperCase();
      roleEl.style.color = Game.role === 'seeker' ? 'var(--theme-seeker, #ff4757)' : 'var(--theme-runner, #00f5b4)';
    }
    if (boundaryEl) {
      boundaryEl.textContent = (Game.boundaryRadiusMeters || Config.settings.boundaryRadiusMeters || 1500) + 'm';
    }

    this.showModal('modal-ingame-settings');
    this.playAudioCue('blip');
  }
}

// Global UIManager singleton
const UI = new UIManager();
