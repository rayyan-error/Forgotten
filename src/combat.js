import * as THREE from 'three';

/**
 * Computes squared distance from point P to line segment AB.
 */
function pointToSegmentDistSq(p, a, b) {
  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const abZ = b.z - a.z;
  const lenSq = abX * abX + abY * abY + abZ * abZ;
  if (lenSq < 1e-6) {
    return p.distanceToSquared(a);
  }
  const t = THREE.MathUtils.clamp(
    ((p.x - a.x) * abX + (p.y - a.y) * abY + (p.z - a.z) * abZ) / lenSq,
    0,
    1
  );
  const cx = a.x + abX * t;
  const cy = a.y + abY * t;
  const cz = a.z + abZ * t;
  const dx = p.x - cx;
  const dy = p.y - cy;
  const dz = p.z - cz;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Lightweight zero-asset procedural Web Audio synthesizer for combat tactile feedback.
 */
class ProceduralSFX {
  constructor() {
    this.ctx = null;
  }

  _ensureContext() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      return this.ctx;
    } catch {
      return null;
    }
  }

  play(type) {
    const ctx = this._ensureContext();
    if (!ctx || ctx.state !== 'running') return;

    const now = ctx.currentTime;
    try {
      if (type === 'swingLight' || type === 'swingHeavy') {
        const dur = type === 'swingHeavy' ? 0.28 : 0.18;
        const bufSize = Math.floor(ctx.sampleRate * dur);
        const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.sin((i / bufSize) * Math.PI);
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(type === 'swingHeavy' ? 320 : 520, now);
        filter.frequency.exponentialRampToValueAtTime(160, now + dur);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(type === 'swingHeavy' ? 0.16 : 0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
        src.connect(filter).connect(gain).connect(ctx.destination);
        src.start(now);
      } else if (type === 'blockClang' || type === 'guardBreak') {
        const freqs = type === 'guardBreak' ? [210, 315, 440] : [580, 920, 1460];
        const dur = type === 'guardBreak' ? 0.45 : 0.26;
        freqs.forEach((f, idx) => {
          const osc = ctx.createOscillator();
          osc.type = idx === 0 ? 'triangle' : 'sine';
          osc.frequency.setValueAtTime(f, now);
          osc.frequency.exponentialRampToValueAtTime(f * 0.72, now + dur);
          const gain = ctx.createGain();
          gain.gain.setValueAtTime(0.11 / (idx + 1), now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
          osc.connect(gain).connect(ctx.destination);
          osc.start(now);
          osc.stop(now + dur);
        });
      } else if (type === 'hitLight' || type === 'hitHeavy' || type === 'playerHit') {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(type === 'hitHeavy' ? 145 : 185, now);
        osc.frequency.exponentialRampToValueAtTime(42, now + 0.14);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(type === 'hitHeavy' ? 0.18 : 0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.15);
      } else if (type === 'heal' || type === 'grace') {
        const notes = type === 'grace' ? [330, 440, 660] : [520, 780];
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + i * 0.06);
          const gain = ctx.createGain();
          gain.gain.setValueAtTime(0.07, now + i * 0.06);
          gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.06 + 0.42);
          osc.connect(gain).connect(ctx.destination);
          osc.start(now + i * 0.06);
          osc.stop(now + i * 0.06 + 0.45);
        });
      } else if (type === 'death') {
        [110, 165].forEach((freq) => {
          const osc = ctx.createOscillator();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now);
          osc.frequency.exponentialRampToValueAtTime(freq * 0.78, now + 1.2);
          const gain = ctx.createGain();
          gain.gain.setValueAtTime(0.14, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 1.25);
          osc.connect(gain).connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 1.3);
        });
      }
    } catch {
      // Safe fallback when Web Audio is disallowed
    }
  }
}

/**
 * CombatSystem
 * ------------
 * Handles weapon hitbox checks, i-frame negations, shield block angle resolution,
 * procedural glowing slash-trail ribbons, micro hit-stop, camera trauma, and particles.
 */
export class CombatSystem {
  constructor(scene) {
    this.scene = scene;
    this.sfx = new ProceduralSFX();

    this.hitStopTimer = 0;

    // Particles pool
    this._particles = [];
    this._particleGroup = new THREE.Group();
    this.scene.add(this._particleGroup);
    this._shardGeo = new THREE.OctahedronGeometry(0.055, 0);

    // Procedural Slash Trail Ribbon
    this._maxTrailSamples = 18;
    this._trailSamples = [];
    this._lastSwingId = -1;
    this._setupSlashRibbon();
  }

  _setupSlashRibbon() {
    const maxVerts = this._maxTrailSamples * 2;
    this._trailPositions = new Float32Array(maxVerts * 3);
    this._trailColors = new Float32Array(maxVerts * 4);
    const indices = [];
    for (let i = 0; i < this._maxTrailSamples - 1; i++) {
      const a = i * 2;
      const b = i * 2 + 1;
      const c = (i + 1) * 2;
      const d = (i + 1) * 2 + 1;
      indices.push(a, b, c, b, d, c);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this._trailPositions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this._trailColors, 4));
    geo.setIndex(indices);
    geo.setDrawRange(0, 0);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec4 aColor;
        varying vec4 vColor;
        void main() {
          vColor = aColor;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec4 vColor;
        void main() {
          gl_FragColor = vColor;
        }
      `,
    });

    this._trailMesh = new THREE.Mesh(geo, mat);
    this._trailMesh.frustumCulled = false;
    this.scene.add(this._trailMesh);
  }

  triggerHitStop(duration) {
    this.hitStopTimer = Math.max(this.hitStopTimer, duration);
  }

  /**
   * Returns remaining simulation dt after applying micro hit-stop freeze.
   */
  consumeHitStop(dt) {
    if (this.hitStopTimer > 0) {
      this.hitStopTimer = Math.max(0, this.hitStopTimer - dt);
      return 0;
    }
    return dt;
  }

  playSound(type) {
    this.sfx.play(type);
  }

  spawnBurst(pos, dir, count, kind) {
    const baseDir = dir ? dir.clone().normalize() : new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < count; i++) {
      let color = 0xffcf6b;
      let speed = 4.5 + Math.random() * 4.5;
      let gravity = 11.0;
      let life = 0.28 + Math.random() * 0.22;
      let scale = 0.7 + Math.random() * 0.65;

      if (kind === 'bloodAsh') {
        color = i % 3 === 0 ? 0x62242a : 0xb5242d;
        speed = 2.6 + Math.random() * 3.6;
        gravity = 9.0;
        life = 0.34 + Math.random() * 0.26;
      } else if (kind === 'heal') {
        color = i % 2 === 0 ? 0xff9e54 : 0xff4545;
        speed = 1.2 + Math.random() * 1.4;
        gravity = -3.2; // Float upward!
        life = 0.6 + Math.random() * 0.3;
        scale = 0.8 + Math.random() * 0.5;
      } else if (kind === 'slam') {
        color = i % 2 === 0 ? 0xffaa44 : 0x7a6c64;
        speed = 3.2 + Math.random() * 3.8;
        gravity = 6.5;
        life = 0.4 + Math.random() * 0.2;
        scale = 1.1 + Math.random() * 0.8;
      }

      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(this._shardGeo, mat);
      mesh.position.copy(pos);
      if (kind === 'heal') {
        const a = Math.random() * Math.PI * 2;
        mesh.position.x += Math.cos(a) * 0.42;
        mesh.position.z += Math.sin(a) * 0.42;
      }
      mesh.scale.setScalar(scale);
      this._particleGroup.add(mesh);

      const spread = new THREE.Vector3(
        (Math.random() - 0.5) * 1.35,
        Math.random() * 0.95 + (kind === 'heal' ? 0.6 : 0.15),
        (Math.random() - 0.5) * 1.35
      );
      const vel =
        kind === 'heal'
          ? new THREE.Vector3(spread.x * 0.35, 1.3 + Math.random() * 1.1, spread.z * 0.35)
          : baseDir.clone().multiplyScalar(speed * 0.65).add(spread.multiplyScalar(speed * 0.55));

      this._particles.push({
        mesh,
        vel,
        gravity,
        age: 0,
        life,
        baseScale: scale,
      });
    }
  }

  _updateParticles(dt) {
    for (let i = this._particles.length - 1; i >= 0; i--) {
      const p = this._particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        this._particleGroup.remove(p.mesh);
        p.mesh.material.dispose();
        this._particles.splice(i, 1);
        continue;
      }
      const t = p.age / p.life;
      p.vel.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += dt * 9;
      p.mesh.rotation.y += dt * 7;
      p.mesh.material.opacity = 0.95 * (1 - t);
      p.mesh.scale.setScalar(p.baseScale * (1 - t * 0.55));
    }
  }

  _updateSlashTrail(dt, player) {
    // Age existing ribbon samples
    for (let i = this._trailSamples.length - 1; i >= 0; i--) {
      this._trailSamples[i].age += dt;
      if (this._trailSamples[i].age >= this._trailSamples[i].maxAge) {
        this._trailSamples.splice(i, 1);
      }
    }

    const activeTrail = player.isSlashTrailActive();
    if (activeTrail) {
      if (activeTrail.swingId !== this._lastSwingId) {
        this._lastSwingId = activeTrail.swingId;
        this._trailSamples.length = 0;
      }
      this._trailSamples.unshift({
        base: activeTrail.base.clone(),
        tip: activeTrail.tip.clone(),
        age: 0,
        maxAge: activeTrail.isHeavy ? 0.24 : 0.16,
        isHeavy: activeTrail.isHeavy,
      });
      if (this._trailSamples.length > this._maxTrailSamples) {
        this._trailSamples.length = this._maxTrailSamples;
      }
    }

    const count = this._trailSamples.length;
    if (count < 2) {
      this._trailMesh.geometry.setDrawRange(0, 0);
      return;
    }

    const posAttr = this._trailMesh.geometry.getAttribute('position');
    const colAttr = this._trailMesh.geometry.getAttribute('aColor');

    for (let i = 0; i < count; i++) {
      const s = this._trailSamples[i];
      const lifeRatio = 1 - s.age / s.maxAge;
      const tailFade = 1 - i / Math.max(count - 1, 1);
      const alphaTip = Math.pow(lifeRatio * tailFade, 1.35) * (s.isHeavy ? 0.85 : 0.65);
      const alphaBase = alphaTip * 0.08;

      posAttr.setXYZ(i * 2, s.base.x, s.base.y, s.base.z);
      posAttr.setXYZ(i * 2 + 1, s.tip.x, s.tip.y, s.tip.z);

      if (s.isHeavy) {
        colAttr.setXYZW(i * 2, 0.95, 0.28, 0.08, alphaBase);
        colAttr.setXYZW(i * 2 + 1, 1.0, 0.88, 0.45, alphaTip);
      } else {
        colAttr.setXYZW(i * 2, 0.72, 0.48, 0.24, alphaBase);
        colAttr.setXYZW(i * 2 + 1, 1.0, 0.92, 0.68, alphaTip);
      }
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    this._trailMesh.geometry.setDrawRange(0, (count - 1) * 6);
  }

  /**
   * Evaluates player & enemy weapon hitboxes, shield blocks, i-frames, and world dummy hits.
   */
  resolveHits(player, enemyManager, world, cameraController) {
    // 1. Player Attack Hitbox vs. Enemies & Practice Dummy
    const playerAtk = player.getActiveAttack();
    if (playerAtk) {
      const enemies = enemyManager.enemies;
      for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        if (!enemy.isAlive || playerAtk.hitIds.has(enemy.id)) continue;

        const hitRadius = enemy.collisionRadius + (playerAtk.isHeavy ? 0.48 : 0.36);
        const hitRadiusSq = hitRadius * hitRadius;

        // Check vertical capsule points along enemy body against sword segment
        const bodyHeights = [0.5, 1.0, 1.5, 1.9];
        let didHit = false;
        const samplePt = new THREE.Vector3();
        for (let h = 0; h < bodyHeights.length; h++) {
          samplePt.set(enemy.position.x, enemy.position.y + bodyHeights[h], enemy.position.z);
          if (pointToSegmentDistSq(samplePt, playerAtk.base, playerAtk.tip) <= hitRadiusSq) {
            didHit = true;
            break;
          }
        }

        if (didHit) {
          playerAtk.hitIds.add(enemy.id);

          const knockDir = new THREE.Vector3(
            enemy.position.x - player.position.x,
            0,
            enemy.position.z - player.position.z
          ).normalize();

          const res = enemy.takeDamage(
            playerAtk.damage,
            playerAtk.poiseDamage,
            knockDir,
            playerAtk.isHeavy
          );

          const hitPos = enemy.position.clone().add(new THREE.Vector3(0, 1.1, 0));
          this.spawnBurst(hitPos, knockDir, playerAtk.isHeavy ? 14 : 9, 'bloodAsh');
          this.spawnBurst(hitPos, knockDir, playerAtk.isHeavy ? 7 : 4, 'spark');

          this.triggerHitStop(playerAtk.isHeavy || res.staggered ? 0.044 : 0.028);
          cameraController.addTrauma(playerAtk.isHeavy ? 0.32 : 0.16);
          this.sfx.play(playerAtk.isHeavy ? 'hitHeavy' : 'hitLight');

          if (res.killed) {
            enemyManager.notifyKill(enemy);
          }
        }
      }

      // Allow hitting the courtyard Ashen Training Dummy for tactile feedback!
      const dummy = world.getLockableTargets().find((t) => t.id === 'training-dummy');
      if (dummy && !playerAtk.hitIds.has(dummy.id)) {
        const samplePt = new THREE.Vector3(dummy.position.x, dummy.position.y + 1.1, dummy.position.z);
        const r = dummy.radius + 0.42;
        if (pointToSegmentDistSq(samplePt, playerAtk.base, playerAtk.tip) <= r * r) {
          playerAtk.hitIds.add(dummy.id);
          const dir = samplePt.clone().sub(player.position).setY(0).normalize();
          world.wobbleDummy(dir, playerAtk.isHeavy ? 1.0 : 0.55);
          this.spawnBurst(samplePt, dir, 10, 'spark');
          this.triggerHitStop(playerAtk.isHeavy ? 0.036 : 0.022);
          cameraController.addTrauma(playerAtk.isHeavy ? 0.22 : 0.12);
          this.sfx.play('blockClang');
        }
      }
    }

    // 2. Enemy Attack Hitboxes vs. Player
    if (player.actionState === 'dead') return;

    const enemies = enemyManager.enemies;
    const playerForwardX = Math.sin(player.facingYaw);
    const playerForwardZ = Math.cos(player.facingYaw);
    const playerSamplePts = [
      new THREE.Vector3(player.position.x, player.position.y + 0.65, player.position.z),
      new THREE.Vector3(player.position.x, player.position.y + 1.15, player.position.z),
    ];

    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      const atk = enemy.getActiveAttack();
      if (!atk) continue;

      const hitRadiusSq = Math.pow(player.collisionRadius + atk.radius, 2);
      let overlaps = false;
      for (let p = 0; p < playerSamplePts.length; p++) {
        if (pointToSegmentDistSq(playerSamplePts[p], atk.base, atk.tip) <= hitRadiusSq) {
          overlaps = true;
          break;
        }
      }

      if (!overlaps) continue;

      // Consume enemy swing once overlap connects
      enemy.markAttackHit();

      // A) i-Frame Dodge Negation!
      if (player.isInvulnerable) {
        continue;
      }

      const toEnemyX = enemy.position.x - player.position.x;
      const toEnemyZ = enemy.position.z - player.position.z;
      const dist = Math.hypot(toEnemyX, toEnemyZ) || 1;
      const dirToEnemyX = toEnemyX / dist;
      const dirToEnemyZ = toEnemyZ / dist;

      // B) Shield Block Angle Check (~155° frontal arc)
      const facingDot = playerForwardX * dirToEnemyX + playerForwardZ * dirToEnemyZ;
      if (player.isBlocking && facingDot >= 0.18) {
        const shieldPos = player.getShieldWorldPos();
        const sparkDir = new THREE.Vector3(dirToEnemyX, 0.4, dirToEnemyZ).normalize();
        this.spawnBurst(shieldPos, sparkDir, 15, 'spark');

        const guardBroken = player.consumeBlockStamina(atk.staminaDamage);
        this.triggerHitStop(guardBroken ? 0.055 : 0.032);
        cameraController.addTrauma(guardBroken ? 0.48 : 0.24);
        this.sfx.play(guardBroken ? 'guardBreak' : 'blockClang');
        continue;
      }

      // C) Unblocked Direct Hit
      player.stats.hp = Math.max(0, player.stats.hp - atk.damage);
      const kbDir = new THREE.Vector3(-dirToEnemyX, 0, -dirToEnemyZ);
      const hitCenter = player.getWorldCenter();
      this.spawnBurst(hitCenter, kbDir, 14, 'bloodAsh');

      this.triggerHitStop(0.038);
      cameraController.addTrauma(0.38);

      if (player.stats.hp <= 0) {
        player.triggerDeath();
        this.sfx.play('death');
      } else {
        player.triggerHitStagger(kbDir, atk.isHeavy ? 5.2 : 3.6);
        this.sfx.play('playerHit');
      }
    }
  }

  /**
   * Visual-only effects update (runs smoothly even during hit-stop frames).
   */
  updateEffects(dt, player) {
    this._updateParticles(dt);
    this._updateSlashTrail(dt, player);
  }
}
