# Golf Tycoon

A mobile-first browser golf game combining Golf Clash-style gameplay with RollerCoaster Tycoon-style course building. Hybrid rendering: Three.js 3D for gameplay, 2D Canvas for menus, builder, and HUD overlays.

## Features

- **3D gameplay** — continuous heightmap terrain, rolling hills, trees, water, skybox, shadows
- **Three-step shot flow** — overhead aim, TAKE SHOT, drag-back accuracy mini-game
- **Putting mini-game** — drag-back with slope-aware curved guide and accuracy sweep
- **Realistic ball physics** — slope-based rolling on all terrain, landing angle affects bounce, backspin checks back, multi-bounce drives
- **9 hand-designed holes** across 3 themed courses, each with a single clear risk/reward decision
- **Course builder** — paint terrain, place tee and hole, save to localStorage, test-play directly
- **Career progression** — unlock courses by finishing the previous one

## Running

Open `index.html` in any modern mobile browser or use a local web server. Three.js is loaded from a CDN at runtime — no build step required.

```
python3 -m http.server 8000
# then visit http://localhost:8000
```

## File Structure

```
index.html      Dual canvas setup, loads Three.js CDN + all scripts
engine.js       2D canvas, touch/mouse input, terrain constants, drawing helpers
courses.js      9 career holes across 3 courses with clear decision points
builder.js      Course builder (2D canvas — paint, save/load, test-play)
renderer3d.js   Three.js scene, heightmap terrain, camera system, raycasting
game.js         Game state, ball physics, shot mechanics, all screens, main loop
ARCHITECTURE.md Deep dive on systems and design decisions
TODO.md         Feature list and backlog
```

## Controls

- **One finger** — drag the target to aim, drag elsewhere to pan the camera, tap buttons
- **Two fingers** — pinch to zoom, twist to rotate, drag to pan
- **Taking a shot** — aim → TAKE SHOT → drag the ball back into the circle → release on the white line
- **Putting** — drag back from the ball on the green, release on the white line

## License

Personal project. No license granted.
