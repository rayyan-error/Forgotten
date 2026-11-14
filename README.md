# FORGOTTEN — Ashen Overlook (Chunk 1)

A 3D low-poly, third-person dark-fantasy action RPG prototype inspired by *Elden Ring*, built with **Three.js** using **100% procedural geometry, shaders, and materials** (zero external 3D models, textures, or build steps).

## Features (Chunk 1)

1. **Twilight & Eclipse Atmosphere (`src/world.js`)**
   - Custom GLSL twilight sky dome featuring a pitch-black eclipsed sun with a shimmering golden-amber solar corona, horizon dusk bloom, high-altitude twilight stars, exponential fog, and texel-snapped directional shadows.
   - Procedural cliffside ruined courtyard (*Ashen Overlook*): uneven instanced flagstones, central stepped ritual dais, weathered gothic arches, crumbling stone pillars, dead twisted branching trees, distant jagged mountain silhouettes, drifting ash motes, and a glowing golden **Site of Grace** with rising ember particles.

2. **Procedural Articulated Knight & Third-Person Camera (`src/player.js`, `src/camera.js`)**
   - Multi-pivot hierarchical low-poly knight (helm with recessed visor slit, layered pauldrons, articulated shoulders/elbows/hips/knees, two-stage tattered crimson cloak, kite shield, and greatsword held at the ready).
   - Smooth third-person orbit camera with Pointer Lock (plus drag-orbit fallback), scroll zoom, ground/pillar collision avoidance, and soft **Target Lock-On** (`Q` or Middle-Click) toward courtyard targets (*Ashen Effigy* dummy and *Runed Obelisk*).

3. **Souls-Like Locomotion, Stamina & Dodge Roll (`src/player.js`)**
   - Camera-relative WASD movement (or target-facing strafing & backpedaling when locked on).
   - Procedural idle breathing sway, stride/knee-lift gait, sprint lean, and velocity-damped cloak/weapon secondary motion.
   - `Shift` sprint drain, `Space` directional 360-degree tucked dodge roll (or backstep when neutral) with invulnerability frames (`isInvulnerable`), and delayed stamina regeneration with exhaustion recovery.

4. **Minimalist Souls-Style HUD (`index.html`, `styles.css`, `src/hud.js`)**
   - Top-left HP (crimson), FP (cerulean), and Stamina (emerald with delayed golden drain trail) bars, projected lock-on diamond reticle, Grace rest prompt (`E`), and bottom control hints.

## Running Locally

Serve the repository over any static HTTP server (no build step required):

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` in a modern WebGL-capable browser.

## Project Structure

- `index.html` — Viewport shell, import map (Three.js CDN), and HUD markup
- `styles.css` — Dark-fantasy minimalist HUD styling
- `src/main.js` — Renderer setup, subsystem orchestration, and fixed-capped frame loop
- `src/input.js` — Keyboard, mouse, wheel, pointer-lock, and action triggers
- `src/world.js` — Procedural sky, lighting, ruins, Grace shrine, particles, and collision queries
- `src/player.js` — Procedural knight rig, Souls locomotion, stamina, dodge i-frames, and animation
- `src/camera.js` — Orbit camera, collision clamping, and soft Target Lock-On
- `src/hud.js` — Vitals bars, drain trails, reticle projection, and banners

## Author

- **Mohammad Rayyan** — [GitHub](https://github.com/rayyan-error) · [Portfolio](https://rayyan-error.github.io/) · [LinkedIn](https://www.linkedin.com/in/rayyan-error)
