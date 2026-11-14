import * as THREE from 'three';

/**
 * Minimalist Souls-style HUD manager.
 * Handles HP/FP/Stamina bars with delayed golden drain trails,
 * Crimson Flask slot, floating enemy HP bars, lock-on reticle,
 * YOU DIED / ENEMY FELLED overlays, and Grace prompts.
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
    this.pointerPrompt = document.getElementById('pointer-prompt');

    this.areaBanner = document.getElementById('area-banner');
    this.bannerTitle = document.getElementById('banner-title');
    this.bannerSubtitle = document.getElementById('banner-subtitle');

    this.deathOverlay = document.getElementById('death-overlay');

    this._trails = {
      hp: { ratio: 1, holdTimer: 0, lastRatio: 1 },
      fp: { ratio: 1, holdTimer: 0, lastRatio: 1 },
      stamina: { ratio: 1, holdTimer: 0, lastRatio: 1 },
    };

    this._enemyBarMap = new Map();
    this._bannerTimer = 0;
    this._projVec = new THREE.Vector3();

    this.showBanner('ASHEN OVERLOOK', 'The Eclipsed Courtyard', 4.0, false);
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

      this._projVec.set(
        enemy.position.x,
        enemy.position.y + (enemy.archetype === 'sentinel' ? 2.45 : 2.12),
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

    // Clean up stale DOM bars after enemy respawns
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

    // Crimson Flask counter & depletion styling
    this.flaskCount.textContent = String(stats.flasks);
    this.flaskFrame.classList.toggle('depleted', stats.flasks <= 0);
    if (this.flaskLiquid) {
      this.flaskLiquid.style.opacity = stats.flasks > 0 ? '1' : '0.15';
    }

    // Floating Enemy HP bars
    this._updateEnemyBars(dt, enemies, cameraController, player.position);

    // Update Lock-On Reticle projection
    const anchor = cameraController.getLockedTargetAnchor(this._projVec);
    if (anchor) {
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

    // YOU DIED overlay (suppresses lingering area/grace banners for clean presentation)
    const isDead = player.actionState === 'dead';
    this.deathOverlay.classList.toggle('hidden', !isDead);
    if (isDead && this._bannerTimer > 0) {
      this._bannerTimer = 0;
      this.areaBanner.classList.add('hidden');
    }

    // Site of Grace interaction prompt (hidden while dead)
    const nearGrace = !isDead && world.isNearGrace(player.position);
    this.interactPrompt.classList.toggle('hidden', !nearGrace);

    // Pointer lock prompt
    this.pointerPrompt.classList.toggle('hidden', input.isPointerLocked);

    // Banner countdown
    if (this._bannerTimer > 0) {
      this._bannerTimer -= dt;
      if (this._bannerTimer <= 0) {
        this.areaBanner.classList.add('hidden');
      }
    }
  }
}
