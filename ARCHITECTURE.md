# Golf Tycoon — Architecture

## Overview
A mobile-first browser golf game combining Golf Clash-style gameplay with RollerCoaster Tycoon-style course building. Built as vanilla JS with HTML5 Canvas — no frameworks, no dependencies.

## File Structure

```
index.html      — Entry point. Loads all scripts, sets up canvas.
engine.js       — Core engine: canvas, input, camera, terrain types, drawing helpers.
courses.js      — Pre-built career course data (9 holes across 3 courses).
builder.js      — Course builder UI and logic (paint terrain, place tee/hole, save/load).
game.js         — Game state, ball physics, shot mechanics, screens, and main loop.
```

## Script Load Order
Scripts must load in this order (each depends on the previous):
1. `engine.js` — defines globals: canvas, ctx, terrain constants, camera, input, helpers
2. `courses.js` — uses `makeGrid`, `fillRect`, `fillCircle` and terrain constants from engine
3. `builder.js` — uses terrain constants, drawing helpers, and grid utilities
4. `game.js` — uses everything above; contains the main game loop

## Key Systems

### Terrain (engine.js)
Grid-based terrain with 10 types. Each cell is `CELL` (16px) in world space.
- `T.FAIRWAY`, `T.GREEN`, `T.ROUGH` — normal play surfaces with different friction
- `T.SAND` — high friction (ball slows fast)
- `T.WATER` — ball resets + 1 stroke penalty
- `T.TREE` — ball bounces back (ground) or drops with speed loss (air)
- `T.OOB` — out of bounds, ball resets + 1 stroke penalty
- Friction values in `TERRAIN_FRICTION` — applied per-frame as `velocity *= friction^(dt*60)`

### Camera (engine.js)
Smooth-follow camera with zoom and **360° rotation**. Key functions:
- `camTransform()` / `camRestore()` — push/pop canvas transform (includes rotation)
- `screenToWorld()` / `worldToScreen()` — coordinate conversion (rotation-aware)
- `cam.targetX/Y/Zoom/Rot` — lerps toward targets each frame
- **Two-finger gestures**: pinch to zoom, twist to rotate, drag to pan (all simultaneous)
- Manual zoom/rotate/recenter buttons in HUD as fallback

### Input (engine.js)
Unified touch + mouse input. Sets global `touch` object.
- Single-finger: dispatched to `onTouchStart/Move/End` in game.js
- Two-finger: handled directly in engine.js for pinch-zoom, twist-rotate, and pan
- `pinching` flag prevents single-finger handlers from firing during two-finger gestures

### Ball Physics (game.js)
- Position + velocity model with per-terrain friction
- Sub-step collision to prevent tunneling through thin terrain
- **Airborne system**: velocity calculated from physics so flight distance matches displayed club range. `velocity = (targetDist * 0.85) / airTime`. Ball spends ~85% of distance in air, ~15% rolling.
- **Gravity**: constant `GRAVITY = 400` pulls ball down during flight
- **Curl**: continuous lateral force perpendicular to velocity during airborne flight, bends the ball's arc
- **Spin**: sidespin curves initial trajectory; topspin/backspin affects landing roll factor (0.1x backspin to 0.5x topspin)
- Water/OOB trigger reset to last safe position + penalty stroke
- Hole detection: ball within 6px of hole center at speed < 200 (ground only)

### Shot Flow (game.js) — Golf Clash Style
Three-step process for full shots:

**Step 1 — Aim:**
- A target (crosshair + accuracy rings) auto-places toward the hole at club max range
- Player drags the target to aim — target clamped within club's max range
- Dragging anywhere else pans the camera
- Aim line, landing zone, ball guide, and distance ring all visible
- Can switch clubs (auto-repositions target), adjust spin
- Release target to lock aim → TAKE SHOT button appears

**Step 2 — Confirm:**
- TAKE SHOT + Cancel buttons visible
- Can still adjust spin or re-drag target
- Tap TAKE SHOT to proceed to accuracy meter

**Step 3 — Accuracy Meter:**
- Vertical meter on right side of screen
- Marker sweeps downward toward center target line
- Tap to stop — center = Perfect!, off-center = hook/slice (up to 17° deviation)
- During sweep, drag left/right to apply curl (bends flight arc)
- Shows Perfect!/Great!/Good/Hook!/Slice! feedback

**Putts** (on green): separate mechanic — drag back from ball to aim, release to putt. No accuracy meter, no curl.

### Club System (game.js)
6 clubs with distinct characteristics:
| Club | Max Yards | Behavior |
|------|-----------|----------|
| Driver | 230 | Longest, high launch — tee shots |
| 3 Wood | 195 | Long fairway shots |
| 5 Iron | 160 | Medium approach |
| 7 Iron | 120 | Short, controlled |
| P Wedge | 80 | High arc, short game |
| Putter | 40 | Ground only — auto-selected on green |

Each club has: `maxPower`, `launch` (air height), `airMin` (minimum power % to go airborne), `maxYds`.

- **Auto-select**: picks shortest club that reaches the hole after each shot
- **Manual switch**: tap arrows in the club bar to cycle (auto-repositions target)
- **Distance ring**: dashed circle on course showing max range of selected club
- **Target clamping**: target can't be dragged beyond max range
- **Yards display**: club bar shows `Club (X yds)` + distance to hole with reach indicator

Distance conversion: `YDS_TO_WORLD = 3` (1 yard = 3 world units). All yard calculations use this constant.

### Spin System (game.js)
- **Spin control**: ball icon in bottom-right corner with draggable red dot
- **Topspin** (drag up): increases roll after landing (0.5x speed retained)
- **Backspin** (drag down): decreases roll (0.1x speed retained — ball checks up)
- **Sidespin** (drag left/right): curves initial ball trajectory perpendicular to aim
- **Curl** (separate from spin): applied during accuracy meter by dragging left/right. Continuous lateral force during flight that bends the arc. Used for doglegs and shaping around obstacles.
- Spin resets after each shot

### Wind System (game.js)
- Random wind generated per hole: 1-13 mph, random direction
- **HUD**: compass circle with directional arrow + mph readout (top-right corner)
- **Physics**: wind force applied to ball velocity on shot. Air shots affected ~4.5x more than ground shots
- **Skill element**: wind is NOT factored into aim guides — player must read the compass and manually offset their aim to compensate

### Camera System (game.js + engine.js)
- **Hole flyover**: at start of each hole, camera zooms out to show full layout, then pans to ball. Tap to skip.
- **Auto-follow**: camera tracks ball during shots, zooms in tighter on the green
- **Manual pan**: one-finger drag (not on target) pans camera to scout the hole
- **Two-finger**: pinch zoom (0.3x–8x), twist rotate (360°), drag pan — all simultaneous
- **Buttons**: +/−/↻/↺/◎ for zoom, rotate, and recenter
- **Manual zoom override**: user zoom persists until next shot, then auto-zoom resumes
- **Rotation-aware panning**: drag direction accounts for camera rotation angle

### Visual Indicators
- **Accuracy rings**: 3 concentric circles around the landing target showing dispersion zones
- **Ball guide line**: fading dots after the landing zone showing predicted bounce/roll path (accounts for spin)
- **Green slope arrows**: subtle directional arrows on the green showing break toward the hole
- **Landing zone crosshair**: target with crosshair lines, center dot
- **Distance ring**: dashed circle at club's max range
- **Shot trail**: dotted line showing ball's actual path after each shot

### Course Data (courses.js)
Each hole is:
```js
{
    grid: number[][],  // 2D array of terrain type IDs
    cols: number,
    rows: number,
    tee: { x, y },    // grid coordinates
    hole: { x, y },   // grid coordinates
    par: number,
    name: string
}
```
Career courses are arrays of holes grouped into named courses.
- Par 3s: ~25 cells tee-to-hole (reachable in 1 iron shot)
- Par 4s: ~50 cells (driver + iron approach)
- Par 5s: ~65-70 cells (driver + long iron + short iron)

### Course Builder (builder.js)
- Paint-based terrain editor with selectable brush size (1-3)
- Tool palette: all terrain types + Set Tee / Set Hole markers
- Save to localStorage under `gt_customHoles`
- Can test-play custom holes directly from builder

### Persistence
All save data uses localStorage with `gt_` prefix:
- `gt_player` — player name, ball color, unlocked courses
- `gt_customHoles` — array of saved custom hole data
- `gt_best_N` — best score per career course

## Current Status
All core systems are implemented and playable:
- [x] Engine (canvas, input, camera with rotation, terrain, drawing helpers)
- [x] Career courses (3 courses, 9 holes with proper par-length scaling)
- [x] Course builder (paint, save, load, test play)
- [x] Ball physics with airborne system, physics-based flight distance
- [x] Golf Clash-style target-based aiming with draggable landing zone
- [x] Accuracy meter (single-tap timing mini-game with hook/slice)
- [x] Curl system (drag during meter to bend flight arc)
- [x] Ball spin (top/back/side via spin control ball)
- [x] Ball guide line (predicted bounce/roll after landing)
- [x] Accuracy rings around landing target
- [x] Green slope indicators (directional arrows)
- [x] Club system (6 clubs, auto-select, manual switch, target clamping)
- [x] Wind system (random per hole, compass HUD, NOT shown in guides)
- [x] Hole flyover + 360° camera (pinch/twist/pan)
- [x] All screens: menu, character creator, career select, gameplay HUD
- [x] Hole complete + round complete scorecard screens
- [x] Builder integration (menu → builder → test play → back)
- [x] Career progression (complete a course to unlock the next)
