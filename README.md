# Zen River

A top-down ASMR idle game set in a Japanese zen garden. Draw a single winding river from the spring to the pond — the river can't cross over itself — then watch koi and wildlife flow down it. Earn money based on how long each creature stays in the water. Spend earnings on multiplicative upgrades across 8 progression tiers, unlock rare species through two wildlife rarity trees, place obstacles to extend flow time, earn passive income from garden decorations, and prestige for a permanent multiplier.

## Branch Layout

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
index.html          Mobile shell, canvas, script tags
engine.js           Canvas, input, zen garden palette, lush grass background
river.js            River polyline drawing, Chaikin smoothing, filled polygon banks,
                    water particle system (flow blobs + caustics + bank foam),
                    self-intersection prevention, source spring, outlet pond
flow.js             Animal spawning, parametric flow, per-species rendering (11 species),
                    obstacle slowdown, smooth position lerping
shop.js             16 upgrades across 8 tiers, 5 rarity trees (25 levels),
                    multiplicative economy (5 compounding layers), prestige,
                    milestone notifications, offline earnings, confirm preview
game.js             Main loop, menu / play / shop / reset screens, HUD with animated
                    money counter + $/sec display, confirm purchase modal with
                    current→after preview, celebration banners, multiplier breakdown
IDLE-GAME-DESIGN.md The 7 idle game design tenets and how Zen River implements each
```

## Core Loop

1. **Draw the river** — drag from spring to pond in one continuous motion (self-overlap prevented)
2. **Test Flow** — send a glowing droplet to measure travel time, iterate as many times as you want
3. **Start Round** — lock the river, koi begin spawning and flowing
4. **Earn money** — payout = `base × koiMult × flowBonus × goldenCurrent × gardenHarmony × prestige`
5. **Upgrade** — spend on 8 tiers of multiplicative upgrades + 5 rarity trees
6. **Hit a wall** — progress slows, new tier becomes visible, milestone notification fires
7. **Prestige** — reset for ×1.5 permanent, blast through early game faster each run

## Controls

- **Drag from spring to pond** — draw the river (one continuous motion, can't cross itself)
- **Draw Again** — wipe the river and redraw before starting
- **Test Flow** — one glowing droplet, shows travel time
- **Start Round** — lock the river, animals begin flowing
- **Tap river with rock inventory** — place an obstacle
- **⚙ Shop** — buy upgrades, see confirm preview with current→after stats
- **⌂ Home** — return to menu

## Upgrade Tiers (8 tiers, 16 cards, 25 tree levels)

| Tier | Upgrades | Mechanic |
|---|---|---|
| Basics | Koi Value (×1.15/lvl), Spawn Rate, Flow Bonus (×1.12/lvl) | Multiplicative income |
| River | Wider River (+15%/lvl), Expand Garden (zoom out + redraw) | River scaling |
| Wildlife | Fish Tree (5 species), Lily Pad Tree (5 species) | Rarity + value escalation |
| Obstacles | Rock (+1 to place), Obstacle Tree (5 levels) | Stronger slowdowns |
| Garden | Garden Beauty (5 levels, passive $/s), More Springs (5 levels) | Passive income + spawn × |
| Advanced | Twin Springs (double spawn), Golden Current (×1.10), Swift Current | Meta-bonuses |
| Harmony | Garden Harmony (×1.08 to ALL income) | Meta-multiplier layer |
| Zen Mastery | Prestige (×1.5 compound reset) | Endgame loop |

## Wildlife Rarity Trees

### Fish (swimmers)
| LV | Species | Value | Weight | Cost |
|---|---|---|---|---|
| 1 | Goldfish | 2× | 35% | $300 |
| 2 | Catfish | 5× | 15% | $1,500 |
| 3 | Dragon Fish | 12× | 6% | $8,000 |
| 4 | Golden Koi | 30× | 2.5% | $40,000 |
| 5 | Spirit Fish | 80× | 1% | $200,000 |

### Lily Pad (riders)
| LV | Species | Value | Weight | Cost |
|---|---|---|---|---|
| 1 | Frog | 3× | 28% | $500 |
| 2 | Turtle | 8× | 12% | $2,500 |
| 3 | Duck | 15× | 6% | $12,000 |
| 4 | Crane | 40× | 2% | $60,000 |
| 5 | Panda | 100× | 0.8% | $300,000 |

## Water Rendering

The river uses a 4-layer particle system on a dark bed:
- **~180 surface blobs** — large (r=12-26px), very transparent (α=0.03-0.05), additive-blended. Where they overlap they accumulate into a bright turquoise surface.
- **~90 detail streaks** — small elongated ellipses oriented along the flow direction
- **~25 caustic highlights** — pulsing bright spots simulating light refraction
- **~40 bank foam** — white specs near the shoreline edges

River polyline is Chaikin-smoothed (2 iterations), rendered as filled polygons with organic-wobble bank outlines. Self-intersection is prevented during drawing by rejecting points within 90% of river width of earlier path points.

## Art Style

Japanese zen garden: lush mossy greens, basalt stones with moss caps, fiery autumn Japanese maple silhouettes, turquoise flowing water, koi pond with lily pads, parchment HUD with deep brown ink text. Per-species colors for all 11 animal types.

## Economy Design

All income is multiplicative across 5 compounding layers (see IDLE-GAME-DESIGN.md):
1. Base animal value (from species type + fish tree)
2. Koi Value multiplier (×1.15^level)
3. Flow time coefficient (0.3 × 1.12^level per second)
4. Golden Current (×1.10^level)
5. Garden Harmony (×1.08^level meta-multiplier)
6. Prestige (×1.5^level permanent)

Offline earnings at 50% efficiency. 7 milestone notifications at earning thresholds. Confirm purchase modal shows current→after stat + estimated income change.

## Roadmap

1. Audio — water babbling, koto ambient, chime on collection
2. Campaign mode — preset levels, score = money earned
3. Visual upgrades — animate Garden Beauty decorations on the board
4. Themes — dusk, cherry blossom, winter snow, night fireflies
5. More obstacle types — visual variety per obstacle tree level
6. Achievement system — one-time bonuses for milestones
7. WebGL water shader — flow-map texture scrolling for AAA water quality
