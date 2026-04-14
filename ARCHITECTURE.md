# Golf Tycoon — Architecture

## Overview
A mobile-first browser golf game combining Golf Clash-style gameplay with RollerCoaster Tycoon-style course building. **Hybrid rendering**: Three.js 3D for gameplay, 2D Canvas for menus/builder/HUD overlays.

## File Structure

```
index.html      — Dual canvas setup, loads Three.js CDN + all scripts.
engine.js       — 2D canvas, touch/mouse input, terrain constants, drawing helpers.
courses.js      — 9 hand-designed career holes across 3 courses.
builder.js      — Course builder (2D canvas — paint terrain, place tee/hole, save/load).
renderer3d.js   — Three.js scene, heightmap terrain, trees/water/sky, camera system, raycasting.
game.js         — Game state, ball physics, shot mechanics, all screens, main loop.
```

## Rendering Architecture

### Dual Canvas System
- **Three.js canvas** (`#three-canvas`): 3D gameplay (terrain, ball, flag, trees, water, sky)
- **2D Canvas** (`#c`): transparent HUD overlay during gameplay; full render for menus/builder
- Three.js loaded from CDN (r128)

### 3D Scene (renderer3d.js)
- **Terrain**: single continuous `PlaneGeometry` mesh with per-vertex heights and per-vertex colors. Heightmap comes from `hole.heights` (generated in `generateHeights`). Colors chosen by priority vote over neighboring cells (sand > green/tee > fairway > rough/tree > water) so boundaries stay crisp.
- **Visual polish per-vertex**:
  - Fairway mowing stripes — alternating 115% / 85% brightness every 3 rows
  - Bunker lips — vertices near sand darkened to 75% for edge definition
  - Tree shadow patches — rough near trees darkened to 65-70%
  - Procedural 256x256 canvas grass texture — speckles + blade strokes
- **Water**: teal ground plane extending beyond course — course appears surrounded by ocean
- **Trees**: InstancedMesh variants — pines (cone + cylinder), oaks (sphere + thick trunk), bushes (squashed sphere). ~80% density on TREE cells with size variation.
- **Distant scenery**: 2 rings of ~160 background trees + 8 large hills visible from the behind-ball camera
- **Ball**: small sphere (1.2 radius) with shadows, updated via `updateBall3D(wx, wy, wz, color, groundY)` that splits terrain height 1:1 from airborne 0.5
- **Flag**: pole (28u) + red flag plane (8x5)
- **Hole**: white rim ring + dark interior + recessed cylinder for depth, depthWrite disabled to prevent z-fighting
- **Skybox**: vertex-colored sphere — blue-grey top, bright horizon haze, teal bottom matching water
- **Clouds**: scattered white planes
- **Lighting**: ambient (0.6) + directional (0.8) with 1024² shadow maps
- **Fog**: teal (1500-3000) blending terrain into water/sky

### Camera System (renderer3d.js)
PerspectiveCamera (FOV 60°, near 1, far 5000):
- **Overhead**: tilted ~55° (height 500, z offset height * 0.7) so elevation/hills are visible during aim
- **Behind-ball** (low angle): camera at ground level (h=10), look-at 300 units forward — over-the-shoulder feel. Used for drag-back and putting.
- **Follow**: low chase cam tracking the ball in its velocity direction during flight
- **Scouting**: auto-positioning skipped when `scouting=true` or `manualZoom=true`. `cam3dSkipLerp` prevents lerp from fighting manual pan.

### 3D ↔ 2D Coordinate Conversion
- `screenToWorld3D(sx, sy)`: raycast to ground plane. Returns `{x, y, behind}`.
- `worldToScreen3D(wx, wy)`: project world to screen. Returns `{x, y, behind}` — the `behind` flag prevents inverted rendering when the point is behind the camera (fixes aim line flipping when zoomed in).
- `panCamera3D(dx, dy)`: immediate camera movement using camera's right/forward vectors.
- `orbitCamera3D(angle, cx, cz)`: rotate camera around a point.
- `zoomCamera3D(factor)`: change camera height.

## Game Systems

### Shot Flow — Three-Step Golf Clash

**Step 1 — Aim (overhead view):**
- Target (animated concentric rings) auto-placed toward hole at club max range via `updateTargetFromClub`
- Drag target to re-aim — clamped within club range
- Drag elsewhere to pan 3D camera (persists after release)
- Floating yardage pill above target
- Aim line + ball guide dots projected via `worldToScreen3D`
- Switch clubs with left-side stack, adjust spin on right
- **TAKE SHOT bar visible from the start**: if player is happy with the auto-aim they can tap it immediately. Dragging the target manually adds a Cancel button.
- Releasing a manual drag locks the aim (`shotLocked = true`)

**Step 2 — TAKE SHOT → drag-back (behind-ball view):**
- Tapping TAKE SHOT (with or without manual aim) enters `dragBackMode`, swings camera behind the ball
- Pulsing dashed "DRAG BACK" circle appears below the ball on screen
- Re-Aim button (bottom-right) restores overhead view with a fresh aim state
- Spin, club switch, and camera buttons are all hidden during this phase

**Step 3 — Drag-back mini-game:**
- Touching the ball begins `dragBackActive`
- Virtual ball follows the finger with a green glow trail from the original ball position
- Crossing `DRAG_BACK_THRESHOLD` (100px) engages `meterActive` — accuracy arc sweeps at the bottom of the screen
- **Release on white** fires via `fireFromMeter(lockedDirX, lockedDirY, powerPct, meterAngle, 0)`
- Releasing before the threshold cancels the drag but keeps the player in drag-back mode

**Putts (behind-ball view):**
- Camera auto-positions behind ball facing hole
- Drag back from ball to aim and set power
- Glowing cyan slope-aware curved putt guide
- Accuracy arc runs during the drag (all three elements simultaneously: aim, strength, sweep)
- Release captures `puttMeterAngle` and applies an angular deviation (green < 0.6°, yellow up to 2.5°, red up to 7°)
- Feedback notifications: Pure Strike / Pulled Left / Pushed Right

### Ball Physics (game.js)

**Constants:**
- `YDS_TO_WORLD = 16` (1 yard = 16 world units, 2 yards per cell)
- `CELL = 32`
- `GRAVITY = 304`

**Launch:**
- Non-linear: `vz = club.launch * powerPct^1.4 * lie.launchMult`
- Horizontal velocity: `(targetDist * 0.85) / airTime` — **no air drag**, a 230 yd driver travels exactly 230 yds

**Lie modifiers (`LIE_MODIFIERS`):**
| Terrain | Power | Spin | Launch |
|---------|-------|------|--------|
| Tee/Fairway/Green | 1.00 | 1.00 | 1.00 |
| Rough | 0.80 | 0.40 | 0.85 |
| Sand | 0.55 | 0.00 | 0.70 |
| Path | 0.95 | 0.80 | 0.95 |

**Realistic rolling (`updateBall`):**
1. **Heightmap slope on every terrain.** Each frame samples `terrainSlopeAt(ball.x, ball.y)` (central-difference gradient) and adds downhill gravity: `ball.vx += hslope.sx * slopeGain * stepDt` with `slopeGain = 350` (420 on greens since they are flattened to 10% height).
2. **Stop threshold respects slope.** At speed < 2, the ball only stops if the slope magnitude is below `(1 - fric) * 0.8`. Otherwise it gets a downhill nudge and keeps rolling.
3. **Landing angle affects bounce.** `cosAngle = cos(atan2(vzImpact, hSpeed))`, `rollAngleFactor = cosAngle^3`. Horizontal retain = `0.15 + rollAngleFactor * 0.78` — steep drops lose almost everything, flat roll-ins keep 85%+.
4. **Terrain bounce modifiers.** Fairway ×1.05, green ×0.55, rough ×0.4, sand flat 0.08, path ×1.3.
5. **Multi-bounce drives.** `bounceTable = [0.40, 0.22, 0.10, 0]` — first bounce preserves 40% of vz (diminishing on each subsequent bounce). Sand/rough kill the bounce entirely.
6. **Backspin check-back.** On the first bounce on green or fairway with topSpin < -0.2, a reverse impulse of `(speed + 60) * backMag * 1.6` is applied along the velocity direction, visibly pulling the ball back.
7. **Green slope forces** (legacy, on top of heightmap): per-cell seeded variation toward the hole during ground rolling.
8. **Curl**: continuous lateral force perpendicular to velocity during flight
9. **Sidespin**: initial velocity offset perpendicular to aim
10. **Wind**: continuous force while airborne, `heightBoost = min(1 + z/300, 1.8)`. Tuned so 10 mph crosswind ≈ 10-15 yd drift on a 230 yd drive. **Not shown in aim guides.**

### Club System
| Club | Max Yds | Launch | airMin | Behavior |
|------|---------|--------|--------|----------|
| Driver | 230 | 780 | 0.15 | Longest, runs out |
| 3 Wood | 195 | 680 | 0.18 | Long fairway |
| 5 Iron | 160 | 500 | 0.20 | Medium approach |
| 7 Iron | 120 | 420 | 0.22 | Short, controlled |
| P Wedge | 80 | 560 | 0.15 | High arc, soft landing |
| Putter | 40 | 0 | 999 | Ground only |

Putter is locked on the green and skipped off it.

### Course Design Philosophy
Every hole is a **5-second puzzle with one clear risk/reward decision**. Each course teaches one concept and escalates:

**Course 1 — Sunny Meadows** (core loop):
- *First Swing* par 3 — dead-simple intro, huge green, no hazards
- *The Fork* par 4 — split fairway, safe left vs risky right over sand
- *Go For It* par 5 — water bisects, lay up in 3 or reach in 2

**Course 2 — Oceanside Links** (water + angles):
- *Corner Cut* par 4 — dogleg with water on the inside
- *Island Green* par 3 — pure precision, no bailout
- *Peninsula* par 5 — snaking fairway between three water pockets

**Course 3 — Mountain Ridge** (precision + commitment):
- *The Chute* par 4 — ultra-narrow tree corridor
- *Serpent* par 5 — double dogleg with two water carries
- *Abyss* par 3 — tiny green over massive water

**Rules enforced in `courses.js`:**
- `treeLine` never overwrites fairway/green/tee/sand/water/path — trees can line playable terrain but never sit on it
- Every tee box has a strip of rough between it and the fairway
- Programmatic validation runs: every tee lands on `T.TEE` and every pin lands on `T.GREEN`

### Heightmap Generation (`generateHeights`)
- Low-resolution control grid every 15 cells, two octaves of hash noise, amplitude 60 + 20
- Bilinear interpolation with smoothstep `t*t*(3-2t)` for Perlin-style easing
- Terrain-type flattening: tees/greens ×0.1, fairway ×0.5, water forced to 0
- Result: rolling hills that the ball can actually roll on (drives #1 of the rolling physics)

### HUD (2D Canvas Overlay)
- **Top bar** (44px): dark pills — SHOTS counter (blue), HOLE + PAR boxes
- **Wind** (left): compact pill with orange directional arrow + speed
- **Club** (left): vertical stack with up/down arrows, club name + max yards
- **Spin** (right): glass circle with glowing red draggable dot
- **TAKE SHOT bar** (bottom): orange gradient button — full-width when no manual aim, narrower with Cancel when locked
- **Re-Aim button** (bottom-right during drag-back): restores overhead aim
- **Camera controls** (left): circular glass buttons (+/−/↻/↺/◎)
- **Aim guides**: cyan aim line, animated target rings, floating yardage pill, ball guide dots — all projected via `worldToScreen3D`
- **Drag-back circle**: pulsing dashed circle below ball + green glow trail while finger is down
- **Accuracy arc**: 40-segment fan with outer glow, inner ring, glowing center line (used for both shots and putts)
- **Putt guide**: glowing cyan curved line with arrow + distance in feet

### Screens
All use dark gradient backgrounds with glassmorphism panels:
- **Main Menu**: gradient bg, decorative circles, glass player card, gradient pill buttons with icons
- **Character**: circle color swatches, pill name buttons, large ball preview with glow
- **Career Select**: glass course cards with colored left accent, emoji icons, gold best-score pills, lock overlays
- **Hole Complete**: vignette overlay, glass card, large colored score name, gradient button
- **Round Complete**: glass scorecard panel, refined rows, gold/green unlock pills, gradient + ghost buttons

### Course Builder (builder.js)
Pure 2D canvas. Paint terrain types, place tee/hole, adjustable brush size, save to localStorage, test-play directly.

### Persistence
`localStorage` with `gt_` prefix: player data, custom courses, best scores per career course.

### Input System (engine.js)
- **One finger**: dispatched to game.js — target drag, camera pan, drag-back, putt drag, button taps
- **Two finger**: handled in engine.js — pinch zoom (camera height), twist rotate (orbit), drag pan
- Pinch also drives 3D camera via `zoomCamera3D` / `panCamera3D`
- `cam3dSkipLerp` flag prevents lerp from fighting manual pan

## Key Design Decisions

- **Hybrid rendering** — Three.js 3D for gameplay, 2D Canvas for menus/builder/HUD
- **Continuous heightmap mesh** — single PlaneGeometry with per-vertex heights, not per-cell meshes (massive perf win + smooth rolling hills)
- **Priority-based vertex colors** — majority vote among neighboring cells prevents blending artifacts at terrain boundaries
- **Drag-back mini-game** — the three-step shot flow gates the accuracy sweep behind a commitment gesture, matching Golf Clash's pacing
- **Slope-based rolling on all terrain** — heightmap gradient is sampled every frame, ball rolls downhill everywhere (not just greens)
- **Landing angle uses cos³** — aggressive enough to actually stop a wedge while letting a driver run out
- **No air drag** — clean physics. Club range = actual flight distance.
- **Wind as skill** — affects ball but NOT aim guides. Player must read compass and compensate.
- **Decisions over realism** — every hole is a 5-second puzzle with one clear risk/reward choice
- **Accuracy zones synced** — visual arc colors exactly match code thresholds (0.33 / 0.66)
- **Trees never on playable terrain** — `treeLine` guards against overwrites so courses stay readable
