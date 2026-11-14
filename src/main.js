import * as THREE from 'three';
import { InputManager } from './input.js';
import { World } from './world.js';
import { Player } from './player.js';
import { ThirdPersonCamera } from './camera.js';
import { HUD } from './hud.js';
import { EnemyManager } from './enemies.js';
import { CombatSystem } from './combat.js';

/**
 * Forgotten — Action RPG Entrypoint (Chunk 1 + Chunk 2 + Chunk 3)
 * Orchestrates renderer, modular subsystems, Dynamic Day/Night Cycle,
 * multi-biome world, combat/projectiles, and Settings Menu pause state.
 */
class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();

    // Initialize core subsystems
    this.input = new InputManager(this.canvas);
    this.world = new World(this.scene);
    this.player = new Player(this.scene, new THREE.Vector3(0, 0, 10.6));
    this.enemyManager = new EnemyManager(this.scene, this.world);
    this.combat = new CombatSystem(this.scene);
    this.cameraController = new ThirdPersonCamera(
      window.innerWidth / Math.max(window.innerHeight, 1)
    );
    this.hud = new HUD();

    this.isPaused = false;

    this._wireCombatCallbacks();
    this._wireSettingsCallbacks();

    this._lastTime = performance.now();
    this._elapsed = 0;
    this._rafId = null;

    this._onResize = this._handleResize.bind(this);
    window.addEventListener('resize', this._onResize);

    // Expose runtime handle for debugging and E2E verification
    window.__FORGOTTEN__ = this;
  }

  _wireCombatCallbacks() {
    this.player.onAttackStart = (kind, isHeavy) => {
      this.combat.playSound(isHeavy ? 'swingHeavy' : 'swingLight');
    };

    this.player.onHeavySlamImpact = (impactPos) => {
      this.combat.spawnBurst(impactPos, new THREE.Vector3(0, 1, 0), 12, 'slam');
      this.cameraController.addTrauma(0.24);
    };

    this.player.onHealSip = (playerPos) => {
      this.combat.playSound('heal');
      const burstPos = playerPos.clone().add(new THREE.Vector3(0, 1.18, 0));
      this.combat.spawnBurst(burstPos, new THREE.Vector3(0, 1, 0), 16, 'heal');
    };

    this.enemyManager.onShootProjectile = (origin, target, enemy) => {
      this.combat.spawnWebProjectile(origin, target, enemy);
    };

    this.enemyManager.onEnemyKilled = (enemy, remainingInBiome) => {
      const regionLabel =
        enemy.biome === 'plains'
          ? 'Outpost Cleared'
          : enemy.biome === 'mountains'
          ? 'High Pass Cleared'
          : 'Courtyard Cleared';
      const subtitle =
        remainingInBiome === 0
          ? `${enemy.name} Vanquished — ${regionLabel}`
          : `${enemy.name} Vanquished`;
      this.hud.showBanner('ENEMY FELLED', subtitle, 2.4, true);
    };
  }

  _wireSettingsCallbacks() {
    const applySettings = (s) => {
      this.cameraController.setSensitivityScale(s.sensitivityScale);
      this.cameraController.setInvertY(s.invertY);
      this.combat.setVolume((s.volume ?? 80) / 100);
      this.combat.setMuted(Boolean(s.muted));
      this.world.setTimePreset(s.todPreset || 'auto');
      this.world.setTimeScale(typeof s.todSpeed === 'number' ? s.todSpeed : 1);
    };

    // Apply initial (or localStorage-persisted) settings immediately
    applySettings(this.hud.settings);

    this.hud.onSettingsChange = (s) => {
      applySettings(s);
    };

    this.hud.onPauseChange = (paused) => {
      this.isPaused = paused;
      this.input.uiBlocked = paused;
      if (paused) {
        this.input.releasePointerLock();
        this.input.clearActiveInputs();
      }
    };

    this.hud.onRespawnAtGrace = () => {
      this._respawnCycle();
    };
  }

  _getAllLockableTargets() {
    return [...this.enemyManager.getLivingEnemies(), ...this.world.getLockableTargets()];
  }

  _respawnCycle() {
    const activeGrace = this.world.getActiveGraceShrine();
    if (activeGrace) {
      this.player.setRespawnGrace(activeGrace.respawnPos, activeGrace.respawnYaw);
    }
    this.player.respawnAtGrace();
    this.enemyManager.spawnAll();
    this.world.triggerGraceRest(activeGrace);
    this.cameraController.lockedTarget = null;
    this.combat.playSound('grace');
    const title = activeGrace ? activeGrace.name.toUpperCase() : 'ASHEN RUINS';
    this.hud.showBanner(title, 'Awakened at the Grace', 2.4, true);
  }

  _handleResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height);
    this.cameraController.resize(width, height);
  }

  start() {
    this._lastTime = performance.now();
    const tick = (now) => {
      const rawDt = (now - this._lastTime) * 0.001;
      this._lastTime = now;
      const dt = Math.min(rawDt, 0.05);
      if (!this.isPaused) {
        this._elapsed += dt;
      }

      this._update(dt);
      this.renderer.render(this.scene, this.cameraController.camera);

      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  _update(dt) {
    this.input.beginFrame();

    // Toggle Settings Menu on Escape key
    if (this.input.wasActionPressed('toggleSettings')) {
      this.hud.toggleSettings();
    }

    const lockableTargets = this._getAllLockableTargets();

    // Pause gameplay simulation cleanly while Settings Menu is open
    if (this.isPaused) {
      this.hud.update(
        dt,
        this.player,
        this.cameraController,
        this.world,
        this.input,
        this.enemyManager.enemies
      );
      this.input.endFrame();
      return;
    }

    const simDt = this.combat.consumeHitStop(dt);

    if (this.player.actionState === 'dead') {
      const canManualRespawn =
        this.player._deathTimer >= 1.4 &&
        (this.input.wasActionPressed('interact') || this.input.wasActionPressed('dodge'));
      if (this.player._deathTimer >= 2.8 || canManualRespawn) {
        this._respawnCycle();
      }
    } else {
      // Target Lock-On Toggle (Q or Middle Mouse Button)
      if (this.input.wasActionPressed('lockOnToggle')) {
        this.cameraController.toggleLockOn(lockableTargets, this.player.position);
      }

      // Cycle Lock-On Target (Tab)
      if (this.input.wasActionPressed('cycleTarget')) {
        this.cameraController.cycleLockOn(lockableTargets, this.player.position, 1);
      }

      // Site of Grace Interaction (F) across any of the 3 Biome Grace Shrines
      const nearShrine = this.world.getNearestGrace(this.player.position);
      if (this.input.wasActionPressed('interact') && nearShrine) {
        this.player.setRespawnGrace(nearShrine.respawnPos, nearShrine.respawnYaw);
        this.player.restoreAtGrace();
        this.world.triggerGraceRest(nearShrine);
        this.enemyManager.spawnAll();
        if (this.cameraController.lockedTarget && this.cameraController.lockedTarget.isEnemy) {
          this.cameraController.lockedTarget = null;
        }
        this.combat.playSound('grace');
        this.hud.showBanner(
          'GRACE RESTORED',
          `${nearShrine.name} — Vitals, Flasks & Foes Reset`,
          2.6,
          true
        );
      }
    }

    // Core Simulation (pauses briefly during micro hit-stop)
    if (simDt > 0) {
      this.player.update(simDt, this.input, this.cameraController, this.world);
      this.enemyManager.update(simDt, this.player, this.world);
      this.combat.resolveHits(
        this.player,
        this.enemyManager,
        this.world,
        this.cameraController,
        simDt
      );
      this.world.update(simDt, this._elapsed, this.player.position);
    } else {
      // Preserve player combat presses fired on a hit-stop freeze frame
      for (const action of ['lightAttack', 'heavyAttack', 'dodge', 'heal']) {
        if (this.input.wasActionPressed(action)) {
          this.input.pendingActionPresses.add(action);
        }
      }
    }

    // Camera, Trauma Shake, VFX & HUD run smoothly every rendered frame
    this.cameraController.updateShake(dt);
    this.cameraController.update(dt, this.input, this.player, this.world, lockableTargets);
    this.combat.updateEffects(dt, this.player, this.enemyManager.enemies);
    this.hud.update(
      dt,
      this.player,
      this.cameraController,
      this.world,
      this.input,
      this.enemyManager.enemies
    );

    this.input.endFrame();
  }

  dispose() {
    if (this._rafId !== null) cancelAnimationFrame(this._rafId);
    window.removeEventListener('resize', this._onResize);
    this.input.dispose();
    this.renderer.dispose();
  }
}

const game = new Game();
game.start();
