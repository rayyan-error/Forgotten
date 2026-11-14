import * as THREE from 'three';
import { InputManager } from './input.js';
import { World } from './world.js';
import { Player } from './player.js';
import { ThirdPersonCamera } from './camera.js';
import { HUD } from './hud.js';

/**
 * Forgotten — Action RPG Entrypoint (Chunk 1)
 * Orchestrates renderer, modular subsystems, and fixed-capped game loop.
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
    this.cameraController = new ThirdPersonCamera(
      window.innerWidth / Math.max(window.innerHeight, 1)
    );
    this.hud = new HUD();

    this._lastTime = performance.now();
    this._elapsed = 0;
    this._rafId = null;

    this._onResize = this._handleResize.bind(this);
    window.addEventListener('resize', this._onResize);

    // Expose read-only runtime handle for debugging/future chunks
    window.__FORGOTTEN__ = this;
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
      const dt = Math.min(rawDt, 0.05); // Cap delta time to prevent physics spikes
      this._elapsed += dt;

      this._update(dt);
      this.renderer.render(this.scene, this.cameraController.camera);

      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  _update(dt) {
    this.input.beginFrame();

    // Target Lock-On Toggle (Q or Middle Mouse Button)
    if (this.input.wasActionPressed('lockOnToggle')) {
      this.cameraController.toggleLockOn(
        this.world.getLockableTargets(),
        this.player.position
      );
    }

    // Site of Grace Interaction
    if (
      this.input.wasActionPressed('interact') &&
      this.world.isNearGrace(this.player.position)
    ) {
      this.player.restoreAtGrace();
      this.world.triggerGraceRest();
      this.hud.showBanner('GRACE RESTORED', 'Vitals & Stamina Replenished', 2.8, true);
    }

    // Update Subsystems
    this.player.update(dt, this.input, this.cameraController, this.world);
    this.cameraController.update(dt, this.input, this.player, this.world);
    this.world.update(dt, this._elapsed, this.player.position);
    this.hud.update(dt, this.player, this.cameraController, this.world, this.input);

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
