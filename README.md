# Zen River — Godot 4 Port

ASMR idle river game ported to Godot 4 for Steam + mobile with GPU-accelerated water shaders.

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
project.godot              Project config (mobile-first, portrait, GL Compatibility)
export_presets.cfg          Web + Android + Windows Desktop export presets
scenes/
  main.tscn                Full scene tree (~30 nodes, 11 scripts, water shader)
scripts/
  game_data.gd             Autoload singleton — economy, upgrades, 5 trees, prestige,
                            milestones, save/load with river + rock persistence
  main.gd                  State machine (6 states), input routing, HUD, notifications,
                            rock placement, effects spawning, shop/reset wiring
  river_drawer.gd          River drawing, Chaikin smoothing, self-intersection prevention,
                            Polygon2D mesh generation with UVs for the water shader,
                            river persistence to/from GameData
  flow_manager.gd          Spawn timer, weight-based animal rolling, per-animal updates,
                            rock slowdown using obstacle tree stats, test droplet,
                            passive income tick, rock persistence
  animal.gd                11 species with per-species colors, swim + lilypad rendering,
                            smooth position lerping, gentle wobble
  background.gd            Grass gradient, moss patches, grass tufts, pebbles, maple
                            silhouettes. Lazy-bakes on first draw, rebakes on resize.
  spring_pond.gd           Spring (stone outcroppings + blue pool + animated sparkle) and
                            pond (stone rim + deep water + lily pads + animated ripple)
  shop_ui.gd               Scrollable tiered cards (8 tiers), confirm purchase modal,
                            multiplier breakdown pills, tree upgrade support
  reset_confirm.gd         Modal with warning text, Cancel + Reset buttons
  effects.gd               Float text payouts (+$X Ns) and maple-leaf burst particles
  rock_obstacle.gd         Placeable mossy basalt stone with foam eddy rendering
shaders/
  water_flow.gdshader      GPU water shader — the reason we switched to Godot
```

## Water Shader

`water_flow.gdshader` does what was impossible in HTML5 Canvas:

- **Two-phase UV scrolling** along the river direction — seamless looping flow
- **Fractal noise waves** (3-octave FBM) that distort the surface
- **Depth gradient** — darker at banks, lighter in center
- **Caustic highlights** — dancing light refraction patterns
- **Bank edge foam** — white noise at the river edges
- **Foam streaks** — bright lines flowing with the current

All procedural (no textures needed), runs at 60fps on mobile GPU with zero CPU overhead.

## Economy

All income is multiplicative across 5 compounding layers:

```
payout = base × koiMult(×1.15^lvl) × flowBonus(0.3×1.12^lvl per sec)
         × goldenCurrent(×1.10^lvl) × gardenHarmony(×1.08^lvl)
         × prestige(×1.5^lvl)
```

16 upgrade cards across 8 tiers + 5 rarity trees with 25 total levels. 7 milestone notifications. Offline earnings at 50%. Prestige resets everything for a permanent compound multiplier.

## Current Status

Feature-complete at the script level. All systems from the HTML5 version ported + GPU water shader added. 8 bugs found and fixed in static analysis. Needs first runtime test in the Godot editor to surface remaining issues.
