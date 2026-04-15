# Zen River

A top-down ASMR idle game. Draw a river from the spring at the top to the pond at the bottom, then watch koi glide down it. Each koi earns money based on how long it was in the river — longer, windier rivers mean bigger payouts.

## Branch Layout

This repository hosts multiple parallel games on separate branches:

- `claude/create-iphone-game-u21nY` — **Golf Tycoon**
- `claude/asmr-marble-run` — **Marble Flow** (ASMR bouncing marble version)
- `claude/zen-river` — **Zen River** (this game)

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
engine.js    Canvas, input, zen garden palette, background, save/load helpers
river.js     River polyline drawing + rendering, source spring, outlet pond
flow.js      Animal spawning, parametric flow along the river, rocks, payout
shop.js      Money, upgrades, save format
game.js      Main loop, state machine, menu / play / shop / reset screens
```

## Core Loop

1. **Draw the river** — press inside the spring opening at the top, drag in one fluid motion through the garden, release when you reach the pond at the bottom.
2. **Test Flow** — spawn a single glowing droplet to see how long your river takes. Iterate as many times as you want before committing.
3. **Start Round** — koi begin spawning from the spring and flow along your river. Each koi that reaches the pond pays out based on how long it was on the river.
4. **Upgrade** — spend earnings on spawn rate, koi value, flow multiplier, rocks (obstacles that slow koi down and extend flow time), and eventually **Expand Garden** — the big-ticket upgrade that scales the whole garden down, giving you more drawing room and forcing you to redraw.

## Controls

- **Drag from spring to pond** — draw the river (one continuous motion)
- **Draw Again** — wipe the river and try another route
- **Test Flow** — send one droplet to measure flow time
- **Start Round** — lock in the river and start earning
- **⚙ Shop** — buy upgrades
- **⌂ Home** — return to the main menu
- **Tap the river with a rock in inventory** — place a rock obstacle

## Animals

MVP ships with **koi** as the only real sprite. Placeholders exist in `ANIMAL_TYPES` for future species:

- Frog
- Turtle (slow, valuable — long flow time bonus)
- Lily pad passenger
- Rare visitor (big animal event)

Each future species will get its own sprite and spawn weighting in later commits.

## Upgrades

| Upgrade | Effect |
|---|---|
| Koi Value | +1 base payout per koi |
| Spawn Rate | Faster spawn interval |
| Flow Multiplier | +0.1 per-second bonus |
| Place Rock | +1 rock in inventory to place on the river |
| Expand Garden | Scales the garden down for more room, forces a redraw (expensive) |

## Roadmap

1. **Audio** — water babbling, koto ambient loop, soft chime on collection, splash on rock placement
2. **More animals** — wire up the placeholder species with unique sprites and behaviours
3. **Campaign mode** — preset levels with fixed animal counts, score = money earned converted to points, star ratings
4. **Offline earnings** — idle ticker runs while the tab is closed
5. **Themes** — dusk, autumn (more maple leaves), winter snow, cherry blossom spring
6. **More obstacles** — logs, lily pads that carry animals for a bonus, reeds that split flow
7. **Prestige** — reset for a permanent multiplier, zen-themed progression metaphor

## Current Status

Work-in-progress. The rendering, physics, shop, and save systems are in place; `game.js` (main loop and screens) is still being written and will land in a follow-up commit.
