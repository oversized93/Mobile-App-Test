# Zen River — Godot 4 Port

ASMR idle river game ported to Godot 4 for Steam + mobile deployment with GPU-accelerated water shaders.

## Branch Layout

- `claude/zen-river` — HTML5 Canvas version (playable via browser)
- `claude/zen-river-godot` — **Godot 4 port (this branch)**
- `claude/create-iphone-game-u21nY` — Golf Tycoon
- `claude/asmr-marble-run` — Marble Flow

## Setup

1. Download [Godot 4.3+](https://godotengine.org/download) (standard, not .NET)
2. Clone this branch: `git clone -b claude/zen-river-godot <repo-url>`
3. Open Godot → Import → select the `project.godot` file
4. Hit Play (F5) to test in the editor
5. To test on phone: Project → Export → Web → Export Project → host the output

## Project Structure

```
project.godot              Project config (mobile-first, GL Compatibility)
scenes/
  main.tscn                Root scene — background, river, animals, HUD
scripts/
  game_data.gd             Autoload singleton — economy, upgrades, save/load
  main.gd                  State machine (menu/play/shop)
  river_drawer.gd          River drawing, smoothing, self-intersection, polygon mesh
  animal.gd                Individual animal flow + rendering (11 species)
shaders/
  water_flow.gdshader      GPU flow-map water shader (the reason we switched)
```

## Water Shader

The `water_flow.gdshader` does what was impossible in HTML5 Canvas:

- **Two-phase UV scrolling** along the river direction — seamless looping flow
- **Fractal noise waves** that distort the surface perpendicular to flow
- **Depth gradient** — darker at banks, lighter in center
- **Caustic highlights** — dancing light refraction patterns
- **Bank foam** — white noise at the river edges
- **Foam streaks** — bright lines flowing with the current

All running on the GPU at 60fps with zero CPU overhead.

## Current Status

Work-in-progress port. Core systems ported:
- [x] Economy / upgrade data (game_data.gd — all 16 upgrades, 5 trees, prestige)
- [x] River drawing with Chaikin smoothing + self-intersection prevention
- [x] River polygon mesh with proper UVs for the water shader
- [x] Water shader (flow, waves, caustics, foam)
- [x] Animal system (11 species, per-species colors, swim + lilypad styles)
- [ ] Animal spawning + flow manager
- [ ] HUD (money, $/sec, buttons)
- [ ] Shop screen with confirm modal
- [ ] Menu + reset screens
- [ ] Touch input wiring
- [ ] Sound effects
- [ ] Mobile export testing
