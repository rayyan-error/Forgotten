import * as THREE from 'three';

function angleDiff(from, to) {
  let diff = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function damp(current, target, lambda, dt) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
}

const ATTACK_SPECS = {
  light_1: {
    duration: 0.6,
    windupEnd: 0.19,
    activeEnd: 0.37,
    comboWindowStart: 0.28,
    staminaCost: 18,
    damage: 26,
    poiseDamage: 18,
    lungeSpeed: 5.2,
    isHeavy: false,
    next: 'light_2',
  },
  light_2: {
    duration: 0.62,
    windupEnd: 0.17,
    activeEnd: 0.36,
    comboWindowStart: 0.28,
    staminaCost: 18,
    damage: 29,
    poiseDamage: 20,
    lungeSpeed: 5.4,
    isHeavy: false,
    next: 'light_3',
  },
  light_3: {
    duration: 0.8,
    windupEnd: 0.28,
    activeEnd: 0.46,
    comboWindowStart: 0.8,
    staminaCost: 22,
    damage: 40,
    poiseDamage: 36,
    lungeSpeed: 6.4,
    isHeavy: true,
    next: null,
  },
  heavy: {
    duration: 0.98,
    windupEnd: 0.38,
    activeEnd: 0.56,
    comboWindowStart: 0.98,
    staminaCost: 34,
    damage: 56,
    poiseDamage: 65,
    lungeSpeed: 7.4,
    isHeavy: true,
    next: null,
  },
};

/**
 * Procedural articulated dark-fantasy Knight player controller.
 * Supports Souls-like locomotion, stamina, 360° dodge roll with i-frames,
 * 3-hit greatsword combo, heavy cleave, shield blocking & guard break,
 * and Crimson Flask healing.
 */
export class Player {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3} spawnPosition
   */
  constructor(scene, spawnPosition = new THREE.Vector3(0, 0, 10.6)) {
    this.scene = scene;
    this.spawnPosition = spawnPosition.clone();

    // World transform state
    this.position = spawnPosition.clone();
    this.velocity = new THREE.Vector3();
    this.facingYaw = Math.PI; // Facing -Z toward the Grace & Eclipse
    this.collisionRadius = 0.42;

    // Combat & Resource Stats
    this.stats = {
      hp: 100,
      maxHp: 100,
      fp: 60,
      maxFp: 60,
      stamina: 100,
      maxStamina: 100,
      flasks: 3,
      maxFlasks: 3,
      flaskHealAmount: 55,
      staminaExhausted: false,
      regenDelayTimer: 0,
    };

    // Action / Combat / i-frame state
    // 'idle' | 'move' | 'sprint' | 'roll' | 'backstep' | 'attack' | 'drink' | 'hitStagger' | 'guardBreak' | 'dead'
    this.actionState = 'idle';
    this.isInvulnerable = false;
    this.isBlocking = false;
    this.isLockedOn = false;

    this._dodgeTimer = 0;
    this._dodgeDuration = 0.58;
    this._dodgeDir = new THREE.Vector3(0, 0, -1);
    this._dodgeLandingPuffDone = false;

    // Melee Attack state
    this._attackKind = null;
    this._attackTimer = 0;
    this._attackSwingId = 0;
    this._attackHitSet = new Set();
    this._queuedAttack = null;
    this._attackSlamPuffDone = false;

    // Block / Flask / Stagger timers
    this._blockRecoilTimer = 0;
    this._drinkTimer = 0;
    this._drinkDuration = 0.85;
    this._drinkApplied = false;
    this._staggerTimer = 0;
    this._staggerDuration = 0.4;
    this._deathTimer = 0;

    // Callbacks wired by main.js / CombatSystem
    this.onAttackStart = null;
    this.onHeavySlamImpact = null;
    this.onHealSip = null;

    // Locomotion tuning (meters/sec)
    this.walkSpeed = 4.6;
    this.blockWalkSpeed = 2.55;
    this.drinkWalkSpeed = 2.1;
    this.sprintSpeed = 7.7;
    this.rollBurstSpeed = 10.8;
    this.backstepSpeed = 8.4;

    // Stamina tuning
    this.sprintDrainPerSec = 21;
    this.rollStaminaCost = 26;
    this.backstepStaminaCost = 18;
    this.staminaRegenPerSec = 34;
    this.staminaRegenDelay = 0.72;
    this.exhaustionRecoveryThreshold = 20;

    // Procedural animation phase & smoothed weights
    this._stridePhase = 0;
    this._moveBlend = 0;
    this._sprintBlend = 0;
    this._blockBlend = 0;
    this._forwardComponent = 0;
    this._rightComponent = 0;
    this._cloakLagPitch = 0;
    this._cloakLagRoll = 0;
    this._lastYaw = this.facingYaw;

    // Dust puff pool
    this._dustPuffs = [];
    this._dustGroup = new THREE.Group();
    this.scene.add(this._dustGroup);

    // Build character hierarchy
    this.root = new THREE.Group();
    this.root.position.copy(this.position);
    this.root.rotation.y = this.facingYaw;
    this.scene.add(this.root);

    this.pivots = {};
    this._buildKnightMesh();
  }

  _buildKnightMesh() {
    const mat = {
      armorDark: new THREE.MeshStandardMaterial({
        color: 0x484d59,
        roughness: 0.42,
        metalness: 0.72,
        flatShading: true,
      }),
      armorSteel: new THREE.MeshStandardMaterial({
        color: 0x717888,
        roughness: 0.34,
        metalness: 0.8,
        flatShading: true,
      }),
      bladeSteel: new THREE.MeshStandardMaterial({
        color: 0xa2aab8,
        roughness: 0.24,
        metalness: 0.9,
        flatShading: true,
      }),
      brass: new THREE.MeshStandardMaterial({
        color: 0xb6904c,
        roughness: 0.36,
        metalness: 0.8,
        flatShading: true,
      }),
      cloak: new THREE.MeshStandardMaterial({
        color: 0x7c2830,
        roughness: 0.86,
        metalness: 0.04,
        flatShading: true,
        side: THREE.DoubleSide,
      }),
      cloakTrim: new THREE.MeshStandardMaterial({
        color: 0x4f191f,
        roughness: 0.9,
        metalness: 0.02,
        flatShading: true,
      }),
      leather: new THREE.MeshStandardMaterial({
        color: 0x2a1f1a,
        roughness: 0.85,
        metalness: 0.08,
        flatShading: true,
      }),
      shieldFace: new THREE.MeshStandardMaterial({
        color: 0x262c3a,
        roughness: 0.56,
        metalness: 0.45,
        flatShading: true,
      }),
      visorVoid: new THREE.MeshStandardMaterial({
        color: 0x0a090d,
        roughness: 0.95,
        metalness: 0.1,
      }),
      emberGlint: new THREE.MeshBasicMaterial({
        color: 0xdf8f34,
      }),
      flaskGlow: new THREE.MeshStandardMaterial({
        color: 0xe63b3b,
        emissive: 0xc92a2a,
        emissiveIntensity: 1.4,
        roughness: 0.2,
        metalness: 0.1,
        flatShading: true,
      }),
    };

    const addShadow = (mesh) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    };

    // Center-of-mass pivot for clean 360-degree tucked dodge roll
    const rollPivot = new THREE.Group();
    rollPivot.position.set(0, 0.88, 0);
    this.root.add(rollPivot);
    this.pivots.rollPivot = rollPivot;

    const bodyRoot = new THREE.Group();
    bodyRoot.position.set(0, -0.88, 0);
    rollPivot.add(bodyRoot);
    this.pivots.bodyRoot = bodyRoot;

    // ------------------------------------------------------------------------
    // Pelvis / Waist / Tassets
    // ------------------------------------------------------------------------
    const pelvis = new THREE.Group();
    pelvis.position.set(0, 0.91, 0);
    bodyRoot.add(pelvis);
    this.pivots.pelvis = pelvis;

    const waistMesh = addShadow(
      new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.21, 0.22, 8), mat.armorDark)
    );
    waistMesh.scale.set(1.12, 1, 0.86);
    pelvis.add(waistMesh);

    const belt = addShadow(
      new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.21, 0.08, 8), mat.leather)
    );
    belt.scale.set(1.14, 1, 0.88);
    belt.position.y = 0.05;
    pelvis.add(belt);

    const buckle = addShadow(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.04), mat.brass));
    buckle.position.set(0, 0.05, 0.18);
    pelvis.add(buckle);

    const frontTasset = addShadow(
      new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.24, 0.05), mat.armorDark)
    );
    frontTasset.position.set(0, -0.1, 0.16);
    frontTasset.rotation.x = -0.15;
    pelvis.add(frontTasset);

    [-1, 1].forEach((side) => {
      const sideTasset = addShadow(
        new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.24, 0.2), mat.armorSteel)
      );
      sideTasset.position.set(side * 0.22, -0.09, 0);
      sideTasset.rotation.z = side * 0.18;
      pelvis.add(sideTasset);
    });

    // ------------------------------------------------------------------------
    // Torso / Cuirass / Baldric / Sheath / Cloak
    // ------------------------------------------------------------------------
    const torso = new THREE.Group();
    torso.position.set(0, 0.09, 0);
    pelvis.add(torso);
    this.pivots.torso = torso;

    const chest = addShadow(
      new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.185, 0.48, 8), mat.armorSteel)
    );
    chest.scale.set(1.16, 1, 0.84);
    chest.position.y = 0.24;
    torso.add(chest);

    const breastRidge = addShadow(
      new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.36, 4), mat.armorDark)
    );
    breastRidge.position.set(0, 0.28, 0.13);
    breastRidge.rotation.x = Math.PI;
    breastRidge.scale.set(1.1, 1, 0.55);
    torso.add(breastRidge);

    const gorget = addShadow(
      new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.21, 0.12, 8), mat.armorDark)
    );
    gorget.position.y = 0.49;
    torso.add(gorget);

    const baldric = addShadow(
      new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.58, 0.38), mat.leather)
    );
    baldric.position.set(0, 0.27, 0);
    baldric.rotation.z = 0.62;
    torso.add(baldric);

    const scabbard = addShadow(
      new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.02, 0.045), mat.leather)
    );
    scabbard.position.set(0.04, 0.22, -0.22);
    scabbard.rotation.z = -0.52;
    scabbard.rotation.x = 0.08;
    torso.add(scabbard);

    const scabbardTip = addShadow(
      new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.16, 4), mat.brass)
    );
    scabbardTip.position.set(-0.23, -0.25, -0.26);
    scabbardTip.rotation.z = Math.PI - 0.52;
    torso.add(scabbardTip);

    // Tattered Wanderer Cloak
    const cloakMantle = addShadow(
      new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.34, 0.2, 8, 1, false, Math.PI * 0.55, Math.PI * 1.9),
        mat.cloakTrim
      )
    );
    cloakMantle.position.set(0, 0.44, -0.02);
    torso.add(cloakMantle);

    const cloakUpper = new THREE.Group();
    cloakUpper.position.set(0, 0.46, -0.17);
    torso.add(cloakUpper);
    this.pivots.cloakUpper = cloakUpper;

    const cloakTopPanel = addShadow(
      new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.04), mat.cloak)
    );
    cloakTopPanel.position.set(0, -0.23, -0.02);
    cloakUpper.add(cloakTopPanel);

    const cloakLower = new THREE.Group();
    cloakLower.position.set(0, -0.45, -0.02);
    cloakUpper.add(cloakLower);
    this.pivots.cloakLower = cloakLower;

    const tailSpecs = [
      { x: -0.15, w: 0.15, h: 0.52, rz: 0.06 },
      { x: 0.0, w: 0.18, h: 0.62, rz: 0.0 },
      { x: 0.15, w: 0.15, h: 0.48, rz: -0.06 },
    ];
    tailSpecs.forEach((t) => {
      const tail = addShadow(new THREE.Mesh(new THREE.BoxGeometry(t.w, t.h, 0.032), mat.cloak));
      tail.position.set(t.x, -t.h * 0.5, 0);
      tail.rotation.z = t.rz;
      cloakLower.add(tail);

      const tip = addShadow(
        new THREE.Mesh(new THREE.ConeGeometry(t.w * 0.52, 0.16, 4), mat.cloakTrim)
      );
      tip.position.set(t.x, -t.h - 0.07, 0);
      tip.rotation.x = Math.PI;
      tip.rotation.y = Math.PI * 0.25;
      cloakLower.add(tip);
    });

    // ------------------------------------------------------------------------
    // Head / Knight Helmet with Visor Slit
    // ------------------------------------------------------------------------
    const neck = new THREE.Group();
    neck.position.set(0, 0.54, 0.01);
    torso.add(neck);
    this.pivots.neck = neck;

    const helmGroup = new THREE.Group();
    neck.add(helmGroup);

    const helmDome = addShadow(
      new THREE.Mesh(new THREE.DodecahedronGeometry(0.155, 0), mat.armorSteel)
    );
    helmDome.position.set(0, 0.14, -0.01);
    helmDome.scale.set(0.92, 1.08, 1.05);
    helmGroup.add(helmDome);

    const crest = addShadow(
      new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.09, 0.25), mat.brass)
    );
    crest.position.set(0, 0.28, -0.02);
    crest.rotation.x = -0.15;
    helmGroup.add(crest);

    const visorRecess = new THREE.Mesh(
      new THREE.BoxGeometry(0.21, 0.055, 0.16),
      mat.visorVoid
    );
    visorRecess.position.set(0, 0.135, 0.085);
    helmGroup.add(visorRecess);

    [-0.042, 0.042].forEach((ex) => {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.014, 0.02), mat.emberGlint);
      eye.position.set(ex, 0.135, 0.155);
      helmGroup.add(eye);
    });

    const brow = addShadow(
      new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.05, 0.17), mat.armorDark)
    );
    brow.position.set(0, 0.18, 0.09);
    brow.rotation.x = 0.18;
    helmGroup.add(brow);

    const faceGuard = addShadow(
      new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.095, 0.13, 6), mat.armorSteel)
    );
    faceGuard.position.set(0, 0.05, 0.065);
    faceGuard.rotation.x = 0.15;
    helmGroup.add(faceGuard);

    const nosePeak = addShadow(
      new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.14, 4), mat.armorDark)
    );
    nosePeak.position.set(0, 0.07, 0.15);
    nosePeak.rotation.x = Math.PI * 0.5;
    nosePeak.rotation.y = Math.PI * 0.25;
    helmGroup.add(nosePeak);

    // ------------------------------------------------------------------------
    // Left Arm (+X), Kite Shield & Crimson Flask Prop
    // ------------------------------------------------------------------------
    const shoulderL = new THREE.Group();
    shoulderL.position.set(0.32, 0.44, 0);
    torso.add(shoulderL);
    this.pivots.shoulderL = shoulderL;

    const pauldronL = addShadow(
      new THREE.Mesh(
        new THREE.SphereGeometry(0.135, 6, 4, 0, Math.PI * 2, 0, Math.PI * 0.65),
        mat.armorSteel
      )
    );
    pauldronL.position.set(0.02, 0.02, 0);
    pauldronL.rotation.z = -0.35;
    shoulderL.add(pauldronL);

    const upperArmL = addShadow(
      new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.058, 0.26, 6), mat.armorDark)
    );
    upperArmL.position.y = -0.13;
    shoulderL.add(upperArmL);

    const elbowL = new THREE.Group();
    elbowL.position.set(0, -0.26, 0);
    shoulderL.add(elbowL);
    this.pivots.elbowL = elbowL;

    const forearmL = addShadow(
      new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.052, 0.25, 6), mat.armorSteel)
    );
    forearmL.position.y = -0.125;
    elbowL.add(forearmL);

    const handL = addShadow(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.08), mat.armorDark));
    handL.position.y = -0.26;
    elbowL.add(handL);

    // Crimson Estus Flask (visible only while drinking)
    const flaskGroup = new THREE.Group();
    flaskGroup.position.set(-0.02, -0.28, 0.06);
    flaskGroup.visible = false;
    elbowL.add(flaskGroup);
    this.pivots.flask = flaskGroup;

    const flaskBody = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.075, 0),
      mat.flaskGlow
    );
    flaskBody.scale.set(0.95, 1.25, 0.95);
    flaskGroup.add(flaskBody);

    const flaskNeck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.032, 0.07, 6),
      mat.brass
    );
    flaskNeck.position.y = 0.09;
    flaskGroup.add(flaskNeck);

    // Heraldic Kite Shield mounted on outer left forearm
    const shieldGroup = new THREE.Group();
    shieldGroup.position.set(0.09, -0.14, 0.04);
    shieldGroup.rotation.y = Math.PI * 0.5;
    elbowL.add(shieldGroup);
    this.pivots.shield = shieldGroup;

    this.shieldCenterMarker = new THREE.Object3D();
    this.shieldCenterMarker.position.set(0, 0.05, 0.05);
    shieldGroup.add(this.shieldCenterMarker);

    const shieldTop = addShadow(
      new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.44, 0.045), mat.shieldFace)
    );
    shieldTop.position.y = 0.1;
    shieldGroup.add(shieldTop);

    const shieldPoint = addShadow(
      new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.44, 4), mat.shieldFace)
    );
    shieldPoint.position.set(0, -0.33, 0);
    shieldPoint.rotation.x = Math.PI;
    shieldPoint.rotation.y = Math.PI * 0.25;
    shieldPoint.scale.set(1.36, 1, 0.14);
    shieldGroup.add(shieldPoint);

    const shieldRimTop = addShadow(
      new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.045, 0.058), mat.brass)
    );
    shieldRimTop.position.y = 0.32;
    shieldGroup.add(shieldRimTop);

    const shieldCrossV = addShadow(
      new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.62, 0.06), mat.brass)
    );
    shieldCrossV.position.set(0, -0.02, 0.008);
    shieldGroup.add(shieldCrossV);

    const shieldCrossH = addShadow(
      new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.045, 0.06), mat.brass)
    );
    shieldCrossH.position.set(0, 0.14, 0.008);
    shieldGroup.add(shieldCrossH);

    const shieldBoss = addShadow(
      new THREE.Mesh(new THREE.OctahedronGeometry(0.075, 0), mat.armorSteel)
    );
    shieldBoss.position.set(0, 0.14, 0.04);
    shieldBoss.scale.set(1, 1, 0.55);
    shieldGroup.add(shieldBoss);

    // ------------------------------------------------------------------------
    // Right Arm (-X) & Greatsword Held at the Ready
    // ------------------------------------------------------------------------
    const shoulderR = new THREE.Group();
    shoulderR.position.set(-0.32, 0.44, 0);
    torso.add(shoulderR);
    this.pivots.shoulderR = shoulderR;

    const pauldronR = addShadow(
      new THREE.Mesh(
        new THREE.SphereGeometry(0.135, 6, 4, 0, Math.PI * 2, 0, Math.PI * 0.65),
        mat.armorSteel
      )
    );
    pauldronR.position.set(-0.02, 0.02, 0);
    pauldronR.rotation.z = 0.35;
    shoulderR.add(pauldronR);

    const upperArmR = addShadow(
      new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.058, 0.26, 6), mat.armorDark)
    );
    upperArmR.position.y = -0.13;
    shoulderR.add(upperArmR);

    const elbowR = new THREE.Group();
    elbowR.position.set(0, -0.26, 0);
    shoulderR.add(elbowR);
    this.pivots.elbowR = elbowR;

    const forearmR = addShadow(
      new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.052, 0.25, 6), mat.armorSteel)
    );
    forearmR.position.y = -0.125;
    elbowR.add(forearmR);

    const handR = addShadow(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.08), mat.armorDark));
    handR.position.y = -0.26;
    elbowR.add(handR);

    const swordGroup = new THREE.Group();
    swordGroup.position.set(-0.01, -0.27, 0.02);
    swordGroup.rotation.set(Math.PI * 0.34, 0, 0.08);
    elbowR.add(swordGroup);
    this.pivots.sword = swordGroup;

    // World-space blade hitbox & slash-trail ribbon markers
    this.swordBaseMarker = new THREE.Object3D();
    this.swordBaseMarker.position.set(0, 0.14, 0);
    swordGroup.add(this.swordBaseMarker);

    this.swordTipMarker = new THREE.Object3D();
    this.swordTipMarker.position.set(0, 1.4, 0);
    swordGroup.add(this.swordTipMarker);

    const pommel = addShadow(
      new THREE.Mesh(new THREE.OctahedronGeometry(0.045, 0), mat.brass)
    );
    pommel.position.y = -0.16;
    swordGroup.add(pommel);

    const grip = addShadow(
      new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.026, 0.26, 6), mat.leather)
    );
    grip.position.y = -0.02;
    swordGroup.add(grip);

    const crossguard = addShadow(
      new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.045, 0.065), mat.brass)
    );
    crossguard.position.y = 0.12;
    swordGroup.add(crossguard);

    const bladeMain = addShadow(
      new THREE.Mesh(new THREE.BoxGeometry(0.095, 1.02, 0.024), mat.bladeSteel)
    );
    bladeMain.position.y = 0.65;
    swordGroup.add(bladeMain);

    const fuller = addShadow(
      new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.78, 0.032), mat.armorDark)
    );
    fuller.position.y = 0.56;
    swordGroup.add(fuller);

    const bladeTip = addShadow(
      new THREE.Mesh(new THREE.ConeGeometry(0.066, 0.24, 4), mat.bladeSteel)
    );
    bladeTip.position.y = 1.28;
    bladeTip.rotation.y = Math.PI * 0.25;
    bladeTip.scale.set(1, 1, 0.28);
    swordGroup.add(bladeTip);

    // ------------------------------------------------------------------------
    // Legs
    // ------------------------------------------------------------------------
    const buildLeg = (side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.135, -0.02, 0);
      pelvis.add(hip);

      const thigh = addShadow(
        new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.072, 0.42, 6), mat.armorDark)
      );
      thigh.position.y = -0.21;
      hip.add(thigh);

      const knee = new THREE.Group();
      knee.position.set(0, -0.42, 0);
      hip.add(knee);

      const poleyn = addShadow(
        new THREE.Mesh(new THREE.OctahedronGeometry(0.072, 0), mat.armorSteel)
      );
      poleyn.position.set(0, 0, 0.045);
      poleyn.scale.set(1, 1.15, 0.8);
      knee.add(poleyn);

      const shin = addShadow(
        new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.056, 0.4, 6), mat.armorSteel)
      );
      shin.position.y = -0.2;
      knee.add(shin);

      const foot = addShadow(
        new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.075, 0.23), mat.armorDark)
      );
      foot.position.set(0, -0.425, 0.055);
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

  _spawnDustPuff(count = 4, spread = 0.28) {
    const geo = new THREE.DodecahedronGeometry(0.11, 0);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x7e7266,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      const angle = Math.random() * Math.PI * 2;
      mesh.position.set(
        this.position.x + Math.cos(angle) * spread * Math.random(),
        this.position.y + 0.08 + Math.random() * 0.12,
        this.position.z + Math.sin(angle) * spread * Math.random()
      );
      mesh.scale.setScalar(0.6 + Math.random() * 0.7);
      this._dustGroup.add(mesh);
      this._dustPuffs.push({
        mesh,
        vel: new THREE.Vector3(
          Math.cos(angle) * (0.6 + Math.random() * 1.1),
          0.45 + Math.random() * 0.6,
          Math.sin(angle) * (0.6 + Math.random() * 1.1)
        ),
        age: 0,
        life: 0.45 + Math.random() * 0.2,
      });
    }
  }

  _updateDustPuffs(dt) {
    for (let i = this._dustPuffs.length - 1; i >= 0; i--) {
      const p = this._dustPuffs[i];
      p.age += dt;
      if (p.age >= p.life) {
        this._dustGroup.remove(p.mesh);
        p.mesh.material.dispose();
        this._dustPuffs.splice(i, 1);
        continue;
      }
      const t = p.age / p.life;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(Math.exp(-3.5 * dt));
      p.mesh.scale.setScalar(0.8 + t * 1.8);
      p.mesh.material.opacity = 0.42 * (1 - t);
    }
  }

  /**
   * Restores HP, FP, Stamina, and Crimson Flask charges at a Site of Grace.
   */
  restoreAtGrace() {
    this.stats.hp = this.stats.maxHp;
    this.stats.fp = this.stats.maxFp;
    this.stats.stamina = this.stats.maxStamina;
    this.stats.flasks = this.stats.maxFlasks;
    this.stats.staminaExhausted = false;
    this.stats.regenDelayTimer = 0;
  }

  respawnAtGrace() {
    this.position.copy(this.spawnPosition);
    this.velocity.set(0, 0, 0);
    this.facingYaw = Math.PI;
    this.actionState = 'idle';
    this.isInvulnerable = false;
    this.isBlocking = false;
    this._attackKind = null;
    this._queuedAttack = null;
    this._deathTimer = 0;
    this.pivots.rollPivot.rotation.set(0, 0, 0);
    this.pivots.rollPivot.position.set(0, 0.88, 0);
    this.pivots.flask.visible = false;
    this.restoreAtGrace();
    this.root.position.copy(this.position);
    this.root.rotation.y = this.facingYaw;
  }

  _consumeStamina(amount) {
    this.stats.stamina -= amount;
    this.stats.regenDelayTimer = this.staminaRegenDelay;
    if (this.stats.stamina <= 0) {
      this.stats.stamina = 0;
      this.stats.staminaExhausted = true;
      this.stats.regenDelayTimer = this.staminaRegenDelay + 0.18;
    }
  }

  _canSpendStamina() {
    return this.stats.stamina > 0 && !this.stats.staminaExhausted;
  }

  _computeWorldMoveDir(moveVec, cameraYaw) {
    if (moveVec.magnitude === 0) {
      return new THREE.Vector3(0, 0, 0);
    }
    const camForwardX = -Math.sin(cameraYaw);
    const camForwardZ = -Math.cos(cameraYaw);
    const camRightX = Math.cos(cameraYaw);
    const camRightZ = -Math.sin(cameraYaw);

    const dir = new THREE.Vector3(
      camForwardX * moveVec.z + camRightX * moveVec.x,
      0,
      camForwardZ * moveVec.z + camRightZ * moveVec.x
    );
    if (dir.lengthSq() > 1e-5) dir.normalize();
    return dir;
  }

  _startDodgeRoll(worldMoveDir) {
    this._consumeStamina(this.rollStaminaCost);
    this.actionState = 'roll';
    this.isInvulnerable = true;
    this.isBlocking = false;
    this._attackKind = null;
    this._queuedAttack = null;
    this._dodgeTimer = 0;
    this._dodgeDuration = 0.58;
    this._dodgeLandingPuffDone = false;

    if (worldMoveDir.lengthSq() > 1e-4) {
      this._dodgeDir.copy(worldMoveDir).normalize();
    } else {
      this._dodgeDir.set(Math.sin(this.facingYaw), 0, Math.cos(this.facingYaw));
    }

    this.facingYaw = Math.atan2(this._dodgeDir.x, this._dodgeDir.z);
    this._spawnDustPuff(5, 0.25);
  }

  _startBackstep() {
    this._consumeStamina(this.backstepStaminaCost);
    this.actionState = 'backstep';
    this.isInvulnerable = true;
    this.isBlocking = false;
    this._attackKind = null;
    this._queuedAttack = null;
    this._dodgeTimer = 0;
    this._dodgeDuration = 0.38;
    this._dodgeLandingPuffDone = false;

    this._dodgeDir.set(-Math.sin(this.facingYaw), 0, -Math.cos(this.facingYaw));
    this._spawnDustPuff(4, 0.2);
  }

  _startAttack(kind, lockedTarget, worldMoveDir) {
    const spec = ATTACK_SPECS[kind];
    if (!spec || !this._canSpendStamina()) return false;

    this._consumeStamina(spec.staminaCost);
    this.actionState = 'attack';
    this.isBlocking = false;
    this._attackKind = kind;
    this._attackTimer = 0;
    this._attackSwingId += 1;
    this._attackHitSet.clear();
    this._queuedAttack = null;
    this._attackSlamPuffDone = false;

    // Orient toward locked target or directional input
    if (lockedTarget) {
      const dx = lockedTarget.position.x - this.position.x;
      const dz = lockedTarget.position.z - this.position.z;
      if (dx * dx + dz * dz > 1e-4) {
        this.facingYaw = Math.atan2(dx, dz);
      }
    } else if (worldMoveDir.lengthSq() > 1e-4) {
      this.facingYaw = Math.atan2(worldMoveDir.x, worldMoveDir.z);
    }

    if (this.onAttackStart) {
      this.onAttackStart(kind, spec.isHeavy);
    }
    return true;
  }

  _startDrinkFlask() {
    if (this.stats.flasks <= 0) return false;
    this.actionState = 'drink';
    this.isBlocking = false;
    this._drinkTimer = 0;
    this._drinkApplied = false;
    this.pivots.flask.visible = true;
    return true;
  }

  /**
   * Returns active greatsword hitbox segment during active swing frames.
   */
  getActiveAttack() {
    if (this.actionState !== 'attack' || !this._attackKind) return null;
    const spec = ATTACK_SPECS[this._attackKind];
    if (this._attackTimer < spec.windupEnd || this._attackTimer > spec.activeEnd) {
      return null;
    }
    const base = new THREE.Vector3();
    const tip = new THREE.Vector3();
    this.swordBaseMarker.getWorldPosition(base);
    this.swordTipMarker.getWorldPosition(tip);

    return {
      swingId: this._attackSwingId,
      kind: this._attackKind,
      damage: spec.damage,
      poiseDamage: spec.poiseDamage,
      isHeavy: spec.isHeavy,
      base,
      tip,
      hitIds: this._attackHitSet,
    };
  }

  isSlashTrailActive() {
    if (this.actionState !== 'attack' || !this._attackKind) return null;
    const spec = ATTACK_SPECS[this._attackKind];
    if (this._attackTimer >= spec.windupEnd - 0.04 && this._attackTimer <= spec.activeEnd + 0.05) {
      const base = new THREE.Vector3();
      const tip = new THREE.Vector3();
      this.swordBaseMarker.getWorldPosition(base);
      this.swordTipMarker.getWorldPosition(tip);
      return { base, tip, isHeavy: spec.isHeavy, swingId: this._attackSwingId };
    }
    return null;
  }

  getShieldWorldPos(out = new THREE.Vector3()) {
    return this.shieldCenterMarker.getWorldPosition(out);
  }

  consumeBlockStamina(staminaDamage) {
    this._blockRecoilTimer = 0.18;
    this._consumeStamina(staminaDamage);
    if (this.stats.stamina <= 0) {
      this.triggerGuardBreak();
      return true; // guard broken!
    }
    return false;
  }

  triggerGuardBreak() {
    this.isBlocking = false;
    this.actionState = 'guardBreak';
    this._staggerTimer = 0;
    this._staggerDuration = 1.1;
    this._attackKind = null;
    this._queuedAttack = null;
    this.pivots.flask.visible = false;
  }

  triggerHitStagger(knockbackDir, force = 4.0) {
    if (this.stats.hp <= 0) {
      this.triggerDeath();
      return;
    }
    this.isBlocking = false;
    this.actionState = 'hitStagger';
    this._staggerTimer = 0;
    this._staggerDuration = 0.34;
    this._attackKind = null;
    this._queuedAttack = null;
    this.pivots.flask.visible = false;
    this.velocity.x = knockbackDir.x * force;
    this.velocity.z = knockbackDir.z * force;
  }

  triggerDeath() {
    this.stats.hp = 0;
    this.actionState = 'dead';
    this.isInvulnerable = false;
    this.isBlocking = false;
    this._attackKind = null;
    this._queuedAttack = null;
    this._deathTimer = 0;
    this.pivots.flask.visible = false;
  }

  /**
   * Main per-frame update.
   */
  update(dt, input, cameraController, world) {
    if (this._blockRecoilTimer > 0) {
      this._blockRecoilTimer = Math.max(0, this._blockRecoilTimer - dt);
    }

    // ------------------------------------------------------------------------
    // Dead State
    // ------------------------------------------------------------------------
    if (this.actionState === 'dead') {
      this._deathTimer += dt;
      this.velocity.x = damp(this.velocity.x, 0, 8, dt);
      this.velocity.z = damp(this.velocity.z, 0, 8, dt);
      this.position.x += this.velocity.x * dt;
      this.position.z += this.velocity.z * dt;
      world.resolveCollision(this.position, this.collisionRadius);
      this.root.position.copy(this.position);
      this._animateCharacter(dt);
      this._updateDustPuffs(dt);
      return;
    }

    const moveVec = input.getMoveVector();
    const worldMoveDir = this._computeWorldMoveDir(moveVec, cameraController.yaw);
    const lockedTarget = cameraController.lockedTarget;
    this.isLockedOn = Boolean(lockedTarget);

    let spentStaminaThisFrame = false;

    // ------------------------------------------------------------------------
    // 1. Dodge Roll & Backstep
    // ------------------------------------------------------------------------
    if (this.actionState === 'roll' || this.actionState === 'backstep') {
      this.isBlocking = false;
      this._dodgeTimer += dt;
      const progress = Math.min(this._dodgeTimer / this._dodgeDuration, 1);

      if (this.actionState === 'roll') {
        this.isInvulnerable = this._dodgeTimer <= 0.4;
        const burstFactor = Math.pow(1 - progress, 0.85) * 0.8 + 0.2;
        const speed = this.rollBurstSpeed * burstFactor;
        this.velocity.x = this._dodgeDir.x * speed;
        this.velocity.z = this._dodgeDir.z * speed;

        if (!this._dodgeLandingPuffDone && progress > 0.78) {
          this._dodgeLandingPuffDone = true;
          this._spawnDustPuff(4, 0.24);
        }
      } else {
        this.isInvulnerable = this._dodgeTimer <= 0.24;
        const burstFactor = Math.sin((1 - progress) * Math.PI * 0.5);
        const speed = this.backstepSpeed * burstFactor;
        this.velocity.x = this._dodgeDir.x * speed;
        this.velocity.z = this._dodgeDir.z * speed;
      }

      if (this._dodgeTimer >= this._dodgeDuration) {
        this.actionState = 'idle';
        this.isInvulnerable = false;
      }
    }
    // ------------------------------------------------------------------------
    // 2. Hit Stagger & Guard Break
    // ------------------------------------------------------------------------
    else if (this.actionState === 'hitStagger' || this.actionState === 'guardBreak') {
      this.isInvulnerable = false;
      this.isBlocking = false;
      this._staggerTimer += dt;
      this.velocity.x = damp(this.velocity.x, 0, 10, dt);
      this.velocity.z = damp(this.velocity.z, 0, 10, dt);

      if (this._staggerTimer >= this._staggerDuration) {
        this.actionState = 'idle';
      }
    }
    // ------------------------------------------------------------------------
    // 3. Crimson Flask Drinking
    // ------------------------------------------------------------------------
    else if (this.actionState === 'drink') {
      this.isInvulnerable = false;
      this.isBlocking = false;
      this._drinkTimer += dt;

      // Allow slow cautious walking while sipping
      const targetVx = worldMoveDir.x * this.drinkWalkSpeed;
      const targetVz = worldMoveDir.z * this.drinkWalkSpeed;
      this.velocity.x = damp(this.velocity.x, targetVx, 12, dt);
      this.velocity.z = damp(this.velocity.z, targetVz, 12, dt);

      if (!this._drinkApplied && this._drinkTimer >= 0.4) {
        this._drinkApplied = true;
        this.stats.flasks = Math.max(0, this.stats.flasks - 1);
        this.stats.hp = Math.min(this.stats.maxHp, this.stats.hp + this.stats.flaskHealAmount);
        if (this.onHealSip) this.onHealSip(this.position);
      }

      // Allow emergency dodge-cancel late in sip
      if (this._drinkTimer > 0.55 && input.wasActionPressed('dodge') && this._canSpendStamina()) {
        this.pivots.flask.visible = false;
        if (moveVec.magnitude > 0) this._startDodgeRoll(worldMoveDir);
        else this._startBackstep();
        spentStaminaThisFrame = true;
      } else if (this._drinkTimer >= this._drinkDuration) {
        this.pivots.flask.visible = false;
        this.actionState = 'idle';
      }
    }
    // ------------------------------------------------------------------------
    // 4. Melee Attack Execution & Combo Buffering
    // ------------------------------------------------------------------------
    else if (this.actionState === 'attack') {
      this.isInvulnerable = false;
      this.isBlocking = false;
      const spec = ATTACK_SPECS[this._attackKind];
      this._attackTimer += dt;

      // Track locked target smoothly during early wind-up so strafing foes don't dodge effortlessly
      if (lockedTarget && this._attackTimer < spec.windupEnd * 0.78) {
        const dx = lockedTarget.position.x - this.position.x;
        const dz = lockedTarget.position.z - this.position.z;
        if (dx * dx + dz * dz > 0.04) {
          const wantYaw = Math.atan2(dx, dz);
          this.facingYaw += angleDiff(this.facingYaw, wantYaw) * (1 - Math.exp(-9.5 * dt));
        }
      }

      // Buffer next combo hit or heavy finisher
      if (this._attackTimer >= 0.14) {
        if (input.wasActionPressed('heavyAttack')) {
          this._queuedAttack = 'heavy';
        } else if (input.wasActionPressed('lightAttack') && spec.next) {
          this._queuedAttack = spec.next;
        }
      }

      // Forward step lunge during windup-to-active transition
      const lungeStart = spec.windupEnd * 0.45;
      const lungeEnd = spec.activeEnd;
      const fwdX = Math.sin(this.facingYaw);
      const fwdZ = Math.cos(this.facingYaw);
      if (this._attackTimer >= lungeStart && this._attackTimer <= lungeEnd) {
        const tLunge = (this._attackTimer - lungeStart) / Math.max(lungeEnd - lungeStart, 0.01);
        const speed = spec.lungeSpeed * Math.sin(Math.PI * tLunge);
        this.velocity.x = fwdX * speed;
        this.velocity.z = fwdZ * speed;
      } else {
        this.velocity.x = damp(this.velocity.x, 0, 14, dt);
        this.velocity.z = damp(this.velocity.z, 0, 14, dt);
      }

      // Ground slam dust & camera thump on overhead finishes
      if (
        spec.isHeavy &&
        !this._attackSlamPuffDone &&
        this._attackTimer >= spec.activeEnd - 0.04
      ) {
        this._attackSlamPuffDone = true;
        this._spawnDustPuff(6, 0.35);
        if (this.onHeavySlamImpact) {
          this.onHeavySlamImpact(
            new THREE.Vector3(this.position.x + fwdX * 1.4, this.position.y, this.position.z + fwdZ * 1.4)
          );
        }
      }

      // Allow dodge-cancel after active hitbox ends
      if (
        this._attackTimer >= spec.activeEnd + 0.06 &&
        input.wasActionPressed('dodge') &&
        this._canSpendStamina()
      ) {
        if (moveVec.magnitude > 0) this._startDodgeRoll(worldMoveDir);
        else this._startBackstep();
        spentStaminaThisFrame = true;
      } else if (this._queuedAttack && this._attackTimer >= spec.comboWindowStart) {
        const nextKind = this._queuedAttack;
        if (!this._startAttack(nextKind, lockedTarget, worldMoveDir)) {
          this._queuedAttack = null;
        } else {
          spentStaminaThisFrame = true;
        }
      } else if (this._attackTimer >= spec.duration) {
        this.actionState = 'idle';
        this._attackKind = null;
      }
    }
    // ------------------------------------------------------------------------
    // 5. Neutral / Move / Sprint / Block
    // ------------------------------------------------------------------------
    else {
      this.isInvulnerable = false;

      if (input.wasActionPressed('dodge') && this._canSpendStamina()) {
        if (moveVec.magnitude > 0) {
          this._startDodgeRoll(worldMoveDir);
        } else {
          this._startBackstep();
        }
        spentStaminaThisFrame = true;
      } else if (input.wasActionPressed('heavyAttack') && this._canSpendStamina()) {
        spentStaminaThisFrame = this._startAttack('heavy', lockedTarget, worldMoveDir);
      } else if (input.wasActionPressed('lightAttack') && this._canSpendStamina()) {
        spentStaminaThisFrame = this._startAttack('light_1', lockedTarget, worldMoveDir);
      } else if (input.wasActionPressed('heal') && this.stats.flasks > 0) {
        this._startDrinkFlask();
      } else {
        const wantsMove = moveVec.magnitude > 0;
        const wantsBlock = input.isBlocking();
        this.isBlocking = wantsBlock;

        const canSprint =
          !wantsBlock && wantsMove && input.isSprinting() && this._canSpendStamina();

        if (canSprint) {
          this.actionState = 'sprint';
          this._consumeStamina(this.sprintDrainPerSec * dt);
          spentStaminaThisFrame = true;
        } else if (wantsMove) {
          this.actionState = 'move';
        } else {
          this.actionState = 'idle';
        }

        const targetSpeed = canSprint
          ? this.sprintSpeed
          : wantsMove
          ? wantsBlock
            ? this.blockWalkSpeed
            : this.walkSpeed
          : 0;
        const targetVx = worldMoveDir.x * targetSpeed;
        const targetVz = worldMoveDir.z * targetSpeed;
        const accelLambda = wantsMove ? 14.0 : 16.5;

        this.velocity.x = damp(this.velocity.x, targetVx, accelLambda, dt);
        this.velocity.z = damp(this.velocity.z, targetVz, accelLambda, dt);

        // Rotation: face locked target when strafing/blocking, or face camera when blocking unlocked
        let targetYaw = this.facingYaw;
        if (this.isLockedOn && !canSprint) {
          const toTargetX = lockedTarget.position.x - this.position.x;
          const toTargetZ = lockedTarget.position.z - this.position.z;
          if (toTargetX * toTargetX + toTargetZ * toTargetZ > 0.001) {
            targetYaw = Math.atan2(toTargetX, toTargetZ);
          }
        } else if (wantsBlock && !wantsMove) {
          // Align guard cleanly toward camera forward when standing and blocking
          targetYaw = cameraController.yaw + Math.PI;
        } else if (wantsMove) {
          targetYaw = Math.atan2(worldMoveDir.x, worldMoveDir.z);
        }

        const yawStep = angleDiff(this.facingYaw, targetYaw);
        this.facingYaw += yawStep * (1 - Math.exp(-13.5 * dt));
      }
    }

    // ------------------------------------------------------------------------
    // 6. Stamina Regeneration (slowed while holding Shield Block)
    // ------------------------------------------------------------------------
    if (
      !spentStaminaThisFrame &&
      this.actionState !== 'roll' &&
      this.actionState !== 'backstep' &&
      this.actionState !== 'attack' &&
      this.actionState !== 'guardBreak'
    ) {
      if (this.stats.regenDelayTimer > 0) {
        this.stats.regenDelayTimer = Math.max(0, this.stats.regenDelayTimer - dt);
      } else if (this.stats.stamina < this.stats.maxStamina) {
        const regenScale = this.isBlocking ? 0.35 : 1.0;
        this.stats.stamina = Math.min(
          this.stats.maxStamina,
          this.stats.stamina + this.staminaRegenPerSec * regenScale * dt
        );
        if (
          this.stats.staminaExhausted &&
          this.stats.stamina >= this.exhaustionRecoveryThreshold
        ) {
          this.stats.staminaExhausted = false;
        }
      }
    }

    // ------------------------------------------------------------------------
    // 7. Integrate Position, World Collision & Ground Elevation
    // ------------------------------------------------------------------------
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    world.resolveCollision(this.position, this.collisionRadius);

    const targetGroundY = world.getGroundHeight(this.position.x, this.position.z);
    this.position.y = damp(this.position.y, targetGroundY, 22.0, dt);

    this.root.position.copy(this.position);
    this.root.rotation.y = this.facingYaw;

    // ------------------------------------------------------------------------
    // 8. Procedural Articulated Animation
    // ------------------------------------------------------------------------
    this._animateCharacter(dt);
    this._updateDustPuffs(dt);
  }

  _animateCharacter(dt) {
    const time = performance.now() * 0.001;
    const p = this.pivots;

    // Collapse Animation on Death
    if (this.actionState === 'dead') {
      const t = Math.min(this._deathTimer / 0.65, 1);
      p.rollPivot.rotation.x = damp(p.rollPivot.rotation.x, -Math.PI * 0.48, 8, dt);
      p.rollPivot.position.y = damp(p.rollPivot.position.y, 0.25, 8, dt);
      p.shoulderR.rotation.set(-0.3, 0, -0.5 * t);
      p.shoulderL.rotation.set(-0.3, 0, 0.5 * t);
      p.cloakUpper.rotation.x = damp(p.cloakUpper.rotation.x, 0.05, 8, dt);
      return;
    }

    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const charForwardX = Math.sin(this.facingYaw);
    const charForwardZ = Math.cos(this.facingYaw);
    const charRightX = Math.cos(this.facingYaw);
    const charRightZ = -Math.sin(this.facingYaw);

    const rawForward = (this.velocity.x * charForwardX + this.velocity.z * charForwardZ) / this.walkSpeed;
    const rawRight = (this.velocity.x * charRightX + this.velocity.z * charRightZ) / this.walkSpeed;

    this._forwardComponent = damp(this._forwardComponent, THREE.MathUtils.clamp(rawForward, -1.6, 1.8), 14, dt);
    this._rightComponent = damp(this._rightComponent, THREE.MathUtils.clamp(rawRight, -1.3, 1.3), 14, dt);

    const isRolling = this.actionState === 'roll';
    const isBackstepping = this.actionState === 'backstep';
    const isSprinting = this.actionState === 'sprint';
    const isAttacking = this.actionState === 'attack';

    const targetMoveBlend =
      !isRolling && !isBackstepping && !isAttacking
        ? THREE.MathUtils.clamp(horizSpeed / this.walkSpeed, 0, 1)
        : 0;
    const targetSprintBlend = isSprinting ? 1 : 0;
    this._moveBlend = damp(this._moveBlend, targetMoveBlend, 12, dt);
    this._sprintBlend = damp(this._sprintBlend, targetSprintBlend, 10, dt);
    this._blockBlend = damp(this._blockBlend, this.isBlocking ? 1 : 0, 18, dt);

    if (this._moveBlend > 0.03) {
      const cycleRate = THREE.MathUtils.lerp(2.2, 3.05, this._sprintBlend);
      this._stridePhase += dt * horizSpeed * cycleRate;
    }

    // Secondary cloak lag
    const yawRate = angleDiff(this._lastYaw, this.facingYaw) / Math.max(dt, 0.001);
    this._lastYaw = this.facingYaw;
    const targetCloakPitch =
      0.08 +
      Math.max(0, rawForward) * 0.34 +
      this._sprintBlend * 0.25 +
      (isRolling ? 0.55 : 0) +
      (isAttacking ? 0.28 : 0);
    const targetCloakRoll = THREE.MathUtils.clamp(-yawRate * 0.045 - rawRight * 0.14, -0.45, 0.45);
    this._cloakLagPitch = damp(this._cloakLagPitch, targetCloakPitch, 9, dt);
    this._cloakLagRoll = damp(this._cloakLagRoll, targetCloakRoll, 10, dt);

    const cloakWind = Math.sin(time * 3.1) * 0.05 + Math.cos(time * 5.2) * 0.025;
    p.cloakUpper.rotation.x = this._cloakLagPitch + cloakWind;
    p.cloakUpper.rotation.z = this._cloakLagRoll;
    p.cloakLower.rotation.x = this._cloakLagPitch * 0.55 + Math.sin(time * 4.4 - 0.8) * 0.08;
    p.cloakLower.rotation.z = this._cloakLagRoll * 0.5;

    // Dodge Roll Pose
    if (isRolling) {
      const t = THREE.MathUtils.clamp(this._dodgeTimer / this._dodgeDuration, 0, 1);
      const rollEase = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) * 0.5;
      p.rollPivot.rotation.x = rollEase * Math.PI * 2;
      p.rollPivot.position.y = 0.88 + Math.sin(Math.PI * t) * 0.24 - (t > 0.78 ? (1 - t) * 0.12 : 0);

      p.pelvis.position.y = 0.82;
      p.pelvis.rotation.set(0, 0, 0);
      p.torso.rotation.set(0.55, 0, 0);
      p.neck.rotation.set(0.35, 0, 0);

      p.hipL.rotation.set(-1.35, 0, 0.08);
      p.kneeL.rotation.set(2.05, 0, 0);
      p.hipR.rotation.set(-1.25, 0, -0.08);
      p.kneeR.rotation.set(1.98, 0, 0);

      p.shoulderL.rotation.set(-0.95, 0.25, -0.2);
      p.elbowL.rotation.set(-1.45, 0, 0);
      p.shoulderR.rotation.set(0.65, 0, -0.25);
      p.elbowR.rotation.set(-1.55, 0, 0);
      p.sword.rotation.set(Math.PI * 0.14, 0, -0.18);
      return;
    }

    // Backstep Pose
    if (isBackstepping) {
      const t = THREE.MathUtils.clamp(this._dodgeTimer / this._dodgeDuration, 0, 1);
      const hop = Math.sin(Math.PI * t);
      p.rollPivot.rotation.x = damp(p.rollPivot.rotation.x, 0, 20, dt);
      p.rollPivot.position.y = 0.88 + hop * 0.16;

      p.pelvis.position.y = 0.83;
      p.pelvis.rotation.set(0, 0, 0);
      p.torso.rotation.set(0.28 * hop + 0.1, 0, 0);
      p.neck.rotation.set(-0.14, 0, 0);

      p.hipL.rotation.set(-0.45 * hop - 0.15, 0, 0.06);
      p.kneeL.rotation.set(0.85 * hop + 0.2, 0, 0);
      p.hipR.rotation.set(-0.25 * hop, 0, -0.06);
      p.kneeR.rotation.set(0.65 * hop + 0.15, 0, 0);

      p.shoulderL.rotation.set(-0.75, 0.35, -0.1);
      p.elbowL.rotation.set(-1.1, 0, 0);
      p.shoulderR.rotation.set(0.32, 0, -0.18);
      p.elbowR.rotation.set(-0.65, 0, 0);
      p.sword.rotation.set(Math.PI * 0.32, 0, 0.12);
      return;
    }

    p.rollPivot.rotation.x = 0;
    p.rollPivot.position.y = damp(p.rollPivot.position.y, 0.88, 18, dt);

    // Hit Stagger / Guard Break Pose
    if (this.actionState === 'guardBreak' || this.actionState === 'hitStagger') {
      const t = this._staggerTimer / this._staggerDuration;
      const recoil = Math.sin(Math.min(t * 1.2, 1) * Math.PI);
      const isGB = this.actionState === 'guardBreak';
      p.pelvis.position.y = 0.86;
      p.torso.rotation.set(-0.35 * recoil, isGB ? -0.35 * recoil : 0.2 * recoil, 0);
      p.neck.rotation.set(-0.25 * recoil, 0, 0);
      p.shoulderL.rotation.set(-0.45, isGB ? -0.85 * recoil : 0.1, isGB ? 0.65 * recoil : 0.2);
      p.elbowL.rotation.set(-0.4, 0, 0);
      p.shoulderR.rotation.set(0.25, 0, -0.45 * recoil);
      p.elbowR.rotation.set(-0.45, 0, 0);
      p.hipL.rotation.set(-0.2, 0, 0.08);
      p.kneeL.rotation.set(0.35, 0, 0);
      p.hipR.rotation.set(0.18, 0, -0.08);
      p.kneeR.rotation.set(0.2, 0, 0);
      return;
    }

    // Crimson Flask Drinking Animation
    if (this.actionState === 'drink') {
      const t = THREE.MathUtils.clamp(this._drinkTimer / this._drinkDuration, 0, 1);
      const lift = Math.sin(Math.min(t * 1.35, 1) * Math.PI);
      p.pelvis.position.y = 0.89;
      p.torso.rotation.set(damp(p.torso.rotation.x, -0.14 * lift, 12, dt), 0, 0);
      p.neck.rotation.set(damp(p.neck.rotation.x, -0.25 * lift, 12, dt), 0, 0);

      // Left arm lifts glowing flask toward visor while right sword drops slightly low
      p.shoulderL.rotation.set(
        damp(p.shoulderL.rotation.x, -1.35 * lift - 0.2, 14, dt),
        damp(p.shoulderL.rotation.y, 0.55 * lift, 14, dt),
        damp(p.shoulderL.rotation.z, -0.3 * lift, 14, dt)
      );
      p.elbowL.rotation.set(damp(p.elbowL.rotation.x, -1.45 * lift - 0.3, 14, dt), 0, 0);
      p.shield.rotation.y = damp(p.shield.rotation.y, Math.PI * 0.85, 12, dt);

      p.shoulderR.rotation.set(damp(p.shoulderR.rotation.x, 0.2, 10, dt), 0, -0.22);
      p.elbowR.rotation.set(damp(p.elbowR.rotation.x, -0.35, 10, dt), 0, 0);
      p.sword.rotation.set(Math.PI * 0.48, 0, 0.12);

      // Legs keep soft walk cycle if moving
      const sSin = Math.sin(this._stridePhase) * THREE.MathUtils.clamp(horizSpeed / 2.2, 0, 1);
      p.hipL.rotation.x = damp(p.hipL.rotation.x, -sSin * 0.32, 12, dt);
      p.hipR.rotation.x = damp(p.hipR.rotation.x, sSin * 0.32, 12, dt);
      p.kneeL.rotation.x = 0.14;
      p.kneeR.rotation.x = 0.14;
      return;
    }

    p.shield.rotation.y = damp(p.shield.rotation.y, Math.PI * 0.5, 14, dt);

    // ------------------------------------------------------------------------
    // Greatsword 3-Hit Combo & Heavy Cleave Animations
    // ------------------------------------------------------------------------
    if (isAttacking && this._attackKind) {
      this._animateAttackPose(dt);
      return;
    }

    // ------------------------------------------------------------------------
    // Idle + Grounded Walk / Sprint / Strafe + Shield Block
    // ------------------------------------------------------------------------
    const idleBreath = Math.sin(time * 2.1);
    const idleSway = Math.sin(time * 1.05);

    const strideSin = Math.sin(this._stridePhase);
    const strideCos = Math.cos(this._stridePhase);
    const moveAmt = this._moveBlend;
    const sprintAmt = this._sprintBlend;
    const blk = this._blockBlend;

    const fwdSign = this._forwardComponent >= -0.15 ? 1 : -1;
    const fwdMag = Math.min(Math.abs(this._forwardComponent), 1.3);
    const strafeAmt = this._rightComponent;

    const legSwingAmp = THREE.MathUtils.lerp(0.56, 0.86, sprintAmt) * moveAmt * (1 - blk * 0.25);
    const hipBob = moveAmt * Math.abs(strideSin) * (0.045 + sprintAmt * 0.035);

    p.pelvis.position.y = damp(
      p.pelvis.position.y,
      0.91 - moveAmt * 0.035 - blk * 0.04 + hipBob + (1 - moveAmt) * idleBreath * 0.01,
      18,
      dt
    );
    p.pelvis.rotation.y = damp(p.pelvis.rotation.y, strideSin * 0.11 * moveAmt * fwdSign, 16, dt);
    p.pelvis.rotation.z = damp(p.pelvis.rotation.z, -strafeAmt * 0.08 + strideCos * 0.035 * moveAmt, 14, dt);

    const targetTorsoPitch =
      (1 - moveAmt) * (0.04 + idleBreath * 0.022) +
      moveAmt * (0.14 + sprintAmt * 0.24) * (fwdSign > 0 ? 1 : -0.35) +
      blk * 0.14;
    const targetTorsoYaw =
      (1 - moveAmt) * idleSway * 0.03 -
      strideSin * 0.14 * moveAmt * fwdSign -
      blk * 0.22;
    p.torso.rotation.x = damp(p.torso.rotation.x, targetTorsoPitch, 14, dt);
    p.torso.rotation.y = damp(p.torso.rotation.y, targetTorsoYaw, 14, dt);
    p.torso.rotation.z = damp(p.torso.rotation.z, strafeAmt * 0.09, 14, dt);

    p.neck.rotation.x = damp(p.neck.rotation.x, -targetTorsoPitch * 0.65 - idleBreath * 0.018, 12, dt);
    p.neck.rotation.y = damp(p.neck.rotation.y, -targetTorsoYaw * 0.65, 12, dt);

    const swingL = strideSin * legSwingAmp * (0.65 + 0.35 * fwdMag) * fwdSign;
    const swingR = -strideSin * legSwingAmp * (0.65 + 0.35 * fwdMag) * fwdSign;
    const kneeLiftL = Math.max(0, -Math.cos(this._stridePhase * fwdSign)) * (0.62 + sprintAmt * 0.45) * moveAmt;
    const kneeLiftR = Math.max(0, Math.cos(this._stridePhase * fwdSign)) * (0.62 + sprintAmt * 0.45) * moveAmt;

    const idleStanceL = (1 - moveAmt) * (-0.06 - blk * 0.16);
    const idleStanceR = (1 - moveAmt) * (0.07 + blk * 0.2);
    const strafeHipL = Math.max(0, strafeAmt) * 0.18 * (0.5 + 0.5 * strideSin);
    const strafeHipR = Math.max(0, -strafeAmt) * 0.18 * (0.5 - 0.5 * strideSin);

    p.hipL.rotation.x = damp(p.hipL.rotation.x, idleStanceL - swingL, 16, dt);
    p.hipL.rotation.z = damp(p.hipL.rotation.z, 0.04 + strafeHipL, 14, dt);
    p.kneeL.rotation.x = damp(p.kneeL.rotation.x, 0.08 + blk * 0.22 + kneeLiftL + Math.max(0, swingL) * 0.35, 16, dt);

    p.hipR.rotation.x = damp(p.hipR.rotation.x, idleStanceR - swingR, 16, dt);
    p.hipR.rotation.z = damp(p.hipR.rotation.z, -0.04 - strafeHipR, 14, dt);
    p.kneeR.rotation.x = damp(p.kneeR.rotation.x, 0.08 + blk * 0.18 + kneeLiftR + Math.max(0, swingR) * 0.35, 16, dt);

    // Left Arm: Ready Guard -> Raised Front Kite Shield Block!
    const lockShieldRaise = this.isLockedOn && !isSprinting ? 0.32 : 0;
    const recoilKick = this._blockRecoilTimer > 0 ? Math.sin((this._blockRecoilTimer / 0.18) * Math.PI) * 0.32 : 0;
    const armSwingL = swingR * (0.48 + sprintAmt * 0.32) * (1 - blk * 0.85);

    const guardShoulderX = -0.96 + recoilKick;
    const guardShoulderY = 0.78;
    const guardShoulderZ = -0.18 - recoilKick * 0.4;
    const guardElbowX = -1.28;

    const freeShoulderX =
      (1 - moveAmt) * (-0.18 - idleBreath * 0.02) +
      moveAmt * (-0.28 + armSwingL) -
      lockShieldRaise;
    const freeShoulderY = (1 - moveAmt) * 0.18 + lockShieldRaise * 0.85;
    const freeShoulderZ = 0.12 - lockShieldRaise * 0.25;
    const freeElbowX = -0.58 - lockShieldRaise * 0.72 - sprintAmt * 0.22;

    p.shoulderL.rotation.x = damp(p.shoulderL.rotation.x, THREE.MathUtils.lerp(freeShoulderX, guardShoulderX, blk), 16, dt);
    p.shoulderL.rotation.y = damp(p.shoulderL.rotation.y, THREE.MathUtils.lerp(freeShoulderY, guardShoulderY, blk), 16, dt);
    p.shoulderL.rotation.z = damp(p.shoulderL.rotation.z, THREE.MathUtils.lerp(freeShoulderZ, guardShoulderZ, blk), 16, dt);
    p.elbowL.rotation.x = damp(p.elbowL.rotation.x, THREE.MathUtils.lerp(freeElbowX, guardElbowX, blk), 16, dt);
    p.shield.rotation.y = damp(p.shield.rotation.y, THREE.MathUtils.lerp(Math.PI * 0.5, Math.PI * 0.14, blk), 16, dt);

    // Right Arm: Greatsword held ready (pulled back defensively while blocking)
    const armSwingR = swingL * (0.52 + sprintAmt * 0.35) * (1 - blk * 0.75);
    const targetShoulderRX =
      (1 - moveAmt) * (-0.12 + idleBreath * 0.025) +
      moveAmt * (0.14 + armSwingR + sprintAmt * 0.38) +
      blk * 0.25;
    p.shoulderR.rotation.x = damp(p.shoulderR.rotation.x, targetShoulderRX, 13, dt);
    p.shoulderR.rotation.y = damp(p.shoulderR.rotation.y, 0, 13, dt);
    p.shoulderR.rotation.z = damp(p.shoulderR.rotation.z, -0.16 - sprintAmt * 0.12 - blk * 0.15, 13, dt);
    p.elbowR.rotation.x = damp(p.elbowR.rotation.x, -0.45 + sprintAmt * 0.18 - blk * 0.3, 13, dt);

    const targetSwordPitch = Math.PI * (0.36 + sprintAmt * 0.22) + strideSin * 0.05 * moveAmt;
    p.sword.rotation.set(damp(p.sword.rotation.x, targetSwordPitch, 12, dt), 0, damp(p.sword.rotation.z, 0.08, 12, dt));
  }

  _animateAttackPose(dt) {
    const p = this.pivots;
    const spec = ATTACK_SPECS[this._attackKind];
    const t = this._attackTimer;
    const wu = spec.windupEnd;
    const act = spec.activeEnd;

    // Grounded lunge stance legs
    p.pelvis.position.y = damp(p.pelvis.position.y, 0.84, 16, dt);
    p.hipL.rotation.set(-0.42, 0, 0.08);
    p.kneeL.rotation.set(0.62, 0, 0);
    p.hipR.rotation.set(0.28, 0, -0.08);
    p.kneeR.rotation.set(0.28, 0, 0);

    // Shield tucked defensively during greatsword swing
    p.shoulderL.rotation.set(-0.55, 0.45, 0.15);
    p.elbowL.rotation.set(-1.05, 0, 0);
    p.shield.rotation.y = Math.PI * 0.42;

    if (this._attackKind === 'light_1') {
      // Hit 1: Diagonal Right-Upper -> Left-Lower Cleave
      if (t < wu) {
        const u = t / wu;
        const ease = u * u;
        p.torso.rotation.set(-0.08 * ease, -0.82 * ease, 0.08 * ease);
        p.shoulderR.rotation.set(-1.35 * ease, -0.55 * ease, -1.05 * ease);
        p.elbowR.rotation.set(-0.62, 0, 0);
        p.sword.rotation.set(Math.PI * 0.34, 0, -0.45 * ease);
      } else if (t < act) {
        const s = (t - wu) / (act - wu);
        const swing = 1 - Math.pow(1 - s, 2.2);
        p.torso.rotation.set(THREE.MathUtils.lerp(-0.08, 0.28, swing), THREE.MathUtils.lerp(-0.82, 0.92, swing), -0.1 * swing);
        p.shoulderR.rotation.set(
          THREE.MathUtils.lerp(-1.35, -0.35, swing),
          THREE.MathUtils.lerp(-0.55, 1.15, swing),
          THREE.MathUtils.lerp(-1.05, 0.55, swing)
        );
        p.elbowR.rotation.set(-0.24, 0, 0);
        p.sword.rotation.set(Math.PI * 0.48, 0, THREE.MathUtils.lerp(-0.45, 0.42, swing));
      } else {
        const r = (t - act) / (spec.duration - act);
        p.torso.rotation.set(damp(p.torso.rotation.x, 0.1, 8, dt), damp(p.torso.rotation.y, 0.35 * (1 - r), 8, dt), 0);
        p.shoulderR.rotation.set(damp(p.shoulderR.rotation.x, -0.25, 8, dt), damp(p.shoulderR.rotation.y, 0.35 * (1 - r), 8, dt), damp(p.shoulderR.rotation.z, 0.1, 8, dt));
        p.elbowR.rotation.set(-0.42, 0, 0);
        p.sword.rotation.set(Math.PI * 0.42, 0, 0.15);
      }
      return;
    }

    if (this._attackKind === 'light_2') {
      // Hit 2: Reverse Left-Lower -> Right-Upper Rising Slash
      if (t < wu) {
        const u = t / wu;
        p.torso.rotation.set(0.2 * u, 0.88 * u, -0.1 * u);
        p.shoulderR.rotation.set(-0.2 - 0.15 * u, 1.05 * u, 0.65 * u);
        p.elbowR.rotation.set(-0.5, 0, 0);
        p.sword.rotation.set(Math.PI * 0.46, 0, 0.65 * u);
      } else if (t < act) {
        const s = (t - wu) / (act - wu);
        const swing = 1 - Math.pow(1 - s, 2.2);
        p.torso.rotation.set(THREE.MathUtils.lerp(0.2, -0.14, swing), THREE.MathUtils.lerp(0.88, -0.88, swing), 0.12 * swing);
        p.shoulderR.rotation.set(
          THREE.MathUtils.lerp(-0.35, -1.65, swing),
          THREE.MathUtils.lerp(1.05, -0.68, swing),
          THREE.MathUtils.lerp(0.65, -0.92, swing)
        );
        p.elbowR.rotation.set(-0.22, 0, 0);
        p.sword.rotation.set(Math.PI * 0.45, 0, THREE.MathUtils.lerp(0.65, -0.45, swing));
      } else {
        const r = (t - act) / (spec.duration - act);
        p.torso.rotation.set(damp(p.torso.rotation.x, 0.05, 8, dt), damp(p.torso.rotation.y, -0.35 * (1 - r), 8, dt), 0);
        p.shoulderR.rotation.set(damp(p.shoulderR.rotation.x, -0.7, 8, dt), damp(p.shoulderR.rotation.y, -0.25 * (1 - r), 8, dt), damp(p.shoulderR.rotation.z, -0.35, 8, dt));
        p.elbowR.rotation.set(-0.45, 0, 0);
        p.sword.rotation.set(Math.PI * 0.36, 0, -0.1);
      }
      return;
    }

    // Hit 3 ('light_3') or Heavy Cleave ('heavy'): Overhead High Raise -> Crushing Vertical Slam!
    const isHeavy = this._attackKind === 'heavy';
    const raisePitch = isHeavy ? -2.45 : -2.25;
    if (t < wu) {
      const u = t / wu;
      const ease = u * u;
      p.torso.rotation.set(-0.24 * ease, -0.18 * ease, 0);
      p.shoulderR.rotation.set(raisePitch * ease, 0, -0.15 * ease);
      p.elbowR.rotation.set(-0.42 * ease, 0, 0);
      p.sword.rotation.set(THREE.MathUtils.lerp(Math.PI * 0.35, Math.PI * 0.14, ease), 0, 0.04);
      // Raise shield arm slightly higher in two-handed overhead feel
      p.shoulderL.rotation.set(-1.35 * ease, 0.55, 0.1);
      p.elbowL.rotation.set(-1.0, 0, 0);
    } else if (t < act) {
      const s = (t - wu) / (act - wu);
      const slam = 1 - Math.pow(1 - s, 1.9); // Crisp downward cleave through chest/head height
      p.torso.rotation.set(THREE.MathUtils.lerp(-0.24, 0.48, slam), THREE.MathUtils.lerp(-0.18, 0.14, slam), 0);
      p.shoulderR.rotation.set(THREE.MathUtils.lerp(raisePitch, -0.08, slam), 0, -0.05);
      p.elbowR.rotation.set(-0.16, 0, 0);
      p.sword.rotation.set(THREE.MathUtils.lerp(Math.PI * 0.14, Math.PI * 0.52, slam), 0, 0.04);
    } else {
      const r = (t - act) / (spec.duration - act);
      const recover = Math.min(r * 1.4, 1);
      p.torso.rotation.set(THREE.MathUtils.lerp(0.48, 0.08, recover), THREE.MathUtils.lerp(0.14, 0, recover), 0);
      p.shoulderR.rotation.set(THREE.MathUtils.lerp(-0.08, -0.15, recover), 0, -0.15);
      p.elbowR.rotation.set(THREE.MathUtils.lerp(-0.18, -0.45, recover), 0, 0);
      p.sword.rotation.set(THREE.MathUtils.lerp(Math.PI * 0.5, Math.PI * 0.36, recover), 0, 0.08);
    }
  }

  getWorldCenter() {
    return new THREE.Vector3(this.position.x, this.position.y + 1.15, this.position.z);
  }
}
