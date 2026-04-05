# Golf Tycoon — Architecture

## Overview
A mobile-first browser golf game combining Golf Clash-style drag-to-shoot gameplay with RollerCoaster Tycoon-style course building. Built as vanilla JS with HTML5 Canvas — no frameworks, no dependencies.

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
- `T.TREE` — ball bounces back
- `T.OOB` — out of bounds, ball resets + 1 stroke penalty
- Friction values in `TERRAIN_FRICTION` — applied per-frame as `velocity *= friction^(dt*60)`

### Camera (engine.js)
Smooth-follow camera with zoom. Key functions:
- `camTransform()` / `camRestore()` — push/pop canvas transform
- `screenToWorld()` / `worldToScreen()` — coordinate conversion
- `cam.targetX/Y/Zoom` — lerps toward targets each frame

### Input (engine.js)
Unified touch + mouse input. Sets global `touch` object.
Calls global `onTouchStart`, `onTouchMove`, `onTouchEnd` functions (defined in game.js).

### Ball Physics (game.js)
- Position + velocity model with per-terrain friction
- Sub-step collision to prevent tunneling through thin terrain
- **Airborne system**: balls launch into the air on shots >30% power (except putts). While airborne, balls fly over water, trees, and hazards. Gravity pulls them back down in a parabolic arc. On landing, speed is reduced and terrain is checked.
- Water/OOB trigger reset to last safe position + penalty stroke
- Tree collision: bounces ball backward on ground, drops with heavy speed loss from air
- Hole detection: ball within 6px of hole center at speed < 200 (ground only)

### Shot Mechanic (game.js)
Golf Clash style:
- Touch near ball to start aiming
- Drag BACK from ball — direction + distance = aim + power
- Dotted aim line + power meter + **landing zone indicator** showing estimated landing spot
- Release to shoot
- `takeShot(power, dirX, dirY)` applies velocity to ball, factors in club and wind

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
- **Manual switch**: tap arrows in the club bar to cycle
- **Distance ring**: dashed circle on course showing max range of selected club
- **Yards display**: club bar shows `Club (X yds)` + distance to hole with reach indicator

Distance conversion: `YDS_TO_WORLD = 3` (1 yard = 3 world units). All yard calculations use this constant.

### Wind System (game.js)
- Random wind generated per hole: 1-13 mph, random direction
- **HUD**: compass circle with directional arrow + mph readout (top-right corner)
- **Physics**: wind force applied to ball velocity on shot. Air shots affected ~4.5x more than ground shots.
- Players must manually aim into the wind to compensate

### Camera System (game.js)
- **Hole flyover**: at start of each hole, camera zooms out to show full layout, then pans to ball. Tap to skip.
- **Auto-follow**: camera tracks ball during shots, zooms in tighter on the green
- **Scouting**: drag anywhere (not on the ball) to pan camera and scout the hole. Release to snap back to ball.

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
- [x] Engine (canvas, input, camera, terrain, drawing helpers)
- [x] Career courses (3 courses, 9 holes with proper par-length scaling)
- [x] Course builder (paint, save, load, test play)
- [x] Ball physics with airborne system (fly over hazards)
- [x] Golf Clash drag-back-to-aim touch controls
- [x] Club system (6 clubs, auto-select, manual switch, distance ring)
- [x] Wind system (random per hole, compass HUD, physics effect)
- [x] Hole flyover + camera scouting
- [x] Landing zone indicator during aiming
- [x] All screens: menu, character creator, career select, gameplay HUD
- [x] Hole complete + round complete scorecard screens
- [x] Main game loop with state machine
- [x] Builder integration (menu → builder → test play → back)
- [x] Career progression (complete a course to unlock the next)
