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

function smoothstep(edge0, edge1, x) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Procedural dark-fantasy world: "Ashen Overlook", "Gilded Moorlands" (Plains/Farmlands),
 * and "Frostpeak Crags" (Rugged Mountains).
 * Features a continuous Dynamic Day/Night Cycle, nocturnal point-light ignition,
 * multi-biome terrain height sampling, 3 Golden Grace Shrines, and collision resolution.
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

    // Dynamic Day/Night Cycle state
    // 0.00 = Dawn, 0.25 = Golden Day, 0.50 = Crimson Dusk, 0.75 = Moonlit Night
    this.dayLengthSeconds = 300; // 5-minute full continuous cycle
    this.timeOfDay = 0.48; // Starts in late Golden-Crimson Dusk so initial mood is iconic
    this.timeScale = 1.0;
    this.timePreset = 'auto'; // 'auto' | 'dawn' | 'day' | 'dusk' | 'night'
    this.nightLightFactor = 0.35;
    this.isNight = false;

    this.sunDirection = new THREE.Vector3(-0.08, 0.165, -0.983).normalize();
    this.moonDirection = new THREE.Vector3(0.08, 0.65, 0.75).normalize();

    // Expanded world boundaries covering Courtyard + Plains/Farmlands (East) + Mountains (West)
    this.walkBounds = {
      minX: -80.0,
      maxX: 80.0,
      minZ: -34.0,
      maxZ: 34.0,
    };

    // Primary Courtyard Grace position (preserved for backwards compatibility)
    this.gracePosition = new THREE.Vector3(0, 0.28, 1.4);
    this.graceShrines = [];
    this.activeGraceId = 'grace-courtyard';

    // Night-toggled atmospheric lights (campfires, torches, braziers)
    this.nightPointLights = [];
    this.campfireFlames = [];
    this.windmillSails = null;

    this._graceRestBoost = 0;
    this._dummyWobble = { x: 0, z: 0, vx: 0, vz: 0 };
    this._materials = this._createMaterials();

    // Register the 3 biome Grace Shrine coordinates before terrain evaluation
    this._graceCoords = [
      {
        id: 'grace-courtyard',
        name: 'Ashen Overlook',
        subtitle: 'The Eclipsed Courtyard',
        biome: 'courtyard',
        x: 0,
        z: 1.4,
        respawnOffset: new THREE.Vector3(0, 0, 3.2),
        respawnYaw: Math.PI,
      },
      {
        id: 'grace-plains',
        name: 'Gilded Moorlands',
        subtitle: 'Farmland Crossroads Shrine',
        biome: 'plains',
        x: 34.0,
        z: 2.0,
        respawnOffset: new THREE.Vector3(-2.6, 0, 0.6),
        respawnYaw: -Math.PI * 0.5,
      },
      {
        id: 'grace-mountains',
        name: 'Frostpeak Pass',
        subtitle: 'High Crag Sanctuary',
        biome: 'mountains',
        x: -45.0,
        z: -5.0,
        respawnOffset: new THREE.Vector3(2.6, 0, 1.2),
        respawnYaw: Math.PI * 0.5,
      },
    ];

    this._setupAtmosphereAndLighting();
    this._buildSkyDome();
    this._buildCliffPlateau();
    this._buildExpandedBiomesTerrain();
    this._buildFlagstones();
    this._buildCentralDais();
    this._buildArchesAndWalls();
    this._buildCrumblingPillars();
    this._buildTwistedTrees();
    this._buildAllGraceShrines();
    this._buildTargetDummy();
    this._buildRunedTargetPillar();
    this._buildPlainsAndFarmlandsProps();
    this._buildMountainBiomeProps();
    this._buildDistantMountains();
    this._buildParticles();

    // Apply initial lighting interpolation
    this._updateDayNightLighting(0);
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
      woodFence: std(0x5b4331, 0.9, 0.03),
      plasterDaub: std(0x7c7060, 0.92, 0.02),
      roofThatch: std(0x5c472c, 0.94, 0.02),
      hayGold: std(0xb58d3d, 0.9, 0.03),
      tentCanvas: std(0x6e352f, 0.88, 0.04),
      tentTan: std(0x7a6852, 0.9, 0.03),
      pineNeedle: std(0x23382c, 0.9, 0.02),
      pineSnow: std(0xcbd6e2, 0.78, 0.05),
      snowCap: std(0xd8e2ec, 0.75, 0.05),
      slateMountain: std(0x373c48, 0.92, 0.06),
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
      campfireFlame: new THREE.MeshBasicMaterial({
        color: 0xff8c2b,
        transparent: true,
        opacity: 0.9,
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
    this.scene.fog = new THREE.FogExp2(0x2a1f34, 0.0085);

    // Sky + warm/cool ground hemisphere light
    this.hemiLight = new THREE.HemisphereLight(0x7c6aa6, 0x3b2d2a, 1.25);
    this.scene.add(this.hemiLight);

    // Primary Sun / Moon directional light casting dynamic shadows
    this.sunLight = new THREE.DirectionalLight(0xffb972, 2.45);
    this.sunLight.position.copy(this.sunDirection).multiplyScalar(56);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.near = 4;
    this.sunLight.shadow.camera.far = 140;
    const d = 26;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.025;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Secondary rim/fill directional light
    this.rimLight = new THREE.DirectionalLight(0x7e8ec9, 1.05);
    this.rimLight.position.set(16, 18, 28);
    this.scene.add(this.rimLight);
  }

  _buildSkyDome() {
    const skyGeo = new THREE.SphereGeometry(320, 36, 24);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uSunDir: { value: this.sunDirection.clone() },
        uMoonDir: { value: this.moonDirection.clone() },
        uTime: { value: 0 },
        uZenithCol: { value: new THREE.Color(0x0b0815) },
        uMidCol: { value: new THREE.Color(0x251b36) },
        uHorizonCol: { value: new THREE.Color(0x382436) },
        uAbyssCol: { value: new THREE.Color(0x0e0b16) },
        uSolarGlowCol: { value: new THREE.Color(0xeb7324) },
        uDayFactor: { value: 0.0 },
        uTwilightFactor: { value: 1.0 },
        uNightFactor: { value: 0.2 },
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
        uniform vec3 uMoonDir;
        uniform float uTime;
        uniform vec3 uZenithCol;
        uniform vec3 uMidCol;
        uniform vec3 uHorizonCol;
        uniform vec3 uAbyssCol;
        uniform vec3 uSolarGlowCol;
        uniform float uDayFactor;
        uniform float uTwilightFactor;
        uniform float uNightFactor;
        varying vec3 vWorldDir;

        float hash(vec3 p) {
          p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }

        void main() {
          vec3 dir = normalize(vWorldDir);
          float h = clamp(dir.y, -0.25, 1.0);

          vec3 col = mix(uHorizonCol, uMidCol, smoothstep(0.0, 0.28, max(h, 0.0)));
          col = mix(col, uZenithCol, smoothstep(0.24, 0.85, max(h, 0.0)));
          if (h < 0.0) {
            col = mix(uHorizonCol, uAbyssCol, smoothstep(0.0, -0.22, h));
          }

          // Solar horizon bloom & halo
          vec3 sDir = normalize(uSunDir);
          float sunDot = max(dot(dir, sDir), 0.0);
          float sunVis = clamp(sDir.y * 3.5 + 0.55, 0.0, 1.0);
          float horizonBand = exp(-abs(dir.y - max(0.02, sDir.y * 0.4)) * 6.5);
          col += uSolarGlowCol * pow(sunDot, 2.2) * horizonBand * (0.55 + uTwilightFactor * 0.45) * sunVis;
          col += uSolarGlowCol * pow(sunDot, 12.0) * 0.48 * sunVis;
          col += vec3(1.0, 0.88, 0.55) * pow(sunDot, 48.0) * 0.55 * sunVis;

          // Sun / Eclipse Disc
          float ang = acos(clamp(dot(dir, sDir), -1.0, 1.0));
          float discRadius = 0.052;
          float coronaWidth = 0.022;
          float angleAround = atan(dir.y - sDir.y, dir.x - sDir.x);
          float rayShimmer = 0.88 + 0.12 * sin(angleAround * 7.0 + uTime * 0.6) * cos(angleAround * 5.0 - uTime * 0.4);
          float outerCorona = exp(-max(ang - discRadius, 0.0) / coronaWidth) * rayShimmer;
          float innerRing = smoothstep(discRadius + 0.014, discRadius - 0.001, ang) *
                            smoothstep(discRadius - 0.006, discRadius + 0.003, ang);

          col += vec3(1.0, 0.68, 0.22) * outerCorona * 1.35 * sunVis;
          col += vec3(1.0, 0.92, 0.68) * innerRing * 2.0 * sunVis;

          float discMask = smoothstep(discRadius, discRadius - 0.004, ang) * sunVis;
          vec3 sunCoreCol = mix(vec3(0.015, 0.01, 0.024), vec3(1.0, 0.96, 0.82), uDayFactor * 0.88);
          col = mix(col, sunCoreCol, discMask);

          // Moon Disc & Silver-Blue Lunar Halo at Night
          vec3 mDir = normalize(uMoonDir);
          float moonDot = max(dot(dir, mDir), 0.0);
          float moonAng = acos(clamp(dot(dir, mDir), -1.0, 1.0));
          float moonRadius = 0.044;
          float moonHalo = exp(-max(moonAng - moonRadius, 0.0) / 0.035);
          col += vec3(0.45, 0.62, 0.95) * moonHalo * 0.65 * uNightFactor;
          col += vec3(0.32, 0.45, 0.78) * pow(moonDot, 16.0) * 0.35 * uNightFactor;
          float moonMask = smoothstep(moonRadius, moonRadius - 0.004, moonAng) * uNightFactor;
          col = mix(col, vec3(0.86, 0.92, 1.0), moonMask);

          // Twinkling Starfield (faint at twilight, bright at night)
          float starStrength = clamp(uNightFactor * 1.15 + uTwilightFactor * 0.35 - uDayFactor * 0.9, 0.0, 1.0);
          if (h > 0.08 && starStrength > 0.01) {
            vec3 starCell = floor(dir * 380.0);
            float s = hash(starCell);
            if (s > 0.9958) {
              float twinkle = 0.55 + 0.45 * sin(uTime * 2.1 + s * 100.0);
              float starVis = smoothstep(0.08, 0.45, h) * (1.0 - pow(sunDot, 3.0) * sunVis);
              col += vec3(0.88, 0.91, 1.0) * twinkle * starVis * starStrength * 0.85;
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

  /**
   * Returns accurate ground elevation at (x, z) across the Courtyard,
   * Plains/Farmlands (East), and Rugged Mountains (West).
   */
  getTerrainHeight(x, z) {
    // 1. Check stepped ritual daises around all 3 Golden Grace Shrines
    for (let i = 0; i < this._graceCoords.length; i++) {
      const g = this._graceCoords[i];
      const dg = Math.hypot(x - g.x, z - g.z);
      if (dg < 4.62) {
        const baseH = i === 0 ? 0 : this._sampleRawBiomeHeight(g.x, g.z);
        if (dg < 3.12) return baseH + 0.28;
        return baseH + 0.14;
      }
    }

    // 2. Starting Ruined Courtyard flat plateau
    if (x >= -13.5 && x <= 13.5 && z >= -11.2 && z <= 16.5) {
      return 0;
    }

    return this._sampleRawBiomeHeight(x, z);
  }

  /**
   * Alias preserved for existing player/enemy/camera calls.
   */
  getGroundHeight(x, z) {
    return this.getTerrainHeight(x, z);
  }

  _sampleRawBiomeHeight(x, z) {
    // Smooth blend to 0 inside the Courtyard footprint
    const inCourtyardX = 1 - smoothstep(13.2, 19.5, Math.abs(x));
    const inCourtyardZ = z >= -12.0 && z <= 17.5 ? 1 - smoothstep(12.0, 18.5, Math.abs(z - 2.5)) : 0;
    const courtyardMask = inCourtyardX * inCourtyardZ;
    if (courtyardMask >= 0.999) return 0;

    let h = 0;

    if (x > 0) {
      // EAST: Plains & Farmlands Biome
      const tEast = smoothstep(13.5, 22.0, x);
      const roll =
        Math.sin(x * 0.075) * Math.cos(z * 0.085) * 1.15 +
        Math.sin((x + z) * 0.045) * 0.65 -
        0.25;

      // Flatten slightly along the winding dirt road (z ≈ 1.2 + sin((x-14)*0.07)*4.5)
      const roadZ = 1.2 + Math.sin((x - 14) * 0.065) * 4.2;
      const distRoad = Math.abs(z - roadZ);
      const roadFlatten = 1 - 0.65 * (1 - smoothstep(1.8, 5.5, distRoad));

      // Gentle plateau leveling around Soldier Outpost Camp (56, -11) & Farmhouse Hill (46, 17)
      const distCamp = Math.hypot(x - 56, z + 11);
      const campBlend = 1 - smoothstep(7.5, 13.5, distCamp);
      const distFarm = Math.hypot(x - 46, z - 18);
      const farmBlend = 1 - smoothstep(7.0, 13.0, distFarm);

      let plainsH = roll * roadFlatten;
      plainsH = THREE.MathUtils.lerp(plainsH, 0.85, campBlend * 0.8);
      plainsH = THREE.MathUtils.lerp(plainsH, 1.45, farmBlend * 0.75);
      h = plainsH * tEast;
    } else {
      // WEST: Rugged Mountain Biome
      const tWest = smoothstep(-13.5, -20.5, x);
      const distWest = Math.max(0, -x - 13.5);

      // Progressive mountain climb with switchback plateaus
      let climb = distWest * 0.145;
      const ridge =
        Math.sin(x * 0.09) * Math.cos(z * 0.09) * 1.35 +
        Math.cos(x * 0.05 - z * 0.06) * 0.85;

      // Flatten switchback trail & combat arenas:
      // 1) Lower Wolf Pack Ledge (-30, 3) -> y ~ 2.4
      const dWolf = Math.hypot(x + 30, z - 3);
      const bWolf = 1 - smoothstep(6.5, 12.0, dWolf);
      // 2) Mid Mountain Ruin & Grace Shrine (-45, -5) -> y ~ 4.6
      const dGrace = Math.hypot(x + 45, z + 5);
      const bGrace = 1 - smoothstep(6.5, 12.0, dGrace);
      // 3) Upper Frostpeak Spider Lair (-63, 6) -> y ~ 7.4
      const dSpider = Math.hypot(x + 63, z - 6);
      const bSpider = 1 - smoothstep(7.5, 13.5, dSpider);

      let mtnH = climb + ridge * 0.65;
      mtnH = THREE.MathUtils.lerp(mtnH, 2.4, bWolf * 0.82);
      mtnH = THREE.MathUtils.lerp(mtnH, 4.6, bGrace * 0.88);
      mtnH = THREE.MathUtils.lerp(mtnH, 7.4, bSpider * 0.85);
      h = Math.max(0, mtnH) * tWest;
    }

    return h * (1 - courtyardMask);
  }

  /**
   * Returns current biome identifier & display title for a world position.
   */
  getBiomeAt(x, z) {
    if (x > 16.5) {
      return {
        id: 'plains',
        title: 'GILDED MOORLANDS',
        subtitle: 'Abandoned Farmlands & Soldier Outpost',
      };
    }
    if (x < -16.5) {
      return {
        id: 'mountains',
        title: 'FROSTPEAK CRAGS',
        subtitle: 'Shattered Switchbacks & Alpine Pass',
      };
    }
    return {
      id: 'courtyard',
      title: 'ASHEN OVERLOOK',
      subtitle: 'The Eclipsed Courtyard',
    };
  }

  _buildExpandedBiomesTerrain() {
    // Low-poly vertex-colored terrain spanning [-86..86] x [-40..40]
    const width = 172;
    const depth = 80;
    const segX = 86;
    const segZ = 40;

    const geo = new THREE.PlaneGeometry(width, depth, segX, segZ);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    const colCourtyard = new THREE.Color(0x2e2a38);
    const colMeadow = new THREE.Color(0x415233);
    const colWheat = new THREE.Color(0x6e6234);
    const colDirtRoad = new THREE.Color(0x574434);
    const colCampAsh = new THREE.Color(0x463d38);
    const colMtnSlate = new THREE.Color(0x383c48);
    const colMtnRock = new THREE.Color(0x4a505e);
    const colSnow = new THREE.Color(0xcfd9e5);
    const tmpCol = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);

      // Depress terrain slightly inside the courtyard slab footprint so flagstones sit cleanly on top
      const inCourtyard = x >= -13.2 && x <= 13.2 && z >= -10.8 && z <= 16.0;
      const y = inCourtyard ? -0.18 : this._sampleRawBiomeHeight(x, z);
      pos.setY(i, y);

      if (x >= 12.0) {
        // Plains & Farmlands coloring
        const tEast = smoothstep(12.0, 21.0, x);
        const wheatNoise = Math.sin(x * 0.14) * Math.cos(z * 0.14) * 0.5 + 0.5;
        tmpCol.copy(colMeadow).lerp(colWheat, wheatNoise * 0.65);

        const roadZ = 1.2 + Math.sin((x - 14) * 0.065) * 4.2;
        const roadFactor = 1 - smoothstep(1.2, 3.2, Math.abs(z - roadZ));
        tmpCol.lerp(colDirtRoad, roadFactor * 0.88);

        const campDist = Math.hypot(x - 56, z + 11);
        const campFactor = 1 - smoothstep(4.0, 9.5, campDist);
        tmpCol.lerp(colCampAsh, campFactor * 0.75);

        tmpCol.lerp(colCourtyard, 1 - tEast);
      } else if (x <= -12.0) {
        // Rugged Mountain coloring (slate -> frost rock -> alpine snow)
        const tWest = smoothstep(-12.0, -20.0, x);
        tmpCol.copy(colMtnSlate);

        const trailZ = -1.5 + Math.sin((-x - 14) * 0.09) * 5.2;
        const trailFactor = 1 - smoothstep(1.3, 3.4, Math.abs(z - trailZ));
        tmpCol.lerp(colMtnRock, trailFactor * 0.65);

        const snowFactor = smoothstep(4.2, 7.2, y);
        tmpCol.lerp(colSnow, snowFactor * 0.88);

        tmpCol.lerp(colCourtyard, 1 - tWest);
      } else {
        tmpCol.copy(colCourtyard);
      }

      colors[i * 3] = tmpCol.r;
      colors[i * 3 + 1] = tmpCol.g;
      colors[i * 3 + 2] = tmpCol.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.04,
      flatShading: true,
    });

    const terrainMesh = new THREE.Mesh(geo, terrainMat);
    terrainMesh.receiveShadow = true;
    this.root.add(terrainMesh);
  }

  _buildCliffPlateau() {
    const deckGeo = new THREE.BoxGeometry(29.5, 4.5, 30.5, 6, 1, 6);
    const pos = deckGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const x = pos.getX(i);
      const z = pos.getZ(i);
      if (y < 0) {
        const taper = 0.82;
        pos.setX(i, x * taper + (this.rng() - 0.5) * 1.6);
        pos.setZ(i, z * taper + (this.rng() - 0.5) * 1.6);
        pos.setY(i, y - this.rng() * 3.5);
      } else {
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

    // Lower craggy cliff spurs jutting down into the northern chasm
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2;
      const rx = Math.cos(angle) * (13.8 + this.rng() * 3.8);
      const rz = 2.6 + Math.sin(angle) * (14.4 + this.rng() * 3.8);
      const scaleX = 2.4 + this.rng() * 3.6;
      const scaleY = 5.5 + this.rng() * 11.0;
      const scaleZ = 2.4 + this.rng() * 3.6;

      const spur = new THREE.Mesh(
        rockGeo,
        this.rng() > 0.45 ? this._materials.cliffRock : this._materials.cliffDark
      );
      spur.position.set(rx, -scaleY * 0.5 - 1.2 - this.rng() * 2.0, rz);
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

    const abyssGeo = new THREE.PlaneGeometry(560, 560, 8, 8);
    abyssGeo.rotateX(-Math.PI / 2);
    const abyssMat = new THREE.MeshBasicMaterial({ color: 0x16111e });
    const abyss = new THREE.Mesh(abyssGeo, abyssMat);
    abyss.position.y = -28;
    this.root.add(abyss);
  }

  _buildFlagstones() {
    const slabGeo = new THREE.BoxGeometry(1.56, 0.18, 1.56);
    const stonePalette = [
      new THREE.Color(0x47424d),
      new THREE.Color(0x3c3843),
      new THREE.Color(0x353939),
      new THREE.Color(0x524947),
      new THREE.Color(0x2f2b36),
    ];

    const placements = [];
    for (let gx = -12.6; gx <= 12.6; gx += 1.68) {
      for (let gz = -10.4; gz <= 15.8; gz += 1.68) {
        const distCenter = Math.hypot(gx, gz - 1.4);
        const edgeRatio = Math.max(Math.abs(gx) / 13.2, Math.abs(gz - 2.5) / 14.0);
        if (edgeRatio > 0.78 && this.rng() < 0.28) continue;
        if (distCenter > 5.0 && this.rng() < 0.08) continue;
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
    this._graceCoords.forEach((g, idx) => {
      const baseH = idx === 0 ? 0 : this._sampleRawBiomeHeight(g.x, g.z);
      const cx = g.x;
      const cz = g.z;

      const tier1Geo = new THREE.CylinderGeometry(4.55, 4.78, 0.24, 12);
      const tier1 = new THREE.Mesh(tier1Geo, this._materials.stoneMid);
      tier1.position.set(cx, baseH + 0.02, cz);
      tier1.receiveShadow = true;
      tier1.castShadow = true;
      this.root.add(tier1);

      const tier2Geo = new THREE.CylinderGeometry(3.05, 3.25, 0.22, 12);
      const tier2 = new THREE.Mesh(tier2Geo, this._materials.stoneSand);
      tier2.position.set(cx, baseH + 0.17, cz);
      tier2.receiveShadow = true;
      tier2.castShadow = true;
      this.root.add(tier2);

      const ringGeo = new THREE.RingGeometry(1.45, 2.35, 16);
      ringGeo.rotateX(-Math.PI / 2);
      const ring = new THREE.Mesh(ringGeo, this._materials.stoneDark);
      ring.position.set(cx, baseH + 0.285, cz);
      ring.receiveShadow = true;
      this.root.add(ring);
    });
  }

  _buildArchesAndWalls() {
    // 1. Grand Entrance Gothic Arch behind spawn (z = 14.2)
    this._createGothicArch(0, 0, 14.2, 0, true);

    // 2. Half-Collapsed Overlook Arch framing the Eclipse on north-cliff edge
    this._createGothicArch(-5.6, 0, -9.8, 0.28, false);

    // 3. East Gate Arch leading to Gilded Moorlands (Plains)
    this._createGothicArch(13.6, 0, 1.0, Math.PI * 0.5, true);

    // 4. West Gate Arch leading to Frostpeak Crags (Mountains)
    this._createGothicArch(-13.6, 0, 1.0, Math.PI * 0.5, false);

    // 5. Crumbling Low Parapet Walls along North Cliff Overlook & Courtyard Flanks
    // (Leaves wide open gates at x = ±13.6 around z ∈ [-2.4, 4.4] for East/West biome travel)
    const wallSegments = [
      { x: -8.6, z: -11.2, w: 6.4, h: 1.05, d: 0.72, ry: 0.03 },
      { x: 8.6, z: -11.2, w: 6.6, h: 0.95, d: 0.72, ry: -0.02 },
      { x: -3.9, z: -11.2, w: 2.2, h: 0.48, d: 0.65, ry: 0.0 },
      { x: 3.9, z: -11.2, w: 2.2, h: 0.42, d: 0.65, ry: 0.0 },
      // West ruin perimeter walls (north & south of West Gate at z = 1.0)
      { x: -13.6, z: -6.8, w: 0.78, h: 2.1, d: 6.2, ry: 0.0 },
      { x: -13.6, z: 9.2, w: 0.78, h: 1.6, d: 6.8, ry: 0.0 },
      // East ruin perimeter walls (north & south of East Gate at z = 1.0)
      { x: 13.6, z: -6.8, w: 0.78, h: 1.85, d: 6.2, ry: 0.0 },
      { x: 13.6, z: 9.2, w: 0.78, h: 2.25, d: 6.8, ry: 0.0 },
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

    const span = 2.85;
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
      }

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

    const archSteps = 11;
    const baseArchY = 0.55 + pierHeight + 0.25;
    for (let i = 0; i <= archSteps; i++) {
      if (!intact && i > 5) continue;

      const t = i / archSteps;
      const angle = Math.PI * (1 - t);
      const px = Math.cos(angle) * span;
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
      this._placePillar(p.x, 0, p.z, p.h, p.intact, p.fallenAngle);
    });
  }

  _placePillar(x, y, z, h, intact = true, fallenAngle = 0) {
    const group = new THREE.Group();
    group.position.set(x, y, z);

    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(1.28, 0.45, 1.28),
      this._materials.stoneDark
    );
    plinth.position.y = 0.225;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    group.add(plinth);

    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.48, h, 8),
      this._materials.stoneMid
    );
    shaft.position.y = 0.45 + h * 0.5;
    shaft.castShadow = true;
    shaft.receiveShadow = true;
    group.add(shaft);

    if (intact) {
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(1.22, 0.34, 1.22),
        this._materials.stoneLight
      );
      cap.position.y = 0.45 + h + 0.17;
      cap.castShadow = true;
      cap.receiveShadow = true;
      group.add(cap);
    } else {
      const jag = new THREE.Mesh(
        new THREE.ConeGeometry(0.42, 0.72, 6),
        this._materials.stoneLight
      );
      jag.position.set(0.08, 0.45 + h + 0.2, -0.05);
      jag.rotation.set(0.25, this.rng() * Math.PI, -0.35);
      jag.castShadow = true;
      group.add(jag);

      const drum = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.42, 1.35, 8),
        this._materials.stoneLight
      );
      drum.position.set(Math.cos(fallenAngle) * 1.45, 0.4, Math.sin(fallenAngle) * 1.45);
      drum.rotation.set(Math.PI * 0.5, 0, fallenAngle + 0.35);
      drum.castShadow = true;
      drum.receiveShadow = true;
      group.add(drum);
    }

    this.root.add(group);
    this.circleColliders.push({ x, z, radius: 0.66 });
  }

  _buildTwistedTrees() {
    const treeConfigs = [
      { x: -11.4, z: -9.0, scale: 1.18, seed: 101 },
      { x: 11.2, z: -8.6, scale: 1.05, seed: 202 },
      { x: -11.8, z: 5.5, scale: 0.95, seed: 303 },
      { x: 11.6, z: 9.8, scale: 1.12, seed: 404 },
      { x: 25.0, z: -12.0, scale: 1.1, seed: 505 },
      { x: 40.0, z: 12.5, scale: 1.0, seed: 606 },
    ];

    treeConfigs.forEach((cfg) => {
      const tree = this._createTwistedTreeMesh(cfg.scale, mulberry32(cfg.seed));
      const y = this.getTerrainHeight(cfg.x, cfg.z);
      tree.position.set(cfg.x, y, cfg.z);
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

  /**
   * Builds all 3 Golden Grace Shrines (Courtyard, Plains Crossroads, Mountain Pass).
   */
  _buildAllGraceShrines() {
    this._graceCoords.forEach((cfg, idx) => {
      const y = this.getTerrainHeight(cfg.x, cfg.z);
      const pos = new THREE.Vector3(cfg.x, y, cfg.z);
      if (idx === 0) {
        this.gracePosition.copy(pos);
      }

      const group = new THREE.Group();
      group.position.copy(pos);

      const basin = new THREE.Mesh(
        new THREE.CylinderGeometry(0.95, 1.15, 0.22, 10),
        this._materials.stoneDark
      );
      basin.position.y = 0.08;
      basin.receiveShadow = true;
      basin.castShadow = true;
      group.add(basin);

      const ashMound = new THREE.Mesh(
        new THREE.ConeGeometry(0.75, 0.26, 9),
        this._materials.stoneSand
      );
      ashMound.position.y = 0.2;
      ashMound.receiveShadow = true;
      group.add(ashMound);

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

      const wispGroup = new THREE.Group();
      wispGroup.position.set(0, 1.06, 0);

      const innerCrystal = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.14, 0),
        this._materials.graceCore
      );
      innerCrystal.scale.set(0.72, 1.65, 0.72);
      wispGroup.add(innerCrystal);

      const aura1 = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.28, 1),
        this._materials.graceAura
      );
      aura1.scale.set(1.0, 1.65, 1.0);
      wispGroup.add(aura1);

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
      wispGroup.add(aura2);

      const ringGeo = new THREE.TorusGeometry(0.42, 0.015, 6, 20);
      const graceRing = new THREE.Mesh(ringGeo, this._materials.runeGlow);
      graceRing.rotation.x = Math.PI * 0.42;
      wispGroup.add(graceRing);

      group.add(wispGroup);
      this.root.add(group);

      const light = new THREE.PointLight(0xffa43b, 5.2, 17.5, 1.35);
      light.position.set(pos.x, pos.y + 0.95, pos.z);
      if (idx === 0) {
        light.castShadow = true;
        light.shadow.mapSize.set(512, 512);
        light.shadow.bias = -0.002;
        this.graceLight = light;
        this.graceWispGroup = wispGroup;
        this.graceRing = graceRing;
      }
      this.scene.add(light);

      const respawnPos = new THREE.Vector3(
        pos.x + cfg.respawnOffset.x,
        this.getTerrainHeight(pos.x + cfg.respawnOffset.x, pos.z + cfg.respawnOffset.z),
        pos.z + cfg.respawnOffset.z
      );

      this.graceShrines.push({
        id: cfg.id,
        name: cfg.name,
        subtitle: cfg.subtitle,
        biome: cfg.biome,
        position: pos,
        respawnPos,
        respawnYaw: cfg.respawnYaw,
        wispGroup,
        graceRing,
        light,
      });

      this.circleColliders.push({
        x: pos.x,
        z: pos.z,
        radius: 1.05,
      });
    });
  }

  /**
   * Builds Plains & Farmlands biome landmarks:
   * wooden fences, 2 abandoned farmhouses, broken rotating windmill, hay bales,
   * and the barricaded Soldier Outpost Camp with tents, watchtower, and night campfires/torches.
   */
  _buildPlainsAndFarmlandsProps() {
    // 1. Weathered Wooden Fences along the Farmland Road & Pastures
    const buildFenceRun = (x1, z1, x2, z2, segments) => {
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const px = THREE.MathUtils.lerp(x1, x2, t);
        const pz = THREE.MathUtils.lerp(z1, z2, t);
        const py = this.getTerrainHeight(px, pz);

        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.08, 0.09, 1.05, 5),
          this._materials.woodFence
        );
        post.position.set(px, py + 0.5, pz);
        post.castShadow = true;
        post.receiveShadow = true;
        this.root.add(post);

        if (i < segments) {
          const nx = THREE.MathUtils.lerp(x1, x2, (i + 1) / segments);
          const nz = THREE.MathUtils.lerp(z1, z2, (i + 1) / segments);
          const ny = this.getTerrainHeight(nx, nz);
          const mx = (px + nx) * 0.5;
          const mz = (pz + nz) * 0.5;
          const my = (py + ny) * 0.5;
          const segLen = Math.hypot(nx - px, nz - pz);
          const yaw = Math.atan2(nx - px, nz - pz);

          [0.34, 0.72].forEach((railH) => {
            const rail = new THREE.Mesh(
              new THREE.BoxGeometry(0.06, 0.08, segLen),
              this._materials.woodFence
            );
            rail.position.set(mx, my + railH, mz);
            rail.rotation.y = yaw;
            rail.castShadow = true;
            this.root.add(rail);
          });
        }
      }
    };

    buildFenceRun(18, -3.5, 31, -2.5, 5);
    buildFenceRun(18, 6.2, 31, 6.8, 5);
    buildFenceRun(37, 8.0, 48, 12.0, 4);
    buildFenceRun(38, -4.5, 49, -7.0, 4);

    // 2. Abandoned Low-Poly Farmhouses
    const buildFarmhouse = (fx, fz, rotY, scale = 1.0) => {
      const fy = this.getTerrainHeight(fx, fz);
      const group = new THREE.Group();
      group.position.set(fx, fy, fz);
      group.rotation.y = rotY;
      group.scale.setScalar(scale);

      const foundation = new THREE.Mesh(
        new THREE.BoxGeometry(6.4, 0.6, 4.6),
        this._materials.stoneDark
      );
      foundation.position.y = 0.25;
      foundation.castShadow = true;
      foundation.receiveShadow = true;
      group.add(foundation);

      const walls = new THREE.Mesh(
        new THREE.BoxGeometry(6.0, 2.8, 4.2),
        this._materials.plasterDaub
      );
      walls.position.y = 1.9;
      walls.castShadow = true;
      walls.receiveShadow = true;
      group.add(walls);

      // Timber framing beams
      [-2.95, 0, 2.95].forEach((bx) => {
        const beam = new THREE.Mesh(
          new THREE.BoxGeometry(0.16, 2.85, 4.32),
          this._materials.woodWeathered
        );
        beam.position.set(bx, 1.9, 0);
        group.add(beam);
      });

      // Pitched thatch roof (4-sided prism / rotated cylinder)
      const roofGeo = new THREE.ConeGeometry(4.4, 2.3, 4);
      const roof = new THREE.Mesh(roofGeo, this._materials.roofThatch);
      roof.position.y = 4.4;
      roof.rotation.y = Math.PI * 0.25;
      roof.scale.set(1.22, 1.0, 0.88);
      roof.castShadow = true;
      roof.receiveShadow = true;
      group.add(roof);

      // Stone chimney
      const chimney = new THREE.Mesh(
        new THREE.BoxGeometry(0.75, 2.8, 0.75),
        this._materials.stoneMid
      );
      chimney.position.set(2.1, 4.1, -1.1);
      chimney.castShadow = true;
      group.add(chimney);

      this.root.add(group);
      this.boxColliders.push({
        x: fx,
        z: fz,
        halfW: 3.3 * scale,
        halfD: 2.5 * scale,
      });
    };

    buildFarmhouse(43.5, 18.5, -0.35, 1.0);
    buildFarmhouse(61.0, 16.0, 0.42, 0.92);

    // 3. Broken Windmill on Farmland Hill
    {
      const wx = 52.0;
      const wz = 23.0;
      const wy = this.getTerrainHeight(wx, wz);
      const mill = new THREE.Group();
      mill.position.set(wx, wy, wz);
      mill.rotation.y = -0.6;

      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(2.1, 2.6, 2.4, 8),
        this._materials.stoneMid
      );
      base.position.y = 1.2;
      base.castShadow = true;
      base.receiveShadow = true;
      mill.add(base);

      const tower = new THREE.Mesh(
        new THREE.CylinderGeometry(1.45, 2.05, 5.4, 8),
        this._materials.woodWeathered
      );
      tower.position.y = 5.1;
      tower.castShadow = true;
      tower.receiveShadow = true;
      mill.add(tower);

      const cap = new THREE.Mesh(
        new THREE.ConeGeometry(1.65, 1.6, 8),
        this._materials.roofThatch
      );
      cap.position.y = 8.5;
      cap.castShadow = true;
      mill.add(cap);

      const sailsPivot = new THREE.Group();
      sailsPivot.position.set(0, 6.8, 1.65);
      mill.add(sailsPivot);
      this.windmillSails = sailsPivot;

      const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(0.24, 0.24, 0.6, 6),
        this._materials.ironDark
      );
      hub.rotation.x = Math.PI * 0.5;
      sailsPivot.add(hub);

      for (let i = 0; i < 4; i++) {
        const armGroup = new THREE.Group();
        armGroup.rotation.z = (i / 4) * Math.PI * 2;
        const broken = i === 2;
        const armLen = broken ? 2.1 : 4.2;

        const spar = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, armLen, 0.12),
          this._materials.woodWeathered
        );
        spar.position.y = armLen * 0.5;
        spar.castShadow = true;
        armGroup.add(spar);

        if (!broken) {
          const lattice = new THREE.Mesh(
            new THREE.BoxGeometry(0.68, 2.9, 0.04),
            this._materials.tentTan
          );
          lattice.position.set(0.36, 2.45, 0.03);
          lattice.castShadow = true;
          armGroup.add(lattice);
        }
        sailsPivot.add(armGroup);
      }

      this.root.add(mill);
      this.circleColliders.push({ x: wx, z: wz, radius: 2.55 });
    }

    // 4. Scattered Golden Hay Bales
    const hayCoords = [
      [38.5, 14.0],
      [40.2, 13.2],
      [48.5, 15.0],
      [54.2, 18.2],
      [45.0, 23.0],
      [28.5, 8.8],
    ];
    hayCoords.forEach(([hx, hz], idx) => {
      const hy = this.getTerrainHeight(hx, hz);
      const bale = new THREE.Mesh(
        new THREE.CylinderGeometry(0.58, 0.58, 0.92, 8),
        this._materials.hayGold
      );
      bale.position.set(hx, hy + 0.48, hz);
      if (idx % 2 === 0) {
        bale.rotation.z = Math.PI * 0.5;
        bale.rotation.y = idx * 0.7;
      }
      bale.castShadow = true;
      bale.receiveShadow = true;
      this.root.add(bale);
      this.circleColliders.push({ x: hx, z: hz, radius: 0.65 });
    });

    // 5. Barricaded Soldier Outpost Camp (x ~ 56, z ~ -11)
    const buildTent = (tx, tz, rotY, isCommand = false) => {
      const ty = this.getTerrainHeight(tx, tz);
      const tent = new THREE.Group();
      tent.position.set(tx, ty, tz);
      tent.rotation.y = rotY;

      const mat = isCommand ? this._materials.tentCanvas : this._materials.tentTan;
      const body = new THREE.Mesh(
        new THREE.ConeGeometry(isCommand ? 2.4 : 1.85, isCommand ? 2.9 : 2.3, 4),
        mat
      );
      body.position.y = isCommand ? 1.45 : 1.15;
      body.rotation.y = Math.PI * 0.25;
      body.scale.set(1.25, 1, 0.95);
      body.castShadow = true;
      body.receiveShadow = true;
      tent.add(body);

      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.08, isCommand ? 3.3 : 2.6, 5),
        this._materials.woodWeathered
      );
      pole.position.y = isCommand ? 1.65 : 1.3;
      tent.add(pole);

      this.root.add(tent);
      this.circleColliders.push({ x: tx, z: tz, radius: isCommand ? 2.0 : 1.55 });
    };

    buildTent(52.5, -16.5, 0.4, true);
    buildTent(61.5, -14.2, -0.65, false);
    buildTent(62.0, -6.5, -1.4, false);

    // Timber Watchtower at Soldier Camp
    {
      const twX = 58.0;
      const twZ = -18.5;
      const twY = this.getTerrainHeight(twX, twZ);
      const tower = new THREE.Group();
      tower.position.set(twX, twY, twZ);

      [
        [-1.2, -1.2],
        [1.2, -1.2],
        [-1.2, 1.2],
        [1.2, 1.2],
      ].forEach(([lx, lz]) => {
        const leg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12, 0.15, 5.2, 5),
          this._materials.woodWeathered
        );
        leg.position.set(lx, 2.6, lz);
        leg.castShadow = true;
        tower.add(leg);
      });

      const deck = new THREE.Mesh(
        new THREE.BoxGeometry(3.1, 0.28, 3.1),
        this._materials.woodFence
      );
      deck.position.y = 4.2;
      deck.castShadow = true;
      deck.receiveShadow = true;
      tower.add(deck);

      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(2.4, 1.6, 4),
        this._materials.roofThatch
      );
      roof.position.y = 5.95;
      roof.rotation.y = Math.PI * 0.25;
      roof.castShadow = true;
      tower.add(roof);

      this.root.add(tower);
      this.boxColliders.push({ x: twX, z: twZ, halfW: 1.5, halfD: 1.5 });
    }

    // Spiked Wooden Barricades guarding the camp perimeter
    const barricades = [
      [48.5, -9.0, 0.3],
      [49.5, -13.5, -0.2],
      [56.0, -4.2, 1.4],
    ];
    barricades.forEach(([bx, bz, ry]) => {
      const by = this.getTerrainHeight(bx, bz);
      const bar = new THREE.Group();
      bar.position.set(bx, by, bz);
      bar.rotation.y = ry;

      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(2.6, 0.22, 0.22),
        this._materials.woodWeathered
      );
      beam.position.y = 0.72;
      beam.castShadow = true;
      bar.add(beam);

      for (let s = -2; s <= 2; s++) {
        const stake = new THREE.Mesh(
          new THREE.ConeGeometry(0.11, 1.45, 5),
          this._materials.woodFence
        );
        stake.position.set(s * 0.52, 0.68, 0.15);
        stake.rotation.x = 0.48;
        stake.castShadow = true;
        bar.add(stake);
      }

      this.root.add(bar);
      this.circleColliders.push({ x: bx, z: bz, radius: 1.15 });
    });

    // Campfires & Torches (automatically ignite at night!)
    this._createCampfire(55.5, -11.0, 4.8, 17.0); // Main Soldier Outpost Campfire
    this._createStandingTorch(49.2, -10.8);
    this._createStandingTorch(60.5, -10.2);
    this._createStandingTorch(41.0, 15.2); // Farmhouse porch torch
  }

  /**
   * Builds Rugged Mountain biome props:
   * pine trees, steep slate cliffs, snow-capped boulders, ancient stone ruins, and pass brazier.
   */
  _buildMountainBiomeProps() {
    // 1. Evergreen Low-Poly Pine Trees (snow-dusted at higher elevations)
    const pineCoords = [
      [-21, -8, 1.1],
      [-23, 8, 1.25],
      [-28, -12, 1.3],
      [-34, 11, 1.15],
      [-36, -4, 1.05],
      [-41, 9, 1.35],
      [-43, -15, 1.2],
      [-51, -14, 1.4],
      [-53, 3, 1.1],
      [-57, 14, 1.3],
      [-60, -8, 1.25],
      [-69, -4, 1.35],
      [-71, 12, 1.2],
    ];

    pineCoords.forEach(([px, pz, scale]) => {
      const py = this.getTerrainHeight(px, pz);
      const isSnowy = py > 3.6;
      const pine = new THREE.Group();
      pine.position.set(px, py, pz);
      pine.scale.setScalar(scale);

      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.26, 1.6, 6),
        this._materials.barkDark
      );
      trunk.position.y = 0.8;
      trunk.castShadow = true;
      pine.add(trunk);

      [
        { y: 1.9, r: 1.25, h: 1.8 },
        { y: 3.0, r: 0.96, h: 1.6 },
        { y: 4.0, r: 0.65, h: 1.4 },
      ].forEach((tier, idx) => {
        const coneMat =
          isSnowy && idx >= 1 ? this._materials.pineSnow : this._materials.pineNeedle;
        const cone = new THREE.Mesh(new THREE.ConeGeometry(tier.r, tier.h, 6), coneMat);
        cone.position.y = tier.y;
        cone.castShadow = true;
        cone.receiveShadow = true;
        pine.add(cone);
      });

      this.root.add(pine);
      this.circleColliders.push({ x: px, z: pz, radius: 0.55 * scale });
    });

    // 2. Craggy Mountain Boulders & Slate Spires
    const boulders = [
      [-25, -3.5, 1.8, 2.6],
      [-35, 7.5, 2.2, 3.4],
      [-49, 2.5, 2.1, 3.8],
      [-56, -11.0, 2.5, 4.5],
      [-68, 1.5, 2.4, 4.2],
      [-64, 13.5, 2.6, 4.8],
    ];
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    boulders.forEach(([bx, bz, rad, h]) => {
      const by = this.getTerrainHeight(bx, bz);
      const rock = new THREE.Mesh(
        rockGeo,
        by > 5.0 ? this._materials.snowCap : this._materials.slateMountain
      );
      rock.position.set(bx, by + h * 0.35, bz);
      rock.scale.set(rad, h, rad * 0.9);
      rock.rotation.set(0.15, bx * 0.4, -0.1);
      rock.castShadow = true;
      rock.receiveShadow = true;
      this.root.add(rock);
      this.circleColliders.push({ x: bx, z: bz, radius: rad * 0.78 });
    });

    // 3. Ancient Mountain Stone Ruins & Archways along the Switchback Pass
    this._createGothicArch(-38.0, this.getTerrainHeight(-38.0, -2.0), -2.0, 0.35, false);
    this._placePillar(-42.0, this.getTerrainHeight(-42.0, -9.2), -9.2, 4.2, true, 0);
    this._placePillar(-48.5, this.getTerrainHeight(-48.5, -9.0), -9.0, 2.8, false, 0.6);
    this._placePillar(-59.5, this.getTerrainHeight(-59.5, 2.5), 2.5, 3.6, false, -0.4);
    this._placePillar(-66.5, this.getTerrainHeight(-66.5, 9.5), 9.5, 4.4, true, 0);

    // Mountain Pass Campfire near the ruins
    this._createCampfire(-41.5, -2.5, 4.0, 14.5);
  }

  _createCampfire(x, z, maxIntensity = 4.6, distance = 16.0) {
    const y = this.getTerrainHeight(x, z);
    const group = new THREE.Group();
    group.position.set(x, y, z);

    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const stone = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.18, 0),
        this._materials.stoneDark
      );
      stone.position.set(Math.cos(a) * 0.62, 0.1, Math.sin(a) * 0.62);
      group.add(stone);
    }

    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI + 0.3;
      const log = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.09, 0.95, 5),
        this._materials.woodWeathered
      );
      log.position.set(0, 0.16, 0);
      log.rotation.set(Math.PI * 0.38, a, 0);
      group.add(log);
    }

    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.32, 0.78, 6),
      this._materials.campfireFlame
    );
    flame.position.y = 0.45;
    group.add(flame);
    this.campfireFlames.push(flame);

    this.root.add(group);
    this.circleColliders.push({ x, z, radius: 0.72 });

    const light = new THREE.PointLight(0xff8528, maxIntensity, distance, 1.4);
    light.position.set(x, y + 0.85, z);
    this.scene.add(light);
    this.nightPointLights.push({ light, maxIntensity, baseIntensity: 0.9, phase: x + z });
  }

  _createStandingTorch(x, z) {
    const y = this.getTerrainHeight(x, z);
    const group = new THREE.Group();
    group.position.set(x, y, z);

    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.08, 1.9, 5),
      this._materials.woodWeathered
    );
    post.position.y = 0.95;
    post.castShadow = true;
    group.add(post);

    const brazier = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.09, 0.2, 6),
      this._materials.ironDark
    );
    brazier.position.y = 1.92;
    group.add(brazier);

    const flame = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.16, 0),
      this._materials.campfireFlame
    );
    flame.position.y = 2.12;
    flame.scale.set(0.8, 1.4, 0.8);
    group.add(flame);
    this.campfireFlames.push(flame);

    this.root.add(group);
    this.circleColliders.push({ x, z, radius: 0.32 });
  }

  _buildTargetDummy() {
    const pos = new THREE.Vector3(4.8, 0, -3.2);
    const dummyGroup = new THREE.Group();
    dummyGroup.position.copy(pos);
    dummyGroup.rotation.y = -0.62;

    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.68, 0.24, 8),
      this._materials.stoneDark
    );
    plinth.position.y = 0.12;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    dummyGroup.add(plinth);

    this.dummyPivot = new THREE.Group();
    this.dummyPivot.position.y = 0.24;
    dummyGroup.add(this.dummyPivot);

    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.13, 1.65, 7),
      this._materials.woodWeathered
    );
    post.position.y = 0.82;
    post.castShadow = true;
    this.dummyPivot.add(post);

    const crossbar = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 0.13, 0.13),
      this._materials.woodWeathered
    );
    crossbar.position.y = 1.24;
    crossbar.castShadow = true;
    this.dummyPivot.add(crossbar);

    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.22, 0.68, 8),
      this._materials.clothTattered
    );
    torso.position.y = 1.12;
    torso.castShadow = true;
    this.dummyPivot.add(torso);

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

    const helm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.16, 0.3, 7),
      this._materials.ironDark
    );
    helm.position.y = 1.62;
    helm.castShadow = true;
    this.dummyPivot.add(helm);

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

    const count = 44;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (this.rng() - 0.5) * 0.08;
      const dirX = Math.cos(angle);
      const dirZ = Math.sin(angle);
      const eclipseDot = dirX * this.sunDirection.x + dirZ * this.sunDirection.z;
      const valleyDip = eclipseDot > 0.84 ? 0.24 : 1.0;

      const dist = 115 + this.rng() * 38;
      const h = (28 + this.rng() * 38) * valleyDip;
      const w = 18 + this.rng() * 22;

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

    for (let i = 0; i < 28; i++) {
      const angle = (i / 28) * Math.PI * 2 + 0.12;
      const dirX = Math.cos(angle);
      const dirZ = Math.sin(angle);
      const eclipseDot = dirX * this.sunDirection.x + dirZ * this.sunDirection.z;
      const valleyDip = eclipseDot > 0.86 ? 0.2 : 1.0;

      const dist = 175 + this.rng() * 52;
      const h = (46 + this.rng() * 48) * valleyDip;
      const w = 30 + this.rng() * 26;

      const colossus = new THREE.Mesh(peakGeo, this._materials.mountainFar);
      colossus.position.set(dirX * dist, -24 + h * 0.5, dirZ * dist);
      colossus.scale.set(w, h, w * (0.75 + this.rng() * 0.5));
      colossus.rotation.y = this.rng() * Math.PI * 2;
      this.root.add(colossus);
    }
  }

  _buildParticles() {
    const emberCount = 110;
    this.emberData = [];
    const emberPos = new Float32Array(emberCount * 3);
    const emberSizes = new Float32Array(emberCount);
    const emberAlpha = new Float32Array(emberCount);

    for (let i = 0; i < emberCount; i++) {
      const age = this.rng();
      const angle = this.rng() * Math.PI * 2;
      const radius = 0.12 + this.rng() * 0.85;
      const shrineIdx = i % this.graceShrines.length;
      const gPos = this.graceShrines[shrineIdx].position;
      this.emberData.push({
        shrineIdx,
        age,
        speed: 0.24 + this.rng() * 0.28,
        angle,
        orbitSpeed: (this.rng() - 0.5) * 2.2,
        radius,
        maxH: 3.4 + this.rng() * 2.4,
      });
      emberPos[i * 3] = gPos.x + Math.cos(angle) * radius;
      emberPos[i * 3 + 1] = gPos.y + 0.25 + age * 4.0;
      emberPos[i * 3 + 2] = gPos.z + Math.sin(angle) * radius;
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
    this.emberPoints.frustumCulled = false;
    this.root.add(this.emberPoints);

    const ashCount = 180;
    this.ashData = [];
    const ashPos = new Float32Array(ashCount * 3);
    const ashSizes = new Float32Array(ashCount);
    const ashAlpha = new Float32Array(ashCount);

    for (let i = 0; i < ashCount; i++) {
      const x = (this.rng() - 0.5) * 32;
      const y = 0.3 + this.rng() * 7.5;
      const z = (this.rng() - 0.5) * 32;
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
    this.ashPoints.frustumCulled = false;
    this.root.add(this.ashPoints);
  }

  /**
   * Sets time-of-day preset ('auto' | 'dawn' | 'day' | 'dusk' | 'night').
   */
  setTimePreset(preset) {
    this.timePreset = preset;
    if (preset === 'dawn') this.timeOfDay = 0.02;
    else if (preset === 'day') this.timeOfDay = 0.25;
    else if (preset === 'dusk') this.timeOfDay = 0.5;
    else if (preset === 'night') this.timeOfDay = 0.75;
    this._updateDayNightLighting(0);
  }

  setTimeScale(scale) {
    this.timeScale = THREE.MathUtils.clamp(scale, 0, 20);
  }

  getTimePhaseName() {
    const t = ((this.timeOfDay % 1) + 1) % 1;
    if (t < 0.14 || t >= 0.9) return 'Dawn';
    if (t < 0.38) return 'Golden Day';
    if (t < 0.62) return 'Crimson Dusk';
    return 'Moonlit Night';
  }

  /**
   * Smoothly interpolates Dawn -> Golden Day -> Crimson Dusk -> Moonlit Night.
   */
  _updateDayNightLighting(dt) {
    if (this.timePreset === 'auto' && this.dayLengthSeconds > 0) {
      this.timeOfDay = (this.timeOfDay + (dt * this.timeScale) / this.dayLengthSeconds) % 1.0;
    }

    const t = ((this.timeOfDay % 1) + 1) % 1;

    // Keyframe definitions for the 4 atmospheric phases
    const keyframes = [
      {
        // 0.00: Dawn
        t: 0.0,
        zenith: new THREE.Color(0x1f2442),
        mid: new THREE.Color(0x523957),
        horizon: new THREE.Color(0xb86b4b),
        abyss: new THREE.Color(0x15111e),
        solarGlow: new THREE.Color(0xff9248),
        fogCol: new THREE.Color(0x4c3749),
        fogDensity: 0.0068,
        sunCol: new THREE.Color(0xffb478),
        sunInt: 2.2,
        hemiSky: new THREE.Color(0x9d82ab),
        hemiGround: new THREE.Color(0x45352e),
        hemiInt: 1.25,
        rimCol: new THREE.Color(0x8899cc),
        rimInt: 0.95,
        dayF: 0.35,
        twilightF: 0.85,
        nightF: 0.15,
      },
      {
        // 0.25: Golden Day
        t: 0.25,
        zenith: new THREE.Color(0x284b7a),
        mid: new THREE.Color(0x5a7ea3),
        horizon: new THREE.Color(0xc9b38c),
        abyss: new THREE.Color(0x252c38),
        solarGlow: new THREE.Color(0xffd27d),
        fogCol: new THREE.Color(0x8c877e),
        fogDensity: 0.0046,
        sunCol: new THREE.Color(0xffe6b8),
        sunInt: 3.1,
        hemiSky: new THREE.Color(0xb8cce0),
        hemiGround: new THREE.Color(0x635542),
        hemiInt: 1.55,
        rimCol: new THREE.Color(0xadc2de),
        rimInt: 1.15,
        dayF: 1.0,
        twilightF: 0.15,
        nightF: 0.0,
      },
      {
        // 0.50: Crimson Dusk (Eclipse Twilight)
        t: 0.5,
        zenith: new THREE.Color(0x0b0815),
        mid: new THREE.Color(0x251b36),
        horizon: new THREE.Color(0x382436),
        abyss: new THREE.Color(0x0e0b16),
        solarGlow: new THREE.Color(0xeb7324),
        fogCol: new THREE.Color(0x2a1f34),
        fogDensity: 0.0076,
        sunCol: new THREE.Color(0xffb972),
        sunInt: 2.45,
        hemiSky: new THREE.Color(0x7c6aa6),
        hemiGround: new THREE.Color(0x3b2d2a),
        hemiInt: 1.25,
        rimCol: new THREE.Color(0x7e8ec9),
        rimInt: 1.05,
        dayF: 0.0,
        twilightF: 1.0,
        nightF: 0.25,
      },
      {
        // 0.75: Moonlit Night
        t: 0.75,
        zenith: new THREE.Color(0x04060f),
        mid: new THREE.Color(0x0b1226),
        horizon: new THREE.Color(0x16223d),
        abyss: new THREE.Color(0x05070e),
        solarGlow: new THREE.Color(0x2d4875),
        fogCol: new THREE.Color(0x0d1528),
        fogDensity: 0.0082,
        sunCol: new THREE.Color(0x7aa4e8), // Cool silver-blue moonlight
        sunInt: 1.45,
        hemiSky: new THREE.Color(0x384e78),
        hemiGround: new THREE.Color(0x181d2b),
        hemiInt: 0.88,
        rimCol: new THREE.Color(0x5273b0),
        rimInt: 0.85,
        dayF: 0.0,
        twilightF: 0.1,
        nightF: 1.0,
      },
    ];

    // Find segment [k0, k1]
    const idx0 = Math.floor(t * 4) % 4;
    const idx1 = (idx0 + 1) % 4;
    const k0 = keyframes[idx0];
    const k1 = keyframes[idx1];
    const localT = smoothstep(0, 1, (t - idx0 * 0.25) / 0.25);

    const u = this.skyMaterial.uniforms;
    u.uZenithCol.value.copy(k0.zenith).lerp(k1.zenith, localT);
    u.uMidCol.value.copy(k0.mid).lerp(k1.mid, localT);
    u.uHorizonCol.value.copy(k0.horizon).lerp(k1.horizon, localT);
    u.uAbyssCol.value.copy(k0.abyss).lerp(k1.abyss, localT);
    u.uSolarGlowCol.value.copy(k0.solarGlow).lerp(k1.solarGlow, localT);

    const dayF = THREE.MathUtils.lerp(k0.dayF, k1.dayF, localT);
    const twilightF = THREE.MathUtils.lerp(k0.twilightF, k1.twilightF, localT);
    const nightF = THREE.MathUtils.lerp(k0.nightF, k1.nightF, localT);
    u.uDayFactor.value = dayF;
    u.uTwilightFactor.value = twilightF;
    u.uNightFactor.value = nightF;

    this.nightLightFactor = THREE.MathUtils.clamp(nightF * 0.95 + twilightF * 0.35, 0, 1);
    this.isNight = nightF >= 0.45;

    // Orbit Sun & Moon directions smoothly across the sky
    const sunAngle = t * Math.PI * 2;
    const sunElev = Math.sin(sunAngle) * 0.72 + 0.16;
    const sunX = Math.cos(sunAngle) * 0.65 - 0.08;
    this.sunDirection.set(sunX, Math.max(-0.35, sunElev), -0.92).normalize();
    this.moonDirection.set(-sunX * 0.8, Math.max(0.28, -Math.sin(sunAngle) * 0.75 + 0.22), -0.78).normalize();

    u.uSunDir.value.copy(this.sunDirection);
    u.uMoonDir.value.copy(this.moonDirection);

    // Scene fog & background
    this.scene.fog.color.copy(k0.fogCol).lerp(k1.fogCol, localT);
    this.scene.fog.density = THREE.MathUtils.lerp(k0.fogDensity, k1.fogDensity, localT);
    this.scene.background.copy(this.scene.fog.color);

    // Directional & Hemisphere lighting
    this.sunLight.color.copy(k0.sunCol).lerp(k1.sunCol, localT);
    this.sunLight.intensity = THREE.MathUtils.lerp(k0.sunInt, k1.sunInt, localT);

    this.hemiLight.color.copy(k0.hemiSky).lerp(k1.hemiSky, localT);
    this.hemiLight.groundColor.copy(k0.hemiGround).lerp(k1.hemiGround, localT);
    this.hemiLight.intensity = THREE.MathUtils.lerp(k0.hemiInt, k1.hemiInt, localT);

    this.rimLight.color.copy(k0.rimCol).lerp(k1.rimCol, localT);
    this.rimLight.intensity = THREE.MathUtils.lerp(k0.rimInt, k1.rimInt, localT);
  }

  /**
   * Resolves horizontal collision against obstacles and world boundaries.
   */
  resolveCollision(position, radius = 0.42) {
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

    // Prevent walking off the northern cliff overlook inside the starting Courtyard
    if (position.x > -13.2 && position.x < 13.2 && position.z < -10.8 + radius) {
      position.z = -10.8 + radius;
    }

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

  clampCameraPosition(focusPos, desiredCamPos) {
    const groundAtCam = this.getTerrainHeight(desiredCamPos.x, desiredCamPos.z);
    if (desiredCamPos.y < groundAtCam + 0.45) {
      desiredCamPos.y = groundAtCam + 0.45;
    }

    for (let i = 0; i < this.circleColliders.length; i++) {
      const c = this.circleColliders[i];
      if (c.radius < 0.65) continue;
      const dx = desiredCamPos.x - c.x;
      const dz = desiredCamPos.z - c.z;
      const minDist = c.radius + 0.35;
      const distSq = dx * dx + dz * dz;
      const groundHere = this.getTerrainHeight(c.x, c.z);
      if (distSq < minDist * minDist && desiredCamPos.y < groundHere + 4.5) {
        const dist = Math.sqrt(distSq) || 0.01;
        desiredCamPos.x = c.x + (dx / dist) * minDist;
        desiredCamPos.z = c.z + (dz / dist) * minDist;
      }
    }

    return desiredCamPos;
  }

  /**
   * Returns the nearest Golden Grace Shrine within interaction distance (3.2m), or null.
   */
  getNearestGrace(playerPos, maxDist = 3.2) {
    let best = null;
    let bestDist = maxDist;
    for (let i = 0; i < this.graceShrines.length; i++) {
      const s = this.graceShrines[i];
      const d = Math.hypot(playerPos.x - s.position.x, playerPos.z - s.position.z);
      if (d <= bestDist) {
        bestDist = d;
        best = s;
      }
    }
    return best;
  }

  isNearGrace(playerPos) {
    return Boolean(this.getNearestGrace(playerPos, 3.2));
  }

  triggerGraceRest(shrine = null) {
    this._graceRestBoost = 1.0;
    if (shrine && shrine.id) {
      this.activeGraceId = shrine.id;
    }
  }

  getActiveGraceShrine() {
    return (
      this.graceShrines.find((s) => s.id === this.activeGraceId) || this.graceShrines[0]
    );
  }

  wobbleDummy(hitDir, intensity = 0.65) {
    if (!this.dummyPivot) return;
    const sinY = Math.sin(-0.62);
    const cosY = Math.cos(-0.62);
    const lx = hitDir.x * cosY - hitDir.z * sinY;
    const lz = hitDir.x * sinY + hitDir.z * cosY;
    this._dummyWobble.vx += lz * 7.5 * intensity;
    this._dummyWobble.vz -= lx * 7.5 * intensity;
  }

  getLockableTargets() {
    return this.lockableTargets;
  }

  update(dt, elapsed, playerPos) {
    this.skyMaterial.uniforms.uTime.value = elapsed;
    this._updateDayNightLighting(dt);

    if (this._graceRestBoost > 0) {
      this._graceRestBoost = Math.max(0, this._graceRestBoost - dt * 1.15);
    }

    // Rotate broken windmill sails in the Plains biome
    if (this.windmillSails) {
      this.windmillSails.rotation.z -= dt * 0.38;
    }

    // Animate all 3 Golden Grace Shrines (stronger nocturnal glow at night)
    const flicker =
      Math.sin(elapsed * 7.3) * 0.25 +
      Math.sin(elapsed * 13.7) * 0.16 +
      Math.cos(elapsed * 4.1) * 0.2;
    const nightBoost = 1.0 + this.nightLightFactor * 0.65;
    const wispScale = 1.0 + Math.sin(elapsed * 3.8) * 0.06 + this._graceRestBoost * 0.55;

    for (let i = 0; i < this.graceShrines.length; i++) {
      const s = this.graceShrines[i];
      s.light.intensity = (4.6 * nightBoost + flicker) + this._graceRestBoost * 9.0;
      s.wispGroup.position.y = 1.06 + Math.sin(elapsed * 2.2 + i) * 0.08;
      s.wispGroup.rotation.y = elapsed * 0.9;
      s.graceRing.rotation.z = elapsed * 1.3;
      s.wispGroup.scale.setScalar(wispScale);
    }

    // Automatically toggle/scale campfire & torch point lights at night
    for (let i = 0; i < this.nightPointLights.length; i++) {
      const np = this.nightPointLights[i];
      const f = Math.sin(elapsed * 9.5 + np.phase) * 0.28 + Math.cos(elapsed * 14.2 + i) * 0.15;
      const targetInt = THREE.MathUtils.lerp(
        np.baseIntensity,
        np.maxIntensity,
        this.nightLightFactor
      );
      np.light.intensity = Math.max(0, targetInt + f * (0.3 + this.nightLightFactor * 0.7));
    }

    const flameScaleY = 0.75 + this.nightLightFactor * 0.45 + Math.sin(elapsed * 11.0) * 0.12;
    for (let i = 0; i < this.campfireFlames.length; i++) {
      const fl = this.campfireFlames[i];
      fl.scale.y = flameScaleY;
      fl.rotation.y = elapsed * 3.0 + i;
    }

    if (this.sentinelBand) {
      this.sentinelBand.rotation.z = elapsed * 0.45;
    }

    if (this.dummyPivot) {
      const w = this._dummyWobble;
      const stiffness = 85;
      const damping = 7.5;
      w.vx += (-stiffness * w.x - damping * w.vx) * dt;
      w.vz += (-stiffness * w.z - damping * w.vz) * dt;
      w.x += w.vx * dt;
      w.z += w.vz * dt;
      this.dummyPivot.rotation.x = THREE.MathUtils.clamp(w.x, -0.45, 0.45);
      this.dummyPivot.rotation.z = THREE.MathUtils.clamp(w.z, -0.45, 0.45);
    }

    // Update rising golden embers across all 3 Grace Shrines
    const emberPosAttr = this.emberPoints.geometry.getAttribute('position');
    const emberAlphaAttr = this.emberPoints.geometry.getAttribute('aAlpha');
    const boostMul = 1.0 + this._graceRestBoost * 1.8;

    for (let i = 0; i < this.emberData.length; i++) {
      const e = this.emberData[i];
      const gPos = this.graceShrines[e.shrineIdx].position;
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
        gPos.x + Math.cos(swirl) * radialSpread,
        gPos.y + 0.25 + e.age * e.maxH,
        gPos.z + Math.sin(swirl) * radialSpread
      );

      const fadeIn = Math.min(1, e.age * 6.0);
      const fadeOut = 1.0 - e.age;
      emberAlphaAttr.setX(i, fadeIn * fadeOut * (0.85 + this._graceRestBoost * 0.4));
    }
    emberPosAttr.needsUpdate = true;
    emberAlphaAttr.needsUpdate = true;

    // Update drifting ash motes centered around player
    const centerX = playerPos ? playerPos.x : 0;
    const centerY = playerPos ? playerPos.y : 0;
    const centerZ = playerPos ? playerPos.z : 0;
    const ashPosAttr = this.ashPoints.geometry.getAttribute('position');
    for (let i = 0; i < this.ashData.length; i++) {
      const a = this.ashData[i];
      const driftX = Math.sin(elapsed * a.speed + a.phase) * 0.75 + elapsed * 0.22;
      const driftY = Math.cos(elapsed * a.speed * 0.8 + a.phase) * 0.45;
      const driftZ = Math.sin(elapsed * a.speed * 0.6 + a.phase * 1.3) * 0.65;

      const wx = centerX + (((a.baseX + driftX + 16) % 32 + 32) % 32 - 16);
      const wz = centerZ + (((a.baseZ + driftZ + 16) % 32 + 32) % 32 - 16);
      ashPosAttr.setXYZ(i, wx, centerY + a.baseY + driftY, wz);
    }
    ashPosAttr.needsUpdate = true;

    // Snap directional shadow frustum to texel grid around player (using active sun or moon direction)
    if (playerPos) {
      const activeLightDir = this.isNight ? this.moonDirection : this.sunDirection;
      const texelSize = (26 * 2) / 1024;
      const snapX = Math.round(playerPos.x / texelSize) * texelSize;
      const snapZ = Math.round(playerPos.z / texelSize) * texelSize;
      this.sunLight.target.position.set(snapX, playerPos.y, snapZ);
      this.sunLight.position
        .copy(activeLightDir)
        .multiplyScalar(56)
        .add(this.sunLight.target.position);
      this.sunLight.target.updateMatrixWorld();
    }
  }
}
