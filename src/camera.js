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
 * damped scroll zoom, ground/pillar collision avoidance, and soft Target Lock-On.
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

    this.focusPos = new THREE.Vector3(0, 1.45, 11.0);
    this.lookAtPos = new THREE.Vector3(0, 1.35, 0);

    this.lockedTarget = null;
    this.maxLockRange = 24.0;
    this.breakLockRange = 29.0;

    this._desiredCamPos = new THREE.Vector3();
    this._targetWorldPos = new THREE.Vector3();
  }

  resize(width, height) {
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
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

    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);

    let bestTarget = null;
    let bestScore = -Infinity;

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (!t.isAlive) continue;

      const targetCenter = this._targetWorldPos.copy(t.position).add(t.lockOffset);
      const distToPlayer = playerPos.distanceTo(t.position);
      if (distToPlayer > this.maxLockRange) continue;

      const toTargetFromCam = targetCenter.clone().sub(this.camera.position).normalize();
      const align = camDir.dot(toTargetFromCam);

      // Prefer targets near screen center; still allow nearby targets in front
      if (align < 0.15 && distToPlayer > 10.0) continue;

      const score = align * 2.4 - distToPlayer * 0.035;
      if (score > bestScore) {
        bestScore = score;
        bestTarget = t;
      }
    }

    this.lockedTarget = bestTarget;
    return Boolean(this.lockedTarget);
  }

  /**
   * Returns current locked target world anchor point, or null if unlocked.
   */
  getLockedTargetAnchor(outVec = new THREE.Vector3()) {
    if (!this.lockedTarget) return null;
    return outVec.copy(this.lockedTarget.position).add(this.lockedTarget.lockOffset);
  }

  update(dt, input, player, world) {
    // 1. Scroll Zoom
    if (input.wheelDelta !== 0) {
      this.targetDistance = THREE.MathUtils.clamp(
        this.targetDistance + input.wheelDelta * 0.0042,
        this.minDistance,
        this.maxDistance
      );
    }
    this.distance = damp(this.distance, this.targetDistance, 14, dt);

    // 2. Validate active lock-on range
    if (this.lockedTarget) {
      const dist = player.position.distanceTo(this.lockedTarget.position);
      if (!this.lockedTarget.isAlive || dist > this.breakLockRange) {
        this.lockedTarget = null;
      }
    }

    // 3. Orbit Input vs. Soft Target Lock-On Framing
    if (this.lockedTarget) {
      const anchor = this.getLockedTargetAnchor(this._targetWorldPos);
      const dx = anchor.x - player.position.x;
      const dz = anchor.z - player.position.z;
      const horizDist = Math.hypot(dx, dz);

      if (horizDist > 0.2) {
        // Align camera behind player looking smoothly toward target
        const lockYaw = Math.atan2(-dx, -dz);
        const yawDelta = angleDiff(this.targetYaw, lockYaw);
        this.targetYaw += yawDelta * (1 - Math.exp(-8.5 * dt));

        // Frame slightly higher over shoulder when close so player doesn't obscure target
        const desiredPitch = THREE.MathUtils.clamp(0.42 - horizDist * 0.014, 0.2, 0.44);
        this.targetPitch = damp(this.targetPitch, desiredPitch, 7, dt);
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
      this.yaw += angleDiff(this.yaw, this.targetYaw) * (1 - Math.exp(-22, dt));
      this.pitch = damp(this.pitch, this.targetPitch, 22, dt);
    }

    // 4. Smoothly track player upper-torso focus point
    const targetFocusX = player.position.x;
    const targetFocusY = player.position.y + 1.42;
    const targetFocusZ = player.position.z;

    this.focusPos.x = damp(this.focusPos.x, targetFocusX, 16, dt);
    this.focusPos.y = damp(this.focusPos.y, targetFocusY, 12, dt);
    this.focusPos.z = damp(this.focusPos.z, targetFocusZ, 16, dt);

    // 5. Compute spherical orbit camera position + subtle shoulder framing when locked
    const cosPitch = Math.cos(this.pitch);
    const offsetX = Math.sin(this.yaw) * cosPitch * this.distance;
    const offsetY = Math.sin(this.pitch) * this.distance;
    const offsetZ = Math.cos(this.yaw) * cosPitch * this.distance;

    // Slight right-shoulder offset during lock-on for clear target sightline
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

    // 6. Look-at target: blend between player shoulder focus and locked target midpoint
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

    this.camera.lookAt(this.lookAtPos);
  }
}
