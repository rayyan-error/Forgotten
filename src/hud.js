import * as THREE from 'three';

/**
 * Minimalist Souls-style HUD manager.
 * Handles HP/FP/Stamina bars with delayed golden drain trails,
 * projected Lock-On reticle, Grace prompt, and area discovery banner.
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

    this.lockReticle = document.getElementById('lock-reticle');
    this.interactPrompt = document.getElementById('interact-prompt');
    this.pointerPrompt = document.getElementById('pointer-prompt');

    this.areaBanner = document.getElementById('area-banner');
    this.bannerTitle = document.getElementById('banner-title');
    this.bannerSubtitle = document.getElementById('banner-subtitle');

    this._trails = {
      hp: { ratio: 1, holdTimer: 0, lastRatio: 1 },
      fp: { ratio: 1, holdTimer: 0, lastRatio: 1 },
      stamina: { ratio: 1, holdTimer: 0, lastRatio: 1 },
    };

    this._bannerTimer = 0;
    this._projVec = new THREE.Vector3();

    // Initial discovery banner on load
    this.showBanner('ASHEN OVERLOOK', 'The Eclipsed Courtyard', 4.0, false);
  }

  /**
   * Displays the central Souls-style serif discovery or Grace flash banner.
   */
  showBanner(title, subtitle, duration = 3.2, isGraceFlash = false) {
    this.bannerTitle.textContent = title;
    this.bannerSubtitle.textContent = subtitle;
    this.areaBanner.classList.toggle('grace-flash', isGraceFlash);
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

  update(dt, player, cameraController, world, input) {
    const { stats } = player;

    this._updateBar(
      this.hpFill,
      this.hpTrail,
      this._trails.hp,
      stats.hp / stats.maxHp,
      dt
    );
    this._updateBar(
      this.fpFill,
      this.fpTrail,
      this._trails.fp,
      stats.fp / stats.maxFp,
      dt
    );
    this._updateBar(
      this.staminaFill,
      this.staminaTrail,
      this._trails.stamina,
      stats.stamina / stats.maxStamina,
      dt
    );

    this.staminaFrame.classList.toggle('exhausted', stats.staminaExhausted);

    // Update Lock-On Reticle projection
    const anchor = cameraController.getLockedTargetAnchor(this._projVec);
    if (anchor) {
      anchor.project(cameraController.camera);
      const isBehind = anchor.z > 1;
      if (!isBehind) {
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

    // Site of Grace interaction prompt
    const nearGrace = world.isNearGrace(player.position);
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
