# Golf Tycoon — Architecture

## Overview
A mobile-first browser golf game combining Golf Clash-style gameplay with RollerCoaster Tycoon-style course building. **Hybrid rendering**: Three.js 3D for gameplay, 2D Canvas for menus/builder/HUD overlays.

## File Structure

```
index.html      — Dual canvas setup, loads Three.js CDN + all scripts.
engine.js       — 2D canvas, touch/mouse input, terrain constants, drawing helpers.
courses.js      — Pre-built career course data (9 holes across 3 courses).
builder.js      — Course builder (2D canvas — paint terrain, place tee/hole, save/load).
renderer3d.js   — Three.js scene, 3D terrain/ball/flag/trees, camera system, raycasting.
game.js         — Game state, ball physics, shot mechanics, all screens, main loop.
```

## Rendering Architecture

### Dual Canvas System
- **Three.js canvas** (`#three-canvas`): 3D gameplay (terrain, ball, flag, trees, water, sky)
- **2D Canvas** (`#c`): transparent HUD overlay during gameplay; full render for menus/builder
- Three.js loaded from CDN (r128)

### 3D Scene (renderer3d.js)
- **Terrain**: colored PlaneGeometry per grid cell with slight height variation
- **Water**: teal reflective ground plane (0x1a7a8a) extending beyond course — course appears surrounded by ocean
- **Trees**: cone canopy + cylinder trunk, ~80% density on TREE cells, size variation
- **Ball**: small sphere (1.2 radius) with shadows
- **Flag**: tall pole (35u) + red flag plane
- **Hole**: white rim ring + dark interior + recessed cylinder for depth, depthWrite disabled to prevent z-fighting
- **Skybox**: vertex-colored sphere — blue-grey top, bright horizon haze, teal bottom matching water
- **Clouds**: 12 scattered white planes at varying heights
- **Lighting**: ambient (0.6) + directional (0.8) with shadow maps (1024x1024)
- **Fog**: teal (1500-3000) blending terrain into water/sky

### Camera System (renderer3d.js)
PerspectiveCamera (FOV 60°, near 1, far 5000):
- **Overhead**: for aiming/planning. Height based on zoom level.
- **Behind-ball** (low angle): for accuracy meter and putting. Camera at ground level (height = dist * 0.22) looking past ball toward target. Creates dramatic over-the-shoulder feel.
- **Follow**: tracks ball during flight at moderate height.
- **Scouting**: auto-positioning skipped when `scouting=true` or `manualZoom=true`, allowing free pan. `cam3dSkipLerp` prevents lerp from fighting user input.

### 3D ↔ 2D Coordinate Conversion
- `screenToWorld3D(sx, sy)`: raycast to ground plane (y=0). Returns `{x, y, behind}`.
- `worldToScreen3D(wx, wy)`: project world to screen. Returns `{x, y, behind}` — behind flag prevents inverted rendering when point is behind camera.
- `panCamera3D(dx, dy)`: immediate camera movement using camera's right/forward vectors.
- `orbitCamera3D(angle, cx, cz)`: rotate camera around a point.

## Game Systems

### Shot Flow (Golf Clash Style)

**Step 1 — Aim (overhead view):**
- Target (animated concentric rings) auto-placed toward hole at club max range
- Drag target to re-aim — clamped within club range
- Drag anywhere else to pan 3D camera (persists after release)
- Floating yardage pill ("257 YDS") above target
- Aim line, ball guide dots visible
- Switch clubs (left-side stack with up/down arrows)
- Adjust spin (right-side control)
- Release target → locks aim → TAKE SHOT bar appears

**Step 2 — Confirm (overhead view):**
- Slim bottom bar: TAKE SHOT (orange gradient) + Cancel (ghost)
- Distance ring, accuracy rings hidden for clean view
- Can re-drag target to adjust

**Step 3 — Accuracy (behind-ball view):**
- Camera auto-rotates behind ball at low dramatic angle
- Colored fan arc at bottom: green center (33%) → yellow → red
- Arrow sweeps across arc, tap to stop
- Green zone = 0° deviation (perfect). Yellow = 0-5°. Red = 5-12°.
- Drag left/right for curl (15px dead zone prevents accidental curl)
- Camera restores after shot

**Putts (behind-ball view):**
- Camera auto-positions behind ball facing hole
- Drag back from ball to aim + set power
- Glowing cyan putt guide curves based on green slope simulation
- Release to putt (no accuracy meter)

### Ball Physics (game.js)
- Position + velocity with per-terrain friction
- **Airborne**: velocity = `(targetDist * 0.85) / airTime` — no air drag, clean physics. A 230 yd driver with no wind travels exactly 230 yds.
- **Gravity**: constant 400. Launch values: Driver 550, 3Wood 480, 5Iron 420, 7Iron 380, PWedge 500 (high arc).
- **Landing**: roll factor = `0.3 + topSpin * 0.2` (backspin = 0.1, topspin = 0.5)
- **Green slopes**: per-cell slope force with seeded variation pushes ball during ground rolling. Same forces used in putt guide simulation.
- **Curl**: continuous lateral force perpendicular to velocity during flight
- **Sidespin**: initial velocity offset perpendicular to aim direction
- **Wind**: applied to initial velocity. Air shots affected 1.8x, ground 0.4x. NOT shown in aim guides.

### Club System
| Club | Max Yds | Launch | Behavior |
|------|---------|--------|----------|
| Driver | 230 | 550 | Longest, high launch |
| 3 Wood | 195 | 480 | Long fairway |
| 5 Iron | 160 | 420 | Medium approach |
| 7 Iron | 120 | 380 | Short, controlled |
| P Wedge | 80 | 500 | Highest arc (lob) |
| Putter | 40 | 0 | Ground only |

Distance: `YDS_TO_WORLD = 3` (1 yard = 3 world units).

### HUD (2D Canvas Overlay)
Compact game-style layout:
- **Top bar** (44px): dark pills — SHOTS counter (blue), HOLE + PAR boxes
- **Wind** (left): compact pill with orange directional arrow + speed
- **Club** (left): vertical stack with up/down arrows, club name + max yards
- **Spin** (right): glass circle with glowing red draggable dot
- **TAKE SHOT bar** (bottom): orange gradient button + ghost Cancel
- **Camera controls** (left): circular glass buttons (+/−/↻/↺/◎)
- **Aim guides**: cyan aim line, animated target rings, floating yardage pill, ball guide dots — all projected via `worldToScreen3D`
- **Putt guide**: glowing cyan curved line with arrow + distance in feet

### Screens
All use dark gradient backgrounds with glassmorphism panels:
- **Main Menu**: gradient bg, decorative circles, glass player card, gradient pill buttons with icons
- **Character**: circle color swatches, pill name buttons, large ball preview with glow
- **Career Select**: glass course cards with colored left accent, emoji icons, gold best-score pills, lock overlays
- **Hole Complete**: vignette overlay, glass card, large colored score name, gradient button
- **Round Complete**: glass scorecard panel, refined rows, gold/green unlock pills, gradient + ghost buttons
- **Accuracy Arc**: 40-segment fan with outer glow, inner ring, glowing center line

### Course Builder (builder.js)
Pure 2D canvas. Paint terrain types, place tee/hole, adjustable brush size, save to localStorage, test-play directly.

### Persistence
localStorage with `gt_` prefix: player data, custom courses, best scores per career course.

### Input System (engine.js)
- **One-finger**: dispatched to game.js — target drag, camera pan, putt drag, button taps
- **Two-finger**: handled in engine.js — pinch zoom (camera height), twist rotate (orbit), drag pan
- Pinch also drives 3D camera via `zoomCamera3D`/`panCamera3D`
- `cam3dSkipLerp` flag prevents lerp from fighting manual pan
