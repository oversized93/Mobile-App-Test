# Marble Flow

An ASMR idle marble run builder for mobile browsers. Place ramps, curves, and funnels on a grid; drop marbles; watch them roll into the collector and earn money. Spend money on more pieces and upgrades. Expand the loop over time.

## Branch Layout

This repository hosts two parallel games on separate branches:

- `claude/create-iphone-game-u21nY` — **Golf Tycoon** (a 3D Golf Clash-style game)
- `claude/asmr-marble-run` — **Marble Flow** (this game, ASMR idle marble run)

Each branch has its own `index.html` and its own JS modules. They do not share code.

## Running

Open `index.html` in any modern mobile browser, or use a local HTTP server:

```
python3 -m http.server 8000
# then visit http://localhost:8000
```

No build step, no dependencies — plain HTML5 canvas + JavaScript.

## File Structure

```
index.html   Mobile shell, canvas, script tags
engine.js    Canvas setup, input, grid, drawing helpers, save/load
pieces.js    Piece type definitions and placed-piece state
physics.js   Marble motion, segment collision, spawn/despawn
shop.js      Money, upgrades, save format
game.js      Main loop, input handling, play/shop screens
```

## Controls

- **Tap a piece** in the bottom picker to select it
- **Tap an empty grid cell** to place the selected piece
- **Double-tap a placed piece** to rotate 90°
- **Long-press a placed piece** to remove it
- **Tap Drop Marble** to spawn a marble at the spawner
- **Tap the ⚙ button** to open the shop

## Current MVP

- 3 piece types: Ramp, Curve, Funnel
- Fixed spawner (top) and collector (bottom-right)
- 2D gravity physics with line-segment collision
- Shop with piece-slot and marble-value upgrades
- Auto-save to `localStorage`

## Roadmap

Layered in over future commits, without refactoring the core loop:

1. Audio — click on place, chime on earn, calm ambient loop
2. Idle mechanics — auto-spawn interval, offline earnings
3. More pieces — splitter, accelerator, loop, bumper, teleporter
4. Marble upgrades — gold (×5), rainbow (×10), trails
5. Particle polish — bursts on earn, sparkle trails
6. Themes — neon, zen garden, space
7. Prestige — reset for a permanent multiplier
8. Multiple collectors with different payouts
