import * as THREE from 'three';

/**
 * Deterministic pseudo-random generator for reproducible world layout.
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Procedural dark-fantasy world: "Ashen Overlook"
 * Contains twilight/eclipse atmosphere, cliffside ruin courtyard,
 * Site of Grace with rising embers, dead twisted trees, targetable dummy/pillar,
 * distant mountains, ground height sampling, and collision resolution.
 */
export class World {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.rng = mulberry32(2641528);

    this.circleColliders = [];
    this.boxColliders = [];
    this.lockableTargets = [];

    this.gracePosition = new THREE.Vector3(0, 0.28, 1.4);
    this.sunDirection = new THREE.Vector3(-0.08, 0.165, -0.983).normalize();

    // Walkable cliff plateau boundaries (courtyard deck)
    this.walkBounds = {
      minX: -13.2,
      maxX: 13.2,
      minZ: -10.8,
      maxZ: 16.2,
    };

    this._graceRestBoost = 0;
    this._materials = this._createMaterials();

    this._setupAtmosphereAndLighting();
    this._buildSkyDome();
    this._buildCliffPlateau();
    this._buildFlagstones();
    this._buildCentralDais();
    this._buildArchesAndWalls();
    this._buildCrumblingPillars();
    this._buildTwistedTrees();
    this._buildGraceShrine();
    this._buildTargetDummy();
    this._buildRunedTargetPillar();
    this._buildDistantMountains();
    this._buildParticles();
  }

  _createMaterials() {
    const std = (color, roughness = 0.88, metalness = 0.08, extra = {}) =>
      new THREE.MeshStandardMaterial({
        color,
        roughness,
        metalness,
        flatShading: true,
        ...extra,
      });

    return {
      cliffRock: std(0x282430, 0.95, 0.04),
      cliffDark: std(0x1b1824, 0.97, 0.02),
      stoneLight: std(0x585260, 0.86, 0.06),
      stoneMid: std(0x45404e, 0.88, 0.05),
      stoneDark: std(0x332e3b, 0.9, 0.06),
      stoneMoss: std(0x3a433d, 0.9, 0.04),
      stoneSand: std(0x66584f, 0.84, 0.07),
      barkDark: std(0x28201e, 0.95, 0.02),
      woodWeathered: std(0x4d392d, 0.9, 0.04),
      ironDark: std(0x3a3e48, 0.46, 0.74),
      brassAged: std(0xb48e4a, 0.4, 0.8),
      clothTattered: std(0x622b30, 0.9, 0.02),
      mountainFar: std(0x231b30, 0.98, 0.0),
      mountainMid: std(0x2b2238, 0.96, 0.02),
      graceCore: new THREE.MeshBasicMaterial({
        color: 0xffe49e,
      }),
      graceAura: new THREE.MeshBasicMaterial({
        color: 0xffa634,
        transparent: true,
        opacity: 0.34,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      runeGlow: new THREE.MeshStandardMaterial({
        color: 0xffb347,
        emissive: 0xd97d1e,
        emissiveIntensity: 1.5,
        roughness: 0.4,
        metalness: 0.2,
        flatShading: true,
      }),
    };
  }

  _setupAtmosphereAndLighting() {
    this.scene.background = new THREE.Color(0x1a1324);
    this.scene.fog = new THREE.FogExp2(0x2a1f34, 0.0142);

    // Twilight sky + warm earth bounce
    this.hemiLight = new THREE.HemisphereLight(0x7c6aa6, 0x3b2d2a, 1.25);
    this.scene.add(this.hemiLight);

    // Primary Eclipse Sunlight casting dramatic long twilight shadows
    this.sunLight = new THREE.DirectionalLight(0xffb972, 2.45);
    this.sunLight.position.copy(this.sunDirection).multiplyScalar(48);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 4;
    this.sunLight.shadow.camera.far = 110;
    const d = 24;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.025;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Cool twilight fill from the player-side hemisphere so armored silhouettes & cloak facets shine
    this.rimLight = new THREE.DirectionalLight(0x7e8ec9, 1.05);
    this.rimLight.position.set(16, 18, 28);
    this.scene.add(this.rimLight);

    // Flickering Grace Shrine point light
    this.graceLight = new THREE.PointLight(0xffa43b, 5.2, 16.5, 1.35);
    this.graceLight.position.set(
      this.gracePosition.x,
      this.gracePosition.y + 0.95,
      this.gracePosition.z
    );
    this.graceLight.castShadow = true;
    this.graceLight.shadow.mapSize.set(512, 512);
    this.graceLight.shadow.bias = -0.002;
    this.scene.add(this.graceLight);
  }

  _buildSkyDome() {
    const skyGeo = new THREE.SphereGeometry(280, 36, 24);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uSunDir: { value: this.sunDirection.clone() },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldDir;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldDir = normalize(position);
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir;
        uniform float uTime;
        varying vec3 vWorldDir;

        float hash(vec3 p) {
          p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }

        void main() {
          vec3 dir = normalize(vWorldDir);
          float h = clamp(dir.y, -0.25, 1.0);

          // Twilight sky vertical gradient: warm dusk horizon -> slate-violet -> deep indigo zenith
          vec3 abyssCol = vec3(0.055, 0.042, 0.085);
          vec3 horizonCol = vec3(0.22, 0.14, 0.21);
          vec3 midCol = vec3(0.145, 0.105, 0.21);
          vec3 zenithCol = vec3(0.045, 0.032, 0.082);

          vec3 col = mix(horizonCol, midCol, smoothstep(0.0, 0.28, max(h, 0.0)));
          col = mix(col, zenithCol, smoothstep(0.24, 0.85, max(h, 0.0)));
          if (h < 0.0) {
            col = mix(horizonCol, abyssCol, smoothstep(0.0, -0.22, h));
          }

          // Directional golden-amber eclipse horizon bloom
          float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
          float horizonBand = exp(-abs(dir.y - 0.03) * 8.5);
          vec3 amberGlow = vec3(0.92, 0.45, 0.14) * pow(sunDot, 2.2) * horizonBand * 0.85;
          col += amberGlow;

          // Broad atmospheric solar halo
          col += vec3(1.0, 0.58, 0.22) * pow(sunDot, 12.0) * 0.55;
          col += vec3(1.0, 0.78, 0.42) * pow(sunDot, 48.0) * 0.65;

          // Eclipsed Sun Disc + Blazing Solar Corona
          float ang = acos(clamp(dot(dir, normalize(uSunDir)), -1.0, 1.0));
          float discRadius = 0.052;
          float coronaWidth = 0.022;

          // Subtle shimmering corona rays
          float angleAround = atan(dir.y - uSunDir.y, dir.x - uSunDir.x);
          float rayShimmer = 0.88 + 0.12 * sin(angleAround * 7.0 + uTime * 0.6) * cos(angleAround * 5.0 - uTime * 0.4);

          float outerCorona = exp(-max(ang - discRadius, 0.0) / coronaWidth) * rayShimmer;
          float innerRing = smoothstep(discRadius + 0.014, discRadius - 0.001, ang) *
                            smoothstep(discRadius - 0.006, discRadius + 0.003, ang);

          col += vec3(1.0, 0.68, 0.22) * outerCorona * 1.45;
          col += vec3(1.0, 0.92, 0.68) * innerRing * 2.2;

          // Pitch-black eclipsed moon/occultation core
          float eclipseMask = smoothstep(discRadius, discRadius - 0.004, ang);
          col = mix(col, vec3(0.015, 0.01, 0.024), eclipseMask);

          // Faint high-altitude twilight stars
          if (h > 0.22) {
            vec3 starCell = floor(dir * 380.0);
            float s = hash(starCell);
            if (s > 0.9968) {
              float twinkle = 0.55 + 0.45 * sin(uTime * 1.8 + s * 100.0);
              float starVis = smoothstep(0.22, 0.62, h) * (1.0 - pow(sunDot, 3.0));
              col += vec3(0.88, 0.85, 0.96) * twinkle * starVis * 0.5;
            }
          }

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    this.skyMaterial = skyMat;
    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    this.root.add(skyMesh);
  }

  _buildCliffPlateau() {
    // Main solid stone plateau bedrock
    const deckGeo = new THREE.BoxGeometry(29.5, 4.5, 30.5, 6, 1, 6);
    const pos = deckGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // Taper & crag the underside cliff walls while keeping top surface flat
      if (y < 0) {
        const taper = 0.82;
        pos.setX(i, x * taper + (this.rng() - 0.5) * 1.6);
        pos.setZ(i, z * taper + (this.rng() - 0.5) * 1.6);
        pos.setY(i, y - this.rng() * 3.5);
      } else {
        // Keep edge perimeter slightly organic
        if (Math.abs(x) > 13.5 || z < -11.2 || z > 16.5) {
          pos.setY(i, y - this.rng() * 0.35);
        }
      }
    }
    deckGeo.computeVertexNormals();
    const deck = new THREE.Mesh(deckGeo, this._materials.cliffRock);
    deck.position.set(0, -2.35, 2.6);
    deck.receiveShadow = true;
    deck.castShadow = true;
    this.root.add(deck);

    // Lower craggy cliff spurs jutting down into the misty chasm
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    for (let i = 0; i < 34; i++) {
      const angle = (i / 34) * Math.PI * 2;
      const rx = Math.cos(angle) * (13.8 + this.rng() * 3.8);
      const rz = 2.6 + Math.sin(angle) * (14.4 + this.rng() * 3.8);
      const scaleX = 2.4 + this.rng() * 3.6;
      const scaleY = 5.5 + this.rng() * 11.0;
      const scaleZ = 2.4 + this.rng() * 3.6;

      const spur = new THREE.Mesh(
        rockGeo,
        this.rng() > 0.45 ? this._materials.cliffRock : this._materials.cliffDark
      );
      spur.position.set(rx, -scaleY * 0.5 - 0.5 - this.rng() * 2.0, rz);
      spur.scale.set(scaleX, scaleY, scaleZ);
      spur.rotation.set(
        (this.rng() - 0.5) * 0.25,
        this.rng() * Math.PI * 2,
        (this.rng() - 0.5) * 0.25
      );
      spur.castShadow = true;
      spur.receiveShadow = true;
      this.root.add(spur);
    }

    // Subtle chasm mist abyss floor far below
    const abyssGeo = new THREE.PlaneGeometry(520, 520, 12, 12);
    abyssGeo.rotateX(-Math.PI / 2);
    const abyssMat = new THREE.MeshBasicMaterial({ color: 0x16111e });
    const abyss = new THREE.Mesh(abyssGeo, abyssMat);
    abyss.position.y = -28;
    this.root.add(abyss);
  }

  _buildFlagstones() {
    // Instanced uneven low-poly flagstones across the courtyard
    const slabGeo = new THREE.BoxGeometry(1.56, 0.18, 1.56);
    const stonePalette = [
      new THREE.Color(0x47424d),
      new THREE.Color(0x3c3843),
      new THREE.Color(0x353939), // subtle moss-tinted slate
      new THREE.Color(0x524947), // warm ash-sandstone tint
      new THREE.Color(0x2f2b36),
    ];

    const placements = [];
    for (let gx = -12.6; gx <= 12.6; gx += 1.68) {
      for (let gz = -10.4; gz <= 15.8; gz += 1.68) {
        // Leave occasional missing broken flagstones near edges for ruin feel
        const distCenter = Math.hypot(gx, gz - 1.4);
        const edgeRatio = Math.max(Math.abs(gx) / 13.2, Math.abs(gz - 2.5) / 14.0);
        if (edgeRatio > 0.78 && this.rng() < 0.28) continue;
        if (distCenter > 5.0 && this.rng() < 0.08) continue;

        // Keep central dais clear so stepped circular stones stand cleanly
        if (distCenter < 3.6) continue;

        const jx = gx + (this.rng() - 0.5) * 0.14;
        const jz = gz + (this.rng() - 0.5) * 0.14;
        const heightOffset = (this.rng() - 0.5) * 0.045;
        const tiltX = (this.rng() - 0.5) * 0.042;
        const tiltZ = (this.rng() - 0.5) * 0.042;
        const yaw = (this.rng() - 0.5) * 0.08;
        const sx = 0.88 + this.rng() * 0.18;
        const sz = 0.88 + this.rng() * 0.18;

        placements.push({ jx, jz, heightOffset, tiltX, tiltZ, yaw, sx, sz });
      }
    }

    const inst = new THREE.InstancedMesh(slabGeo, this._materials.stoneLight, placements.length);
    inst.receiveShadow = true;
    inst.castShadow = true;

    const dummy = new THREE.Object3D();
    placements.forEach((p, idx) => {
      dummy.position.set(p.jx, -0.08 + p.heightOffset, p.jz);
      dummy.rotation.set(p.tiltX, p.yaw, p.tiltZ);
      dummy.scale.set(p.sx, 1, p.sz);
      dummy.updateMatrix();
      inst.setMatrixAt(idx, dummy.matrix);

      const baseCol = stonePalette[Math.floor(this.rng() * stonePalette.length)].clone();
      baseCol.offsetHSL(0, 0, (this.rng() - 0.5) * 0.05);
      inst.setColorAt(idx, baseCol);
    });

    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    this.root.add(inst);
  }

  _buildCentralDais() {
    const cx = this.gracePosition.x;
    const cz = this.gracePosition.z;

    // Outer stepped octagonal platform (y = 0.14)
    const tier1Geo = new THREE.CylinderGeometry(4.55, 4.78, 0.24, 12);
    const tier1 = new THREE.Mesh(tier1Geo, this._materials.stoneMid);
    tier1.position.set(cx, 0.02, cz);
    tier1.receiveShadow = true;
    tier1.castShadow = true;
    this.root.add(tier1);

    // Inner ritual dais (y = 0.28)
    const tier2Geo = new THREE.CylinderGeometry(3.05, 3.25, 0.22, 12);
    const tier2 = new THREE.Mesh(tier2Geo, this._materials.stoneSand);
    tier2.position.set(cx, 0.17, cz);
    tier2.receiveShadow = true;
    tier2.castShadow = true;
    this.root.add(tier2);

    // Engraved dark basalt ritual ring inlaid on upper dais
    const ringGeo = new THREE.RingGeometry(1.45, 2.35, 16);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, this._materials.stoneDark);
    ring.position.set(cx, 0.285, cz);
    ring.receiveShadow = true;
    this.root.add(ring);

    // Radial curb stones around the dais perimeter
    const curbGeo = new THREE.BoxGeometry(0.75, 0.16, 0.36);
    for (let i = 0; i < 12; i++) {
      if (i === 0 || i === 6) continue; // Clear north/south path lines
      const a = (i / 12) * Math.PI * 2;
      const curb = new THREE.Mesh(curbGeo, this._materials.stoneDark);
      curb.position.set(cx + Math.sin(a) * 4.45, 0.16, cz + Math.cos(a) * 4.45);
      curb.rotation.y = a;
      curb.castShadow = true;
      curb.receiveShadow = true;
      this.root.add(curb);
    }
  }

  _buildArchesAndWalls() {
    // 1. Grand Entrance Gothic Arch behind spawn (z = 14.2)
    this._createGothicArch(0, 0, 14.2, 0, true);

    // 2. Half-Collapsed Overlook Arch framing the Eclipse on left-cliff edge
    this._createGothicArch(-5.6, 0, -9.8, 0.28, false);

    // 3. Crumbling Low Parapet Walls along Cliff Overlook & Flanks
    const wallSegments = [
      // North cliff overlook left & right parapets (leaving central vista open!)
      { x: -8.6, z: -11.2, w: 6.4, h: 1.05, d: 0.72, ry: 0.03 },
      { x: 8.6, z: -11.2, w: 6.6, h: 0.95, d: 0.72, ry: -0.02 },
      // Low stepped border stone along vista gap (walk-stopping cliff edge curb)
      { x: -3.9, z: -11.2, w: 2.2, h: 0.48, d: 0.65, ry: 0.0 },
      { x: 3.9, z: -11.2, w: 2.2, h: 0.42, d: 0.65, ry: 0.0 },
      // West ruin perimeter broken walls
      { x: -13.6, z: -4.2, w: 0.78, h: 2.2, d: 7.4, ry: 0.0 },
      { x: -13.6, z: 6.8, w: 0.78, h: 1.5, d: 6.2, ry: 0.0 },
      // East ruin perimeter broken walls
      { x: 13.6, z: -4.6, w: 0.78, h: 1.85, d: 6.8, ry: 0.0 },
      { x: 13.6, z: 6.5, w: 0.78, h: 2.35, d: 6.8, ry: 0.0 },
    ];

    wallSegments.forEach((seg) => {
      const group = new THREE.Group();
      group.position.set(seg.x, 0, seg.z);
      group.rotation.y = seg.ry;

      const baseGeo = new THREE.BoxGeometry(seg.w, seg.h, seg.d);
      const wall = new THREE.Mesh(baseGeo, this._materials.stoneMid);
      wall.position.y = seg.h * 0.5;
      wall.castShadow = true;
      wall.receiveShadow = true;
      group.add(wall);

      // Add jagged weathered cap stones along top of wall
      const count = Math.max(2, Math.floor(Math.max(seg.w, seg.d) / 1.4));
      for (let i = 0; i < count; i++) {
        if (this.rng() < 0.32) continue;
        const t = (i + 0.5) / count - 0.5;
        const capH = 0.18 + this.rng() * 0.32;
        const cap = new THREE.Mesh(
          new THREE.BoxGeometry(
            seg.w > seg.d ? seg.w / count * 0.84 : seg.w * 1.08,
            capH,
            seg.d > seg.w ? seg.d / count * 0.84 : seg.d * 1.08
          ),
          this.rng() > 0.5 ? this._materials.stoneLight : this._materials.stoneDark
        );
        cap.position.set(
          seg.w > seg.d ? t * seg.w : 0,
          seg.h + capH * 0.5 - 0.02,
          seg.d > seg.w ? t * seg.d : 0
        );
        cap.rotation.z = (this.rng() - 0.5) * 0.08;
        cap.castShadow = true;
        cap.receiveShadow = true;
        group.add(cap);
      }

      this.root.add(group);
      this.boxColliders.push({
        x: seg.x,
        z: seg.z,
        halfW: (seg.w + 0.25) * 0.5,
        halfD: (seg.d + 0.25) * 0.5,
      });
    });
  }

  _createGothicArch(x, y, z, rotY, intact) {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.y = rotY;

    const span = 2.65;
    const pierHeight = 4.6;

    const buildPier = (px, height, brokenTop = false) => {
      const plinth = new THREE.Mesh(
        new THREE.BoxGeometry(1.45, 0.55, 1.45),
        this._materials.stoneDark
      );
      plinth.position.set(px, 0.275, 0);
      plinth.castShadow = true;
      plinth.receiveShadow = true;
      group.add(plinth);

      const shaft = new THREE.Mesh(
        new THREE.BoxGeometry(1.08, height, 1.08),
        this._materials.stoneMid
      );
      shaft.position.set(px, 0.55 + height * 0.5, 0);
      shaft.castShadow = true;
      shaft.receiveShadow = true;
      group.add(shaft);

      if (!brokenTop) {
        const cap = new THREE.Mesh(
          new THREE.BoxGeometry(1.38, 0.36, 1.38),
          this._materials.stoneLight
        );
        cap.position.set(px, 0.55 + height + 0.18, 0);
        cap.castShadow = true;
        cap.receiveShadow = true;
        group.add(cap);
      } else {
        const shard = new THREE.Mesh(
          new THREE.ConeGeometry(0.62, 0.9, 5),
          this._materials.stoneLight
        );
        shard.position.set(px - 0.1, 0.55 + height + 0.25, 0.05);
        shard.rotation.z = 0.35;
        shard.castShadow = true;
        group.add(shard);
      }

      // Register world-space collider for each pier
      const worldOffset = new THREE.Vector3(px, 0, 0).applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        rotY
      );
      this.circleColliders.push({
        x: x + worldOffset.x,
        z: z + worldOffset.z,
        radius: 0.78,
      });
    };

    buildPier(-span, pierHeight, false);
    buildPier(span, intact ? pierHeight : 2.9, !intact);

    // Voussoir pointed arch segments
    const archSteps = 11;
    const baseArchY = 0.55 + pierHeight + 0.25;
    for (let i = 0; i <= archSteps; i++) {
      if (!intact && i > 5) continue; // Half-collapsed!

      const t = i / archSteps;
      const angle = Math.PI * (1 - t); // Pi -> 0 (left to right)
      const px = Math.cos(angle) * span;
      // Slightly pointed gothic arch profile
      const py = baseArchY + Math.sin(angle) * 2.15 + (1 - Math.abs(t - 0.5) * 2) * 0.45;

      const block = new THREE.Mesh(
        new THREE.BoxGeometry(0.76, 0.74, 1.04),
        i % 2 === 0 ? this._materials.stoneLight : this._materials.stoneMid
      );
      block.position.set(px, py, 0);
      block.rotation.z = angle - Math.PI * 0.5;
      block.castShadow = true;
      block.receiveShadow = true;
      group.add(block);
    }

    if (intact) {
      // Decorative keystone & upper ruined parapet gable
      const keystone = new THREE.Mesh(
        new THREE.BoxGeometry(0.65, 1.15, 1.18),
        this._materials.stoneSand
      );
      keystone.position.set(0, baseArchY + 2.68, 0);
      keystone.castShadow = true;
      group.add(keystone);
    } else {
      // Scatter fallen arch rubble blocks beside the broken right pier
      for (let r = 0; r < 5; r++) {
        const rubble = new THREE.Mesh(
          new THREE.BoxGeometry(0.68, 0.45 + this.rng() * 0.3, 0.72),
          this._materials.stoneDark
        );
        rubble.position.set(
          span * 0.72 + (this.rng() - 0.5) * 1.9,
          0.22,
          (this.rng() - 0.5) * 1.8
        );
        rubble.rotation.set(
          (this.rng() - 0.5) * 0.4,
          this.rng() * Math.PI,
          (this.rng() - 0.5) * 0.5
        );
        rubble.castShadow = true;
        rubble.receiveShadow = true;
        group.add(rubble);
      }
    }

    this.root.add(group);
  }

  _buildCrumblingPillars() {
    const pillars = [
      { x: -7.8, z: 9.2, h: 4.8, intact: true },
      { x: 7.8, z: 9.2, h: 3.1, intact: false, fallenAngle: 0.4 },
      { x: -8.6, z: 2.2, h: 2.2, intact: false, fallenAngle: -1.1 },
      { x: 8.6, z: 2.4, h: 4.9, intact: true },
      { x: -8.4, z: -5.4, h: 3.7, intact: false, fallenAngle: 0.85 },
      { x: 8.8, z: -5.6, h: 2.6, intact: false, fallenAngle: -0.6 },
      { x: -4.2, z: 12.6, h: 3.4, intact: false, fallenAngle: 0.2 },
      { x: 4.2, z: 12.6, h: 4.5, intact: true },
    ];

    pillars.forEach((p) => {
      const group = new THREE.Group();
      group.position.set(p.x, 0, p.z);

      const plinth = new THREE.Mesh(
        new THREE.BoxGeometry(1.28, 0.45, 1.28),
        this._materials.stoneDark
      );
      plinth.position.y = 0.225;
      plinth.castShadow = true;
      plinth.receiveShadow = true;
      group.add(plinth);

      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.48, p.h, 8),
        this._materials.stoneMid
      );
      shaft.position.y = 0.45 + p.h * 0.5;
      shaft.castShadow = true;
      shaft.receiveShadow = true;
      group.add(shaft);

      if (p.intact) {
        const cap = new THREE.Mesh(
          new THREE.BoxGeometry(1.22, 0.34, 1.22),
          this._materials.stoneLight
        );
        cap.position.y = 0.45 + p.h + 0.17;
        cap.castShadow = true;
        cap.receiveShadow = true;
        group.add(cap);
      } else {
        // Jagged sheared crown on top of broken pillar
        const jag = new THREE.Mesh(
          new THREE.ConeGeometry(0.42, 0.72, 6),
          this._materials.stoneLight
        );
        jag.position.set(0.08, 0.45 + p.h + 0.2, -0.05);
        jag.rotation.set(0.25, this.rng() * Math.PI, -0.35);
        jag.castShadow = true;
        group.add(jag);

        // Fallen column drum resting on ground nearby
        const drum = new THREE.Mesh(
          new THREE.CylinderGeometry(0.4, 0.42, 1.35, 8),
          this._materials.stoneLight
        );
        const dir = p.fallenAngle ?? 0;
        drum.position.set(Math.cos(dir) * 1.45, 0.4, Math.sin(dir) * 1.45);
        drum.rotation.set(Math.PI * 0.5, 0, dir + 0.35);
        drum.castShadow = true;
        drum.receiveShadow = true;
        group.add(drum);
      }

      this.root.add(group);
      this.circleColliders.push({ x: p.x, z: p.z, radius: 0.66 });
    });
  }

  _buildTwistedTrees() {
    const treeConfigs = [
      { x: -11.4, z: -9.0, scale: 1.18, seed: 101 },
      { x: 11.2, z: -8.6, scale: 1.05, seed: 202 },
      { x: -11.8, z: 4.5, scale: 0.95, seed: 303 },
      { x: 11.6, z: 9.8, scale: 1.12, seed: 404 },
    ];

    treeConfigs.forEach((cfg) => {
      const tree = this._createTwistedTreeMesh(cfg.scale, mulberry32(cfg.seed));
      tree.position.set(cfg.x, 0, cfg.z);
      this.root.add(tree);
      this.circleColliders.push({ x: cfg.x, z: cfg.z, radius: 0.58 * cfg.scale });
    });
  }

  _createTwistedTreeMesh(scale, rng) {
    const tree = new THREE.Group();

    const growBranch = (parent, length, radiusBottom, radiusTop, depth, tiltX, tiltZ, twistY) => {
      const segGroup = new THREE.Group();
      segGroup.rotation.set(tiltX, twistY, tiltZ);

      const segGeo = new THREE.CylinderGeometry(radiusTop, radiusBottom, length, 6);
      segGeo.translate(0, length * 0.5, 0);
      const segMesh = new THREE.Mesh(segGeo, this._materials.barkDark);
      segMesh.castShadow = true;
      segMesh.receiveShadow = true;
      segGroup.add(segMesh);
      parent.add(segGroup);

      if (depth <= 0) return;

      const tip = new THREE.Group();
      tip.position.set(0, length * 0.92, 0);
      segGroup.add(tip);

      const branches = depth === 3 ? 3 : 2;
      for (let i = 0; i < branches; i++) {
        const subLen = length * (0.64 + rng() * 0.18);
        const subRadB = radiusTop * 0.95;
        const subRadT = Math.max(0.025, radiusTop * 0.52);
        const spread = depth === 3 ? 0.52 : 0.66;
        const bYaw = (i / branches) * Math.PI * 2 + (rng() - 0.5) * 0.9;
        const bTiltX = (rng() - 0.3) * spread;
        const bTiltZ = (rng() - 0.5) * spread + (i === 0 ? 0.35 : -0.32);

        growBranch(tip, subLen, subRadB, subRadT, depth - 1, bTiltX, bTiltZ, bYaw);
      }
    };

    // Twisted gnarled root spurs
    for (let r = 0; r < 4; r++) {
      const ra = (r / 4) * Math.PI * 2 + rng() * 0.4;
      const rootGeo = new THREE.ConeGeometry(0.24, 1.05, 5);
      const root = new THREE.Mesh(rootGeo, this._materials.barkDark);
      root.position.set(Math.cos(ra) * 0.35, 0.25, Math.sin(ra) * 0.35);
      root.rotation.set(Math.sin(ra) * 0.85, ra, -Math.cos(ra) * 0.85);
      root.castShadow = true;
      tree.add(root);
    }

    growBranch(tree, 2.35, 0.38, 0.24, 3, 0.14, -0.1, rng() * Math.PI);
    tree.scale.setScalar(scale);
    return tree;
  }

  _buildGraceShrine() {
    const group = new THREE.Group();
    group.position.copy(this.gracePosition);

    // Stone ash basin ring
    const basin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.95, 1.15, 0.22, 10),
      this._materials.stoneDark
    );
    basin.position.y = 0.08;
    basin.receiveShadow = true;
    basin.castShadow = true;
    group.add(basin);

    // Mound of pale-golden cinder ash
    const ashMound = new THREE.Mesh(
      new THREE.ConeGeometry(0.75, 0.26, 9),
      this._materials.stoneSand
    );
    ashMound.position.y = 0.2;
    ashMound.receiveShadow = true;
    group.add(ashMound);

    // Coiled Grace-Root / Twisted Iron Sword driven into the center
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 1.05, 0.03),
      this._materials.ironDark
    );
    blade.position.set(0, 0.56, 0);
    blade.rotation.set(0.08, 0.4, -0.12);
    blade.castShadow = true;
    group.add(blade);

    const guard = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.06, 0.06),
      this._materials.brassAged
    );
    guard.position.set(-0.04, 0.88, 0.02);
    guard.rotation.set(0.08, 0.4, -0.12);
    group.add(guard);

    // Floating Golden Grace Core Wisp
    this.graceWispGroup = new THREE.Group();
    this.graceWispGroup.position.set(0, 1.06, 0);

    const innerCrystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.14, 0),
      this._materials.graceCore
    );
    innerCrystal.scale.set(0.72, 1.65, 0.72);
    this.graceWispGroup.add(innerCrystal);

    const aura1 = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.28, 1),
      this._materials.graceAura
    );
    aura1.scale.set(1.0, 1.65, 1.0);
    this.graceWispGroup.add(aura1);

    const aura2 = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.54, 1),
      new THREE.MeshBasicMaterial({
        color: 0xff9226,
        transparent: true,
        opacity: 0.14,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.graceWispGroup.add(aura2);

    // Orbiting subtle golden sigil ring
    const ringGeo = new THREE.TorusGeometry(0.42, 0.015, 6, 20);
    this.graceRing = new THREE.Mesh(ringGeo, this._materials.runeGlow);
    this.graceRing.rotation.x = Math.PI * 0.42;
    this.graceWispGroup.add(this.graceRing);

    group.add(this.graceWispGroup);
    this.root.add(group);

    this.circleColliders.push({
      x: this.gracePosition.x,
      z: this.gracePosition.z,
      radius: 1.05,
    });
  }

  _buildTargetDummy() {
    // Primary Target Lock-On Test Dummy: Ashen Training Effigy
    const pos = new THREE.Vector3(4.8, 0, -3.2);
    const dummyGroup = new THREE.Group();
    dummyGroup.position.copy(pos);
    dummyGroup.rotation.y = -0.62; // Facing toward center courtyard

    // Weathered plinth
    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.68, 0.24, 8),
      this._materials.stoneDark
    );
    plinth.position.y = 0.12;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    dummyGroup.add(plinth);

    // Pivot for hit/bump wobble reaction
    this.dummyPivot = new THREE.Group();
    this.dummyPivot.position.y = 0.24;
    dummyGroup.add(this.dummyPivot);

    // Timber upright post
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.13, 1.65, 7),
      this._materials.woodWeathered
    );
    post.position.y = 0.82;
    post.castShadow = true;
    this.dummyPivot.add(post);

    // Crossbar shoulders
    const crossbar = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 0.13, 0.13),
      this._materials.woodWeathered
    );
    crossbar.position.y = 1.24;
    crossbar.castShadow = true;
    this.dummyPivot.add(crossbar);

    // Armored straw/iron training torso barrel
    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.22, 0.68, 8),
      this._materials.clothTattered
    );
    torso.position.y = 1.12;
    torso.castShadow = true;
    this.dummyPivot.add(torso);

    // Iron chest straps & faint target rune
    const strap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.295, 0.275, 0.12, 8),
      this._materials.ironDark
    );
    strap.position.y = 1.2;
    this.dummyPivot.add(strap);

    const chestSigil = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.08, 0),
      this._materials.runeGlow
    );
    chestSigil.position.set(0, 1.16, 0.28);
    chestSigil.scale.set(1, 1.2, 0.4);
    this.dummyPivot.add(chestSigil);

    // Battered pot-helm target head
    const helm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.16, 0.3, 7),
      this._materials.ironDark
    );
    helm.position.y = 1.62;
    helm.castShadow = true;
    this.dummyPivot.add(helm);

    // Side buckler shield mounted on arm
    const buckler = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.24, 0.06, 8),
      this._materials.brassAged
    );
    buckler.position.set(-0.46, 1.14, 0.08);
    buckler.rotation.set(0.2, 0.25, Math.PI * 0.45);
    buckler.castShadow = true;
    this.dummyPivot.add(buckler);

    this.root.add(dummyGroup);
    this.circleColliders.push({ x: pos.x, z: pos.z, radius: 0.65 });

    this.lockableTargets.push({
      id: 'training-dummy',
      name: 'Ashen Effigy',
      position: pos.clone(),
      lockOffset: new THREE.Vector3(0, 1.28, 0),
      radius: 0.65,
      isAlive: true,
      mesh: dummyGroup,
    });
  }

  _buildRunedTargetPillar() {
    // Secondary lockable test target: Runed Sentinel Obelisk across courtyard
    const pos = new THREE.Vector3(-5.2, 0, -2.8);
    const group = new THREE.Group();
    group.position.copy(pos);

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 0.42, 1.15),
      this._materials.stoneDark
    );
    base.position.y = 0.21;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.44, 2.25, 6),
      this._materials.stoneMid
    );
    shaft.position.y = 0.42 + 1.125;
    shaft.castShadow = true;
    shaft.receiveShadow = true;
    group.add(shaft);

    // Glowing etched rune band at chest lock-on height
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(0.41, 0.032, 5, 12),
      this._materials.runeGlow
    );
    band.position.y = 1.48;
    band.rotation.x = Math.PI * 0.5;
    group.add(band);
    this.sentinelBand = band;

    this.root.add(group);
    this.circleColliders.push({ x: pos.x, z: pos.z, radius: 0.68 });

    this.lockableTargets.push({
      id: 'runed-pillar',
      name: 'Runed Obelisk',
      position: pos.clone(),
      lockOffset: new THREE.Vector3(0, 1.48, 0),
      radius: 0.68,
      isAlive: true,
      mesh: group,
    });
  }

  _buildDistantMountains() {
    const peakGeo = new THREE.ConeGeometry(1, 1, 5);
    const ridgeGeo = new THREE.ConeGeometry(1, 1, 4);

    // Inner jagged mountain ring (carving a dramatic valley gap below the Eclipse azimuth)
    const count = 44;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (this.rng() - 0.5) * 0.08;
      const dirX = Math.cos(angle);
      const dirZ = Math.sin(angle);
      const eclipseDot = dirX * this.sunDirection.x + dirZ * this.sunDirection.z;
      const valleyDip = eclipseDot > 0.84 ? 0.24 : 1.0;

      const dist = 78 + this.rng() * 34;
      const h = (24 + this.rng() * 34) * valleyDip;
      const w = 15 + this.rng() * 19;

      const peak = new THREE.Mesh(
        i % 3 === 0 ? ridgeGeo : peakGeo,
        this.rng() > 0.5 ? this._materials.mountainMid : this._materials.mountainFar
      );
      peak.position.set(dirX * dist, -18 + h * 0.5, dirZ * dist);
      peak.scale.set(w, h, w * (0.7 + this.rng() * 0.6));
      peak.rotation.y = this.rng() * Math.PI * 2;
      peak.rotation.z = (this.rng() - 0.5) * 0.16;
      this.root.add(peak);
    }

    // Outer colossal twilight silhouettes
    for (let i = 0; i < 28; i++) {
      const angle = (i / 28) * Math.PI * 2 + 0.12;
      const dirX = Math.cos(angle);
      const dirZ = Math.sin(angle);
      const eclipseDot = dirX * this.sunDirection.x + dirZ * this.sunDirection.z;
      const valleyDip = eclipseDot > 0.86 ? 0.2 : 1.0;

      const dist = 132 + this.rng() * 48;
      const h = (42 + this.rng() * 44) * valleyDip;
      const w = 26 + this.rng() * 24;

      const colossus = new THREE.Mesh(peakGeo, this._materials.mountainFar);
      colossus.position.set(dirX * dist, -24 + h * 0.5, dirZ * dist);
      colossus.scale.set(w, h, w * (0.75 + this.rng() * 0.5));
      colossus.rotation.y = this.rng() * Math.PI * 2;
      this.root.add(colossus);
    }
  }

  _buildParticles() {
    // 1. Rising Golden Embers around Site of Grace
    const emberCount = 110;
    this.emberData = [];
    const emberPos = new Float32Array(emberCount * 3);
    const emberSizes = new Float32Array(emberCount);
    const emberAlpha = new Float32Array(emberCount);

    for (let i = 0; i < emberCount; i++) {
      const age = this.rng();
      const angle = this.rng() * Math.PI * 2;
      const radius = 0.12 + this.rng() * 0.85;
      this.emberData.push({
        age,
        speed: 0.24 + this.rng() * 0.28,
        angle,
        orbitSpeed: (this.rng() - 0.5) * 2.2,
        radius,
        maxH: 3.4 + this.rng() * 2.4,
      });
      emberPos[i * 3] = this.gracePosition.x + Math.cos(angle) * radius;
      emberPos[i * 3 + 1] = this.gracePosition.y + 0.25 + age * 4.0;
      emberPos[i * 3 + 2] = this.gracePosition.z + Math.sin(angle) * radius;
      emberSizes[i] = 10 + this.rng() * 14;
      emberAlpha[i] = 1 - age;
    }

    const emberGeo = new THREE.BufferGeometry();
    emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3));
    emberGeo.setAttribute('aSize', new THREE.BufferAttribute(emberSizes, 1));
    emberGeo.setAttribute('aAlpha', new THREE.BufferAttribute(emberAlpha, 1));

    const emberMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColorHot: { value: new THREE.Color(0xffe69c) },
        uColorWarm: { value: new THREE.Color(0xff7d1a) },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (16.0 / max(-mvPosition.z, 1.0));
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColorHot;
        uniform vec3 uColorWarm;
        varying float vAlpha;
        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float d = length(uv);
          if (d > 0.5) discard;
          float glow = pow(1.0 - d * 2.0, 2.0);
          vec3 col = mix(uColorWarm, uColorHot, glow);
          gl_FragColor = vec4(col, glow * vAlpha);
        }
      `,
    });

    this.emberPoints = new THREE.Points(emberGeo, emberMat);
    this.root.add(this.emberPoints);

    // 2. Ambient Twilight Ash Motes across the courtyard
    const ashCount = 160;
    this.ashData = [];
    const ashPos = new Float32Array(ashCount * 3);
    const ashSizes = new Float32Array(ashCount);
    const ashAlpha = new Float32Array(ashCount);

    for (let i = 0; i < ashCount; i++) {
      const x = (this.rng() - 0.5) * 28;
      const y = 0.3 + this.rng() * 7.5;
      const z = (this.rng() - 0.5) * 28 + 2.0;
      this.ashData.push({
        baseX: x,
        baseY: y,
        baseZ: z,
        phase: this.rng() * Math.PI * 2,
        speed: 0.35 + this.rng() * 0.45,
      });
      ashPos[i * 3] = x;
      ashPos[i * 3 + 1] = y;
      ashPos[i * 3 + 2] = z;
      ashSizes[i] = 6 + this.rng() * 8;
      ashAlpha[i] = 0.25 + this.rng() * 0.35;
    }

    const ashGeo = new THREE.BufferGeometry();
    ashGeo.setAttribute('position', new THREE.BufferAttribute(ashPos, 3));
    ashGeo.setAttribute('aSize', new THREE.BufferAttribute(ashSizes, 1));
    ashGeo.setAttribute('aAlpha', new THREE.BufferAttribute(ashAlpha, 1));

    const ashMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColorHot: { value: new THREE.Color(0xdcc6a4) },
        uColorWarm: { value: new THREE.Color(0x9a756c) },
      },
      vertexShader: emberMat.vertexShader,
      fragmentShader: emberMat.fragmentShader,
    });

    this.ashPoints = new THREE.Points(ashGeo, ashMat);
    this.root.add(this.ashPoints);
  }

  /**
   * Returns walkable surface height at (x, z).
   */
  getGroundHeight(x, z) {
    const distGrace = Math.hypot(x - this.gracePosition.x, z - this.gracePosition.z);
    if (distGrace < 3.12) return 0.28;
    if (distGrace < 4.62) return 0.14;
    return 0;
  }

  /**
   * Resolves horizontal player collision against pillars, walls, shrine, dummies, and cliff perimeter.
   * @param {THREE.Vector3} position - Modified in place.
   * @param {number} radius
   */
  resolveCollision(position, radius = 0.42) {
    // Circle obstacles
    for (let i = 0; i < this.circleColliders.length; i++) {
      const c = this.circleColliders[i];
      const dx = position.x - c.x;
      const dz = position.z - c.z;
      const minDist = radius + c.radius;
      const distSq = dx * dx + dz * dz;
      if (distSq < minDist * minDist) {
        const dist = Math.sqrt(distSq) || 0.0001;
        const push = minDist - dist;
        position.x += (dx / dist) * push;
        position.z += (dz / dist) * push;
      }
    }

    // Axis-aligned wall segments
    for (let i = 0; i < this.boxColliders.length; i++) {
      const b = this.boxColliders[i];
      const closestX = THREE.MathUtils.clamp(position.x, b.x - b.halfW, b.x + b.halfW);
      const closestZ = THREE.MathUtils.clamp(position.z, b.z - b.halfD, b.z + b.halfD);
      const dx = position.x - closestX;
      const dz = position.z - closestZ;
      const distSq = dx * dx + dz * dz;

      if (distSq < radius * radius) {
        if (distSq > 1e-6) {
          const dist = Math.sqrt(distSq);
          const push = radius - dist;
          position.x += (dx / dist) * push;
          position.z += (dz / dist) * push;
        } else {
          // Inside box fallback: push out along nearest axis
          const penX = b.halfW + radius - Math.abs(position.x - b.x);
          const penZ = b.halfD + radius - Math.abs(position.z - b.z);
          if (penX < penZ) {
            position.x += position.x >= b.x ? penX : -penX;
          } else {
            position.z += position.z >= b.z ? penZ : -penZ;
          }
        }
      }
    }

    // Clamp to safe cliff plateau boundaries so player cannot fall into abyss
    position.x = THREE.MathUtils.clamp(
      position.x,
      this.walkBounds.minX + radius,
      this.walkBounds.maxX - radius
    );
    position.z = THREE.MathUtils.clamp(
      position.z,
      this.walkBounds.minZ + radius,
      this.walkBounds.maxZ - radius
    );
  }

  /**
   * Prevents third-person camera from clipping below ground or inside thick stone structures.
   * @param {THREE.Vector3} focusPos
   * @param {THREE.Vector3} desiredCamPos
   */
  clampCameraPosition(focusPos, desiredCamPos) {
    const groundAtCam = this.getGroundHeight(desiredCamPos.x, desiredCamPos.z);
    if (desiredCamPos.y < groundAtCam + 0.45) {
      desiredCamPos.y = groundAtCam + 0.45;
    }

    // Push camera radially outside tall pillar colliders
    for (let i = 0; i < this.circleColliders.length; i++) {
      const c = this.circleColliders[i];
      if (c.radius < 0.65) continue;
      const dx = desiredCamPos.x - c.x;
      const dz = desiredCamPos.z - c.z;
      const minDist = c.radius + 0.35;
      const distSq = dx * dx + dz * dz;
      if (distSq < minDist * minDist && desiredCamPos.y < 4.5) {
        const dist = Math.sqrt(distSq) || 0.01;
        desiredCamPos.x = c.x + (dx / dist) * minDist;
        desiredCamPos.z = c.z + (dz / dist) * minDist;
      }
    }

    return desiredCamPos;
  }

  isNearGrace(playerPos) {
    return (
      Math.hypot(
        playerPos.x - this.gracePosition.x,
        playerPos.z - this.gracePosition.z
      ) <= 3.1
    );
  }

  triggerGraceRest() {
    this._graceRestBoost = 1.0;
  }

  getLockableTargets() {
    return this.lockableTargets;
  }

  /**
   * Animates sky shader, Grace flicker, embers, ambient ash, and shadow stabilization.
   */
  update(dt, elapsed, playerPos) {
    this.skyMaterial.uniforms.uTime.value = elapsed;

    // Decay Grace rest flare
    if (this._graceRestBoost > 0) {
      this._graceRestBoost = Math.max(0, this._graceRestBoost - dt * 1.15);
    }

    // Organic Grace light flicker + float
    const flicker =
      Math.sin(elapsed * 7.3) * 0.25 +
      Math.sin(elapsed * 13.7) * 0.16 +
      Math.cos(elapsed * 4.1) * 0.2;
    this.graceLight.intensity = 5.1 + flicker + this._graceRestBoost * 9.0;

    this.graceWispGroup.position.y = 1.06 + Math.sin(elapsed * 2.2) * 0.08;
    this.graceWispGroup.rotation.y = elapsed * 0.9;
    this.graceRing.rotation.z = elapsed * 1.3;
    const wispScale = 1.0 + Math.sin(elapsed * 3.8) * 0.06 + this._graceRestBoost * 0.55;
    this.graceWispGroup.scale.setScalar(wispScale);

    // Subtle sentinel rune pulse
    if (this.sentinelBand) {
      this.sentinelBand.rotation.z = elapsed * 0.45;
    }

    // Update rising golden embers
    const emberPosAttr = this.emberPoints.geometry.getAttribute('position');
    const emberAlphaAttr = this.emberPoints.geometry.getAttribute('aAlpha');
    const boostMul = 1.0 + this._graceRestBoost * 1.8;

    for (let i = 0; i < this.emberData.length; i++) {
      const e = this.emberData[i];
      e.age += dt * e.speed * boostMul;
      if (e.age >= 1.0) {
        e.age %= 1.0;
        e.angle = this.rng() * Math.PI * 2;
        e.radius = 0.1 + this.rng() * 0.8;
      }

      const swirl = e.angle + e.age * e.orbitSpeed * 2.6;
      const radialSpread = e.radius * (1.0 - e.age * 0.35) + Math.sin(elapsed * 2.0 + i) * 0.07;

      emberPosAttr.setXYZ(
        i,
        this.gracePosition.x + Math.cos(swirl) * radialSpread,
        this.gracePosition.y + 0.25 + e.age * e.maxH,
        this.gracePosition.z + Math.sin(swirl) * radialSpread
      );

      const fadeIn = Math.min(1, e.age * 6.0);
      const fadeOut = 1.0 - e.age;
      emberAlphaAttr.setX(i, fadeIn * fadeOut * (0.85 + this._graceRestBoost * 0.4));
    }
    emberPosAttr.needsUpdate = true;
    emberAlphaAttr.needsUpdate = true;

    // Update drifting twilight ash motes
    const ashPosAttr = this.ashPoints.geometry.getAttribute('position');
    for (let i = 0; i < this.ashData.length; i++) {
      const a = this.ashData[i];
      const driftX = Math.sin(elapsed * a.speed + a.phase) * 0.75 + elapsed * 0.22;
      const driftY = Math.cos(elapsed * a.speed * 0.8 + a.phase) * 0.45;
      const driftZ = Math.sin(elapsed * a.speed * 0.6 + a.phase * 1.3) * 0.65;

      // Wrap horizontally around courtyard
      const wx = ((a.baseX + driftX + 14) % 28 + 28) % 28 - 14;
      ashPosAttr.setXYZ(i, wx, a.baseY + driftY, a.baseZ + driftZ);
    }
    ashPosAttr.needsUpdate = true;

    // Snap directional shadow frustum to texel grid around player to eliminate shadow shimmer
    if (playerPos) {
      const texelSize = (24 * 2) / 2048;
      const snapX = Math.round(playerPos.x / texelSize) * texelSize;
      const snapZ = Math.round(playerPos.z / texelSize) * texelSize;
      this.sunLight.target.position.set(snapX, 0, snapZ);
      this.sunLight.position
        .copy(this.sunDirection)
        .multiplyScalar(48)
        .add(this.sunLight.target.position);
      this.sunLight.target.updateMatrixWorld();
    }
  }
}
