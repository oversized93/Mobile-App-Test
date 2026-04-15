# Marble Flow — Japanese Zen Garden

An ASMR idle marble run for mobile browsers. Draw sumi-ink lines across a raked-sand garden and watch smooth river stones roll along them into a koi-pond collector. Earn money, expand your ink budget, and keep the flow going.

## Branch Layout

This repository hosts two parallel games on separate branches:

- `claude/create-iphone-game-u21nY` — **Golf Tycoon** (a 3D Golf Clash-style game)
- `claude/asmr-marble-run` — **Marble Flow** (this game, ASMR idle marble drawing)

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
engine.js    Canvas setup, input, zen palette, background, drawing helpers, save/load
ink.js       Player-drawn freehand lines (sumi-ink) with ink budget + erase
physics.js   Marble (stone) motion, segment collision, spawn/collect
shop.js      Money, upgrades, save format
game.js      Main loop, input handling, play/shop screens
```

## Controls

- **Drag anywhere** in the garden to draw a sumi-ink line
- **Tap a line** to erase it (refunds the ink)
- **Tap Release Stone** to drop a river stone from the bamboo spout
- **Tap the ⚙ button** to open the shop

Each line you draw costs ink proportional to its length. You start with 1400 ink and the *More Ink* upgrade adds 400 per level.

## Current MVP

- Freehand drawing with real-time collision (marbles react to the line you're drawing)
- Sand gradient background with raked-sand horizontal wave pattern
- Sumi-ink strokes with soft shadow + wet-ink highlight
- Bamboo spout spawner, wooden koi-pond collector
- River-stone marbles with smooth gradient shading
- Cherry-blossom petal particle bursts on collection
- 2D gravity physics with line-segment collision
- Shop with ink-budget and stone-value upgrades (auto-drop placeholder locked)
- Auto-save to `localStorage`
- All gameplay elements sized at 50% of the original prototype — twice the effective play area

## Roadmap

1. Audio — soft chime on collect, brush-stroke sound on draw, ambient koto loop
2. Idle mechanics — auto-drop interval, offline earnings
3. Stone variants — jade (×5), onyx (×10), with trails
4. More environment — koi fish in pond, bamboo leaves in wind, distant pagoda
5. Zen themes — dusk, cherry-blossom season, winter snow
6. Prestige — reset for a permanent multiplier
7. Multiple collectors — routing challenges with different payouts
