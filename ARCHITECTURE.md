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
- Water/OOB trigger reset to last safe position + penalty stroke
- Tree collision bounces ball backward
- Hole detection: ball within 6px of hole center at speed < 200

### Shot Mechanic (game.js)
Golf Clash style:
- Touch near ball to start aiming
- Drag BACK from ball — direction + distance = aim + power
- Dotted line shows shot direction, power meter shows strength
- Release to shoot
- `takeShot(power, dirX, dirY)` applies velocity to ball

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

### Course Builder (builder.js)
- Paint-based terrain editor with selectable brush size (1-3)
- Tool palette: all terrain types + Set Tee / Set Hole markers
- Save to localStorage under `gt_customHoles`
- Can test-play custom holes directly from builder

### Persistence
All save data uses localStorage with `gt_` prefix:
- `gt_player` — player name, ball color, unlocked courses
- `gt_customHoles` — array of saved custom hole data

## Current Status
All core systems are implemented and playable:
- [x] Engine (canvas, input, camera, terrain, drawing helpers)
- [x] Career courses (3 courses, 9 holes)
- [x] Course builder (paint, save, load)
- [x] Ball physics and shot mechanics
- [x] Golf Clash drag-back-to-aim touch controls
- [x] All screens: menu, character creator, career select, gameplay HUD
- [x] Hole complete + round complete scorecard screens
- [x] Main game loop
- [x] Builder integration (menu → builder → test play → back)
- [x] Career progression (complete a course to unlock the next)
