import * as THREE from 'three';

function angleDiff(from, to) {
  let diff = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function damp(current, target, lambda, dt) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export const ENEMY_SPAWNS = [
  // --------------------------------------------------------------------------
  // 1. Starting Ruined Courtyard ("Ashen Overlook")
  // --------------------------------------------------------------------------
  {
    id: 'hollow-west',
    biome: 'courtyard',
    archetype: 'swordsman',
    name: 'Hollow Swordsman',
    pos: [-7.8, 0, 0.2],
    patrolOffset: [1.6, -2.4],
    yaw: 0.9,
  },
  {
    id: 'hollow-east',
    biome: 'courtyard',
    archetype: 'swordsman',
    name: 'Hollow Swordsman',
    pos: [7.0, 0, -0.8],
    patrolOffset: [-1.4, -2.2],
    yaw: -1.1,
  },
  {
    id: 'hollow-north-west',
    biome: 'courtyard',
    archetype: 'swordsman',
    name: 'Hollow Swordsman',
    pos: [-4.6, 0, -6.2],
    patrolOffset: [2.0, 1.1],
    yaw: 0.4,
  },
  {
    id: 'spear-sentinel',
    biome: 'courtyard',
    archetype: 'sentinel',
    name: 'Ashen Spear Sentinel',
    pos: [1.4, 0, -8.6],
    patrolOffset: [-2.4, 0.8],
    yaw: 0.1,
  },

  // --------------------------------------------------------------------------
  // 2. Plains & Farmlands Soldier Outpost Camps ("Gilded Moorlands")
  // --------------------------------------------------------------------------
  {
    id: 'plains-swordsman-1',
    biome: 'plains',
    archetype: 'swordsman',
    name: 'Outpost Swordsman',
    pos: [51.5, 0, -9.5],
    patrolOffset: [3.2, -2.5],
    yaw: -1.2,
  },
  {
    id: 'plains-spear-1',
    biome: 'plains',
    archetype: 'sentinel',
    name: 'Ashen Spear Soldier',
    pos: [56.8, 0, -14.2],
    patrolOffset: [-3.4, 2.2],
    yaw: 0.4,
  },
  {
    id: 'plains-swordsman-2',
    biome: 'plains',
    archetype: 'swordsman',
    name: 'Outpost Swordsman',
    pos: [58.5, 0, -8.2],
    patrolOffset: [-2.8, -3.0],
    yaw: -2.1,
  },
  {
    id: 'plains-spear-2',
    biome: 'plains',
    archetype: 'sentinel',
    name: 'Ashen Spear Soldier',
    pos: [45.5, 0, 13.5],
    patrolOffset: [4.2, -1.8],
    yaw: -0.8,
  },

  // --------------------------------------------------------------------------
  // 3. Rugged Mountain Wildlife & Monsters ("Frostpeak Crags")
  // --------------------------------------------------------------------------
  {
    id: 'mountain-wolf-1',
    biome: 'mountains',
    archetype: 'direwolf',
    name: 'Dire Wolf',
    pos: [-28.5, 0, 2.2],
    patrolOffset: [-3.5, 2.8],
    yaw: 1.5,
  },
  {
    id: 'mountain-wolf-2',
    biome: 'mountains',
    archetype: 'direwolf',
    name: 'Dire Wolf',
    pos: [-32.0, 0, 5.4],
    patrolOffset: [3.2, -2.4],
    yaw: 1.8,
  },
  {
    id: 'mountain-wolf-3',
    biome: 'mountains',
    archetype: 'direwolf',
    name: 'Alpha Dire Wolf',
    pos: [-52.0, 0, -1.5],
    patrolOffset: [3.6, 2.5],
    yaw: 1.2,
  },
  {
    id: 'mountain-spider-1',
    biome: 'mountains',
    archetype: 'spider',
    name: 'Giant Frost Spider',
    pos: [-59.5, 0, 5.5],
    patrolOffset: [-3.5, 2.2],
    yaw: 1.4,
  },
  {
    id: 'mountain-spider-2',
    biome: 'mountains',
    archetype: 'spider',
    name: 'Giant Cave Spider',
    pos: [-65.5, 0, 8.2],
    patrolOffset: [3.2, -3.0],
    yaw: 1.9,
  },
];

/**
 * Procedural dark-fantasy enemy supporting 4 distinct low-poly archetypes:
 * - 'swordsman' (Hollow / Outpost Swordsman)
 * - 'sentinel'  (Ashen Spear Sentinel / Soldier)
 * - 'direwolf'  (Mountain Dire Wolf — fast pack predator with crouch-and-pounce bite)
 * - 'spider'    (Giant Frost/Cave Spider — 8-legged arachnid with leg sweep, leap slam & web spit)
 */
export class Enemy {
  constructor(scene, config, sharedMaterials, onShootProjectile = null) {
    this.scene = scene;
    this.id = config.id;
    this.biome = config.biome || 'courtyard';
    this.archetype = config.archetype;
    this.name = config.name;
    this.isEnemy = true;
    this.onShootProjectile = onShootProjectile;

    const isSentinel = this.archetype === 'sentinel';
    const isWolf = this.archetype === 'direwolf';
    const isSpider = this.archetype === 'spider';

    this.scale = isSentinel ? 1.15 : isSpider ? 1.18 : isWolf ? 1.08 : 1.0;

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
    this.collisionRadius = isSpider ? 0.68 : isSentinel ? 0.5 : isWolf ? 0.48 : 0.42;

    // Archetype Combat Stats
    if (isSpider) {
      this.maxHp = 165;
      this.poiseMax = 54;
      this.walkSpeed = 2.65;
      this.chaseSpeed = 4.35;
      this.aggroRadius = 15.0;
      this.loseAggroRadius = 26.0;
      this.attackRange = 3.35;
      this.baseDamage = 24;
      this.staminaDamage = 28;
      this.lockOffset = new THREE.Vector3(0, 0.88, 0);
    } else if (isWolf) {
      this.maxHp = 82;
      this.poiseMax = 24;
      this.walkSpeed = 3.45;
      this.chaseSpeed = 6.2;
      this.aggroRadius = 14.5;
      this.loseAggroRadius = 25.0;
      this.attackRange = 3.25;
      this.baseDamage = 19;
      this.staminaDamage = 20;
      this.lockOffset = new THREE.Vector3(0, 0.76, 0);
    } else if (isSentinel) {
      this.maxHp = 145;
      this.poiseMax = 48;
      this.walkSpeed = 2.15;
      this.chaseSpeed = 3.85;
      this.aggroRadius = 12.4;
      this.loseAggroRadius = 22.0;
      this.attackRange = 3.55;
      this.baseDamage = 26;
      this.staminaDamage = 30;
      this.lockOffset = new THREE.Vector3(0, 1.48, 0);
    } else {
      this.maxHp = 90;
      this.poiseMax = 30;
      this.walkSpeed = 2.3;
      this.chaseSpeed = 4.05;
      this.aggroRadius = 10.8;
      this.loseAggroRadius = 22.0;
      this.attackRange = 2.45;
      this.baseDamage = 20;
      this.staminaDamage = 23;
      this.lockOffset = new THREE.Vector3(0, 1.28, 0);
    }

    this.hp = this.maxHp;
    this.poise = this.poiseMax;
    this.poiseRegenTimer = 0;
    this.radius = this.collisionRadius;
    this.isAlive = true;

    // AI state machine
    this.aiState = 'patrol';
    this._stateTimer = 0;
    this._strafeDir = Math.random() > 0.5 ? 1 : -1;
    this._strafeDuration = 1.0;
    this._attackCooldown = 0.4;
    this._attackPattern = 0;
    this._attackMove = isSentinel
      ? 'thrust'
      : isWolf
      ? 'pounce'
      : isSpider
      ? 'legSweep'
      : 'slash';
    this._swingId = 0;
    this._lungeVelocity = 0;
    this._lungeDirX = 0;
    this._lungeDirZ = 1;
    this._prevWeaponBase = new THREE.Vector3();
    this._prevWeaponTip = new THREE.Vector3();
    this._hasPrevWeaponSample = false;
    this._projectileFiredThisAttack = false;
    this._windupDuration = 0.62;
    this._attackDuration = 0.26;
    this._recoverDuration = 0.72;
    this._hasHitThisSwing = false;
    this._hitFlashTimer = 0;
    this._damageBarTimer = 0;
    this._stridePhase = Math.random() * Math.PI * 2;

    this.root = new THREE.Group();
    this.root.position.copy(this.position);
    this.root.rotation.y = this.facingYaw;
    this.root.scale.setScalar(this.scale);
    this.scene.add(this.root);

    this.mesh = this.root;
    this.pivots = {};
    this.spiderLegs = [];
    this._ashParticles = [];
    this._ashGroup = new THREE.Group();
    this.scene.add(this._ashGroup);

    if (isWolf) {
      this._buildWolfRig(sharedMaterials);
    } else if (isSpider) {
      this._buildSpiderRig(sharedMaterials);
    } else {
      this._buildHumanoidRig(sharedMaterials, isSentinel);
    }
  }

  _buildHumanoidRig(shared, isSentinel) {
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
      const cap = shadow(
        new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.14, 6), this._mat.shroud)
      );
      cap.position.set(0, 0.24, -0.02);
      cap.rotation.x = -0.2;
      neck.add(cap);
    }

    [-0.042, 0.042].forEach((ex) => {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.02, 0.03), this._mat.eyeGlow);
      eye.position.set(ex, 0.14, 0.125);
      neck.add(eye);
    });

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

    const weapon = new THREE.Group();
    weapon.position.set(0, -0.24, 0.02);
    weapon.rotation.set(Math.PI * 0.42, 0, 0);
    elbowR.add(weapon);
    this.pivots.weapon = weapon;

    this.weaponBaseMarker = new THREE.Object3D();
    this.weaponTipMarker = new THREE.Object3D();
    weapon.add(this.weaponBaseMarker);
    weapon.add(this.weaponTipMarker);

    if (isSentinel) {
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

      this.telegraphOrb = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.14, 0),
        this._mat.telegraphGlow
      );
      this.telegraphOrb.position.y = 1.66;
      this.telegraphOrb.visible = false;
      weapon.add(this.telegraphOrb);

      this.weaponBaseMarker.position.set(0, 0.02, 0);
      this.weaponTipMarker.position.set(0, 1.92, 0);
    } else {
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

      this.weaponBaseMarker.position.set(0, 0.06, 0);
      this.weaponTipMarker.position.set(0, 1.18, 0);
    }

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
   * Builds procedural Dire Wolf rig: articulated quadruped legs, bristling spine fur,
   * lupine snout & jaw with fangs, glowing eyes, and bushy tail.
   */
  _buildWolfRig(shared) {
    this._mat = {
      bone: shared.wolfPeltDark.clone(),
      armor: shared.wolfPeltLight.clone(),
      shroud: shared.wolfPeltDark.clone(),
      rust: shared.fangBone.clone(),
      eyeGlow: shared.eyeGlow.clone(),
      telegraphGlow: shared.telegraphGlow.clone(),
    };

    const shadow = (m) => {
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    };

    const pelvis = new THREE.Group();
    pelvis.position.set(0, 0.62, 0);
    this.root.add(pelvis);
    this.pivots.pelvis = pelvis;

    const torso = new THREE.Group();
    pelvis.add(torso);
    this.pivots.torso = torso;

    // Muscular front ribcage & rear haunches
    const chest = shadow(
      new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.56, 7), this._mat.bone)
    );
    chest.rotation.x = Math.PI * 0.5;
    chest.position.set(0, 0.06, 0.18);
    torso.add(chest);

    const haunch = shadow(
      new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.17, 0.52, 7), this._mat.armor)
    );
    haunch.rotation.x = Math.PI * 0.5;
    haunch.position.set(0, 0.03, -0.25);
    torso.add(haunch);

    // Bristling dorsal fur tufts along spine
    for (let i = 0; i < 4; i++) {
      const tuft = shadow(
        new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.24, 4), this._mat.bone)
      );
      tuft.position.set(0, 0.26 - i * 0.02, 0.32 - i * 0.18);
      tuft.rotation.x = -0.5;
      torso.add(tuft);
    }

    // Neck & Lupine Head + Snout
    const neck = new THREE.Group();
    neck.position.set(0, 0.16, 0.42);
    torso.add(neck);
    this.pivots.neck = neck;

    const head = shadow(
      new THREE.Mesh(new THREE.DodecahedronGeometry(0.17, 0), this._mat.bone)
    );
    head.position.set(0, 0.08, 0.12);
    head.scale.set(0.95, 0.9, 1.15);
    neck.add(head);

    const snout = shadow(
      new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.34, 5), this._mat.armor)
    );
    snout.rotation.x = Math.PI * 0.5;
    snout.position.set(0, 0.04, 0.34);
    neck.add(snout);

    const jaw = new THREE.Group();
    jaw.position.set(0, -0.02, 0.22);
    neck.add(jaw);
    this.pivots.jaw = jaw;

    const lowerJaw = shadow(
      new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.04, 0.24), this._mat.bone)
    );
    lowerJaw.position.set(0, -0.02, 0.1);
    jaw.add(lowerJaw);

    [-0.04, 0.04].forEach((fx) => {
      const fang = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.07, 4), this._mat.rust);
      fang.position.set(fx, 0.02, 0.18);
      jaw.add(fang);
    });

    // Pointed wolf ears
    [-0.1, 0.1].forEach((ex) => {
      const ear = shadow(
        new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 4), this._mat.bone)
      );
      ear.position.set(ex, 0.24, 0.06);
      ear.rotation.set(-0.2, 0, ex > 0 ? -0.18 : 0.18);
      neck.add(ear);
    });

    // Glowing lupine eyes
    [-0.065, 0.065].forEach((ex) => {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.022, 0.03), this._mat.eyeGlow);
      eye.position.set(ex, 0.11, 0.24);
      neck.add(eye);
    });

    // Articulated bushy tail
    const tail = new THREE.Group();
    tail.position.set(0, 0.06, -0.48);
    torso.add(tail);
    this.pivots.tail = tail;

    const tailMesh = shadow(
      new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.52, 5), this._mat.bone)
    );
    tailMesh.rotation.x = -Math.PI * 0.65;
    tailMesh.position.set(0, -0.1, -0.22);
    tail.add(tailMesh);

    // Bite hitbox markers & telegraph glint orb
    this.weaponBaseMarker = new THREE.Object3D();
    this.weaponTipMarker = new THREE.Object3D();
    this.weaponBaseMarker.position.set(0, 0.0, -0.1);
    this.weaponTipMarker.position.set(0, 0.0, 1.05);
    neck.add(this.weaponBaseMarker);
    neck.add(this.weaponTipMarker);

    this.telegraphOrb = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.14, 0),
      this._mat.telegraphGlow
    );
    this.telegraphOrb.position.set(0, 0.02, 0.48);
    this.telegraphOrb.visible = false;
    neck.add(this.telegraphOrb);

    // 4 Articulated Quadruped Legs
    const buildWolfLeg = (lx, lz) => {
      const hip = new THREE.Group();
      hip.position.set(lx, -0.04, lz);
      pelvis.add(hip);

      const upper = shadow(
        new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.045, 0.32, 5), this._mat.bone)
      );
      upper.position.y = -0.15;
      hip.add(upper);

      const knee = new THREE.Group();
      knee.position.set(0, -0.3, 0);
      hip.add(knee);

      const lower = shadow(
        new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.032, 0.3, 5), this._mat.armor)
      );
      lower.position.y = -0.14;
      knee.add(lower);

      const paw = shadow(
        new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.13), this._mat.bone)
      );
      paw.position.set(0, -0.28, 0.03);
      knee.add(paw);

      return { hip, knee };
    };

    const fl = buildWolfLeg(0.17, 0.32);
    const fr = buildWolfLeg(-0.17, 0.32);
    const bl = buildWolfLeg(0.16, -0.32);
    const br = buildWolfLeg(-0.16, -0.32);
    this.pivots.legFL = fl;
    this.pivots.legFR = fr;
    this.pivots.legBL = bl;
    this.pivots.legBR = br;
  }

  /**
   * Builds procedural Giant Frost/Cave Spider rig:
   * segmented cephalothorax + frost-crusted abdomen, 8 animated multi-jointed legs,
   * cluster of glowing eyes, and articulated glowing mandibles.
   */
  _buildSpiderRig(shared) {
    this._mat = {
      bone: shared.spiderChitin.clone(),
      armor: shared.spiderFrost.clone(),
      shroud: shared.spiderChitin.clone(),
      rust: shared.spiderMandible.clone(),
      eyeGlow: shared.spiderEyeGlow.clone(),
      telegraphGlow: shared.telegraphGlow.clone(),
    };

    const shadow = (m) => {
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    };

    const pelvis = new THREE.Group();
    pelvis.position.set(0, 0.56, 0);
    this.root.add(pelvis);
    this.pivots.pelvis = pelvis;

    const torso = new THREE.Group();
    pelvis.add(torso);
    this.pivots.torso = torso;

    // Cephalothorax carapace
    const thorax = shadow(
      new THREE.Mesh(new THREE.DodecahedronGeometry(0.28, 0), this._mat.bone)
    );
    thorax.scale.set(1.15, 0.72, 1.25);
    thorax.position.set(0, 0.04, 0.12);
    torso.add(thorax);

    // Segmented bulbous Frost Abdomen
    const abdomen = new THREE.Group();
    abdomen.position.set(0, 0.08, -0.22);
    torso.add(abdomen);
    this.pivots.abdomen = abdomen;

    const abMesh = shadow(
      new THREE.Mesh(new THREE.DodecahedronGeometry(0.42, 1), this._mat.armor)
    );
    abMesh.scale.set(1.08, 0.88, 1.32);
    abMesh.position.set(0, 0.08, -0.35);
    abdomen.add(abMesh);

    // Frost crystal dorsal spines on abdomen
    for (let i = 0; i < 5; i++) {
      const crystal = shadow(
        new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.24, 4), this._mat.rust)
      );
      crystal.position.set(
        (i % 2 === 0 ? 1 : -1) * (i === 0 ? 0 : 0.16),
        0.38,
        -0.18 - i * 0.11
      );
      crystal.rotation.x = -0.35;
      abdomen.add(crystal);
    }

    // Cluster of 6 glowing arachnid eyes
    [
      [-0.09, 0.12, 0.42],
      [-0.035, 0.14, 0.44],
      [0.035, 0.14, 0.44],
      [0.09, 0.12, 0.42],
      [-0.06, 0.18, 0.4],
      [0.06, 0.18, 0.4],
    ].forEach(([ex, ey, ez]) => {
      const eye = new THREE.Mesh(new THREE.OctahedronGeometry(0.024, 0), this._mat.eyeGlow);
      eye.position.set(ex, ey, ez);
      torso.add(eye);
    });

    // Articulated Glowing Mandibles / Chelicerae
    const buildMandible = (side) => {
      const piv = new THREE.Group();
      piv.position.set(side * 0.12, 0.0, 0.4);
      torso.add(piv);

      const base = shadow(
        new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.055, 0.22, 5), this._mat.rust)
      );
      base.rotation.x = Math.PI * 0.4;
      base.position.set(0, -0.02, 0.1);
      piv.add(base);

      const fang = shadow(
        new THREE.Mesh(new THREE.ConeGeometry(0.038, 0.24, 4), this._mat.rust)
      );
      fang.rotation.x = Math.PI * 0.55;
      fang.rotation.z = -side * 0.45;
      fang.position.set(-side * 0.04, -0.04, 0.25);
      piv.add(fang);

      return piv;
    };

    this.pivots.mandibleL = buildMandible(1);
    this.pivots.mandibleR = buildMandible(-1);

    // Hitbox markers & telegraph orb
    this.weaponBaseMarker = new THREE.Object3D();
    this.weaponTipMarker = new THREE.Object3D();
    this.weaponBaseMarker.position.set(0, 0.0, -0.15);
    this.weaponTipMarker.position.set(0, 0.0, 1.48);
    torso.add(this.weaponBaseMarker);
    torso.add(this.weaponTipMarker);

    this.telegraphOrb = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.16, 0),
      this._mat.telegraphGlow
    );
    this.telegraphOrb.position.set(0, 0.06, 0.58);
    this.telegraphOrb.visible = false;
    torso.add(this.telegraphOrb);

    // 8 Multi-Jointed Arachnid Legs (4 per side)
    const legZOffsets = [0.26, 0.1, -0.06, -0.22];
    const legBaseYaws = [0.52, 0.18, -0.2, -0.58];

    for (let i = 0; i < 4; i++) {
      [-1, 1].forEach((side) => {
        const coxa = new THREE.Group();
        coxa.position.set(side * 0.24, 0.02, legZOffsets[i]);
        const baseYaw = side > 0 ? legBaseYaws[i] : -legBaseYaws[i];
        coxa.rotation.y = baseYaw;
        pelvis.add(coxa);

        // Upper femur rising outward and upward
        const femurGroup = new THREE.Group();
        femurGroup.rotation.z = -side * 0.62;
        coxa.add(femurGroup);

        const femur = shadow(
          new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.045, 0.54, 5), this._mat.bone)
        );
        femur.position.y = 0.27;
        femurGroup.add(femur);

        // Knee joint bending sharply downward to the ground
        const knee = new THREE.Group();
        knee.position.set(0, 0.52, 0);
        knee.rotation.z = side * 2.18;
        femurGroup.add(knee);

        const tibia = shadow(
          new THREE.Mesh(new THREE.ConeGeometry(0.038, 0.78, 5), this._mat.armor)
        );
        tibia.position.y = 0.39;
        knee.add(tibia);

        this.spiderLegs.push({
          coxa,
          femurGroup,
          knee,
          side,
          index: i,
          baseYaw,
        });
      });
    }
  }

  /**
   * Returns active attack data only during offensive hitbox frames.
   */
  getActiveAttack() {
    if (
      !this.isAlive ||
      this.aiState !== 'attack' ||
      this._hasHitThisSwing ||
      this._attackMove === 'webSpit'
    ) {
      return null;
    }
    const base = new THREE.Vector3();
    const tip = new THREE.Vector3();
    this.weaponBaseMarker.getWorldPosition(base);
    this.weaponTipMarker.getWorldPosition(tip);

    const prevBase = this._hasPrevWeaponSample
      ? this._prevWeaponBase.clone()
      : base.clone();
    const prevTip = this._hasPrevWeaponSample
      ? this._prevWeaponTip.clone()
      : tip.clone();

    this._prevWeaponBase.copy(base);
    this._prevWeaponTip.copy(tip);
    this._hasPrevWeaponSample = true;

    const isHeavy = this._attackPattern === 1;
    let radius = 0.56;
    if (this.archetype === 'sentinel') {
      radius = this._attackMove === 'thrust' ? 0.62 : 0.64;
    } else if (this.archetype === 'direwolf') {
      radius = 0.62;
    } else if (this.archetype === 'spider') {
      radius = 0.72;
    }

    return {
      enemy: this,
      swingId: this._swingId,
      attackMove: this._attackMove,
      damage: isHeavy ? Math.round(this.baseDamage * 1.32) : this.baseDamage,
      staminaDamage: isHeavy ? Math.round(this.staminaDamage * 1.32) : this.staminaDamage,
      isHeavy,
      base,
      tip,
      prevBase,
      prevTip,
      radius,
    };
  }

  /**
   * Active strike trail sampling matching offensive hitbox frames 1:1.
   */
  isSlashTrailActive() {
    if (!this.isAlive || this.aiState !== 'attack' || this._attackMove === 'webSpit') {
      return null;
    }
    const base = new THREE.Vector3();
    const tip = new THREE.Vector3();
    this.weaponBaseMarker.getWorldPosition(base);
    this.weaponTipMarker.getWorldPosition(tip);
    return {
      swingId: `${this.id}-${this._swingId}`,
      base,
      tip,
      isHeavy: this._attackPattern === 1,
      isThrust: this._attackMove === 'thrust' || this._attackMove === 'pounce',
    };
  }

  markAttackHit() {
    this._hasHitThisSwing = true;
  }

  takeDamage(amount, poiseDamage, knockbackDir, isHeavy = false) {
    if (!this.isAlive) return { hit: false, killed: false, staggered: false };

    this.hp = Math.max(0, this.hp - amount);
    this.poise -= poiseDamage;
    this.poiseRegenTimer = 3.2;
    this._hitFlashTimer = 0.14;
    this._damageBarTimer = 5.5;

    if (this.aiState === 'patrol') {
      this.aiState = 'pursue';
    }

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
        this.position.y + 0.35 + Math.random() * 1.15,
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

  _beginWindup(distToPlayer, forcedMove = null) {
    this.aiState = 'windup';
    this._stateTimer = 0;
    this._hasHitThisSwing = false;
    this._hasPrevWeaponSample = false;
    this._projectileFiredThisAttack = false;
    this._swingId += 1;

    if (this.archetype === 'sentinel') {
      if (forcedMove === 'thrust' || forcedMove === 'sweep') {
        this._attackMove = forcedMove;
      } else if (distToPlayer <= 2.35) {
        this._attackMove = Math.random() < 0.68 ? 'sweep' : 'thrust';
      } else {
        this._attackMove = Math.random() < 0.82 ? 'thrust' : 'sweep';
      }
      this._attackPattern = this._attackMove === 'sweep' ? 1 : 0;
      this._windupDuration = this._attackMove === 'sweep' ? 0.72 : 0.6;
      this._attackDuration = this._attackMove === 'sweep' ? 0.3 : 0.28;
      this._recoverDuration = this._attackMove === 'sweep' ? 0.78 : 0.72;
    } else if (this.archetype === 'direwolf') {
      if (forcedMove === 'pounce' || forcedMove === 'bite') {
        this._attackMove = forcedMove;
      } else if (distToPlayer > 2.2) {
        this._attackMove = 'pounce';
      } else {
        this._attackMove = Math.random() < 0.55 ? 'bite' : 'pounce';
      }
      this._attackPattern = this._attackMove === 'pounce' ? 1 : 0;
      this._windupDuration = this._attackMove === 'pounce' ? 0.52 : 0.38;
      this._attackDuration = this._attackMove === 'pounce' ? 0.28 : 0.22;
      this._recoverDuration = this._attackMove === 'pounce' ? 0.54 : 0.42;
    } else if (this.archetype === 'spider') {
      if (forcedMove === 'legSweep' || forcedMove === 'leapSlam' || forcedMove === 'webSpit') {
        this._attackMove = forcedMove;
      } else if (distToPlayer > 4.2) {
        this._attackMove = Math.random() < 0.72 ? 'webSpit' : 'leapSlam';
      } else if (distToPlayer > 2.6) {
        this._attackMove = Math.random() < 0.55 ? 'leapSlam' : 'legSweep';
      } else {
        this._attackMove = Math.random() < 0.68 ? 'legSweep' : 'leapSlam';
      }
      this._attackPattern = this._attackMove === 'leapSlam' ? 1 : 0;
      this._windupDuration =
        this._attackMove === 'leapSlam' ? 0.68 : this._attackMove === 'webSpit' ? 0.56 : 0.54;
      this._attackDuration = this._attackMove === 'webSpit' ? 0.24 : 0.28;
      this._recoverDuration = this._attackMove === 'leapSlam' ? 0.78 : 0.62;
    } else {
      if (forcedMove === 'slash' || forcedMove === 'overhead') {
        this._attackMove = forcedMove;
      } else {
        this._attackMove = Math.random() < 0.36 ? 'overhead' : 'slash';
      }
      this._attackPattern = this._attackMove === 'overhead' ? 1 : 0;
      this._windupDuration = this._attackMove === 'overhead' ? 0.72 : 0.56;
      this._attackDuration = 0.24;
      this._recoverDuration = this._attackMove === 'overhead' ? 0.76 : 0.68;
    }

    if (distToPlayer > this.attackRange * 0.96 && this._attackMove !== 'webSpit') {
      this._windupDuration += 0.04;
    }
  }

  update(dt, player, world, otherEnemies) {
    this._updateAshParticles(dt);

    if (this._hitFlashTimer > 0) {
      this._hitFlashTimer = Math.max(0, this._hitFlashTimer - dt);
      const flash = this._hitFlashTimer > 0 ? 0.65 : 0;
      this._mat.armor.emissive.setRGB(flash * 0.8, flash * 0.25, flash * 0.15);
      this._mat.bone.emissive.setRGB(flash * 0.9, flash * 0.4, flash * 0.2);
    }
    if (this.aiState !== 'attack' && this.aiState !== 'windup') {
      this._mat.rust.emissive.setRGB(0, 0, 0);
      this.telegraphOrb.visible = false;
      this._mat.eyeGlow.color.setHex(this.archetype === 'spider' ? 0x45f5ff : 0xff3c1e);
    }

    if (this._damageBarTimer > 0) {
      this._damageBarTimer = Math.max(0, this._damageBarTimer - dt);
    }

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

    if (this.aiState === 'patrol' && distToPlayer > 36) {
      return;
    }

    if (this._attackCooldown > 0) {
      this._attackCooldown = Math.max(0, this._attackCooldown - dt);
    }

    let desiredVx = 0;
    let desiredVz = 0;
    let targetYaw = this.facingYaw;

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
          if (dist < 0.5) {
            this._patrolPause = 1.2 + Math.random() * 1.1;
            this._patrolTarget =
              this._patrolTarget.distanceToSquared(this.patrolA) < 0.25
                ? this.patrolB.clone()
                : this.patrolA.clone();
          } else {
            desiredVx = (dx / dist) * this.walkSpeed * 0.72;
            desiredVz = (dz / dist) * this.walkSpeed * 0.72;
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

        // Giant Spider can initiate ranged web-spit from mid-range
        if (
          this.archetype === 'spider' &&
          distToPlayer >= 4.4 &&
          distToPlayer <= 11.5 &&
          this._attackCooldown <= 0 &&
          Math.random() < 0.045
        ) {
          this._beginWindup(distToPlayer, 'webSpit');
          break;
        }

        if (distToPlayer <= this.attackRange * 0.94 && this._attackCooldown <= 0) {
          this._beginWindup(distToPlayer);
        } else if (distToPlayer <= this.attackRange * 1.18) {
          this.aiState = 'strafe';
          this._stateTimer = 0;
          this._strafeDuration =
            this.archetype === 'direwolf'
              ? 0.28 + Math.random() * 0.35
              : 0.48 + Math.random() * 0.62;
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

        if (distToPlayer > this.attackRange * 1.4) {
          this.aiState = 'pursue';
          break;
        }

        const rightX = -dirToPlayerZ * this._strafeDir;
        const rightZ = dirToPlayerX * this._strafeDir;
        const radialAdjust =
          distToPlayer < this.attackRange * 0.6
            ? -0.45
            : distToPlayer > this.attackRange * 0.92
            ? 0.65
            : 0;

        const strafeSpeed = this.archetype === 'direwolf' ? this.chaseSpeed * 0.72 : this.walkSpeed;
        desiredVx = (rightX * 0.85 + dirToPlayerX * radialAdjust) * strafeSpeed;
        desiredVz = (rightZ * 0.85 + dirToPlayerZ * radialAdjust) * strafeSpeed;

        if (this._stateTimer >= this._strafeDuration && this._attackCooldown <= 0) {
          this._beginWindup(distToPlayer);
        }
        break;
      }

      case 'windup': {
        this._stateTimer += dt;
        const t = Math.min(this._stateTimer / this._windupDuration, 1);

        if (t < 0.86) {
          targetYaw = Math.atan2(dirToPlayerX, dirToPlayerZ);
        }

        if (t >= 0.48 && distToPlayer > 1.32 && this._attackMove !== 'webSpit') {
          const advanceSpeed =
            this._attackMove === 'thrust' || this._attackMove === 'pounce' ? 2.8 : 2.1;
          desiredVx = dirToPlayerX * advanceSpeed;
          desiredVz = dirToPlayerZ * advanceSpeed;
        }

        this.telegraphOrb.visible = true;
        this._mat.telegraphGlow.color.setHex(
          this._attackMove === 'webSpit' ? 0x7be8ff : 0xffa838
        );
        this._mat.telegraphGlow.opacity = 0.88;
        const pulse = 0.72 + 0.65 * Math.sin(t * Math.PI);
        this.telegraphOrb.scale.setScalar(pulse);
        this.telegraphOrb.rotation.y += dt * 7;
        this._mat.eyeGlow.color.setHex(0xffc966);
        this._mat.rust.emissive.setRGB(0.28 * t, 0.14 * t, 0.03 * t);

        if (this._stateTimer >= this._windupDuration) {
          this.aiState = 'attack';
          this._stateTimer = 0;
          this._hasPrevWeaponSample = false;

          const fwdX = Math.sin(this.facingYaw);
          const fwdZ = Math.cos(this.facingYaw);
          this._lungeDirX = fwdX;
          this._lungeDirZ = fwdZ;

          if (this._attackMove === 'webSpit') {
            this._lungeVelocity = -1.5; // Slight recoil on spit
            if (!this._projectileFiredThisAttack && this.onShootProjectile) {
              this._projectileFiredThisAttack = true;
              const origin = new THREE.Vector3();
              this.telegraphOrb.getWorldPosition(origin);
              const target = player.position.clone().add(new THREE.Vector3(0, 1.0, 0));
              this.onShootProjectile(origin, target, this);
            }
          } else if (this.archetype === 'sentinel') {
            this._lungeVelocity = this._attackMove === 'thrust' ? 11.4 : 6.4;
          } else if (this.archetype === 'direwolf') {
            this._lungeVelocity = this._attackMove === 'pounce' ? 13.0 : 9.6;
          } else if (this.archetype === 'spider') {
            this._lungeVelocity = this._attackMove === 'leapSlam' ? 11.4 : 7.6;
          } else {
            this._lungeVelocity = this._attackMove === 'overhead' ? 7.6 : 6.8;
          }
          this.velocity.x = fwdX * this._lungeVelocity;
          this.velocity.z = fwdZ * this._lungeVelocity;
        }
        break;
      }

      case 'attack': {
        this._stateTimer += dt;
        const tAtk = Math.min(this._stateTimer / this._attackDuration, 1);

        const lungeCurve =
          this._attackMove === 'thrust' || this._attackMove === 'pounce'
            ? Math.max(0.15, 1 - tAtk * 0.55)
            : Math.max(0.1, 1 - tAtk * 0.78);
        desiredVx = this._lungeDirX * this._lungeVelocity * lungeCurve;
        desiredVz = this._lungeDirZ * this._lungeVelocity * lungeCurve;

        this.telegraphOrb.visible = true;
        this._mat.telegraphGlow.color.setHex(
          this._attackMove === 'webSpit' ? 0x99f2ff : 0xff5a2a
        );
        this._mat.telegraphGlow.opacity = 0.95 * (1 - tAtk * 0.35);
        this.telegraphOrb.scale.setScalar(1.32 - tAtk * 0.45);
        this.telegraphOrb.rotation.y += dt * 14;
        this._mat.eyeGlow.color.setHex(0xff3c1e);
        this._mat.rust.emissive.setRGB(0.85 * (1 - tAtk * 0.45), 0.24 * (1 - tAtk * 0.5), 0.06);

        if (this._stateTimer >= this._attackDuration) {
          this.aiState = 'recover';
          this._stateTimer = 0;
          this.telegraphOrb.visible = false;
          this._mat.rust.emissive.setRGB(0, 0, 0);
        }
        break;
      }

      case 'recover': {
        this._stateTimer += dt;
        targetYaw = Math.atan2(dirToPlayerX, dirToPlayerZ);
        if (this._stateTimer >= this._recoverDuration) {
          this._attackCooldown =
            this.archetype === 'direwolf'
              ? 0.22 + Math.random() * 0.25
              : 0.42 + Math.random() * 0.42;
          this.aiState = distToPlayer <= this.attackRange * 1.25 ? 'strafe' : 'pursue';
          this._stateTimer = 0;
          this._strafeDuration =
            this.archetype === 'direwolf' ? 0.25 + Math.random() * 0.3 : 0.45 + Math.random() * 0.6;
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

    const turnRate = this.aiState === 'windup' ? 12.5 : this.aiState === 'attack' ? 1.8 : 8.5;
    this.facingYaw += angleDiff(this.facingYaw, targetYaw) * (1 - Math.exp(-turnRate * dt));

    const accel = this.aiState === 'attack' ? 19.0 : this.aiState === 'stagger' ? 7.5 : 11.5;
    this.velocity.x = damp(this.velocity.x, desiredVx, accel, dt);
    this.velocity.z = damp(this.velocity.z, desiredVz, accel, dt);

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    world.resolveCollision(this.position, this.collisionRadius);

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

    if (playerAlive) {
      const dx = this.position.x - player.position.x;
      const dz = this.position.z - player.position.z;
      const margin = this.aiState === 'attack' ? -0.02 : 0.08;
      const minDist = this.collisionRadius + player.collisionRadius + margin;
      const distSq = dx * dx + dz * dz;
      if (distSq < minDist * minDist) {
        const d = Math.sqrt(distSq) || 0.01;
        const push = minDist - d;
        this.position.x += (dx / d) * push;
        this.position.z += (dz / d) * push;
      }
    }

    const groundY = world.getTerrainHeight
      ? world.getTerrainHeight(this.position.x, this.position.z)
      : world.getGroundHeight(this.position.x, this.position.z);
    this.position.y = damp(this.position.y, groundY, 20, dt);

    this.root.position.copy(this.position);
    this.root.rotation.y = this.facingYaw;

    if (this.archetype === 'direwolf') {
      this._animateWolfRig(dt);
    } else if (this.archetype === 'spider') {
      this._animateSpiderRig(dt);
    } else {
      this._animateHumanoidRig(dt);
    }
  }

  _animateWolfRig(dt) {
    const p = this.pivots;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const moveAmt = THREE.MathUtils.clamp(speed / this.chaseSpeed, 0, 1);

    if (moveAmt > 0.04) {
      this._stridePhase += dt * speed * 2.9;
    }

    const sSin = Math.sin(this._stridePhase);
    const sCos = Math.cos(this._stridePhase);

    // Quadruped bounding gait
    const amp = 0.62 * moveAmt;
    p.legFL.hip.rotation.x = damp(p.legFL.hip.rotation.x, sSin * amp, 16, dt);
    p.legFR.hip.rotation.x = damp(p.legFR.hip.rotation.x, -sSin * amp, 16, dt);
    p.legBL.hip.rotation.x = damp(p.legBL.hip.rotation.x, -sSin * amp, 16, dt);
    p.legBR.hip.rotation.x = damp(p.legBR.hip.rotation.x, sSin * amp, 16, dt);

    p.legFL.knee.rotation.x = damp(p.legFL.knee.rotation.x, Math.max(0, sCos) * 0.55 * moveAmt, 16, dt);
    p.legFR.knee.rotation.x = damp(p.legFR.knee.rotation.x, Math.max(0, -sCos) * 0.55 * moveAmt, 16, dt);
    p.legBL.knee.rotation.x = damp(p.legBL.knee.rotation.x, -Math.max(0, -sCos) * 0.45 * moveAmt, 16, dt);
    p.legBR.knee.rotation.x = damp(p.legBR.knee.rotation.x, -Math.max(0, sCos) * 0.45 * moveAmt, 16, dt);

    p.tail.rotation.y = Math.sin(performance.now() * 0.006) * 0.28;

    if (this.aiState === 'windup') {
      const t = Math.min(this._stateTimer / this._windupDuration, 1);
      // Crouch low before pouncing, baring fangs
      p.pelvis.position.y = damp(p.pelvis.position.y, 0.44 - 0.08 * t, 16, dt);
      p.torso.rotation.x = damp(p.torso.rotation.x, 0.26 * t, 14, dt);
      p.neck.rotation.x = damp(p.neck.rotation.x, -0.32 * t, 14, dt);
      p.jaw.rotation.x = damp(p.jaw.rotation.x, 0.55 * t, 16, dt);
      return;
    }

    if (this.aiState === 'attack') {
      const t = Math.min(this._stateTimer / this._attackDuration, 1);
      const leapArc = Math.sin(t * Math.PI);
      p.pelvis.position.y = 0.62 + (this._attackMove === 'pounce' ? leapArc * 0.42 : leapArc * 0.16);
      p.torso.rotation.x = -0.25 * leapArc;
      p.neck.rotation.x = 0.22 * leapArc;
      // Snap jaws shut mid-bite
      p.jaw.rotation.x = t < 0.45 ? 0.6 : 0.04;
      p.legFL.hip.rotation.x = -0.65 * leapArc;
      p.legFR.hip.rotation.x = -0.65 * leapArc;
      p.legBL.hip.rotation.x = 0.65 * leapArc;
      p.legBR.hip.rotation.x = 0.65 * leapArc;
      return;
    }

    p.pelvis.position.y = damp(p.pelvis.position.y, 0.62 + Math.abs(sSin) * 0.04 * moveAmt, 14, dt);
    p.torso.rotation.x = damp(p.torso.rotation.x, sCos * 0.06 * moveAmt, 12, dt);
    p.neck.rotation.x = damp(p.neck.rotation.x, 0, 12, dt);
    p.jaw.rotation.x = damp(p.jaw.rotation.x, 0.08, 12, dt);
  }

  _animateSpiderRig(dt) {
    const p = this.pivots;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const moveAmt = THREE.MathUtils.clamp(speed / this.chaseSpeed, 0, 1);

    if (moveAmt > 0.03) {
      this._stridePhase += dt * speed * 3.8;
    }

    // 8-legged alternating tetrapod arachnid gait
    for (let i = 0; i < this.spiderLegs.length; i++) {
      const leg = this.spiderLegs[i];
      const phaseOffset = ((leg.index + (leg.side > 0 ? 0 : 1)) % 2) * Math.PI + leg.index * 0.35;
      const cycle = this._stridePhase + phaseOffset;
      const swing = Math.sin(cycle) * 0.28 * moveAmt;
      const lift = Math.max(0, Math.cos(cycle)) * 0.32 * moveAmt;

      leg.coxa.rotation.y = leg.baseYaw + swing * leg.side;
      leg.femurGroup.rotation.z = -leg.side * (0.62 + lift);
    }

    if (this.aiState === 'windup') {
      const t = Math.min(this._stateTimer / this._windupDuration, 1);
      if (this._attackMove === 'webSpit') {
        p.torso.rotation.x = damp(p.torso.rotation.x, -0.25 * t, 14, dt);
        p.abdomen.rotation.x = damp(p.abdomen.rotation.x, 0.45 * t, 14, dt);
      } else {
        // Rear up on hind legs, spreading mandibles & front legs wide
        p.pelvis.position.y = damp(p.pelvis.position.y, 0.72, 14, dt);
        p.torso.rotation.x = damp(p.torso.rotation.x, -0.48 * t, 14, dt);
      }
      p.mandibleL.rotation.y = 0.48 * t;
      p.mandibleR.rotation.y = -0.48 * t;
      return;
    }

    if (this.aiState === 'attack') {
      const t = Math.min(this._stateTimer / this._attackDuration, 1);
      const arc = Math.sin(t * Math.PI);
      if (this._attackMove === 'leapSlam') {
        p.pelvis.position.y = 0.56 + arc * 0.55;
        p.torso.rotation.x = THREE.MathUtils.lerp(-0.45, 0.35, t);
      } else if (this._attackMove === 'legSweep') {
        p.torso.rotation.y = THREE.MathUtils.lerp(-0.65, 0.65, t);
        p.torso.rotation.x = 0.18;
      }
      p.mandibleL.rotation.y = -0.25 * arc;
      p.mandibleR.rotation.y = 0.25 * arc;
      return;
    }

    const time = performance.now() * 0.001;
    p.pelvis.position.y = damp(p.pelvis.position.y, 0.56 + Math.sin(time * 3.2) * 0.02, 12, dt);
    p.torso.rotation.x = damp(p.torso.rotation.x, 0, 12, dt);
    p.torso.rotation.y = damp(p.torso.rotation.y, 0, 12, dt);
    p.abdomen.rotation.x = damp(p.abdomen.rotation.x, Math.sin(time * 2.4) * 0.06, 10, dt);
    p.mandibleL.rotation.y = damp(p.mandibleL.rotation.y, Math.sin(time * 4.0) * 0.08, 12, dt);
    p.mandibleR.rotation.y = damp(p.mandibleR.rotation.y, -Math.sin(time * 4.0) * 0.08, 12, dt);
  }

  _animateHumanoidRig(dt) {
    const p = this.pivots;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const moveAmt = THREE.MathUtils.clamp(speed / this.chaseSpeed, 0, 1);

    if (moveAmt > 0.05) {
      this._stridePhase += dt * speed * 2.55;
    }

    const sSin = Math.sin(this._stridePhase);
    const sCos = Math.cos(this._stridePhase);

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
      p.weapon.rotation.z = damp(p.weapon.rotation.z, 0, 14, dt);
      return;
    }

    if (this.aiState === 'windup') {
      const t = Math.min(this._stateTimer / this._windupDuration, 1);
      if (this.archetype === 'sentinel') {
        if (this._attackMove === 'sweep') {
          p.torso.rotation.set(0.16 * t, -0.92 * t, 0);
          p.shoulderR.rotation.set(-0.65 * t, -0.65 * t, -1.05 * t);
          p.elbowR.rotation.x = damp(p.elbowR.rotation.x, -0.45 * t, 14, dt);
          p.weapon.rotation.set(
            damp(p.weapon.rotation.x, Math.PI * 0.68, 14, dt),
            0,
            damp(p.weapon.rotation.z, -Math.PI * 0.42 * t, 14, dt)
          );
        } else {
          p.torso.rotation.set(0.24 * t, -0.42 * t, 0);
          p.shoulderR.rotation.set(
            damp(p.shoulderR.rotation.x, 0.72 * t, 14, dt),
            0,
            damp(p.shoulderR.rotation.z, -0.18 * t, 14, dt)
          );
          p.elbowR.rotation.x = damp(p.elbowR.rotation.x, -1.25 * t, 14, dt);
          p.weapon.rotation.set(
            damp(p.weapon.rotation.x, Math.PI * 0.76, 14, dt),
            0,
            damp(p.weapon.rotation.z, 0, 14, dt)
          );
        }
      } else if (this._attackMove === 'overhead') {
        p.torso.rotation.x = damp(p.torso.rotation.x, -0.22 * t, 14, dt);
        p.torso.rotation.y = damp(p.torso.rotation.y, -0.25 * t, 14, dt);
        p.shoulderR.rotation.set(
          damp(p.shoulderR.rotation.x, -2.25 * t, 14, dt),
          0,
          damp(p.shoulderR.rotation.z, -0.22 * t, 14, dt)
        );
        p.elbowR.rotation.x = damp(p.elbowR.rotation.x, -0.45 * t, 14, dt);
        p.weapon.rotation.set(damp(p.weapon.rotation.x, Math.PI * 0.24, 14, dt), 0, 0);
      } else {
        p.torso.rotation.x = damp(p.torso.rotation.x, 0.14 * t, 14, dt);
        p.torso.rotation.y = damp(p.torso.rotation.y, -0.78 * t, 14, dt);
        p.shoulderR.rotation.set(
          damp(p.shoulderR.rotation.x, -1.25 * t, 14, dt),
          -0.38 * t,
          damp(p.shoulderR.rotation.z, -0.95 * t, 14, dt)
        );
        p.elbowR.rotation.x = damp(p.elbowR.rotation.x, -0.45 * t, 14, dt);
        p.weapon.rotation.set(damp(p.weapon.rotation.x, Math.PI * 0.56, 14, dt), 0, 0);
      }
      p.shoulderL.rotation.set(-0.5, 0.35, 0.15);
      p.elbowL.rotation.set(-0.9, 0, 0);
      return;
    }

    if (this.aiState === 'attack') {
      const t = Math.min(this._stateTimer / this._attackDuration, 1);
      if (this.archetype === 'sentinel') {
        if (this._attackMove === 'sweep') {
          const sweep = 1 - Math.pow(1 - t, 1.85);
          p.torso.rotation.set(0.22, THREE.MathUtils.lerp(-0.92, 1.15, sweep), 0);
          p.shoulderR.rotation.set(
            -0.68,
            THREE.MathUtils.lerp(-0.65, 1.08, sweep),
            THREE.MathUtils.lerp(-1.05, 0.42, sweep)
          );
          p.elbowR.rotation.x = -0.22;
          p.weapon.rotation.set(Math.PI * 0.78, 0, -Math.PI * 0.42);
        } else {
          const snap = Math.min(t * 2.35, 1);
          const easeSnap = 1 - Math.pow(1 - snap, 2.0);
          p.torso.rotation.set(0.26, THREE.MathUtils.lerp(-0.42, 0.12, easeSnap), 0);
          p.shoulderR.rotation.set(THREE.MathUtils.lerp(0.72, -1.25, easeSnap), 0, -0.05);
          p.elbowR.rotation.x = THREE.MathUtils.lerp(-1.25, -0.08, easeSnap);
          p.weapon.rotation.set(THREE.MathUtils.lerp(Math.PI * 0.76, Math.PI * 0.85, easeSnap), 0, 0);
        }
      } else if (this._attackMove === 'overhead') {
        const slam = 1 - Math.pow(1 - t, 1.9);
        p.torso.rotation.set(THREE.MathUtils.lerp(-0.22, 0.44, slam), 0.14, 0);
        p.shoulderR.rotation.set(THREE.MathUtils.lerp(-2.25, -0.06, slam), 0, -0.05);
        p.elbowR.rotation.x = -0.2;
        p.weapon.rotation.set(Math.PI * 0.62, 0, 0);
      } else {
        const swing = 1 - Math.pow(1 - t, 1.95);
        p.torso.rotation.set(0.22, THREE.MathUtils.lerp(-0.78, 0.88, swing), 0);
        p.shoulderR.rotation.set(
          -0.88,
          THREE.MathUtils.lerp(-0.38, 1.05, swing),
          THREE.MathUtils.lerp(-0.95, 0.48, swing)
        );
        p.elbowR.rotation.x = -0.24;
        p.weapon.rotation.set(Math.PI * 0.72, 0, 0);
      }
      return;
    }

    if (this.aiState === 'recover') {
      p.torso.rotation.x = damp(p.torso.rotation.x, 0.25, 8, dt);
      p.torso.rotation.y = damp(p.torso.rotation.y, 0.18, 8, dt);
      p.shoulderR.rotation.set(damp(p.shoulderR.rotation.x, -0.25, 8, dt), 0, -0.2);
      p.elbowR.rotation.x = damp(p.elbowR.rotation.x, -0.5, 8, dt);
      p.weapon.rotation.x = damp(p.weapon.rotation.x, Math.PI * 0.42, 8, dt);
      p.weapon.rotation.z = damp(p.weapon.rotation.z, 0, 10, dt);
      return;
    }

    const time = performance.now() * 0.001;
    const hunch = this.aiState === 'patrol' ? 0.16 : 0.24;
    p.torso.rotation.x = damp(p.torso.rotation.x, hunch + Math.sin(time * 2.2) * 0.03, 10, dt);
    p.torso.rotation.y = damp(p.torso.rotation.y, -sSin * 0.12 * moveAmt, 10, dt);
    p.neck.rotation.x = damp(p.neck.rotation.x, -hunch * 0.65, 10, dt);

    p.shoulderL.rotation.x = damp(p.shoulderL.rotation.x, -0.45 + sSin * 0.22 * moveAmt, 10, dt);
    p.shoulderL.rotation.y = damp(p.shoulderL.rotation.y, 0.35, 10, dt);
    p.elbowL.rotation.x = damp(p.elbowL.rotation.x, -0.78, 10, dt);

    p.shoulderR.rotation.x = damp(p.shoulderR.rotation.x, -0.35 - sSin * 0.28 * moveAmt, 10, dt);
    p.shoulderR.rotation.y = damp(p.shoulderR.rotation.y, 0, 10, dt);
    p.shoulderR.rotation.z = damp(p.shoulderR.rotation.z, -0.18, 10, dt);
    p.elbowR.rotation.x = damp(p.elbowR.rotation.x, -0.62, 10, dt);
    p.weapon.rotation.x = damp(p.weapon.rotation.x, Math.PI * 0.42, 10, dt);
    p.weapon.rotation.z = damp(p.weapon.rotation.z, 0, 10, dt);
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
 * Manages all world enemies across Courtyard, Plains Outpost, and Mountain Crags.
 */
export class EnemyManager {
  constructor(scene, world = null) {
    this.scene = scene;
    this.world = world;
    this.enemies = [];
    this.onEnemyKilled = null;
    this.onAllCleared = null;
    this.onShootProjectile = null;

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
      wolfPeltDark: new THREE.MeshStandardMaterial({
        color: 0x2c303a,
        roughness: 0.88,
        metalness: 0.06,
        flatShading: true,
      }),
      wolfPeltLight: new THREE.MeshStandardMaterial({
        color: 0x545b6b,
        roughness: 0.85,
        metalness: 0.05,
        flatShading: true,
      }),
      fangBone: new THREE.MeshStandardMaterial({
        color: 0xe6dec8,
        roughness: 0.4,
        metalness: 0.1,
        flatShading: true,
      }),
      spiderChitin: new THREE.MeshStandardMaterial({
        color: 0x1d2633,
        roughness: 0.45,
        metalness: 0.38,
        flatShading: true,
      }),
      spiderFrost: new THREE.MeshStandardMaterial({
        color: 0x4c6b8a,
        roughness: 0.38,
        metalness: 0.25,
        flatShading: true,
      }),
      spiderMandible: new THREE.MeshStandardMaterial({
        color: 0x7ac5dc,
        roughness: 0.3,
        metalness: 0.45,
        flatShading: true,
      }),
      eyeGlow: new THREE.MeshBasicMaterial({
        color: 0xff3c1e,
      }),
      spiderEyeGlow: new THREE.MeshBasicMaterial({
        color: 0x45f5ff,
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
    this.enemies = ENEMY_SPAWNS.map((cfg) => {
      const groundY = this.world
        ? this.world.getTerrainHeight(cfg.pos[0], cfg.pos[2])
        : 0;
      const groundedCfg = {
        ...cfg,
        pos: [cfg.pos[0], groundY, cfg.pos[2]],
      };
      return new Enemy(
        this.scene,
        groundedCfg,
        this._sharedMaterials,
        (origin, target, enemy) => {
          if (this.onShootProjectile) {
            this.onShootProjectile(origin, target, enemy);
          }
        }
      );
    });
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
      const remainingInBiome = this.enemies.filter(
        (e) => e.isAlive && e.biome === enemy.biome
      ).length;
      this.onEnemyKilled(enemy, remainingInBiome);
    }
  }
}
