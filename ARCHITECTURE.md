# Golf Tycoon — Architecture

## Overview
A mobile-first browser golf game combining Golf Clash-style gameplay with RollerCoaster Tycoon-style course building. Hybrid rendering: **Three.js 3D** for gameplay, **2D Canvas** for menus, builder, and HUD overlays.

## File Structure

```
index.html      — Entry point. Dual canvas setup, loads Three.js CDN + all scripts.
engine.js       — Core engine: 2D canvas, touch/mouse input, terrain constants, drawing helpers.
courses.js      — Pre-built career course data (9 holes across 3 courses).
builder.js      — Course builder UI and logic (2D canvas — paint terrain, place tee/hole, save/load).
renderer3d.js   — NEW: Three.js scene, 3D terrain/ball/flag, camera system, raycasting.
game.js         — Game state, ball physics, shot mechanics, screens, and main loop.
```

## Rendering Architecture

### Dual Canvas System
- **Three.js canvas** (`#three-canvas`): 3D gameplay rendering (terrain, ball, flag, trees, sky)
- **2D Canvas** (`#c`): HUD overlay on top of 3D during gameplay; full rendering for menus/builder
- Three.js canvas sits behind, 2D canvas is transparent during gameplay
- `show3D()` / `hide3D()` toggle the 3D canvas visibility per state

### What renders in 3D (renderer3d.js)
- Terrain mesh: colored planes per grid cell with height variation per terrain type
- Trees: cone (canopy) + cylinder (trunk) with shadows
- Water: semi-transparent reflective planes
- Ball: sphere with standard material, shadows
- Flag: pole (cylinder) + flag (plane)
- Hole: dark circle on ground
- Target: ring mesh on ground (yellow)
- Skybox: large sphere with sky blue color
- Lighting: ambient + directional with shadow maps

### What renders in 2D (game.js HUD overlay)
- Aim line (cyan, projected via `worldToScreen3D`)
- Target crosshair + accuracy rings (projected)
- Distance ring (projected)
- Putt guide line (glowing cyan with arrow, projected)
- Top bar (hole name, par, strokes, terrain)
- Club selector bar
- Wind compass
- Spin control ball
- TAKE SHOT / Cancel buttons
- Accuracy fan arc
- Zoom/rotate/recenter buttons
- Notifications

## Script Load Order
1. `three.min.js` (CDN r128) — Three.js library
2. `engine.js` — 2D canvas, input, terrain constants
3. `courses.js` — terrain grid data
4. `builder.js` — course builder (2D only)
5. `renderer3d.js` — Three.js scene setup, camera, raycasting
6. `game.js` — game logic, calls into renderer3d for 3D, engine for 2D

## Key Systems

### Terrain (engine.js + renderer3d.js)
Grid-based terrain with 10 types. Each cell is `CELL` (16px) in world space.
- 2D: flat colored rectangles with friction values
- 3D: `PlaneGeometry` per cell, positioned at terrain-specific heights:
  - Water: -1.5, Sand: -0.3, Green: +0.2, Tee: +0.3, OOB: -0.5, default: 0
- Trees rendered as 3D cone+cylinder on TREE cells
- Water gets extra semi-transparent plane for reflective look

### 3D Camera System (renderer3d.js)
`PerspectiveCamera` with smooth lerp transitions between modes:

**Overhead** (`setCameraOverhead`): looks down at an angle for aiming/planning. Height based on zoom level. Used when ball is stopped and not on green.

**Behind-ball** (`setCameraBehindBall`): positioned behind the ball looking toward the target/hole. Used for:
- Accuracy meter (full shots)
- Putting (on green, looking toward hole)

**Follow** (`setCameraOverhead` with ball tracking): follows ball during flight.

**Scouting override**: when `scouting=true`, auto-positioning is skipped so `panCamera3D` can move the camera freely. `cam3dSkipLerp` prevents the lerp from fighting user panning.

Camera properties: FOV 60°, near 1, far 5000. Fog 1500-3000. Skybox radius 2500.

### 3D ↔ 2D Coordinate Conversion (renderer3d.js)
- `screenToWorld3D(sx, sy)`: raycast from screen point to ground plane (y=0), returns world {x, y}
- `worldToScreen3D(wx, wy)`: project world point to screen via camera, returns screen {x, y}
- `panCamera3D(dx, dy)`: translate screen drag delta to 3D camera movement using camera's right/forward vectors. Moves both target and position immediately to prevent shakiness.
- `zoomCamera3D(factor)`: adjust camera height

### Ball Physics (game.js)
- Position + velocity model with per-terrain friction
- **Airborne system**: velocity calculated from physics so flight distance matches displayed club range
- **Gravity**: constant `GRAVITY = 400`
- **Curl**: continuous lateral force perpendicular to velocity during airborne flight
- **Spin**: sidespin curves trajectory; topspin/backspin affects landing roll factor
- Ball position synced to 3D via `updateBall3D(wx, wy, wz, color)` each frame

### Shot Flow (game.js) — Golf Clash Style

**Step 1 — Aim (overhead view):**
- Target auto-placed toward hole at club max range
- Drag target to re-aim (clamped to club range)
- Drag elsewhere to pan 3D camera
- Aim line, accuracy rings, distance ring shown as 2D overlay projected from 3D
- Switch clubs, adjust spin

**Step 2 — Confirm:**
- TAKE SHOT + Cancel buttons
- Can re-drag target or adjust spin

**Step 3 — Accuracy (behind-ball view):**
- Camera auto-rotates behind ball looking toward target
- Colored fan arc at bottom of screen (green center → yellow → red edges)
- Arrow sweeps across arc, tap to stop
- Drag left/right for curl during sweep
- Camera restores after shot

**Putts (behind-ball view):**
- Camera auto-positions behind ball facing hole
- Drag back from ball to aim + set power
- Glowing cyan putt guide line (wide glow + thin core + arrow + distance in feet)
- Direction converted from screen to world space via `screenToWorld3D` raycasting
- Release to putt (no accuracy meter)

### Club System (game.js)
6 clubs: Driver (230 yds), 3 Wood (195), 5 Iron (160), 7 Iron (120), P Wedge (80), Putter (40).

### Wind System (game.js)
Random 1-13 mph per hole. Compass HUD. Affects ball physics but NOT shown in aim guides.

### Course Builder (builder.js)
Pure 2D canvas. Paint terrain, place tee/hole, save to localStorage, test-play.

### Persistence
localStorage with `gt_` prefix: player data, custom courses, best scores.

## Current Status
- [x] Three.js 3D rendering for gameplay (terrain, ball, flag, trees, water, sky, shadows)
- [x] Dual canvas: 3D behind, 2D HUD overlay on top
- [x] 3D camera: overhead, behind-ball, follow, scouting pan
- [x] 3D raycasting for target drag and putt direction
- [x] Projected aim guides (aim line, crosshair, rings, distance ring, putt guide)
- [x] Behind-ball accuracy fan arc
- [x] Behind-ball putting with glowing guide line
- [x] All previous features (clubs, spin, curl, wind, career, builder, etc.)
