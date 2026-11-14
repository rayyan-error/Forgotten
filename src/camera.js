import * as THREE from 'three';

function angleDiff(from, to) {
  let diff = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function damp(current, target, lambda, dt) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/**
 * ThirdPersonCamera
 * -----------------
 * Smooth Souls-style third-person orbit camera with pointer-lock / drag orbit,
 * damped scroll zoom, ground/pillar collision avoidance, screen shake trauma,
 * and dynamic Target Lock-On with live enemy prioritization & cycling.
 */
export class ThirdPersonCamera {
  /**
   * @param {number} aspect
   */
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(54, aspect, 0.12, 420);

    // Orbit angles (yaw = 0 looks toward -Z)
    this.yaw = 0;
    this.pitch = 0.28;
    this.targetYaw = 0;
    this.targetPitch = 0.28;

    this.distance = 5.4;
    this.targetDistance = 5.4;
    this.minDistance = 2.8;
    this.maxDistance = 9.8;

    this.minPitch = -0.32;
    this.maxPitch = 1.08;
    this.sensitivity = 0.0023;

    this.focusPos = new THREE.Vector3(0, 1.45, 10.6);
    this.lookAtPos = new THREE.Vector3(0, 1.35, 0);

    this.lockedTarget = null;
    this.maxLockRange = 24.0;
    this.breakLockRange = 29.0;
    this._flickCooldown = 0;

    // Screen shake trauma [0..1]
    this._trauma = 0;
    this._shakePhase = 0;

    this._desiredCamPos = new THREE.Vector3();
    this._targetWorldPos = new THREE.Vector3();
  }

  resize(width, height) {
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  }

  addTrauma(amount) {
    this._trauma = Math.min(1.0, this._trauma + amount);
  }

  _findBestTarget(targets, playerPos, excludeTarget = null) {
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);

    const pickFromPool = (pool) => {
      let best = null;
      let bestScore = -Infinity;
      for (let i = 0; i < pool.length; i++) {
        const t = pool[i];
        if (!t.isAlive || t === excludeTarget) continue;

        const targetCenter = this._targetWorldPos.copy(t.position).add(t.lockOffset);
        const distToPlayer = playerPos.distanceTo(t.position);
        if (distToPlayer > this.maxLockRange) continue;

        const toTargetFromCam = targetCenter.clone().sub(this.camera.position).normalize();
        const align = camDir.dot(toTargetFromCam);

        if (align < 0.05 && distToPlayer > 11.0) continue;

        const score = align * 2.5 - distToPlayer * 0.045;
        if (score > bestScore) {
          bestScore = score;
          best = t;
        }
      }
      return best;
    };

    // Prioritize living enemies first; fall back to courtyard training targets if none
    const livingEnemies = targets.filter((t) => t.isEnemy && t.isAlive);
    const enemyMatch = pickFromPool(livingEnemies);
    if (enemyMatch) return enemyMatch;

    return pickFromPool(targets);
  }

  /**
   * Toggles Target Lock-On toward the best visible target in range.
   * @param {Array} targets
   * @param {THREE.Vector3} playerPos
   * @returns {boolean} True if now locked on.
   */
  toggleLockOn(targets, playerPos) {
    if (this.lockedTarget) {
      this.lockedTarget = null;
      return false;
    }

    this.lockedTarget = this._findBestTarget(targets, playerPos);
    return Boolean(this.lockedTarget);
  }

  /**
   * Cycles Lock-On to another nearby living target (preferring directional side).
   */
  cycleLockOn(targets, playerPos, direction = 1) {
    if (!this.lockedTarget) {
      return this.toggleLockOn(targets, playerPos);
    }

    const candidates = targets.filter(
      (t) =>
        t.isAlive &&
        t !== this.lockedTarget &&
        t.isEnemy &&
        playerPos.distanceTo(t.position) <= this.maxLockRange
    );
    const pool =
      candidates.length > 0
        ? candidates
        : targets.filter(
            (t) =>
              t.isAlive &&
              t !== this.lockedTarget &&
              playerPos.distanceTo(t.position) <= this.maxLockRange
          );

    if (pool.length === 0) return false;

    const camRight = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const curRel = this.lockedTarget.position.clone().sub(playerPos).setY(0).normalize();

    let best = pool[0];
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i];
      const rel = c.position.clone().sub(playerPos).setY(0);
      const dist = rel.length();
      rel.normalize();
      const sideDot = rel.sub(curRel).dot(camRight) * direction;
      const score = (sideDot > 0 ? sideDot * 2.0 : sideDot * 0.5) - dist * 0.03;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }

    this.lockedTarget = best;
    return true;
  }

  /**
   * Returns current locked target world anchor point, or null if unlocked.
   */
  getLockedTargetAnchor(outVec = new THREE.Vector3()) {
    if (!this.lockedTarget) return null;
    return outVec.copy(this.lockedTarget.position).add(this.lockedTarget.lockOffset);
  }

  updateShake(dt) {
    if (this._trauma > 0) {
      this._trauma = Math.max(0, this._trauma - dt * 1.95);
      this._shakePhase += dt * 48;
    }
  }

  update(dt, input, player, world, lockableTargets = []) {
    if (this._flickCooldown > 0) {
      this._flickCooldown = Math.max(0, this._flickCooldown - dt);
    }

    // 1. Scroll Zoom
    if (input.wheelDelta !== 0) {
      this.targetDistance = THREE.MathUtils.clamp(
        this.targetDistance + input.wheelDelta * 0.0042,
        this.minDistance,
        this.maxDistance
      );
    }
    this.distance = damp(this.distance, this.targetDistance, 14, dt);

    // 2. Validate active lock-on & auto-retarget to nearest living enemy if target dies
    if (this.lockedTarget) {
      const dist = player.position.distanceTo(this.lockedTarget.position);
      if (!this.lockedTarget.isAlive) {
        const nextEnemy = this._findBestTarget(
          lockableTargets.filter((t) => t.isEnemy),
          player.position,
          this.lockedTarget
        );
        this.lockedTarget = nextEnemy || null;
      } else if (dist > this.breakLockRange) {
        this.lockedTarget = null;
      }
    }

    // 3. Orbit Input vs. Soft Target Lock-On Framing (+ mouse flick target switch)
    if (this.lockedTarget) {
      if (this._flickCooldown <= 0 && Math.abs(input.mouseDeltaX) > 44) {
        const dir = input.mouseDeltaX > 0 ? 1 : -1;
        this.cycleLockOn(lockableTargets, player.position, dir);
        this._flickCooldown = 0.35;
      }

      const anchor = this.getLockedTargetAnchor(this._targetWorldPos);
      if (anchor) {
        const dx = anchor.x - player.position.x;
        const dz = anchor.z - player.position.z;
        const horizDist = Math.hypot(dx, dz);

        if (horizDist > 0.2) {
          const lockYaw = Math.atan2(-dx, -dz);
          const yawDelta = angleDiff(this.targetYaw, lockYaw);
          this.targetYaw += yawDelta * (1 - Math.exp(-8.5 * dt));

          const desiredPitch = THREE.MathUtils.clamp(0.42 - horizDist * 0.014, 0.2, 0.44);
          this.targetPitch = damp(this.targetPitch, desiredPitch, 7, dt);
        }
      }

      this.yaw += angleDiff(this.yaw, this.targetYaw) * (1 - Math.exp(-14 * dt));
      this.pitch = damp(this.pitch, this.targetPitch, 12, dt);
    } else {
      if (input.mouseDeltaX !== 0 || input.mouseDeltaY !== 0) {
        this.targetYaw -= input.mouseDeltaX * this.sensitivity;
        this.targetPitch = THREE.MathUtils.clamp(
          this.targetPitch + input.mouseDeltaY * this.sensitivity,
          this.minPitch,
          this.maxPitch
        );
      }
      this.yaw += angleDiff(this.yaw, this.targetYaw) * (1 - Math.exp(-22 * dt));
      this.pitch = damp(this.pitch, this.targetPitch, 22, dt);
    }

    // 4. Track player upper-torso focus point
    this.focusPos.x = damp(this.focusPos.x, player.position.x, 16, dt);
    this.focusPos.y = damp(this.focusPos.y, player.position.y + 1.42, 12, dt);
    this.focusPos.z = damp(this.focusPos.z, player.position.z, 16, dt);

    // 5. Spherical orbit position
    const cosPitch = Math.cos(this.pitch);
    const offsetX = Math.sin(this.yaw) * cosPitch * this.distance;
    const offsetY = Math.sin(this.pitch) * this.distance;
    const offsetZ = Math.cos(this.yaw) * cosPitch * this.distance;

    const shoulderShift = this.lockedTarget ? 0.42 : 0.14;
    const camRightX = Math.cos(this.yaw);
    const camRightZ = -Math.sin(this.yaw);

    this._desiredCamPos.set(
      this.focusPos.x + offsetX + camRightX * shoulderShift,
      this.focusPos.y + offsetY,
      this.focusPos.z + offsetZ + camRightZ * shoulderShift
    );

    world.clampCameraPosition(this.focusPos, this._desiredCamPos);
    this.camera.position.copy(this._desiredCamPos);

    // 6. Look-at midpoint
    if (this.lockedTarget) {
      const anchor = this.getLockedTargetAnchor(this._targetWorldPos);
      const blendLook = new THREE.Vector3().lerpVectors(this.focusPos, anchor, 0.38);
      this.lookAtPos.lerp(blendLook, 1 - Math.exp(-12 * dt));
    } else {
      const freeLook = new THREE.Vector3(
        this.focusPos.x + camRightX * 0.12,
        this.focusPos.y + 0.08,
        this.focusPos.z + camRightZ * 0.12
      );
      this.lookAtPos.lerp(freeLook, 1 - Math.exp(-18 * dt));
    }

    // 7. Apply quadratic screen shake trauma offset
    if (this._trauma > 0.001) {
      const shake = this._trauma * this._trauma * 0.24;
      const sx = Math.sin(this._shakePhase * 1.1) * shake;
      const sy = Math.cos(this._shakePhase * 1.43) * shake;
      const sz = Math.sin(this._shakePhase * 0.87) * shake * 0.5;
      this.camera.position.add(new THREE.Vector3(sx, sy, sz));
      this.camera.lookAt(
        this.lookAtPos.x + sx * 0.5,
        this.lookAtPos.y + sy * 0.5,
        this.lookAtPos.z + sz * 0.5
      );
    } else {
      this.camera.lookAt(this.lookAtPos);
    }
  }
}
