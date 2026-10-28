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

  checkOnboardingReadiness() {
    // If opening on the web/GitHub page and device hasn't been chosen yet
    if (!window.AndroidNative && !localStorage.getItem('manhunt_device_platform_v2')) {
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
          gpsBtn.textContent = 'GRANTED';
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

  updateConnectionBadge(isConnected, mode = 'cloud') {
    const badge = document.getElementById('status-connection');
    if (!badge) return;
    if (isConnected) {
      badge.textContent = mode === 'cloud' ? 'ONLINE (RELAY)' : 'LOCAL MODE';
      badge.className = 'status-badge status-online';
    } else {
      badge.textContent = 'DISCONNECTED';
      badge.className = 'status-badge status-offline';
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

  renderLobbyRoster(players, isHost) {
    const container = document.getElementById('waiting-player-list');
    if (!container) return;
    container.innerHTML = '';

    players.forEach(p => {
      const item = document.createElement('div');
      item.className = `player-card role-${p.role}`;
      item.innerHTML = `
        <div class="player-info">
          <span class="player-role-badge">${p.role.toUpperCase()}</span>
          <span class="player-name">${p.nickname}</span>
        </div>
        ${p.isHost ? '<span class="host-badge">HOST</span>' : ''}
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

    const boundarySel = document.getElementById('lobby-boundary');
    if (boundarySel && settings.boundaryRadiusMeters !== undefined) boundarySel.value = settings.boundaryRadiusMeters;

    // Update participant badges
    const chipSeeker = document.getElementById('chip-seeker-mode');
    if (chipSeeker) {
      chipSeeker.textContent = `SEEKER: ${settings.seekerTrackingMode === 'live' ? 'LIVE (2S)' : Math.round(parseInt(settings.seekerTrackingMode, 10)/60) + 'M PING'}`;
    }

    const chipRunner = document.getElementById('chip-runner-ping');
    if (chipRunner) {
      chipRunner.textContent = `RUNNER PING: ${Math.round(settings.runnerPingInterval / 60)}M`;
    }

    const chipGrace = document.getElementById('chip-grace-period');
    if (chipGrace) {
      chipGrace.textContent = `GRACE: ${settings.gracePeriod === 0 ? 'INSTANT' : Math.round(settings.gracePeriod / 60) + 'M'}`;
    }

    const chipDuration = document.getElementById('chip-match-duration');
    if (chipDuration) {
      chipDuration.textContent = `DURATION: ${settings.gameDuration === 0 ? 'UNLIMITED' : Math.round(settings.gameDuration / 60) + 'M'}`;
    }

    const chipBoundary = document.getElementById('chip-boundary');
    if (chipBoundary) {
      chipBoundary.textContent = `BOUNDARY: ${settings.boundaryRadiusMeters === 0 ? 'OFF' : (settings.boundaryRadiusMeters >= 1000 ? (settings.boundaryRadiusMeters / 1000) + 'KM' : settings.boundaryRadiusMeters + 'M')}`;
    }
  }

  updateHostButtons(isHost) {
    const hostBtn = document.getElementById('btn-host-controls');
    if (hostBtn) {
      hostBtn.style.display = isHost ? 'flex' : 'none';
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

  showGameOverScreen(data) {
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
      const boundary = parseInt(document.getElementById('lobby-boundary').value, 10);

      const updated = {
        seekerTrackingMode: seekerMode,
        runnerPingInterval: runnerInterval,
        gracePeriod: gracePeriod,
        gameDuration: matchDuration,
        boundaryRadiusMeters: boundary
      };

      Config.save(updated);
      this.updateLobbyRulesDisplay(updated);
      Network.broadcast('settings_sync', updated);
      this.showToast('Tactical rules updated for squad', 'info');
    };

    ['lobby-seeker-mode', 'lobby-runner-interval', 'lobby-grace-period', 'lobby-match-duration', 'lobby-boundary'].forEach(id => {
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
        if (Game.role === 'runner' && Game.lastSelfCoords) {
          Game.broadcastRunnerPing(Game.lastSelfCoords);
        }
      };
    }

    // Settings Modal Open/Close
    const openSettingsBtn = document.getElementById('btn-open-settings');
    const closeSettingsBtn = document.getElementById('btn-close-settings');
    if (openSettingsBtn) openSettingsBtn.onclick = () => this.showScreen('screen-settings');
    if (closeSettingsBtn) closeSettingsBtn.onclick = () => {
      this.showScreen(Game.state === 'ACTIVE' || Game.state === 'GRACE_PERIOD' ? 'screen-hud' : (Game.state === 'WAITING' ? 'screen-waiting' : 'screen-lobby'));
    };

    // Save Settings
    const saveSettingsBtn = document.getElementById('btn-save-settings');
    if (saveSettingsBtn) {
      saveSettingsBtn.onclick = () => {
        const pingInterval = parseInt(document.getElementById('setting-ping-interval').value, 10);
        const grace = parseInt(document.getElementById('setting-grace-period').value, 10);
        const duration = parseInt(document.getElementById('setting-game-duration').value, 10);
        const tagDist = parseInt(document.getElementById('setting-tag-distance').value, 10);
        const boundary = parseInt(document.getElementById('setting-boundary').value, 10);
        const sound = document.getElementById('setting-sound').checked;
        const vib = document.getElementById('setting-vibration').checked;

        const newSettings = {
          runnerPingInterval: pingInterval,
          gracePeriod: grace,
          gameDuration: duration,
          tagDistanceMeters: tagDist,
          boundaryRadiusMeters: boundary,
          soundEnabled: sound,
          vibrationEnabled: vib
        };

        Config.save(newSettings);

        // If host, sync to room peers
        if (Game.isHost && Game.roomCode) {
          Network.broadcast('settings_sync', newSettings);
        }

        this.showToast('Settings saved successfully', 'info');
        this.showScreen(Game.state === 'ACTIVE' ? 'screen-hud' : (Game.state === 'WAITING' ? 'screen-waiting' : 'screen-lobby'));
      };
    }

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
        if (window.AndroidNative && window.AndroidNative.requestLocationPermissions) {
          window.AndroidNative.requestLocationPermissions();
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
  }
}

// Global UIManager singleton
const UI = new UIManager();
