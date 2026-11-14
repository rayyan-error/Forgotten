import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Shortest signed angular difference in [-PI, PI].
 */
function angleDiff(from, to) {
  let diff = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

/**
 * Exponential frame-rate independent damping helper.
 */
function damp(current, target, lambda, dt) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/**
 * Procedural articulated dark-fantasy Knight player controller.
 * Manages Souls-like camera-relative movement, lock-on strafing, sprinting,
 * 360-degree tucked dodge roll & backstep with i-frames, stamina system,
 * and hierarchical procedural animation.
 */
export class Player {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3} spawnPosition
   */
  constructor(scene, spawnPosition = new THREE.Vector3(0, 0, 11.0)) {
    this.scene = scene;

    // World transform state
    this.position = spawnPosition.clone();
    this.velocity = new THREE.Vector3();
    this.facingYaw = Math.PI; // Facing -Z toward the Grace & Eclipse
    this.collisionRadius = 0.42;

    // Combat & Resource Stats (structured for Chunk 2 expansion)
    this.stats = {
      hp: 100,
      maxHp: 100,
      fp: 60,
      maxFp: 60,
      stamina: 100,
      maxStamina: 100,
      staminaExhausted: false,
      regenDelayTimer: 0,
    };

    // Action / Dodge / i-frame state
    this.actionState = 'idle'; // 'idle' | 'move' | 'sprint' | 'roll' | 'backstep'
    this.isInvulnerable = false; // Core i-frames state flag for Chunk 2 hit checks
    this.isLockedOn = false;

    this._dodgeTimer = 0;
    this._dodgeDuration = 0.58;
    this._dodgeDir = new THREE.Vector3(0, 0, -1);
    this._dodgeLandingPuffDone = false;

    // Locomotion tuning (meters/sec)
    this.walkSpeed = 4.6;
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
    this._forwardComponent = 0;
    this._rightComponent = 0;
    this._cloakLagPitch = 0;
    this._cloakLagRoll = 0;
    this._lastYaw = this.facingYaw;

    // Dust puff pool for roll takeoff & landing tactile weight
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

    // Armored skirt tassets
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

    // Breastplate central ridge
    const breastRidge = addShadow(
      new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.36, 4), mat.armorDark)
    );
    breastRidge.position.set(0, 0.28, 0.13);
    breastRidge.rotation.x = Math.PI;
    breastRidge.scale.set(1.1, 1, 0.55);
    torso.add(breastRidge);

    // Gorget / Collar
    const gorget = addShadow(
      new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.21, 0.12, 8), mat.armorDark)
    );
    gorget.position.y = 0.49;
    torso.add(gorget);

    // Diagonal leather baldric strap across chest
    const baldric = addShadow(
      new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.58, 0.38), mat.leather)
    );
    baldric.position.set(0, 0.27, 0);
    baldric.rotation.z = 0.62;
    torso.add(baldric);

    // Empty scabbard strapped diagonally across back (grounding the greatsword silhouette)
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

    // Tattered Wanderer Cloak (two-stage hierarchy for flowing secondary motion)
    const cloakMantle = addShadow(
      new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 0.2, 8, 1, false, Math.PI * 0.55, Math.PI * 1.9), mat.cloakTrim)
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

    // Three jagged tattered lower cloak panels
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

    // Helm cranium dome
    const helmDome = addShadow(
      new THREE.Mesh(new THREE.DodecahedronGeometry(0.155, 0), mat.armorSteel)
    );
    helmDome.position.set(0, 0.14, -0.01);
    helmDome.scale.set(0.92, 1.08, 1.05);
    helmGroup.add(helmDome);

    // Subtle brass sagittal crest along top of helm
    const crest = addShadow(
      new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.09, 0.25), mat.brass)
    );
    crest.position.set(0, 0.28, -0.02);
    crest.rotation.x = -0.15;
    helmGroup.add(crest);

    // Dark recessed visor slit interior
    const visorRecess = new THREE.Mesh(
      new THREE.BoxGeometry(0.21, 0.055, 0.16),
      mat.visorVoid
    );
    visorRecess.position.set(0, 0.135, 0.085);
    helmGroup.add(visorRecess);

    // Subtle faint amber eye glints inside the visor slit
    [-0.042, 0.042].forEach((ex) => {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.014, 0.02), mat.emberGlint);
      eye.position.set(ex, 0.135, 0.155);
      helmGroup.add(eye);
    });

    // Heavy armored brow plate above visor slit
    const brow = addShadow(
      new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.05, 0.17), mat.armorDark)
    );
    brow.position.set(0, 0.18, 0.09);
    brow.rotation.x = 0.18;
    helmGroup.add(brow);

    // Pointed knight bevor / faceguard below visor slit
    const faceGuard = addShadow(
      new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.095, 0.13, 6), mat.armorSteel)
    );
    faceGuard.position.set(0, 0.05, 0.065);
    faceGuard.rotation.x = 0.15;
    helmGroup.add(faceGuard);

    // Angled snout wedge for dramatic low-poly sallet profile
    const nosePeak = addShadow(
      new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.14, 4), mat.armorDark)
    );
    nosePeak.position.set(0, 0.07, 0.15);
    nosePeak.rotation.x = Math.PI * 0.5;
    nosePeak.rotation.y = Math.PI * 0.25;
    helmGroup.add(nosePeak);

    // ------------------------------------------------------------------------
    // Left Arm (+X) & Kite Shield
    // ------------------------------------------------------------------------
    const shoulderL = new THREE.Group();
    shoulderL.position.set(0.32, 0.44, 0);
    torso.add(shoulderL);
    this.pivots.shoulderL = shoulderL;

    const pauldronL = addShadow(
      new THREE.Mesh(new THREE.SphereGeometry(0.135, 6, 4, 0, Math.PI * 2, 0, Math.PI * 0.65), mat.armorSteel)
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

    // Heraldic Kite Shield mounted on outer left forearm
    const shieldGroup = new THREE.Group();
    shieldGroup.position.set(0.09, -0.14, 0.04);
    shieldGroup.rotation.y = Math.PI * 0.5;
    elbowL.add(shieldGroup);
    this.pivots.shield = shieldGroup;

    const shieldTop = addShadow(
      new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.44, 0.045), mat.shieldFace)
    );
    shieldTop.position.y = 0.1;
    shieldGroup.add(shieldTop);

    // Tapered triangular kite shield bottom tip
    const shieldPoint = addShadow(
      new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.44, 4), mat.shieldFace)
    );
    shieldPoint.position.set(0, -0.33, 0);
    shieldPoint.rotation.x = Math.PI;
    shieldPoint.rotation.y = Math.PI * 0.25;
    shieldPoint.scale.set(1.36, 1, 0.14);
    shieldGroup.add(shieldPoint);

    // Brass rim trim & raised steel center boss
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
      new THREE.Mesh(new THREE.SphereGeometry(0.135, 6, 4, 0, Math.PI * 2, 0, Math.PI * 0.65), mat.armorSteel)
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

    // Greatsword gripped in Right Hand
    const swordGroup = new THREE.Group();
    swordGroup.position.set(-0.01, -0.27, 0.02);
    // Angled forward & slightly outward at the ready
    swordGroup.rotation.set(Math.PI * 0.34, 0, 0.08);
    elbowR.add(swordGroup);
    this.pivots.sword = swordGroup;

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

    // Greatsword blade (long beveled low-poly claymore profile)
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
    // Legs: Hip -> Thigh -> Knee -> Greave -> Sabaton Foot
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
   * Restores HP, FP, and Stamina cleanly when resting at a Site of Grace.
   */
  restoreAtGrace() {
    this.stats.hp = this.stats.maxHp;
    this.stats.fp = this.stats.maxFp;
    this.stats.stamina = this.stats.maxStamina;
    this.stats.staminaExhausted = false;
    this.stats.regenDelayTimer = 0;
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

  /**
   * Computes camera-relative desired world movement direction on XZ plane.
   */
  _computeWorldMoveDir(moveVec, cameraYaw) {
    if (moveVec.magnitude === 0) {
      return new THREE.Vector3(0, 0, 0);
    }
    // Forward direction camera is looking on XZ plane
    const camForwardX = -Math.sin(cameraYaw);
    const camForwardZ = -Math.cos(cameraYaw);
    // Right vector perpendicular to forward
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
    this._dodgeTimer = 0;
    this._dodgeDuration = 0.58;
    this._dodgeLandingPuffDone = false;

    if (worldMoveDir.lengthSq() > 1e-4) {
      this._dodgeDir.copy(worldMoveDir).normalize();
    } else {
      this._dodgeDir.set(Math.sin(this.facingYaw), 0, Math.cos(this.facingYaw));
    }

    // Face into the roll direction cleanly
    this.facingYaw = Math.atan2(this._dodgeDir.x, this._dodgeDir.z);
    this._spawnDustPuff(5, 0.25);
  }

  _startBackstep() {
    this._consumeStamina(this.backstepStaminaCost);
    this.actionState = 'backstep';
    this._dodgeTimer = 0;
    this._dodgeDuration = 0.38;
    this._dodgeLandingPuffDone = false;

    // Backstep moves opposite to current facing direction
    this._dodgeDir.set(-Math.sin(this.facingYaw), 0, -Math.cos(this.facingYaw));
    this._spawnDustPuff(4, 0.2);
  }

  /**
   * Main per-frame player movement, stamina, dodge i-frames, and animation update.
   */
  update(dt, input, cameraController, world) {
    const moveVec = input.getMoveVector();
    const worldMoveDir = this._computeWorldMoveDir(moveVec, cameraController.yaw);
    const lockedTarget = cameraController.lockedTarget;
    this.isLockedOn = Boolean(lockedTarget);

    let spentStaminaThisFrame = false;

    // ------------------------------------------------------------------------
    // 1. Dodge Roll & Backstep Execution
    // ------------------------------------------------------------------------
    if (this.actionState === 'roll' || this.actionState === 'backstep') {
      this._dodgeTimer += dt;
      const progress = Math.min(this._dodgeTimer / this._dodgeDuration, 1);

      if (this.actionState === 'roll') {
        // Invulnerability frames during core tucked somersault window
        this.isInvulnerable = this._dodgeTimer >= 0.04 && this._dodgeTimer <= 0.39;

        const burstFactor = Math.pow(1 - progress, 0.85) * 0.8 + 0.2;
        const speed = this.rollBurstSpeed * burstFactor;
        this.velocity.x = this._dodgeDir.x * speed;
        this.velocity.z = this._dodgeDir.z * speed;

        if (!this._dodgeLandingPuffDone && progress > 0.78) {
          this._dodgeLandingPuffDone = true;
          this._spawnDustPuff(4, 0.24);
        }
      } else {
        // Backstep i-frames
        this.isInvulnerable = this._dodgeTimer >= 0.03 && this._dodgeTimer <= 0.23;

        const burstFactor = Math.sin((1 - progress) * Math.PI * 0.5);
        const speed = this.backstepSpeed * burstFactor;
        this.velocity.x = this._dodgeDir.x * speed;
        this.velocity.z = this._dodgeDir.z * speed;
      }

      if (this._dodgeTimer >= this._dodgeDuration) {
        this.actionState = 'idle';
        this.isInvulnerable = false;
      }
    } else {
      this.isInvulnerable = false;

      // Trigger Dodge Roll or Backstep on Spacebar
      if (input.wasActionPressed('dodge') && this._canSpendStamina()) {
        if (moveVec.magnitude > 0) {
          this._startDodgeRoll(worldMoveDir);
        } else {
          this._startBackstep();
        }
        spentStaminaThisFrame = true;
      } else {
        // --------------------------------------------------------------------
        // 2. Grounded Movement, Sprint & Facing Rotation
        // --------------------------------------------------------------------
        const wantsMove = moveVec.magnitude > 0;
        const canSprint = wantsMove && input.isSprinting() && this._canSpendStamina();

        if (canSprint) {
          this.actionState = 'sprint';
          this._consumeStamina(this.sprintDrainPerSec * dt);
          spentStaminaThisFrame = true;
        } else if (wantsMove) {
          this.actionState = 'move';
        } else {
          this.actionState = 'idle';
        }

        const targetSpeed = canSprint ? this.sprintSpeed : wantsMove ? this.walkSpeed : 0;
        const targetVx = worldMoveDir.x * targetSpeed;
        const targetVz = worldMoveDir.z * targetSpeed;
        const accelLambda = wantsMove ? 14.0 : 16.5;

        this.velocity.x = damp(this.velocity.x, targetVx, accelLambda, dt);
        this.velocity.z = damp(this.velocity.z, targetVz, accelLambda, dt);

        // Character rotation: face locked target while strafing, OR face movement direction
        let targetYaw = this.facingYaw;
        if (this.isLockedOn && !canSprint) {
          const toTargetX = lockedTarget.position.x - this.position.x;
          const toTargetZ = lockedTarget.position.z - this.position.z;
          if (toTargetX * toTargetX + toTargetZ * toTargetZ > 0.001) {
            targetYaw = Math.atan2(toTargetX, toTargetZ);
          }
        } else if (wantsMove) {
          targetYaw = Math.atan2(worldMoveDir.x, worldMoveDir.z);
        }

        const yawStep = angleDiff(this.facingYaw, targetYaw);
        this.facingYaw += yawStep * (1 - Math.exp(-13.5 * dt));
      }
    }

    // ------------------------------------------------------------------------
    // 3. Stamina Regeneration
    // ------------------------------------------------------------------------
    if (!spentStaminaThisFrame && this.actionState !== 'roll' && this.actionState !== 'backstep') {
      if (this.stats.regenDelayTimer > 0) {
        this.stats.regenDelayTimer = Math.max(0, this.stats.regenDelayTimer - dt);
      } else if (this.stats.stamina < this.stats.maxStamina) {
        this.stats.stamina = Math.min(
          this.stats.maxStamina,
          this.stats.stamina + this.staminaRegenPerSec * dt
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
    // 4. Integrate Position, World Collision & Ground Elevation
    // ------------------------------------------------------------------------
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    world.resolveCollision(this.position, this.collisionRadius);

    const targetGroundY = world.getGroundHeight(this.position.x, this.position.z);
    this.position.y = damp(this.position.y, targetGroundY, 22.0, dt);

    this.root.position.copy(this.position);
    this.root.rotation.y = this.facingYaw;

    // ------------------------------------------------------------------------
    // 5. Procedural Articulated Animation & Secondary Cloak/Weapon Motion
    // ------------------------------------------------------------------------
    this._animateCharacter(dt);
    this._updateDustPuffs(dt);
  }

  _animateCharacter(dt) {
    const time = performance.now() * 0.001;
    const p = this.pivots;

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

    const targetMoveBlend = !isRolling && !isBackstepping ? THREE.MathUtils.clamp(horizSpeed / this.walkSpeed, 0, 1) : 0;
    const targetSprintBlend = isSprinting ? 1 : 0;
    this._moveBlend = damp(this._moveBlend, targetMoveBlend, 12, dt);
    this._sprintBlend = damp(this._sprintBlend, targetSprintBlend, 10, dt);

    // Advance stride phase proportional to ground velocity
    if (this._moveBlend > 0.03) {
      const cycleRate = THREE.MathUtils.lerp(2.2, 3.05, this._sprintBlend);
      this._stridePhase += dt * horizSpeed * cycleRate;
    }

    // Secondary cloak lag & turn whip
    const yawRate = angleDiff(this._lastYaw, this.facingYaw) / Math.max(dt, 0.001);
    this._lastYaw = this.facingYaw;
    const targetCloakPitch = 0.08 + Math.max(0, rawForward) * 0.34 + this._sprintBlend * 0.25 + (isRolling ? 0.55 : 0);
    const targetCloakRoll = THREE.MathUtils.clamp(-yawRate * 0.045 - rawRight * 0.14, -0.45, 0.45);
    this._cloakLagPitch = damp(this._cloakLagPitch, targetCloakPitch, 9, dt);
    this._cloakLagRoll = damp(this._cloakLagRoll, targetCloakRoll, 10, dt);

    const cloakWind = Math.sin(time * 3.1) * 0.05 + Math.cos(time * 5.2) * 0.025;
    p.cloakUpper.rotation.x = this._cloakLagPitch + cloakWind;
    p.cloakUpper.rotation.z = this._cloakLagRoll;
    p.cloakLower.rotation.x = this._cloakLagPitch * 0.55 + Math.sin(time * 4.4 - 0.8) * 0.08;
    p.cloakLower.rotation.z = this._cloakLagRoll * 0.5;

    // ------------------------------------------------------------------------
    // Dodge Roll Pose (Full 360-degree tucked somersault)
    // ------------------------------------------------------------------------
    if (isRolling) {
      const t = THREE.MathUtils.clamp(this._dodgeTimer / this._dodgeDuration, 0, 1);
      // Smooth ease-in-out roll angle from 0 to 2*PI
      const rollEase = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) * 0.5;
      p.rollPivot.rotation.x = rollEase * Math.PI * 2;
      p.rollPivot.position.y = 0.88 + Math.sin(Math.PI * t) * 0.24 - (t > 0.78 ? (1 - t) * 0.12 : 0);

      // Tucked limbs inside somersault
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

    // ------------------------------------------------------------------------
    // Backstep Pose (Crisp backward evade hop)
    // ------------------------------------------------------------------------
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

      // Shield raised defensively during backstep
      p.shoulderL.rotation.set(-0.75, 0.35, -0.1);
      p.elbowL.rotation.set(-1.1, 0, 0);
      p.shoulderR.rotation.set(0.32, 0, -0.18);
      p.elbowR.rotation.set(-0.65, 0, 0);
      p.sword.rotation.set(Math.PI * 0.32, 0, 0.12);
      return;
    }

    // Recover rollPivot smoothly back to neutral 0 (mod 2*PI)
    p.rollPivot.rotation.x = 0;
    p.rollPivot.position.y = damp(p.rollPivot.position.y, 0.88, 18, dt);

    // ------------------------------------------------------------------------
    // Idle + Grounded Walk / Sprint / Strafe Blending
    // ------------------------------------------------------------------------
    const idleBreath = Math.sin(time * 2.1);
    const idleSway = Math.sin(time * 1.05);

    const strideSin = Math.sin(this._stridePhase);
    const strideCos = Math.cos(this._stridePhase);
    const moveAmt = this._moveBlend;
    const sprintAmt = this._sprintBlend;

    // Direction-aware stride scaling (forward, backpedal, or lateral strafe)
    const fwdSign = this._forwardComponent >= -0.15 ? 1 : -1;
    const fwdMag = Math.min(Math.abs(this._forwardComponent), 1.3);
    const strafeAmt = this._rightComponent;

    const legSwingAmp = THREE.MathUtils.lerp(0.56, 0.86, sprintAmt) * moveAmt;
    const hipBob = moveAmt * Math.abs(strideSin) * (0.045 + sprintAmt * 0.035);

    // Pelvis height & counter-sway
    p.pelvis.position.y = damp(p.pelvis.position.y, 0.91 - moveAmt * 0.035 + hipBob + (1 - moveAmt) * idleBreath * 0.01, 18, dt);
    p.pelvis.rotation.y = damp(p.pelvis.rotation.y, strideSin * 0.11 * moveAmt * fwdSign, 16, dt);
    p.pelvis.rotation.z = damp(p.pelvis.rotation.z, -strafeAmt * 0.08 + strideCos * 0.035 * moveAmt, 14, dt);

    // Torso lean & counter-twist
    const targetTorsoPitch =
      (1 - moveAmt) * (0.04 + idleBreath * 0.022) +
      moveAmt * (0.14 + sprintAmt * 0.24) * (fwdSign > 0 ? 1 : -0.35);
    const targetTorsoYaw =
      (1 - moveAmt) * idleSway * 0.03 -
      strideSin * 0.14 * moveAmt * fwdSign;
    p.torso.rotation.x = damp(p.torso.rotation.x, targetTorsoPitch, 14, dt);
    p.torso.rotation.y = damp(p.torso.rotation.y, targetTorsoYaw, 14, dt);
    p.torso.rotation.z = damp(p.torso.rotation.z, strafeAmt * 0.09, 14, dt);

    // Head stabilizes horizon while breathing
    p.neck.rotation.x = damp(p.neck.rotation.x, -targetTorsoPitch * 0.65 - idleBreath * 0.018, 12, dt);
    p.neck.rotation.y = damp(p.neck.rotation.y, -targetTorsoYaw * 0.5, 12, dt);

    // Legs (hip swings forward when < 0; knee bends backward when > 0)
    const swingL = strideSin * legSwingAmp * (0.65 + 0.35 * fwdMag) * fwdSign;
    const swingR = -strideSin * legSwingAmp * (0.65 + 0.35 * fwdMag) * fwdSign;

    // Knee lifts cleanly during forward swing phase
    const kneeLiftL = Math.max(0, -Math.cos(this._stridePhase * fwdSign)) * (0.62 + sprintAmt * 0.45) * moveAmt;
    const kneeLiftR = Math.max(0, Math.cos(this._stridePhase * fwdSign)) * (0.62 + sprintAmt * 0.45) * moveAmt;

    // Slight heroic planted stance in idle + lateral strafe abduction
    const idleStanceL = (1 - moveAmt) * -0.06;
    const idleStanceR = (1 - moveAmt) * 0.07;
    const strafeHipL = Math.max(0, strafeAmt) * 0.18 * (0.5 + 0.5 * strideSin);
    const strafeHipR = Math.max(0, -strafeAmt) * 0.18 * (0.5 - 0.5 * strideSin);

    p.hipL.rotation.x = damp(p.hipL.rotation.x, idleStanceL - swingL, 16, dt);
    p.hipL.rotation.z = damp(p.hipL.rotation.z, 0.04 + strafeHipL, 14, dt);
    p.kneeL.rotation.x = damp(p.kneeL.rotation.x, 0.08 + kneeLiftL + Math.max(0, swingL) * 0.35, 16, dt);

    p.hipR.rotation.x = damp(p.hipR.rotation.x, idleStanceR - swingR, 16, dt);
    p.hipR.rotation.z = damp(p.hipR.rotation.z, -0.04 - strafeHipR, 14, dt);
    p.kneeR.rotation.x = damp(p.kneeR.rotation.x, 0.08 + kneeLiftR + Math.max(0, swingR) * 0.35, 16, dt);

    // Left Arm (Kite Shield ready guard + opposing stride counter-swing)
    const lockShieldRaise = this.isLockedOn && !isSprinting ? 0.36 : 0;
    const armSwingL = swingR * (0.48 + sprintAmt * 0.32);
    const targetShoulderLX =
      (1 - moveAmt) * (-0.18 - idleBreath * 0.02) +
      moveAmt * (-0.28 + armSwingL) -
      lockShieldRaise;
    const targetShoulderLY = (1 - moveAmt) * 0.18 + lockShieldRaise * 0.85;
    p.shoulderL.rotation.x = damp(p.shoulderL.rotation.x, targetShoulderLX, 13, dt);
    p.shoulderL.rotation.y = damp(p.shoulderL.rotation.y, targetShoulderLY, 13, dt);
    p.shoulderL.rotation.z = damp(p.shoulderL.rotation.z, 0.12 - lockShieldRaise * 0.25, 13, dt);
    p.elbowL.rotation.x = damp(p.elbowL.rotation.x, -0.58 - lockShieldRaise * 0.72 - sprintAmt * 0.22, 13, dt);

    // Right Arm (Greatsword carried at the ready; swept lower/back during sprint!)
    const armSwingR = swingL * (0.52 + sprintAmt * 0.35);
    const targetShoulderRX =
      (1 - moveAmt) * (-0.12 + idleBreath * 0.025) +
      moveAmt * (0.14 + armSwingR + sprintAmt * 0.38);
    p.shoulderR.rotation.x = damp(p.shoulderR.rotation.x, targetShoulderRX, 13, dt);
    p.shoulderR.rotation.z = damp(p.shoulderR.rotation.z, -0.16 - sprintAmt * 0.12, 13, dt);
    p.elbowR.rotation.x = damp(p.elbowR.rotation.x, -0.45 + sprintAmt * 0.18, 13, dt);

    // Greatsword trailing wrist angle (low diagonal battle-ready -> swept backward on sprint)
    const targetSwordPitch = Math.PI * (0.36 + sprintAmt * 0.22) + strideSin * 0.05 * moveAmt;
    p.sword.rotation.x = damp(p.sword.rotation.x, targetSwordPitch, 12, dt);
  }

  getWorldCenter() {
    return new THREE.Vector3(this.position.x, this.position.y + 1.15, this.position.z);
  }
}
