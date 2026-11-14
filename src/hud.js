import * as THREE from 'three';

const SETTINGS_STORAGE_KEY = 'forgotten_settings_v1';

/**
 * Minimalist Souls-style HUD & Settings Menu manager.
 * Handles HP/FP/Stamina bars with delayed golden drain trails,
 * Crimson Flask slot, floating enemy HP bars, lock-on reticle,
 * YOU DIED / ENEMY FELLED / Area Discovery banners, Grace prompts,
 * and the persistent Dark-Fantasy Settings Modal.
 */
export class HUD {
  constructor() {
    this.hpFill = document.getElementById('hp-fill');
    this.hpTrail = document.getElementById('hp-trail');
    this.fpFill = document.getElementById('fp-fill');
    this.fpTrail = document.getElementById('fp-trail');
    this.staminaFill = document.getElementById('stamina-fill');
    this.staminaTrail = document.getElementById('stamina-trail');
    this.staminaFrame = document.getElementById('stamina-frame');

    this.flaskFrame = document.getElementById('flask-frame');
    this.flaskCount = document.getElementById('flask-count');
    this.flaskLiquid = document.getElementById('flask-liquid');

    this.enemyBarsLayer = document.getElementById('enemy-bars-layer');
    this.lockReticle = document.getElementById('lock-reticle');
    this.interactPrompt = document.getElementById('interact-prompt');
    this.interactText = document.getElementById('interact-text');
    this.pointerPrompt = document.getElementById('pointer-prompt');

    this.todIndicator = document.getElementById('tod-indicator');
    this.biomeIndicator = document.getElementById('biome-indicator');

    this.areaBanner = document.getElementById('area-banner');
    this.bannerTitle = document.getElementById('banner-title');
    this.bannerSubtitle = document.getElementById('banner-subtitle');

    this.deathOverlay = document.getElementById('death-overlay');

    // Settings Modal elements
    this.settingsToggleBtn = document.getElementById('settings-toggle-btn');
    this.settingsModal = document.getElementById('settings-modal');
    this.sensitivityInput = document.getElementById('setting-sensitivity');
    this.sensitivityVal = document.getElementById('setting-sensitivity-val');
    this.invertYInput = document.getElementById('setting-invert-y');
    this.invertYText = document.getElementById('setting-invert-y-text');
    this.volumeInput = document.getElementById('setting-volume');
    this.volumeVal = document.getElementById('setting-volume-val');
    this.muteInput = document.getElementById('setting-mute');
    this.muteText = document.getElementById('setting-mute-text');
    this.todPresetSelect = document.getElementById('setting-tod-preset');
    this.todSpeedSelect = document.getElementById('setting-tod-speed');
    this.todReadout = document.getElementById('setting-tod-readout');
    this.resumeBtn = document.getElementById('settings-resume-btn');
    this.respawnBtn = document.getElementById('settings-respawn-btn');

    this.isSettingsOpen = false;
    this.settings = {
      sensitivityScale: 1.0,
      invertY: false,
      volume: 80,
      muted: false,
      todPreset: 'auto',
      todSpeed: 1,
    };

    // Callbacks wired by Game (main.js)
    this.onSettingsChange = null;
    this.onPauseChange = null;
    this.onRespawnAtGrace = null;

    this._trails = {
      hp: { ratio: 1, holdTimer: 0, lastRatio: 1 },
      fp: { ratio: 1, holdTimer: 0, lastRatio: 1 },
      stamina: { ratio: 1, holdTimer: 0, lastRatio: 1 },
    };

    this._enemyBarMap = new Map();
    this._bannerTimer = 0;
    this._projVec = new THREE.Vector3();
    this._currentBiomeId = 'courtyard';

    this._loadPersistedSettings();
    this._bindSettingsEvents();
    this.showBanner('ASHEN OVERLOOK', 'The Eclipsed Courtyard', 4.0, false);
  }

  _loadPersistedSettings() {
    try {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed.sensitivityScale === 'number') {
          this.settings.sensitivityScale = THREE.MathUtils.clamp(parsed.sensitivityScale, 0.2, 2.5);
        }
        if (typeof parsed.invertY === 'boolean') {
          this.settings.invertY = parsed.invertY;
        }
        if (typeof parsed.volume === 'number') {
          this.settings.volume = THREE.MathUtils.clamp(parsed.volume, 0, 100);
        }
        if (typeof parsed.muted === 'boolean') {
          this.settings.muted = parsed.muted;
        }
        if (typeof parsed.todPreset === 'string') {
          this.settings.todPreset = parsed.todPreset;
        }
        if (typeof parsed.todSpeed === 'number') {
          this.settings.todSpeed = parsed.todSpeed;
        }
      }
    } catch {
      // Ignore storage access errors in restricted frames
    }
    this._syncSettingsDOM();
  }

  _savePersistedSettings() {
    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Ignore storage quota/access errors
    }
  }

  _syncSettingsDOM() {
    if (this.sensitivityInput) {
      this.sensitivityInput.value = this.settings.sensitivityScale.toFixed(2);
    }
    if (this.sensitivityVal) {
      const rawSens = (0.001 * this.settings.sensitivityScale).toFixed(4);
      this.sensitivityVal.textContent = `${this.settings.sensitivityScale.toFixed(2)}x (${rawSens})`;
    }
    if (this.invertYInput) {
      this.invertYInput.checked = this.settings.invertY;
    }
    if (this.invertYText) {
      this.invertYText.textContent = this.settings.invertY ? 'On' : 'Off';
    }
    if (this.volumeInput) {
      this.volumeInput.value = String(Math.round(this.settings.volume));
    }
    if (this.volumeVal) {
      this.volumeVal.textContent = this.settings.muted
        ? 'Muted'
        : `${Math.round(this.settings.volume)}%`;
    }
    if (this.muteInput) {
      this.muteInput.checked = this.settings.muted;
    }
    if (this.muteText) {
      this.muteText.textContent = this.settings.muted ? 'Muted' : 'Mute';
    }
    if (this.todPresetSelect) {
      this.todPresetSelect.value = this.settings.todPreset;
    }
    if (this.todSpeedSelect) {
      this.todSpeedSelect.value = String(this.settings.todSpeed);
    }
  }

  _emitSettingsChange() {
    this._syncSettingsDOM();
    this._savePersistedSettings();
    if (this.onSettingsChange) {
      this.onSettingsChange({ ...this.settings });
    }
  }

  _bindSettingsEvents() {
    if (this.settingsToggleBtn) {
      this.settingsToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleSettings();
      });
    }

    if (this.resumeBtn) {
      this.resumeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeSettings();
      });
    }

    if (this.respawnBtn) {
      this.respawnBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeSettings();
        if (this.onRespawnAtGrace) {
          this.onRespawnAtGrace();
        }
      });
    }

    if (this.sensitivityInput) {
      this.sensitivityInput.addEventListener('input', () => {
        this.settings.sensitivityScale = parseFloat(this.sensitivityInput.value) || 1.0;
        this._emitSettingsChange();
      });
    }

    if (this.invertYInput) {
      this.invertYInput.addEventListener('change', () => {
        this.settings.invertY = Boolean(this.invertYInput.checked);
        this._emitSettingsChange();
      });
    }

    if (this.volumeInput) {
      this.volumeInput.addEventListener('input', () => {
        this.settings.volume = parseFloat(this.volumeInput.value) || 0;
        if (this.settings.volume > 0 && this.settings.muted) {
          this.settings.muted = false;
        }
        this._emitSettingsChange();
      });
    }

    if (this.muteInput) {
      this.muteInput.addEventListener('change', () => {
        this.settings.muted = Boolean(this.muteInput.checked);
        this._emitSettingsChange();
      });
    }

    if (this.todPresetSelect) {
      this.todPresetSelect.addEventListener('change', () => {
        this.settings.todPreset = this.todPresetSelect.value;
        this._emitSettingsChange();
      });
    }

    if (this.todSpeedSelect) {
      this.todSpeedSelect.addEventListener('change', () => {
        this.settings.todSpeed = parseFloat(this.todSpeedSelect.value);
        if (Number.isNaN(this.settings.todSpeed)) this.settings.todSpeed = 1;
        this._emitSettingsChange();
      });
    }
  }

  openSettings() {
    if (this.isSettingsOpen) return;
    this.isSettingsOpen = true;
    if (this.settingsModal) {
      this.settingsModal.classList.remove('hidden');
    }
    if (this.onPauseChange) {
      this.onPauseChange(true);
    }
  }

  closeSettings() {
    if (!this.isSettingsOpen) return;
    this.isSettingsOpen = false;
    if (this.settingsModal) {
      this.settingsModal.classList.add('hidden');
    }
    if (this.onPauseChange) {
      this.onPauseChange(false);
    }
  }

  toggleSettings() {
    if (this.isSettingsOpen) {
      this.closeSettings();
    } else {
      this.openSettings();
    }
    return this.isSettingsOpen;
  }

  /**
   * Displays the central Souls-style serif banner (discovery, Grace, Enemy Felled).
   */
  showBanner(title, subtitle, duration = 3.0, isGoldFlash = false) {
    this.bannerTitle.textContent = title;
    this.bannerSubtitle.textContent = subtitle;
    this.areaBanner.classList.toggle('grace-flash', isGoldFlash);
    this.areaBanner.classList.remove('hidden');
    this._bannerTimer = duration;
  }

  _updateBar(fillEl, trailEl, trailState, ratio, dt) {
    const clamped = THREE.MathUtils.clamp(ratio, 0, 1);
    fillEl.style.transform = `scaleX(${clamped.toFixed(4)})`;

    if (clamped < trailState.lastRatio - 0.004) {
      trailState.holdTimer = 0.28;
    }
    trailState.lastRatio = clamped;

    if (clamped >= trailState.ratio) {
      trailState.ratio = clamped;
      trailState.holdTimer = 0;
    } else if (trailState.holdTimer > 0) {
      trailState.holdTimer = Math.max(0, trailState.holdTimer - dt);
    } else {
      trailState.ratio = Math.max(clamped, trailState.ratio - dt * 0.65);
    }

    trailEl.style.transform = `scaleX(${trailState.ratio.toFixed(4)})`;
  }

  _ensureEnemyBar(enemy) {
    let entry = this._enemyBarMap.get(enemy.id);
    if (!entry) {
      const wrap = document.createElement('div');
      wrap.className = 'enemy-bar-wrap hidden';

      const name = document.createElement('span');
      name.className = 'enemy-bar-name';
      name.textContent = enemy.name;

      const track = document.createElement('div');
      track.className = 'enemy-bar-track';

      const trail = document.createElement('div');
      trail.className = 'enemy-bar-trail';

      const fill = document.createElement('div');
      fill.className = 'enemy-bar-fill';

      track.appendChild(trail);
      track.appendChild(fill);
      wrap.appendChild(name);
      wrap.appendChild(track);
      this.enemyBarsLayer.appendChild(wrap);

      entry = {
        wrap,
        fill,
        trail,
        trailState: { ratio: 1, holdTimer: 0, lastRatio: 1 },
      };
      this._enemyBarMap.set(enemy.id, entry);
    }
    return entry;
  }

  _updateEnemyBars(dt, enemies, cameraController, playerPos) {
    const activeIds = new Set();
    const cam = cameraController.camera;

    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      activeIds.add(enemy.id);
      const entry = this._ensureEnemyBar(enemy);

      const isLocked = cameraController.lockedTarget === enemy;
      const recentlyHurt = enemy._damageBarTimer > 0 || enemy.hp < enemy.maxHp;
      const dist = playerPos.distanceTo(enemy.position);
      const shouldShow = enemy.isAlive && (isLocked || recentlyHurt) && dist < 24.0;

      if (!shouldShow) {
        entry.wrap.classList.add('hidden');
        this._updateBar(entry.fill, entry.trail, entry.trailState, enemy.hp / enemy.maxHp, dt);
        continue;
      }

      const barHeight =
        enemy.archetype === 'sentinel'
          ? 2.45
          : enemy.archetype === 'spider'
          ? 1.55
          : enemy.archetype === 'direwolf'
          ? 1.38
          : 2.12;

      this._projVec.set(
        enemy.position.x,
        enemy.position.y + barHeight,
        enemy.position.z
      );
      this._projVec.project(cam);

      if (this._projVec.z > 1) {
        entry.wrap.classList.add('hidden');
        continue;
      }

      const sx = (this._projVec.x * 0.5 + 0.5) * window.innerWidth;
      const sy = (-this._projVec.y * 0.5 + 0.5) * window.innerHeight;
      entry.wrap.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0)`;
      entry.wrap.classList.remove('hidden');

      this._updateBar(entry.fill, entry.trail, entry.trailState, enemy.hp / enemy.maxHp, dt);
    }

    for (const [id, entry] of this._enemyBarMap.entries()) {
      if (!activeIds.has(id)) {
        entry.wrap.remove();
        this._enemyBarMap.delete(id);
      }
    }
  }

  update(dt, player, cameraController, world, input, enemies = []) {
    const { stats } = player;

    this._updateBar(this.hpFill, this.hpTrail, this._trails.hp, stats.hp / stats.maxHp, dt);
    this._updateBar(this.fpFill, this.fpTrail, this._trails.fp, stats.fp / stats.maxFp, dt);
    this._updateBar(
      this.staminaFill,
      this.staminaTrail,
      this._trails.stamina,
      stats.stamina / stats.maxStamina,
      dt
    );

    this.staminaFrame.classList.toggle('exhausted', stats.staminaExhausted);

    this.flaskCount.textContent = String(stats.flasks);
    this.flaskFrame.classList.toggle('depleted', stats.flasks <= 0);
    if (this.flaskLiquid) {
      this.flaskLiquid.style.opacity = stats.flasks > 0 ? '1' : '0.15';
    }

    // Update Time-of-Day & Biome Indicator + Trigger Area Discovery Banner on Biome Entry
    if (world) {
      const phaseName = world.getTimePhaseName ? world.getTimePhaseName() : 'Crimson Dusk';
      if (this.todIndicator) {
        this.todIndicator.textContent = phaseName;
      }
      if (this.todReadout) {
        this.todReadout.textContent = phaseName;
      }

      if (world.getBiomeAt) {
        const biome = world.getBiomeAt(player.position.x, player.position.z);
        if (this.biomeIndicator) {
          const shortName =
            biome.id === 'plains'
              ? 'Gilded Moorlands'
              : biome.id === 'mountains'
              ? 'Frostpeak Crags'
              : 'Ashen Overlook';
          this.biomeIndicator.textContent = shortName;
        }
        if (biome.id !== this._currentBiomeId) {
          this._currentBiomeId = biome.id;
          this.showBanner(biome.title, biome.subtitle, 3.2, false);
        }
      }
    }

    this._updateEnemyBars(dt, enemies, cameraController, player.position);

    const anchor = cameraController.getLockedTargetAnchor(this._projVec);
    if (anchor && !this.isSettingsOpen) {
      anchor.project(cameraController.camera);
      if (anchor.z <= 1) {
        const sx = (anchor.x * 0.5 + 0.5) * window.innerWidth;
        const sy = (-anchor.y * 0.5 + 0.5) * window.innerHeight;
        this.lockReticle.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0)`;
        this.lockReticle.classList.remove('hidden');
      } else {
        this.lockReticle.classList.add('hidden');
      }
    } else {
      this.lockReticle.classList.add('hidden');
    }

    const isDead = player.actionState === 'dead';
    this.deathOverlay.classList.toggle('hidden', !isDead);
    if (isDead && this._bannerTimer > 0) {
      this._bannerTimer = 0;
      this.areaBanner.classList.add('hidden');
    }

    const nearestGrace =
      !isDead && world.getNearestGrace
        ? world.getNearestGrace(player.position)
        : !isDead && world.isNearGrace(player.position)
        ? { name: 'Site of Grace' }
        : null;
    this.interactPrompt.classList.toggle('hidden', !nearestGrace || this.isSettingsOpen);
    if (nearestGrace && this.interactText) {
      this.interactText.textContent = `Rest at ${nearestGrace.name} Grace`;
    }

    this.pointerPrompt.classList.toggle(
      'hidden',
      input.isPointerLocked || this.isSettingsOpen
    );

    if (this._bannerTimer > 0 && !this.isSettingsOpen) {
      this._bannerTimer -= dt;
      if (this._bannerTimer <= 0) {
        this.areaBanner.classList.add('hidden');
      }
    }
  }
}
