# FORGOTTEN — Ashen Overlook (Chunk 1 + Chunk 2 + Chunk 3)

A 3D low-poly, third-person dark-fantasy action RPG prototype inspired by *Elden Ring*, built with **Three.js** using **100% procedural geometry, shaders, Web Audio SFX, and materials** (zero external 3D models, textures, or build steps).

## Features

### Chunk 1 — World, Character, Camera & Locomotion
1. **Twilight & Eclipse Atmosphere (`src/world.js`)**
   - Custom GLSL twilight sky dome with an eclipsed sun, shimmering golden-amber solar corona, exponential fog, and texel-snapped directional shadows.
   - Procedural cliffside ruined courtyard (*Ashen Overlook*): uneven instanced flagstones, central stepped ritual dais, weathered gothic arches, crumbling stone pillars, dead twisted trees, distant jagged mountains, drifting ash motes, and a glowing golden **Site of Grace** with rising ember particles.
2. **Procedural Knight & Third-Person Camera (`src/player.js`, `src/camera.js`)**
   - Multi-pivot hierarchical knight (visored helm, layered pauldrons, articulated limbs, tattered crimson cloak, kite shield, greatsword, and dynamic **Wayfarer's Hip Lantern**).
   - Smooth third-person orbit camera with Pointer Lock (+ drag fallback), scroll zoom, environment collision avoidance, dynamic **Target Lock-On** (`Q` / Middle-Click), target cycling (`Tab` or horizontal mouse flick), and quadratic screen-shake trauma.
3. **Souls-Like Movement & Stamina (`src/player.js`)**
   - Camera-relative WASD locomotion (with target-facing strafing while locked on), procedural gait/breathing/secondary motion, `Shift` sprint drain, `Space` directional 360-degree dodge roll (or neutral backstep) with invulnerability frames (`isInvulnerable`), and delayed stamina regeneration.

### Chunk 2 — Melee Combat, Shield Blocking & Enemy AI
4. **Player Melee Combat, Blocking & Healing (`src/player.js`, `src/combat.js`)**
   - **Light 3-Hit Combo (`LMB`)**: Diagonal slash -> reverse upward slash -> overhead slam with distinct wind-up, active, and recovery windows, forward step momentum, stamina cost, input buffering, dodge cancel late in recovery, and glowing additive slash-trail ribbons.
   - **Heavy Overhead Cleave (`Shift + LMB` or `R`)**: High-damage, high-poise overhead strike with slam impact burst and extra camera trauma.
   - **Shield Block (`RMB` held)**: Raises the kite shield to absorb frontal enemy hits (~140° cone) by draining Stamina instead of HP with sparks and metallic clang feedback; hitting `0` Stamina triggers a **Guard-Break** stagger.
   - **Crimson Flask (`E`)**: 3 rechargeable healing charges restored at any Site of Grace with a drinking animation and golden-crimson particle burst.
5. **Procedural Undead Enemies & Telegraphing AI (`src/enemies.js`)**
   - **Hollow Swordsmen** and **Ashen Spear Sentinels** (with a 2-move lunging thrust and horizontal shaft-cleave kit) built procedurally with skeletal armor, glowing eye sockets, and rusted steel weapons.
   - State-machine AI (`patrol` -> `pursue` -> `strafe` -> `windup` glint telegraph -> `attack` -> `recover` -> `stagger` -> ash dissolve death).
6. **Hitboxes, Hit-Stop & Overlays (`src/combat.js`, `src/hud.js`)**
   - Weapon-blade segment collision checks, clean dodge i-frame negation, ~28–55ms micro hit-stop, procedural Web Audio SFX, projected floating enemy HP bars, **`ENEMY FELLED`** & **`YOU DIED`** overlays, and **`F`** Site of Grace rest to restore HP/FP/Stamina/Flasks and respawn foes.

### Chunk 3 — Dynamic Day/Night Cycle, Interconnected Biomes, Mountain Monsters & Settings Menu
7. **Dynamic Day/Night Cycle & Night Illumination (`src/world.js`, `src/player.js`)**
   - Smooth 5-minute continuous Day/Night cycle (`Dawn -> Golden Day -> Crimson Dusk -> Moonlit Night`) interpolating sun/moon directional light angles, sky shader gradients, starfield + moon disc, fog color/density, and ambient hemisphere lighting.
   - Automatic nocturnal point-light ignition: boosts Golden Grace Shrines, ignites soldier campfires/torches, and automatically lights the player's **Wayfarer's Hip Lantern** after dusk.
8. **Seamless Map Expansion into Two New Biomes (`src/world.js`)**
   - Continuous vertex-colored terrain mesh (`172m × 80m`) with smooth height/color blending (`getTerrainHeight(x, z)`) and 3 Sites of Grace:
     - **Plains & Farmlands (*Gilded Moorlands*, East)**: Rolling golden-green meadows, winding dirt roads, wooden fences, 2 abandoned farmhouses, rotating broken windmill, hay bales, and a barricaded Soldier Outpost Camp (tents, watchtower, spiked barricades, and glowing campfires) guarded by coordinated Hollow Swordsmen & Ashen Spear Sentinels.
     - **Rugged Mountains (*Frostpeak Crags*, West)**: Ascending rocky switchbacks, steep slate cliffs, snow-dusted pine trees, frost boulders, and ancient stone ruins with a mountain pass Site of Grace.
9. **New Mountain Enemy Archetypes (`src/enemies.js`, `src/combat.js`)**
   - **Dire Wolves (`direwolf`)**: Fast pack-style quadruped predators with articulated legs, lupine snout/fangs, glowing eyes, and tail; circle the player and telegraph a crouch-and-pounce lunging bite (`pounce`) or rapid snap (`bite`).
   - **Giant Frost/Cave Spiders (`spider`)**: Multi-segmented arachnids with 8 animated multi-jointed legs, 6 glowing eyes, and mandibles; perform wide foreleg sweeps (`legSweep`), leaping slams (`leapSlam`), and ranged **Web-Spit Projectiles (`webSpit`)** that apply a temporary movement slow (`webSlowTimer`) if not dodged or shield-blocked.
10. **Settings Menu & Lower Default Camera Sensitivity (`src/camera.js`, `src/hud.js`, `src/input.js`)**
    - Lowered default mouse look sensitivity (`0.0010` rad/px) for smooth, controlled third-person camera tracking.
    - Dark-fantasy **Settings Modal (`Esc`)** that cleanly pauses gameplay and persists preferences to `localStorage`: Camera Sensitivity slider (`0.20x – 2.50x`), Invert Y-Axis toggle, Master Volume slider + Mute toggle, Time-of-Day Preset (`Auto Cycle`, `Dawn`, `Golden Day`, `Crimson Dusk`, `Moonlit Night`) & Cycle Speed (`1x`, `4x`, `Paused`), **Resume Game**, and **Respawn at Last Grace**.

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
| `Esc` | Open / Close Settings Menu (Pauses Game) |

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
