# Zen River — Gameplay Layer Map

A complete breakdown of every system, mechanic, and progression path currently implemented. Use this to brainstorm what to expand, rebalance, or add next.

---

## Layer 0: The Core Action

**What the player DOES:**
- Draw a single river path from the spring (top) to the pond (bottom) with one continuous finger drag
- The river can wind and curve but **cannot cross over itself** (self-intersection prevented)
- Once drawn, the river is locked until the player resets or buys Expand Garden

**What makes it interesting:**
- Longer, more winding rivers = more flow time = more money per animal
- The self-intersection limit forces creative routing within the available space

**Expansion ideas to discuss:**
- Can the player edit/extend the river mid-round?
- Should there be terrain obstacles (pre-placed rocks, hills) that force routing decisions?
- Multiple rivers that merge or split?
- River "quality" score based on smoothness/length?

---

## Layer 1: Base Income (Animals Flow Down the River)

**How it works:**
- Animals spawn at the spring on a timer
- They flow along the river centerline at a fixed speed (modified by upgrades)
- Each animal earns `baseValue × (1 + flowTime × flowCoefficient)` when it reaches the pond
- 11 animal species across 2 rarity trees (fish + lily pad riders)

**Animal species (Fish Tree — swimmers):**
| Species | Base Value | Speed | Spawn Weight | Unlock Cost |
|---|---|---|---|---|
| Koi | 1 | 1.0× | Always | Free |
| Goldfish | 2 | 1.05× | 35% | $300 |
| Catfish | 5 | 0.88× | 15% | $1,500 |
| Dragon Fish | 12 | 0.82× | 6% | $8,000 |
| Golden Koi | 30 | 0.78× | 2.5% | $40,000 |
| Spirit Fish | 80 | 0.7× | 1% | $200,000 |

**Animal species (Lily Pad Tree — riders):**
| Species | Base Value | Speed | Spawn Weight | Unlock Cost |
|---|---|---|---|---|
| Frog | 3 | 0.9× | 28% | $500 |
| Turtle | 8 | 0.55× | 12% | $2,500 |
| Duck | 15 | 0.78× | 6% | $12,000 |
| Crane | 40 | 0.6× | 2% | $60,000 |
| Panda | 100 | 0.4× | 0.8% | $300,000 |

**Expansion ideas:**
- Seasonal animals (cherry blossom season = bonus species)
- "Shiny" variants with 10× value at 0.1% chance
- Animals that interact with each other (schools, pairs)
- Boss animals that take 3 laps of the river

---

## Layer 2: Income Multipliers (5 Compounding Layers)

**The multiplication stack (this is what makes numbers explode):**

```
Final payout = base
  × Koi Value      (×1.15 per level, max 30)
  × Flow Bonus     (0.3 × 1.12^level per second of flow time)
  × Golden Current (×1.10 per level, max 10)
  × Garden Harmony (×1.08 per level, max 15)
  × Prestige       (×1.5 per reset, max 10)
```

**At level 10 across all multipliers with a 10-second river:**
- Koi Value: 4.05×
- Flow Bonus: ~10× (3.1 coefficient × 10s)
- Golden Current: 2.59×
- Garden Harmony: 2.16×
- Prestige (1 reset): 1.5×
- **Total: ~340× base value**

**Why it works:** Each layer compounds with all the others. A single upgrade to ANY layer multiplies the output of ALL other layers.

**Expansion ideas:**
- "Combo multiplier" for consecutive rare animals
- Time-of-day bonus (dawn/dusk = 2× for 5 minutes)
- "Lucky hour" random events
- Multiplier cap increases via prestige

---

## Layer 3: Obstacles (Slow Animals = More Flow Time)

**How it works:**
- Player buys rocks from the shop (each purchase = +1 in inventory)
- Tap the river to place a rock at that position
- Animals within the obstacle's range slow to a fraction of their speed
- Obstacle Tree upgrades make ALL placed obstacles stronger

**Obstacle Tree (5 levels):**
| Level | Type | Slow Factor | Range | Cost |
|---|---|---|---|---|
| Base | Rock | 35% speed | 3.5% of river | $80 each |
| 1 | Log | 28% speed | 4.5% | $400 |
| 2 | Whirlpool | 15% speed | 6% | $3,000 |
| 3 | Waterfall | 8% speed | 8% | $15,000 |
| 4 | Dam | 5% speed | 10% | $80,000 |
| 5 | Zen Bridge | 2% speed | 12% | $400,000 |

**Expansion ideas:**
- Obstacle placement strategy (spacing matters for maximum slowdown)
- Obstacles that BOOST speed (rapids) for a different strategy
- Obstacles that split the flow (animals take different sub-paths)
- Obstacle combos (rock + whirlpool near each other = eddy trap)
- Obstacle durability (they wear out and need replacement)

---

## Layer 4: Passive Income (Garden Beauty)

**How it works:**
- Garden Beauty Tree unlocks decorations that generate income per second
- Income is independent of animals — it runs even with no river drawn
- Multiplied by Garden Harmony + Prestige

**Garden Beauty Tree (5 levels):**
| Level | Decoration | Income/sec | Cost |
|---|---|---|---|
| 1 | Bamboo | $0.50/s | $200 |
| 2 | Bonsai Tree | $2.00/s | $1,000 |
| 3 | Stone Lantern | $8.00/s | $5,000 |
| 4 | Moon Bridge | $30.00/s | $25,000 |
| 5 | Torii Gate | $100.00/s | $150,000 |

**At max level: $140.50/s base × multipliers**

**Expansion ideas:**
- Visible decorations rendered on the garden (bamboo clusters, lanterns)
- Decoration placement mini-game (arrange them for beauty bonus)
- Rare decoration drops from milestone achievements
- "Garden score" that attracts rarer animals

---

## Layer 5: Spawn Rate (More Animals = More Throughput)

**How it works:**
- Spawn Rate upgrade makes the spawn timer faster
- Twin Springs upgrade gives 15% chance per level to spawn 2 at once
- More Springs Tree multiplies the effective spawn rate

**More Springs Tree (5 levels):**
| Level | Name | Spawn Multiplier | Cost |
|---|---|---|---|
| 1 | Second Spring | 2× | $2,000 |
| 2 | Third Spring | 3× | $10,000 |
| 3 | Golden Spring | 4× | $50,000 |
| 4 | Sacred Spring | 5.5× | $250,000 |
| 5 | Eternal Spring | 8× | $1,000,000 |

**Expansion ideas:**
- Visual: multiple spring openings at the top of the screen
- Each spring could spawn different animal types
- Spring "quality" affecting the value of animals it spawns
- Seasonal springs (only active during certain events)

---

## Layer 6: River Scaling (Expand Garden)

**How it works:**
- Expand Garden upgrade zooms everything out (view scale × 0.82 per level)
- This gives the player MORE ROOM to draw a longer, more winding river
- Forces a river redraw on purchase (intentional — redesigning the river is part of the fun)
- Very expensive (baseCost $2,000, scale 4.5×)

**Wider River upgrade:**
- +15% river width per level
- More visual space for animals to spread out

**Expansion ideas:**
- New terrain features unlocked at each expansion level
- The garden visually changes (more trees, flowers, decorations appear)
- Expansion milestones unlock new mechanics (bridges, waterfalls)
- Different garden "biomes" at high expansion levels

---

## Layer 7: Prestige (The Reset Loop)

**How it works:**
- Zen Mastery costs $50,000 (scales ×5 per level)
- Resets: money, river, all upgrades, all tree levels, rocks
- Keeps: prestige level (permanent ×1.5 compound multiplier)
- Each run through the game is faster than the last

**The prestige curve:**
| Run | Multiplier | Time to $50k | Player feeling |
|---|---|---|---|
| 1st | 1.0× | Long grind | "Finally made it" |
| 2nd | 1.5× | ~65% as long | "I know what to buy first" |
| 3rd | 2.25× | ~45% as long | "Speedrunning this" |
| 4th | 3.375× | ~30% as long | "Optimized" |

**Expansion ideas:**
- Prestige unlocks (new mechanics only available after first prestige)
- Prestige shop (spend prestige currency on permanent perks)
- Prestige challenges (reach $50k with specific constraints)
- "Transcendence" — a second prestige layer that resets prestige levels

---

## Layer 8: Pacing & Feedback (What the Player SEES)

**Milestone notifications (7 thresholds):**
| Earned | Message | What unlocks nearby |
|---|---|---|
| $50 | "Your garden begins to grow..." | Garden Beauty tree |
| $200 | "New wildlife spotted nearby" | Fish + Lilypad trees |
| $1,000 | "The river hums with life" | Spawner tree |
| $5,000 | "Advanced techniques revealed" | Advanced tier |
| $15,000 | "The garden approaches harmony" | Garden Harmony |
| $30,000 | "Zen mastery beckons..." | Prestige visible |
| $100,000 | "A legendary garden" | Deep progression |

**Visual feedback:**
- Animated money counter (rolls up smoothly, pulses on collection)
- Live $/sec display (updates every 0.5s)
- Confirm purchase modal (shows current → after stats + income change)
- Multiplier breakdown pills in shop header
- Float text payouts at the pond (+$X Ns)
- Maple-leaf burst particles on collection
- Celebration banners on wildlife tree unlocks

**Offline earnings:**
- 50% of estimated active income while the player is away
- "While you rested (Xm)... +$Y" popup on return

**Expansion ideas:**
- Achievement system (one-time bonuses for milestones)
- Daily login rewards
- Statistics screen (total animals, longest river, best $/s, etc.)
- Leaderboards (longest flow time, highest $/s)

---

## Layer 9: Water Rendering (The Aesthetic Core)

**Current implementation (Godot GPU shader):**
- Two-phase UV flow scrolling (seamless animated current)
- 3-octave fractal noise for surface wave distortion
- Depth gradient (dark banks → bright center)
- Caustic light refraction highlights
- Bank edge foam
- Surface foam streaks along the current
- Organic-wobble bank outlines (sine noise shorelines)
- Chaikin polyline smoothing (raw finger input → gentle curves)

**Expansion ideas:**
- Seasonal water themes (cherry blossom petals floating, autumn leaves, snow/ice)
- Day/night cycle affecting water color and lighting
- Rain effects (ripple circles on the water surface)
- Waterfall sections (visual + audio + speed boost zones)
- Reflections of nearby trees/decorations on the water surface

---

## The Full Stack (How Everything Connects)

```
PLAYER DRAWS RIVER (Layer 0)
       ↓
ANIMALS SPAWN + FLOW (Layer 1)
       ↓ slowed by
OBSTACLES (Layer 3)
       ↓ multiplied by
INCOME MULTIPLIERS (Layer 2) ← 5 compounding layers
       + 
PASSIVE INCOME (Layer 4) ← independent stream
       ↓ accelerated by
SPAWN RATE (Layer 5) ← more animals per second
       ↓ expanded by
RIVER SCALING (Layer 6) ← more room for longer rivers
       ↓ when progress stalls...
PRESTIGE (Layer 7) ← reset with permanent ×1.5
       ↓ shown via
FEEDBACK (Layer 8) ← $/sec, milestones, celebrations
       ↓ rendered with
WATER SHADER (Layer 9) ← the reason players stay
```

---

## What's NOT Built Yet (Potential New Layers)

| Idea | Type | Effort | Impact |
|---|---|---|---|
| Audio (water, koto, chimes) | Polish | Medium | Huge for ASMR |
| Campaign mode (preset levels + scoring) | Content | Large | Retention |
| Achievements (one-time bonuses) | Progression | Medium | Engagement |
| Seasonal events (cherry blossom, winter) | Content | Medium | Retention |
| Visible garden decorations | Visual | Medium | Satisfying |
| Day/night cycle | Visual | Small | Atmosphere |
| Second prestige layer | Progression | Medium | Longevity |
| Multiplayer leaderboards | Social | Large | Competition |
| Sound design | Polish | Medium | Huge for feel |
| Animated animal sprites | Visual | Large | Character |
| Tutorial / onboarding | UX | Small | Accessibility |
