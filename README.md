# Zen River

A top-down ASMR idle game set in a Japanese zen garden. Draw a river from the spring to the pond, watch koi and wildlife flow down it, and earn money based on how long each creature stays in the water. Spend earnings on multiplicative upgrades across 8 progression tiers, unlock rare species, place obstacles to extend flow time, and eventually prestige for a permanent multiplier.

## Branch Layout

This repository hosts multiple parallel games on separate branches:

- `claude/create-iphone-game-u21nY` — **Golf Tycoon**
- `claude/asmr-marble-run` — **Marble Flow** (bouncing marble version)
- `claude/zen-river` — **Zen River** (this game)

## Running

```
python3 -m http.server 8000
# visit http://localhost:8000
```

No build step, no dependencies — plain HTML5 canvas + JavaScript.

## File Structure

```
index.html   Mobile shell, canvas, script tags
engine.js    Canvas, input, zen garden palette, background with moss + maple silhouettes
river.js     River polyline drawing + rendering, source spring, outlet pond
flow.js      Animal spawning, parametric flow, obstacles, per-species rendering
shop.js      16 upgrades across 8 tiers, 5 rarity trees, prestige, offline earnings
game.js      Main loop, menu / play / shop / reset screens, HUD, milestone system
```

## Core Loop

1. **Draw the river** — drag from spring to pond in one motion
2. **Test Flow** — send a droplet to measure travel time
3. **Start Round** — koi begin spawning and flowing
4. **Earn money** — each creature pays `base × koiMult × flowBonus × goldenCurrent × gardenHarmony × prestige`
5. **Upgrade** — spend on 8 tiers of multiplicative upgrades
6. **Hit a wall** — progress slows, new tier of upgrades becomes visible
7. **Prestige** — reset for a permanent 1.5× compound multiplier, blast through early game faster

## Controls

- **Drag from spring to pond** — draw the river
- **Draw Again** — wipe and redraw before starting
- **Test Flow** — one glowing droplet, shows travel time
- **Start Round** — lock the river, animals begin flowing
- **Tap river with rock inventory** — place an obstacle
- **⚙ Shop** — buy upgrades across 8 tiers
- **⌂ Home** — return to menu

## Upgrade Tiers (8 tiers, 16 cards, 25 tree levels)

| Tier | Upgrades | Mechanic |
|---|---|---|
| Basics | Koi Value (×1.15/lvl), Spawn Rate, Flow Bonus (×1.12/lvl) | Multiplicative income layers |
| River | Wider River (+15%/lvl), Expand Garden (zoom out + redraw) | River scaling |
| Wildlife | Fish Tree (5 species), Lily Pad Tree (5 species) | Rarity + value escalation |
| Obstacles | Rock (+1 to place), Obstacle Tree (5 levels) | Stronger slowdowns per level |
| Garden | Garden Beauty (5 levels, passive $/s), More Springs (5 levels) | Passive income + spawn multiplier |
| Advanced | Twin Springs (double spawn), Golden Current (×1.10), Swift Current | Meta-bonuses |
| Harmony | Garden Harmony (×1.08 to ALL income) | Meta-multiplier layer |
| Zen Mastery | Prestige (×1.5 compound reset) | Endgame loop |

## Wildlife Trees

### Fish (swimmers — koi-shaped, per-species colors)
| LV | Species | Value | Spawn weight |
|---|---|---|---|
| 1 | Goldfish | 2× | 35% |
| 2 | Catfish | 5× | 15% |
| 3 | Dragon Fish | 12× | 6% |
| 4 | Golden Koi | 30× | 2.5% |
| 5 | Spirit Fish | 80× | 1% |

### Lily Pad (riders — green pad + colored blob)
| LV | Species | Value | Spawn weight |
|---|---|---|---|
| 1 | Frog | 3× | 28% |
| 2 | Turtle | 8× | 12% |
| 3 | Duck | 15× | 6% |
| 4 | Crane | 40× | 2% |
| 5 | Panda | 100× | 0.8% |

## Art Style

Inspired by Japanese zen gardens — lush mossy greens, basalt stones with moss caps, fiery autumn Japanese maple silhouettes, turquoise flowing water with cross-stream ripples and foam flecks, koi pond with lily pads, parchment HUD with deep brown ink text.

## Roadmap

1. Audio — water babbling, koto ambient, chime on collection
2. Campaign mode — preset levels, score = money earned
3. Visual upgrades — animate Garden Beauty decorations on the board
4. Themes — dusk, cherry blossom, winter snow, night fireflies
5. More obstacle types — visual variety per obstacle tree level
6. Achievement system — one-time bonuses for milestones
