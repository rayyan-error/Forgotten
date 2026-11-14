# FORGOTTEN — Ashen Overlook (Chunk 1 + Chunk 2)

A 3D low-poly, third-person dark-fantasy action RPG prototype inspired by *Elden Ring*, built with **Three.js** using **100% procedural geometry, shaders, Web Audio SFX, and materials** (zero external 3D models, textures, or build steps).

## Features

### Chunk 1 — World, Character, Camera & Locomotion
1. **Twilight & Eclipse Atmosphere (`src/world.js`)**
   - Custom GLSL twilight sky dome with an eclipsed sun, shimmering golden-amber solar corona, exponential fog, and texel-snapped directional shadows.
   - Procedural cliffside ruined courtyard (*Ashen Overlook*): uneven instanced flagstones, central stepped ritual dais, weathered gothic arches, crumbling stone pillars, dead twisted trees, distant jagged mountains, drifting ash motes, and a glowing golden **Site of Grace** with rising ember particles.
2. **Procedural Knight & Third-Person Camera (`src/player.js`, `src/camera.js`)**
   - Multi-pivot hierarchical knight (visored helm, layered pauldrons, articulated limbs, tattered crimson cloak, kite shield, and greatsword).
   - Smooth third-person orbit camera with Pointer Lock (+ drag fallback), scroll zoom, environment collision avoidance, dynamic **Target Lock-On** (`Q` / Middle-Click), target cycling (`Tab` or horizontal mouse flick), and quadratic screen-shake trauma.
3. **Souls-Like Movement & Stamina (`src/player.js`)**
   - Camera-relative WASD locomotion (with target-facing strafing while locked on), procedural gait/breathing/secondary motion, `Shift` sprint drain, `Space` directional 360-degree dodge roll (or neutral backstep) with invulnerability frames (`isInvulnerable`), and delayed stamina regeneration.

### Chunk 2 — Melee Combat, Shield Blocking & Enemy AI
4. **Player Melee Combat, Blocking & Healing (`src/player.js`, `src/combat.js`)**
   - **Light 3-Hit Combo (`LMB`)**: Diagonal slash -> reverse upward slash -> overhead slam with distinct wind-up, active, and recovery windows, forward step momentum, stamina cost, input buffering, dodge cancel late in recovery, and glowing additive slash-trail ribbons.
   - **Heavy Overhead Cleave (`Shift + LMB` or `R`)**: High-damage, high-poise overhead strike with slam impact burst and extra camera trauma.
   - **Shield Block (`RMB` held)**: Raises the kite shield to absorb frontal enemy hits by draining Stamina instead of HP with sparks and metallic clang feedback; hitting `0` Stamina triggers a **Guard-Break** stagger.
   - **Crimson Flask (`E`)**: 3 rechargeable healing charges restored at the Site of Grace with a drinking animation and golden-crimson particle burst.
5. **Procedural Undead Enemies & Telegraphing AI (`src/enemies.js`)**
   - 3 **Hollow Swordsmen** and 1 **Ashen Spear Sentinel** built procedurally with skeletal armor, glowing eye sockets, and rusted steel weapons.
   - State-machine AI (`patrol` -> `pursue` -> `strafe` -> `windup` glint telegraph -> `attack` -> `recover` -> `stagger` -> ash dissolve death).
6. **Hitboxes, Hit-Stop & Overlays (`src/combat.js`, `src/hud.js`)**
   - Weapon-blade segment collision checks, clean dodge i-frame negation, ~28–55ms micro hit-stop, procedural Web Audio SFX, projected floating enemy HP bars, **`ENEMY FELLED`** & **`YOU DIED`** overlays, and **`F`** Site of Grace rest to restore HP/FP/Stamina/Flasks and respawn courtyard foes.

## Controls

| Input | Action |
| --- | --- |
| `WASD` | Move / Strafe (locked) |
| `Shift` (hold) | Sprint |
| `Space` | Dodge Roll / Backstep (i-frames) |
| `LMB` | Light Greatsword 3-Hit Combo |
| `Shift + LMB` / `R` | Heavy Overhead Cleave |
| `RMB` (hold) | Raise Kite Shield Block |
| `E` | Drink Crimson Flask (3 charges) |
| `F` | Rest at Site of Grace (when nearby) |
| `Q` / `Middle Click` | Toggle Target Lock-On |
| `Tab` | Cycle Locked Target |

## Running Locally

Serve the repository over any static HTTP server (no build step required):

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` in a modern WebGL-capable browser.

## Project Structure

- `index.html` — Viewport shell, import map (Three.js CDN), and HUD markup
- `styles.css` — Dark-fantasy HUD styling, flask quick-slot, floating enemy bars, and `YOU DIED` overlay
- `src/main.js` — Renderer setup, combat/enemy orchestration, Grace rest/respawn cycle, and hit-stop loop
- `src/input.js` — Keyboard, mouse buttons, wheel, pointer-lock, and combat action triggers
- `src/world.js` — Procedural sky, lighting, ruins, Grace shrine, particles, and collision queries
- `src/player.js` — Procedural knight rig, Souls locomotion, combo/heavy attacks, shield block, Flasks, and animations
- `src/enemies.js` — Procedural undead warriors (`Hollow Swordsman`, `Ashen Spear Sentinel`), telegraph AI, and ash death dissolve
- `src/combat.js` — Hitbox overlap math, slash-trail shader ribbon, i-frames, block resolution, hit-stop, VFX bursts, and Web Audio SFX
- `src/camera.js` — Orbit camera, collision clamping, screen-shake trauma, and dynamic enemy lock-on/cycling
- `src/hud.js` — Vitals bars, Crimson Flask HUD, floating enemy HP projection, banners, and death overlay

## Author

- **Mohammad Rayyan** — [GitHub](https://github.com/rayyan-error) · [Portfolio](https://rayyan-error.github.io/) · [LinkedIn](https://www.linkedin.com/in/rayyan-error)
