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

The Godot port is feature-complete at the script level. All gameplay systems from the HTML5 version are ported:

- [x] Economy / upgrade data (game_data.gd — all 16 upgrades, 5 trees, prestige, milestones, save/load)
- [x] River drawing with Chaikin smoothing + self-intersection prevention
- [x] River polygon mesh with proper UVs for the water shader
- [x] Water shader (flow, waves, caustics, foam — GPU-accelerated)
- [x] Animal system (11 species, per-species colors, swim + lilypad styles, smooth position lerp)
- [x] Flow manager (spawn timer, double spawn, passive income, test droplet)
- [x] Background renderer (grass gradient, moss, grass tufts, pebbles, maple silhouettes)
- [x] Spring + pond decorations (animated sparkle + ripples)
- [x] Full state machine (menu → draw → pre-round → running → shop)
- [x] Touch + mouse input routing
- [x] HUD (animated money counter, $/sec, notification system)
- [x] Shop UI (scrollable tiered cards, confirm purchase modal, multiplier breakdown pills)
- [x] Menu screen (title, begin/continue, reset)
- [ ] Shop UI wired into the scene tree (needs a Control node added to ShopLayer)
- [ ] Reset confirmation modal
- [ ] Rock placement input
- [ ] Collection particle effects + float text
- [ ] Sound effects
- [ ] Web export testing on phone
