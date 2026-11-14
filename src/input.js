/**
 * InputManager
 * ------------
 * Unified keyboard, mouse, wheel, and pointer-lock input handler.
 * Supports Chunk 1 movement/camera plus Chunk 2 melee combo, heavy attack,
 * shield block, Crimson Flask heal, Grace rest, and lock-on target cycling.
 */
export class InputManager {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;

    this.keysDown = new Set();
    this.keysJustPressed = new Set();
    this.pendingKeyPresses = new Set();

    this.mouseButtonsDown = new Set();
    this.pendingActionPresses = new Set();
    this.actionsJustPressed = new Set();

    this.isPointerLocked = false;
    this.isDragging = false;
    this.lastPointerX = 0;
    this.lastPointerY = 0;

    this.pendingMouseDeltaX = 0;
    this.pendingMouseDeltaY = 0;
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;

    this.pendingWheelDelta = 0;
    this.wheelDelta = 0;

    this._boundHandlers = {};
    this._bindEvents();
  }

  _bindEvents() {
    this._boundHandlers.onKeyDown = (e) => {
      if (e.code === 'Space' || e.code === 'Tab') {
        e.preventDefault();
      }

      if (!this.keysDown.has(e.code)) {
        this.pendingKeyPresses.add(e.code);

        if (e.code === 'Space') this.pendingActionPresses.add('dodge');
        if (e.code === 'KeyQ') this.pendingActionPresses.add('lockOnToggle');
        if (e.code === 'Tab') this.pendingActionPresses.add('cycleTarget');
        if (e.code === 'KeyE') this.pendingActionPresses.add('heal');
        if (e.code === 'KeyF') this.pendingActionPresses.add('interact');
        if (e.code === 'KeyR') this.pendingActionPresses.add('heavyAttack');
      }
      this.keysDown.add(e.code);
    };

    this._boundHandlers.onKeyUp = (e) => {
      this.keysDown.delete(e.code);
    };

    this._boundHandlers.onMouseDown = (e) => {
      // Middle-click toggles Lock-On and cancels browser auto-scroll
      if (e.button === 1) {
        e.preventDefault();
        this.pendingActionPresses.add('lockOnToggle');
      }

      // Request pointer lock on primary click inside the game canvas
      if (e.target === this.canvas && e.button === 0 && !this.isPointerLocked) {
        this._requestPointerLock();
      }

      // Fallback drag-orbit when pointer lock is inactive (RMB drag)
      if (e.button === 2 && !this.isPointerLocked && e.target === this.canvas) {
        this.isDragging = true;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
      }

      if (!this.mouseButtonsDown.has(e.button)) {
        if (e.button === 0 && e.target === this.canvas) {
          if (this.isSprinting()) {
            this.pendingActionPresses.add('heavyAttack');
          } else {
            this.pendingActionPresses.add('lightAttack');
          }
        }
        if (e.button === 2 && e.target === this.canvas) {
          this.pendingActionPresses.add('blockStart');
        }
      }
      this.mouseButtonsDown.add(e.button);
    };

    this._boundHandlers.onMouseUp = (e) => {
      this.mouseButtonsDown.delete(e.button);
      if (!this.mouseButtonsDown.has(2)) {
        this.isDragging = false;
      }
    };

    this._boundHandlers.onMouseMove = (e) => {
      if (this.isPointerLocked) {
        const dx = Math.abs(e.movementX) < 180 ? e.movementX : 0;
        const dy = Math.abs(e.movementY) < 180 ? e.movementY : 0;
        this.pendingMouseDeltaX += dx;
        this.pendingMouseDeltaY += dy;
      } else if (this.isDragging) {
        const dx = e.clientX - this.lastPointerX;
        const dy = e.clientY - this.lastPointerY;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
        this.pendingMouseDeltaX += dx;
        this.pendingMouseDeltaY += dy;
      }
    };

    this._boundHandlers.onWheel = (e) => {
      e.preventDefault();
      const scale = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? 256 : 1;
      this.pendingWheelDelta += e.deltaY * scale;
    };

    this._boundHandlers.onPointerLockChange = () => {
      this.isPointerLocked = document.pointerLockElement === this.canvas;
      if (this.isPointerLocked) {
        this.isDragging = false;
      }
    };

    this._boundHandlers.onContextMenu = (e) => {
      if (e.target === this.canvas) {
        e.preventDefault();
      }
    };

    this._boundHandlers.onBlur = () => {
      this.keysDown.clear();
      this.mouseButtonsDown.clear();
      this.isDragging = false;
    };

    window.addEventListener('keydown', this._boundHandlers.onKeyDown, { passive: false });
    window.addEventListener('keyup', this._boundHandlers.onKeyUp);
    window.addEventListener('mousedown', this._boundHandlers.onMouseDown, { passive: false });
    window.addEventListener('mouseup', this._boundHandlers.onMouseUp);
    window.addEventListener('mousemove', this._boundHandlers.onMouseMove);
    this.canvas.addEventListener('wheel', this._boundHandlers.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this._boundHandlers.onContextMenu);
    document.addEventListener('pointerlockchange', this._boundHandlers.onPointerLockChange);
    window.addEventListener('blur', this._boundHandlers.onBlur);
  }

  _requestPointerLock() {
    try {
      const promise = this.canvas.requestPointerLock?.();
      if (promise && typeof promise.catch === 'function') {
        promise.catch(() => {
          // Graceful fallback: drag-to-orbit remains active
        });
      }
    } catch {
      // Ignore pointer lock rejection in restricted contexts
    }
  }

  beginFrame() {
    this.keysJustPressed.clear();
    for (const code of this.pendingKeyPresses) {
      this.keysJustPressed.add(code);
    }
    this.pendingKeyPresses.clear();

    this.actionsJustPressed.clear();
    for (const action of this.pendingActionPresses) {
      this.actionsJustPressed.add(action);
    }
    this.pendingActionPresses.clear();

    this.mouseDeltaX = this.pendingMouseDeltaX;
    this.mouseDeltaY = this.pendingMouseDeltaY;
    this.pendingMouseDeltaX = 0;
    this.pendingMouseDeltaY = 0;

    this.wheelDelta = this.pendingWheelDelta;
    this.pendingWheelDelta = 0;
  }

  endFrame() {
    this.keysJustPressed.clear();
    this.actionsJustPressed.clear();
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.wheelDelta = 0;
  }

  isKeyDown(code) {
    return this.keysDown.has(code);
  }

  wasActionPressed(action) {
    return this.actionsJustPressed.has(action);
  }

  isBlocking() {
    return this.mouseButtonsDown.has(2);
  }

  getMoveVector() {
    let x = 0;
    let z = 0;
    if (this.isKeyDown('KeyW') || this.isKeyDown('ArrowUp')) z += 1;
    if (this.isKeyDown('KeyS') || this.isKeyDown('ArrowDown')) z -= 1;
    if (this.isKeyDown('KeyD') || this.isKeyDown('ArrowRight')) x += 1;
    if (this.isKeyDown('KeyA') || this.isKeyDown('ArrowLeft')) x -= 1;

    const len = Math.hypot(x, z);
    if (len > 0) {
      return { x: x / len, z: z / len, magnitude: 1 };
    }
    return { x: 0, z: 0, magnitude: 0 };
  }

  isSprinting() {
    return this.isKeyDown('ShiftLeft') || this.isKeyDown('ShiftRight');
  }

  dispose() {
    window.removeEventListener('keydown', this._boundHandlers.onKeyDown);
    window.removeEventListener('keyup', this._boundHandlers.onKeyUp);
    window.removeEventListener('mousedown', this._boundHandlers.onMouseDown);
    window.removeEventListener('mouseup', this._boundHandlers.onMouseUp);
    window.removeEventListener('mousemove', this._boundHandlers.onMouseMove);
    this.canvas.removeEventListener('wheel', this._boundHandlers.onWheel);
    this.canvas.removeEventListener('contextmenu', this._boundHandlers.onContextMenu);
    document.removeEventListener('pointerlockchange', this._boundHandlers.onPointerLockChange);
    window.removeEventListener('blur', this._boundHandlers.onBlur);
  }
}
