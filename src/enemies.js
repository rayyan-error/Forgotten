import * as THREE from 'three';

function angleDiff(from, to) {
  let diff = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function damp(current, target, lambda, dt) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
}

const ENEMY_SPAWNS = [
  {
    id: 'hollow-west',
    archetype: 'swordsman',
    name: 'Hollow Swordsman',
    pos: [-7.8, 0, 0.2],
    patrolOffset: [1.6, -2.4],
    yaw: 0.9,
  },
  {
    id: 'hollow-east',
    archetype: 'swordsman',
    name: 'Hollow Swordsman',
    pos: [7.0, 0, -0.8],
    patrolOffset: [-1.4, -2.2],
    yaw: -1.1,
  },
  {
    id: 'hollow-north-west',
    archetype: 'swordsman',
    name: 'Hollow Swordsman',
    pos: [-4.6, 0, -6.2],
    patrolOffset: [2.0, 1.1],
    yaw: 0.4,
  },
  {
    id: 'spear-sentinel',
    archetype: 'sentinel',
    name: 'Ashen Spear Sentinel',
    pos: [1.4, 0, -8.6],
    patrolOffset: [-2.4, 0.8],
    yaw: 0.1,
  },
];

/**
 * Individual procedural undead enemy with articulated low-poly rig,
 * telegraphed attack wind-ups, poise/stagger, and ash dissolve death.
 */
export class Enemy {
  constructor(scene, config, sharedMaterials) {
    this.scene = scene;
    this.id = config.id;
    this.archetype = config.archetype;
    this.name = config.name;
    this.isEnemy = true;

    const isSentinel = this.archetype === 'sentinel';
    this.scale = isSentinel ? 1.15 : 1.0;

    this.spawnPos = new THREE.Vector3(...config.pos);
    this.patrolA = this.spawnPos.clone();
    this.patrolB = this.spawnPos
      .clone()
      .add(new THREE.Vector3(config.patrolOffset[0], 0, config.patrolOffset[1]));
    this._patrolTarget = this.patrolB.clone();
    this._patrolPause = 0.8;

    this.position = this.spawnPos.clone();
    this.velocity = new THREE.Vector3();
    this.facingYaw = config.yaw ?? 0;
    this.collisionRadius = isSentinel ? 0.5 : 0.42;

    // Combat stats
    this.maxHp = isSentinel ? 145 : 90;
    this.hp = this.maxHp;
    this.poiseMax = isSentinel ? 48 : 30;
    this.poise = this.poiseMax;
    this.poiseRegenTimer = 0;

    this.walkSpeed = isSentinel ? 2.0 : 2.2;
    this.chaseSpeed = isSentinel ? 3.5 : 3.8;
    this.aggroRadius = isSentinel ? 11.2 : 10.2;
    this.loseAggroRadius = 22.0;
    this.attackRange = isSentinel ? 3.05 : 2.3;
    this.baseDamage = isSentinel ? 27 : 20;
    this.staminaDamage = isSentinel ? 30 : 23;

    // Lock-on interface (matches World target API)
    this.lockOffset = new THREE.Vector3(0, isSentinel ? 1.48 : 1.28, 0);
    this.radius = this.collisionRadius;
    this.isAlive = true;

    // AI state machine
    this.aiState = 'patrol'; // 'patrol' | 'pursue' | 'strafe' | 'windup' | 'attack' | 'recover' | 'stagger' | 'dying' | 'dead'
    this._stateTimer = 0;
    this._strafeDir = Math.random() > 0.5 ? 1 : -1;
    this._strafeDuration = 1.0;
    this._attackCooldown = 0.4;
    this._attackPattern = 0; // 0 = primary slash/thrust, 1 = heavy cleave/sweep
    this._windupDuration = 0.62;
    this._attackDuration = 0.2;
    this._recoverDuration = 0.72;
    this._hasHitThisSwing = false;
    this._hitFlashTimer = 0;
    this._damageBarTimer = 0;
    this._stridePhase = Math.random() * Math.PI * 2;
    this._dissolveSpawned = false;

    this.root = new THREE.Group();
    this.root.position.copy(this.position);
    this.root.rotation.y = this.facingYaw;
    this.root.scale.setScalar(this.scale);
    this.scene.add(this.root);

    this.mesh = this.root;
    this.pivots = {};
    this._ashParticles = [];
    this._ashGroup = new THREE.Group();
    this.scene.add(this._ashGroup);

    this._buildRig(sharedMaterials, isSentinel);
  }

  _buildRig(shared, isSentinel) {
    // Per-enemy material clones for independent hit flash & death dissolve opacity
    this._mat = {
      bone: shared.bone.clone(),
      armor: shared.armor.clone(),
      shroud: (isSentinel ? shared.sentinelCloth : shared.shroud).clone(),
      rust: shared.rust.clone(),
      eyeGlow: shared.eyeGlow.clone(),
      telegraphGlow: shared.telegraphGlow.clone(),
    };

    const shadow = (m) => {
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    };

    const pelvis = new THREE.Group();
    pelvis.position.y = 0.88;
    this.root.add(pelvis);
    this.pivots.pelvis = pelvis;

    const hipMesh = shadow(
      new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.18, 6), this._mat.shroud)
    );
    pelvis.add(hipMesh);

    const torso = new THREE.Group();
    torso.position.y = 0.09;
    pelvis.add(torso);
    this.pivots.torso = torso;

    // Gaunt skeletal rib/armor torso
    const ribcage = shadow(
      new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.13, 0.44, 7), this._mat.armor)
    );
    ribcage.position.y = 0.22;
    ribcage.scale.set(1.12, 1, 0.82);
    torso.add(ribcage);

    const tatteredMantle = shadow(
      new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.42, 0.04), this._mat.shroud)
    );
    tatteredMantle.position.set(0, 0.2, -0.15);
    tatteredMantle.rotation.x = 0.1;
    torso.add(tatteredMantle);

    // Head / Hollow Skull + Glowing Eyes
    const neck = new THREE.Group();
    neck.position.set(0, 0.48, 0.02);
    torso.add(neck);
    this.pivots.neck = neck;

    const skull = shadow(
      new THREE.Mesh(new THREE.DodecahedronGeometry(0.135, 0), this._mat.bone)
    );
    skull.position.y = 0.14;
    skull.scale.set(0.88, 1.05, 1.02);
    neck.add(skull);

    if (isSentinel) {
      // Spiked rusted sentinel crown helm
      const helmRim = shadow(
        new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.155, 0.1, 6), this._mat.armor)
      );
      helmRim.position.set(0, 0.2, 0);
      neck.add(helmRim);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
        const spike = shadow(
          new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.14, 4), this._mat.rust)
        );
        spike.position.set(Math.cos(a) * 0.12, 0.3, Math.sin(a) * 0.12);
        neck.add(spike);
      }
    } else {
      // Tattered hood / rusted cap
      const cap = shadow(
        new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.14, 6), this._mat.shroud)
      );
      cap.position.set(0, 0.24, -0.02);
      cap.rotation.x = -0.2;
      neck.add(cap);
    }

    // Glowing undead eyes
    [-0.042, 0.042].forEach((ex) => {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.02, 0.03), this._mat.eyeGlow);
      eye.position.set(ex, 0.14, 0.125);
      neck.add(eye);
    });

    // Arms
    const shoulderL = new THREE.Group();
    shoulderL.position.set(0.26, 0.41, 0);
    torso.add(shoulderL);
    this.pivots.shoulderL = shoulderL;

    const pauldronL = shadow(
      new THREE.Mesh(new THREE.DodecahedronGeometry(0.1, 0), this._mat.armor)
    );
    shoulderL.add(pauldronL);

    const upperArmL = shadow(
      new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.04, 0.25, 5), this._mat.bone)
    );
    upperArmL.position.y = -0.125;
    shoulderL.add(upperArmL);

    const elbowL = new THREE.Group();
    elbowL.position.set(0, -0.25, 0);
    shoulderL.add(elbowL);
    this.pivots.elbowL = elbowL;

    const forearmL = shadow(
      new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.035, 0.24, 5), this._mat.bone)
    );
    forearmL.position.y = -0.12;
    elbowL.add(forearmL);

    if (!isSentinel) {
      // Splintered round buckler for Swordsman
      const buckler = shadow(
        new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.045, 7), this._mat.armor)
      );
      buckler.position.set(0.08, -0.16, 0.05);
      buckler.rotation.z = Math.PI * 0.5;
      elbowL.add(buckler);
    }

    const shoulderR = new THREE.Group();
    shoulderR.position.set(-0.26, 0.41, 0);
    torso.add(shoulderR);
    this.pivots.shoulderR = shoulderR;

    const pauldronR = shadow(
      new THREE.Mesh(new THREE.DodecahedronGeometry(0.105, 0), this._mat.armor)
    );
    shoulderR.add(pauldronR);

    const upperArmR = shadow(
      new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.04, 0.25, 5), this._mat.bone)
    );
    upperArmR.position.y = -0.125;
    shoulderR.add(upperArmR);

    const elbowR = new THREE.Group();
    elbowR.position.set(0, -0.25, 0);
    shoulderR.add(elbowR);
    this.pivots.elbowR = elbowR;

    const forearmR = shadow(
      new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.035, 0.24, 5), this._mat.bone)
    );
    forearmR.position.y = -0.12;
    elbowR.add(forearmR);

    // Weapon Group
    const weapon = new THREE.Group();
    weapon.position.set(0, -0.24, 0.02);
    weapon.rotation.set(Math.PI * 0.42, 0, 0);
    elbowR.add(weapon);
    this.pivots.weapon = weapon;

    // Weapon tip & base markers for accurate hitbox checks
    this.weaponBaseMarker = new THREE.Object3D();
    this.weaponTipMarker = new THREE.Object3D();
    weapon.add(this.weaponBaseMarker);
    weapon.add(this.weaponTipMarker);

    if (isSentinel) {
      // Long Rusted Partisan Spear
      const shaft = shadow(
        new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 1.85, 6), this._mat.armor)
      );
      shaft.position.y = 0.62;
      weapon.add(shaft);

      const crossbar = shadow(
        new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.04), this._mat.rust)
      );
      crossbar.position.y = 1.46;
      weapon.add(crossbar);

      const spearHead = shadow(
        new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.34, 4), this._mat.rust)
      );
      spearHead.position.y = 1.68;
      spearHead.scale.set(1, 1, 0.4);
      weapon.add(spearHead);

      // Telegraph glint halo on spear tip
      this.telegraphOrb = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.14, 0),
        this._mat.telegraphGlow
      );
      this.telegraphOrb.position.y = 1.66;
      this.telegraphOrb.visible = false;
      weapon.add(this.telegraphOrb);

      this.weaponBaseMarker.position.set(0, 0.7, 0);
      this.weaponTipMarker.position.set(0, 1.84, 0);
    } else {
      // Rusted Hollow Broadsword
      const hilt = shadow(
        new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.05), this._mat.armor)
      );
      hilt.position.y = 0.08;
      weapon.add(hilt);

      const blade = shadow(
        new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.86, 0.022), this._mat.rust)
      );
      blade.position.y = 0.53;
      weapon.add(blade);

      const tip = shadow(
        new THREE.Mesh(new THREE.ConeGeometry(0.048, 0.18, 4), this._mat.rust)
      );
      tip.position.y = 1.04;
      tip.rotation.y = Math.PI * 0.25;
      tip.scale.set(1, 1, 0.32);
      weapon.add(tip);

      this.telegraphOrb = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.12, 0),
        this._mat.telegraphGlow
      );
      this.telegraphOrb.position.y = 0.85;
      this.telegraphOrb.visible = false;
      weapon.add(this.telegraphOrb);

      this.weaponBaseMarker.position.set(0, 0.12, 0);
      this.weaponTipMarker.position.set(0, 1.12, 0);
    }

    // Skeletal Legs
    const buildLeg = (side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.11, -0.02, 0);
      pelvis.add(hip);

      const thigh = shadow(
        new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.044, 0.4, 5), this._mat.bone)
      );
      thigh.position.y = -0.2;
      hip.add(thigh);

      const knee = new THREE.Group();
      knee.position.set(0, -0.4, 0);
      hip.add(knee);

      const shin = shadow(
        new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.038, 0.39, 5), this._mat.armor)
      );
      shin.position.y = -0.195;
      knee.add(shin);

      const foot = shadow(
        new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.19), this._mat.bone)
      );
      foot.position.set(0, -0.41, 0.04);
      knee.add(foot);

      return { hip, knee };
    };

    const legL = buildLeg(1);
    const legR = buildLeg(-1);
    this.pivots.hipL = legL.hip;
    this.pivots.kneeL = legL.knee;
    this.pivots.hipR = legR.hip;
    this.pivots.kneeR = legR.knee;
  }

  /**
   * Returns active attack data only during the offensive hitbox frames.
   */
  getActiveAttack() {
    if (!this.isAlive || this.aiState !== 'attack' || this._hasHitThisSwing) {
      return null;
    }
    const base = new THREE.Vector3();
    const tip = new THREE.Vector3();
    this.weaponBaseMarker.getWorldPosition(base);
    this.weaponTipMarker.getWorldPosition(tip);

    return {
      enemy: this,
      damage: this._attackPattern === 1 ? Math.round(this.baseDamage * 1.35) : this.baseDamage,
      staminaDamage: this._attackPattern === 1 ? Math.round(this.staminaDamage * 1.35) : this.staminaDamage,
      isHeavy: this._attackPattern === 1,
      base,
      tip,
      radius: this.archetype === 'sentinel' ? 0.52 : 0.48,
    };
  }

  markAttackHit() {
    this._hasHitThisSwing = true;
  }

  /**
   * Applies player weapon hit, poise damage, knockback, and death transition.
   */
  takeDamage(amount, poiseDamage, knockbackDir, isHeavy = false) {
    if (!this.isAlive) return { hit: false, killed: false, staggered: false };

    this.hp = Math.max(0, this.hp - amount);
    this.poise -= poiseDamage;
    this.poiseRegenTimer = 3.2;
    this._hitFlashTimer = 0.14;
    this._damageBarTimer = 5.5;

    // Alert enemy immediately if struck from patrol
    if (this.aiState === 'patrol') {
      this.aiState = 'pursue';
    }

    // Knockback impulse
    const push = isHeavy ? 4.8 : 2.6;
    this.velocity.x += knockbackDir.x * push;
    this.velocity.z += knockbackDir.z * push;

    if (this.hp <= 0) {
      this.isAlive = false;
      this.aiState = 'dying';
      this._stateTimer = 0;
      this.telegraphOrb.visible = false;
      this._spawnDeathAsh(26);
      return { hit: true, killed: true, staggered: true };
    }

    let staggered = false;
    if (this.poise <= 0 || isHeavy) {
      staggered = true;
      this.poise = this.poiseMax;
      this.aiState = 'stagger';
      this._stateTimer = 0;
      this.telegraphOrb.visible = false;
    }

    return { hit: true, killed: false, staggered };
  }

  _spawnDeathAsh(count) {
    const geo = new THREE.DodecahedronGeometry(0.08, 0);
    for (let i = 0; i < count; i++) {
      const isEmber = i % 5 === 0;
      const mat = new THREE.MeshBasicMaterial({
        color: isEmber ? 0xff9a3c : 0x6f6878,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        this.position.x + (Math.random() - 0.5) * 0.75,
        this.position.y + 0.35 + Math.random() * 1.35,
        this.position.z + (Math.random() - 0.5) * 0.75
      );
      mesh.scale.setScalar(0.5 + Math.random() * 0.85);
      this._ashGroup.add(mesh);
      this._ashParticles.push({
        mesh,
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 1.2,
          0.9 + Math.random() * 1.8,
          (Math.random() - 0.5) * 1.2
        ),
        age: 0,
        life: 0.9 + Math.random() * 0.65,
      });
    }
  }

  _updateAshParticles(dt) {
    for (let i = this._ashParticles.length - 1; i >= 0; i--) {
      const p = this._ashParticles[i];
      p.age += dt;
      if (p.age >= p.life) {
        this._ashGroup.remove(p.mesh);
        p.mesh.material.dispose();
        this._ashParticles.splice(i, 1);
        continue;
      }
      const t = p.age / p.life;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.position.x += Math.sin(p.age * 6 + i) * 0.25 * dt;
      p.mesh.material.opacity = 0.9 * (1 - t);
      p.mesh.scale.setScalar((1 - t * 0.6) * 0.9);
    }
  }

  _beginWindup(distToPlayer) {
    this.aiState = 'windup';
    this._stateTimer = 0;
    this._hasHitThisSwing = false;

    // Choose attack pattern (occasionally heavy overhead/sweep)
    this._attackPattern = Math.random() < 0.32 ? 1 : 0;
    if (this.archetype === 'sentinel') {
      this._windupDuration = this._attackPattern === 1 ? 0.78 : 0.64;
      this._attackDuration = 0.22;
      this._recoverDuration = 0.78;
    } else {
      this._windupDuration = this._attackPattern === 1 ? 0.76 : 0.6;
      this._attackDuration = 0.2;
      this._recoverDuration = 0.72;
    }

    // Subtle step-in range bias
    if (distToPlayer > this.attackRange * 0.95) {
      this._windupDuration += 0.05;
    }
  }

  update(dt, player, world, otherEnemies) {
    this._updateAshParticles(dt);

    // Hit flash decay
    if (this._hitFlashTimer > 0) {
      this._hitFlashTimer = Math.max(0, this._hitFlashTimer - dt);
      const flash = this._hitFlashTimer > 0 ? 0.65 : 0;
      this._mat.armor.emissive.setRGB(flash * 0.8, flash * 0.25, flash * 0.15);
      this._mat.bone.emissive.setRGB(flash * 0.9, flash * 0.4, flash * 0.2);
    }

    if (this._damageBarTimer > 0) {
      this._damageBarTimer = Math.max(0, this._damageBarTimer - dt);
    }

    // Dying collapse + ash dissolve
    if (this.aiState === 'dying') {
      this._stateTimer += dt;
      const t = Math.min(this._stateTimer / 1.1, 1);
      this.root.rotation.x = damp(this.root.rotation.x, -Math.PI * 0.48, 9, dt);
      this.root.position.y = damp(this.root.position.y, this.position.y - 0.18, 8, dt);

      if (t > 0.35) {
        const fade = 1 - (t - 0.35) / 0.65;
        Object.values(this._mat).forEach((m) => {
          m.transparent = true;
          m.opacity = Math.max(0, fade);
        });
      }
      if (t >= 1) {
        this.aiState = 'dead';
        this.root.visible = false;
      }
      return;
    }

    if (this.aiState === 'dead') return;

    // Poise regeneration
    if (this.poiseRegenTimer > 0) {
      this.poiseRegenTimer -= dt;
    } else if (this.poise < this.poiseMax) {
      this.poise = Math.min(this.poiseMax, this.poise + 12 * dt);
    }

    const toPlayerX = player.position.x - this.position.x;
    const toPlayerZ = player.position.z - this.position.z;
    const distToPlayer = Math.hypot(toPlayerX, toPlayerZ);
    const dirToPlayerX = distToPlayer > 1e-4 ? toPlayerX / distToPlayer : 0;
    const dirToPlayerZ = distToPlayer > 1e-4 ? toPlayerZ / distToPlayer : 1;
    const playerAlive = player.stats.hp > 0;

    if (this._attackCooldown > 0) {
      this._attackCooldown = Math.max(0, this._attackCooldown - dt);
    }

    let desiredVx = 0;
    let desiredVz = 0;
    let targetYaw = this.facingYaw;

    // ------------------------------------------------------------------------
    // AI State Machine
    // ------------------------------------------------------------------------
    switch (this.aiState) {
      case 'patrol': {
        if (playerAlive && distToPlayer <= this.aggroRadius) {
          this.aiState = 'pursue';
          break;
        }
        if (this._patrolPause > 0) {
          this._patrolPause -= dt;
        } else {
          const dx = this._patrolTarget.x - this.position.x;
          const dz = this._patrolTarget.z - this.position.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 0.45) {
            this._patrolPause = 1.4 + Math.random() * 1.2;
            this._patrolTarget =
              this._patrolTarget.distanceToSquared(this.patrolA) < 0.2
                ? this.patrolB.clone()
                : this.patrolA.clone();
          } else {
            desiredVx = (dx / dist) * this.walkSpeed * 0.68;
            desiredVz = (dz / dist) * this.walkSpeed * 0.68;
            targetYaw = Math.atan2(dx, dz);
          }
        }
        break;
      }

      case 'pursue': {
        if (!playerAlive || distToPlayer > this.loseAggroRadius) {
          this.aiState = 'patrol';
          break;
        }
        targetYaw = Math.atan2(dirToPlayerX, dirToPlayerZ);

        if (distToPlayer <= this.attackRange * 0.92 && this._attackCooldown <= 0) {
          this._beginWindup(distToPlayer);
        } else if (distToPlayer <= this.attackRange * 1.18) {
          this.aiState = 'strafe';
          this._stateTimer = 0;
          this._strafeDuration = 0.55 + Math.random() * 0.7;
          this._strafeDir = Math.random() > 0.5 ? 1 : -1;
        } else {
          desiredVx = dirToPlayerX * this.chaseSpeed;
          desiredVz = dirToPlayerZ * this.chaseSpeed;
        }
        break;
      }

      case 'strafe': {
        if (!playerAlive || distToPlayer > this.loseAggroRadius) {
          this.aiState = 'patrol';
          break;
        }
        this._stateTimer += dt;
        targetYaw = Math.atan2(dirToPlayerX, dirToPlayerZ);

        if (distToPlayer > this.attackRange * 1.45) {
          this.aiState = 'pursue';
          break;
        }

        // Circle tangentially while keeping ideal spacing
        const rightX = -dirToPlayerZ * this._strafeDir;
        const rightZ = dirToPlayerX * this._strafeDir;
        const radialAdjust = distToPlayer < this.attackRange * 0.72 ? -0.6 : distToPlayer > this.attackRange * 1.05 ? 0.55 : 0;

        desiredVx = (rightX * 0.85 + dirToPlayerX * radialAdjust) * this.walkSpeed;
        desiredVz = (rightZ * 0.85 + dirToPlayerZ * radialAdjust) * this.walkSpeed;

        if (this._stateTimer >= this._strafeDuration && this._attackCooldown <= 0) {
          this._beginWindup(distToPlayer);
        }
        break;
      }

      case 'windup': {
        this._stateTimer += dt;
        const t = this._stateTimer / this._windupDuration;

        // Track player slightly during early telegraph, then lock angle for fair dodging!
        if (t < 0.55) {
          targetYaw = Math.atan2(dirToPlayerX, dirToPlayerZ);
        }

        // Visual Telegraph: glowing weapon orb + bright crimson eyes!
        this.telegraphOrb.visible = true;
        const pulse = 0.7 + 0.65 * Math.sin(t * Math.PI);
        this.telegraphOrb.scale.setScalar(pulse);
        this.telegraphOrb.rotation.y += dt * 7;
        this._mat.eyeGlow.color.setHex(0xffc966);

        if (this._stateTimer >= this._windupDuration) {
          this.aiState = 'attack';
          this._stateTimer = 0;
          this.telegraphOrb.visible = false;
          this._mat.eyeGlow.color.setHex(0xff3c1e);

          // Forward lunge burst
          const fwdX = Math.sin(this.facingYaw);
          const fwdZ = Math.cos(this.facingYaw);
          const lunge = this.archetype === 'sentinel' ? 7.4 : 5.8;
          this.velocity.x = fwdX * lunge;
          this.velocity.z = fwdZ * lunge;
        }
        break;
      }

      case 'attack': {
        this._stateTimer += dt;
        // Lunge decays naturally
        desiredVx = 0;
        desiredVz = 0;
        if (this._stateTimer >= this._attackDuration) {
          this.aiState = 'recover';
          this._stateTimer = 0;
        }
        break;
      }

      case 'recover': {
        this._stateTimer += dt;
        targetYaw = Math.atan2(dirToPlayerX, dirToPlayerZ);
        if (this._stateTimer >= this._recoverDuration) {
          this._attackCooldown = 0.45 + Math.random() * 0.45;
          this.aiState = distToPlayer <= this.attackRange * 1.25 ? 'strafe' : 'pursue';
          this._stateTimer = 0;
          this._strafeDuration = 0.5 + Math.random() * 0.65;
        }
        break;
      }

      case 'stagger': {
        this._stateTimer += dt;
        if (this._stateTimer >= 0.82) {
          this.aiState = 'pursue';
          this._stateTimer = 0;
          this._attackCooldown = 0.35;
        }
        break;
      }
    }

    // Smooth yaw turn
    const turnRate = this.aiState === 'windup' ? 5.5 : this.aiState === 'attack' ? 1.5 : 8.5;
    this.facingYaw += angleDiff(this.facingYaw, targetYaw) * (1 - Math.exp(-turnRate * dt));

    // Velocity damping
    const accel = this.aiState === 'attack' || this.aiState === 'stagger' ? 7.5 : 11.5;
    this.velocity.x = damp(this.velocity.x, desiredVx, accel, dt);
    this.velocity.z = damp(this.velocity.z, desiredVz, accel, dt);

    // Move & resolve world collision
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    world.resolveCollision(this.position, this.collisionRadius);

    // Soft enemy-to-enemy separation
    for (let i = 0; i < otherEnemies.length; i++) {
      const other = otherEnemies[i];
      if (other === this || !other.isAlive) continue;
      const dx = this.position.x - other.position.x;
      const dz = this.position.z - other.position.z;
      const minDist = this.collisionRadius + other.collisionRadius + 0.12;
      const distSq = dx * dx + dz * dz;
      if (distSq < minDist * minDist) {
        const d = Math.sqrt(distSq) || 0.01;
        const push = (minDist - d) * 0.5;
        this.position.x += (dx / d) * push;
        this.position.z += (dz / d) * push;
      }
    }

    // Soft enemy-to-player separation (keeps characters from passing completely inside each other)
    if (playerAlive) {
      const dx = this.position.x - player.position.x;
      const dz = this.position.z - player.position.z;
      const minDist = this.collisionRadius + player.collisionRadius + 0.08;
      const distSq = dx * dx + dz * dz;
      if (distSq < minDist * minDist) {
        const d = Math.sqrt(distSq) || 0.01;
        const push = minDist - d;
        this.position.x += (dx / d) * push;
        this.position.z += (dz / d) * push;
      }
    }

    const groundY = world.getGroundHeight(this.position.x, this.position.z);
    this.position.y = damp(this.position.y, groundY, 20, dt);

    this.root.position.copy(this.position);
    this.root.rotation.y = this.facingYaw;

    this._animateRig(dt);
  }

  _animateRig(dt) {
    const p = this.pivots;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const moveAmt = THREE.MathUtils.clamp(speed / this.chaseSpeed, 0, 1);

    if (moveAmt > 0.05) {
      this._stridePhase += dt * speed * 2.55;
    }

    const sSin = Math.sin(this._stridePhase);
    const sCos = Math.cos(this._stridePhase);

    // Legs
    const legAmp = 0.58 * moveAmt;
    p.hipL.rotation.x = damp(p.hipL.rotation.x, -sSin * legAmp, 14, dt);
    p.hipR.rotation.x = damp(p.hipR.rotation.x, sSin * legAmp, 14, dt);
    p.kneeL.rotation.x = damp(p.kneeL.rotation.x, 0.14 + Math.max(0, -sCos) * 0.55 * moveAmt, 14, dt);
    p.kneeR.rotation.x = damp(p.kneeR.rotation.x, 0.14 + Math.max(0, sCos) * 0.55 * moveAmt, 14, dt);
    p.pelvis.position.y = damp(p.pelvis.position.y, 0.88 - moveAmt * 0.03 + Math.abs(sSin) * 0.035 * moveAmt, 16, dt);

    if (this.aiState === 'stagger') {
      const t = this._stateTimer / 0.82;
      const recoil = Math.sin(t * Math.PI);
      p.torso.rotation.set(-0.45 * recoil, 0.15 * recoil, 0);
      p.neck.rotation.set(-0.3 * recoil, 0, 0);
      p.shoulderR.rotation.set(-0.6, 0, -0.75 * recoil);
      p.elbowR.rotation.set(-0.3, 0, 0);
      p.shoulderL.rotation.set(-0.5, 0, 0.75 * recoil);
      p.elbowL.rotation.set(-0.4, 0, 0);
      return;
    }

    if (this.aiState === 'windup') {
      const t = Math.min(this._stateTimer / this._windupDuration, 1);
      if (this.archetype === 'sentinel') {
        // Spear pulled low & far back in menacing crouch
        p.torso.rotation.x = damp(p.torso.rotation.x, 0.24 * t, 14, dt);
        p.torso.rotation.y = damp(p.torso.rotation.y, -0.55 * t, 14, dt);
        p.shoulderR.rotation.set(
          damp(p.shoulderR.rotation.x, 0.65 * t, 14, dt),
          0,
          damp(p.shoulderR.rotation.z, -0.35 * t, 14, dt)
        );
        p.elbowR.rotation.x = damp(p.elbowR.rotation.x, -1.15 * t, 14, dt);
        p.weapon.rotation.x = damp(p.weapon.rotation.x, Math.PI * 0.52, 14, dt);
      } else if (this._attackPattern === 1) {
        // Heavy overhead telegraph
        p.torso.rotation.x = damp(p.torso.rotation.x, -0.22 * t, 14, dt);
        p.torso.rotation.y = damp(p.torso.rotation.y, -0.25 * t, 14, dt);
        p.shoulderR.rotation.set(
          damp(p.shoulderR.rotation.x, -2.25 * t, 14, dt),
          0,
          damp(p.shoulderR.rotation.z, -0.22 * t, 14, dt)
        );
        p.elbowR.rotation.x = damp(p.elbowR.rotation.x, -0.45 * t, 14, dt);
        p.weapon.rotation.x = damp(p.weapon.rotation.x, Math.PI * 0.24, 14, dt);
      } else {
        // Raised right-flank slash telegraph
        p.torso.rotation.x = damp(p.torso.rotation.x, 0.1 * t, 14, dt);
        p.torso.rotation.y = damp(p.torso.rotation.y, -0.68 * t, 14, dt);
        p.shoulderR.rotation.set(
          damp(p.shoulderR.rotation.x, -1.55 * t, 14, dt),
          0,
          damp(p.shoulderR.rotation.z, -0.82 * t, 14, dt)
        );
        p.elbowR.rotation.x = damp(p.elbowR.rotation.x, -0.6 * t, 14, dt);
        p.weapon.rotation.x = damp(p.weapon.rotation.x, Math.PI * 0.3, 14, dt);
      }
      p.shoulderL.rotation.set(-0.5, 0.35, 0.15);
      p.elbowL.rotation.set(-0.9, 0, 0);
      return;
    }

    if (this.aiState === 'attack') {
      const t = Math.min(this._stateTimer / this._attackDuration, 1);
      if (this.archetype === 'sentinel') {
        // Explosive forward spear thrust!
        p.torso.rotation.set(0.32, THREE.MathUtils.lerp(-0.5, 0.15, t), 0);
        p.shoulderR.rotation.set(THREE.MathUtils.lerp(0.6, -1.35, t), 0, -0.05);
        p.elbowR.rotation.x = THREE.MathUtils.lerp(-1.1, -0.08, t);
        p.weapon.rotation.x = Math.PI * 0.48;
      } else if (this._attackPattern === 1) {
        // Overhead chop smash
        p.torso.rotation.set(THREE.MathUtils.lerp(-0.2, 0.45, t), 0.15, 0);
        p.shoulderR.rotation.set(THREE.MathUtils.lerp(-2.2, 0.15, t), 0, -0.05);
        p.elbowR.rotation.x = -0.22;
        p.weapon.rotation.x = Math.PI * 0.46;
      } else {
        // Wide horizontal slash
        p.torso.rotation.set(0.22, THREE.MathUtils.lerp(-0.65, 0.72, t), 0);
        p.shoulderR.rotation.set(-0.78, THREE.MathUtils.lerp(-0.35, 0.95, t), THREE.MathUtils.lerp(-0.8, 0.4, t));
        p.elbowR.rotation.x = -0.25;
        p.weapon.rotation.x = Math.PI * 0.45;
      }
      return;
    }

    if (this.aiState === 'recover') {
      p.torso.rotation.x = damp(p.torso.rotation.x, 0.25, 8, dt);
      p.torso.rotation.y = damp(p.torso.rotation.y, 0.18, 8, dt);
      p.shoulderR.rotation.set(damp(p.shoulderR.rotation.x, -0.25, 8, dt), 0, -0.2);
      p.elbowR.rotation.x = damp(p.elbowR.rotation.x, -0.5, 8, dt);
      p.weapon.rotation.x = damp(p.weapon.rotation.x, Math.PI * 0.42, 8, dt);
      return;
    }

    // Idle / Patrol / Pursue / Strafe posture
    const time = performance.now() * 0.001;
    const hunch = this.aiState === 'patrol' ? 0.16 : 0.24;
    p.torso.rotation.x = damp(p.torso.rotation.x, hunch + Math.sin(time * 2.2) * 0.03, 10, dt);
    p.torso.rotation.y = damp(p.torso.rotation.y, -sSin * 0.12 * moveAmt, 10, dt);
    p.neck.rotation.x = damp(p.neck.rotation.x, -hunch * 0.65, 10, dt);

    p.shoulderL.rotation.x = damp(p.shoulderL.rotation.x, -0.45 + sSin * 0.22 * moveAmt, 10, dt);
    p.shoulderL.rotation.y = damp(p.shoulderL.rotation.y, 0.35, 10, dt);
    p.elbowL.rotation.x = damp(p.elbowL.rotation.x, -0.78, 10, dt);

    p.shoulderR.rotation.x = damp(p.shoulderR.rotation.x, -0.35 - sSin * 0.28 * moveAmt, 10, dt);
    p.shoulderR.rotation.z = damp(p.shoulderR.rotation.z, -0.18, 10, dt);
    p.elbowR.rotation.x = damp(p.elbowR.rotation.x, -0.62, 10, dt);
    p.weapon.rotation.x = damp(p.weapon.rotation.x, Math.PI * 0.42, 10, dt);
  }

  dispose() {
    this.scene.remove(this.root);
    this.scene.remove(this._ashGroup);
    Object.values(this._mat).forEach((m) => m.dispose());
    for (const p of this._ashParticles) {
      p.mesh.material.dispose();
    }
  }
}

/**
 * Manages courtyard undead warriors, spawning, updates, and Grace respawning.
 */
export class EnemyManager {
  constructor(scene) {
    this.scene = scene;
    this.enemies = [];
    this.onEnemyKilled = null;
    this.onAllCleared = null;

    this._sharedMaterials = {
      bone: new THREE.MeshStandardMaterial({
        color: 0x8f877d,
        roughness: 0.78,
        metalness: 0.08,
        flatShading: true,
      }),
      armor: new THREE.MeshStandardMaterial({
        color: 0x3b373a,
        roughness: 0.58,
        metalness: 0.62,
        flatShading: true,
      }),
      shroud: new THREE.MeshStandardMaterial({
        color: 0x2a2228,
        roughness: 0.92,
        metalness: 0.04,
        flatShading: true,
        side: THREE.DoubleSide,
      }),
      sentinelCloth: new THREE.MeshStandardMaterial({
        color: 0x522126,
        roughness: 0.9,
        metalness: 0.04,
        flatShading: true,
        side: THREE.DoubleSide,
      }),
      rust: new THREE.MeshStandardMaterial({
        color: 0x6e5144,
        roughness: 0.48,
        metalness: 0.75,
        flatShading: true,
      }),
      eyeGlow: new THREE.MeshBasicMaterial({
        color: 0xff3c1e,
      }),
      telegraphGlow: new THREE.MeshBasicMaterial({
        color: 0xffa838,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    };

    this.spawnAll();
  }

  spawnAll() {
    for (const e of this.enemies) {
      e.dispose();
    }
    this.enemies = ENEMY_SPAWNS.map(
      (cfg) => new Enemy(this.scene, cfg, this._sharedMaterials)
    );
  }

  getLivingEnemies() {
    return this.enemies.filter((e) => e.isAlive);
  }

  update(dt, player, world) {
    for (let i = 0; i < this.enemies.length; i++) {
      this.enemies[i].update(dt, player, world, this.enemies);
    }
  }

  notifyKill(enemy) {
    if (this.onEnemyKilled) {
      const remaining = this.getLivingEnemies().length;
      this.onEnemyKilled(enemy, remaining);
    }
  }
}
