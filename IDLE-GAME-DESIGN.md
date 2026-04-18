# Idle Game Design — The 7 Tenets

How Zen River applies each principle from idle game design theory.

---

## 1. The Core Loop: Growth vs Cost

**Principle:** Generate resources → spend on upgrades → increase generation → repeat.

**How Zen River does it:**
- Koi flow down the river → earn money on collection
- Money buys upgrades that increase income rate, payout per koi, and spawn frequency
- Each purchase feeds back into faster earning
- The loop runs even when idle (passive income from Garden Beauty + offline earnings)

**Key tension:** Income and costs both scale exponentially, but costs scale slightly faster — this creates natural friction that makes upgrades feel earned, not given.

---

## 2. Exponential Growth (Why It Feels Good)

**Principle:** Income should multiply, not add. Each upgrade makes the NEXT upgrade more powerful because they compound.

**How Zen River does it:**

All income multipliers are multiplicative and stack with each other:

```
payout = base × koiMult × flowBonus × goldenCurrent × gardenHarmony × prestige
```

| Layer | Formula | At LV 10 |
|---|---|---|
| Koi Value | 1.15^level | 4.05× |
| Flow Bonus | 0.3 × 1.12^level (per second of flow) | ~3.1× coefficient |
| Golden Current | 1.10^level | 2.59× |
| Garden Harmony | 1.08^level | 2.16× |
| Prestige | 1.5^level | 1.5× per reset |

At level 10 across the board with a 10-second river: a base koi worth $1 pays ~$350.

**Why it works:** Early levels feel small (+15%), but suddenly one more purchase doubles your income because all the multipliers compound. That's the "numbers exploding" moment.

---

## 3. Exponential Costs (Why Progress Slows)

**Principle:** Each purchase costs more than the last. Eventually costs outpace income, creating walls.

**How Zen River does it:**

Every upgrade uses: `cost = baseCost × scale^level`

| Upgrade | Base Cost | Scale | LV 5 Cost | LV 10 Cost |
|---|---|---|---|---|
| Koi Value | $12 | 1.5× | $91 | $692 |
| Spawn Rate | $25 | 1.85× | $548 | $12k |
| Garden Harmony | $500 | 2.4× | $40k | $3.2M |
| Prestige | $50k | 5.0× | $156M | — |

**Why it works:** Early upgrades feel cheap and frequent. By level 8–10, each purchase takes real grinding — pushing the player toward the next tier of upgrades or toward prestige.

---

## 4. The Balance Problem (Walls → Breakthroughs)

**Principle:** The game should feel like you're *almost* stuck, then one smart upgrade pushes you forward.

**How Zen River does it:**

Deliberate walls at these totalEarned thresholds:

| Wall | Earned | What opens up | Breakthrough |
|---|---|---|---|
| Early | $50 | Garden Beauty (passive $/s) | Income while idle |
| First | $200 | Fish Tree + obstacle upgrades | First rare species doubles income |
| Mid | $1,000 | More Springs + lilypad tree | Spawn rate multiplied, new animals |
| Late | $5,000 | Advanced tier (golden/swift/twin) | Meta-multiplier stacking |
| Pre-prestige | $30,000 | Prestige visible | The "escape valve" |

**Milestone notifications** fire at each threshold so the player sees "New wildlife spotted nearby" — they know something just unlocked.

**Wildlife trees ARE the breakthroughs.** A single $300 Goldfish unlock doubles your effective income immediately. That's the "I was stuck, now I'm not" moment.

---

## 5. Prestige (Resetting as Progression)

**Principle:** When progress stalls, let the player reset for a permanent bonus. Each run is faster than the last.

**How Zen River does it:**

- **Zen Mastery** costs $50,000. Resets money, river, all upgrades except prestige level.
- Grants a permanent 1.5× compound multiplier on ALL income.
- Second prestige costs $250k but you earn 2.25× as much.
- Third costs $1.25M but you earn 3.375× as much.

**The prestige loop:**

| Run | Prestige × | Time to $50k | Feeling |
|---|---|---|---|
| 1st | 1.0× | Long grind | "Finally..." |
| 2nd | 1.5× | ~65% as long | "Faster this time" |
| 3rd | 2.25× | ~45% as long | "I know exactly what to buy" |
| 4th | 3.375× | ~30% as long | "Speedrun mode" |

**Why it works:** The player masters the early game through repetition. Each reset feels like progress because they're *better at the game* — they know the optimal upgrade order. That knowledge + the multiplier compounds into a satisfying loop.

---

## 6. Layered Systems (Compounding Complexity)

**Principle:** Don't rely on one generator. Stack systems so upgrades boost OTHER upgrades.

**How Zen River does it:**

```
Layer 1: Base animal value (Fish Tree species)
    ↓ boosted by
Layer 2: Koi Value multiplier + Flow Coefficient
    ↓ boosted by
Layer 3: Golden Current (×1.10 per level)
    ↓ boosted by
Layer 4: Garden Harmony (×1.08 meta-multiplier)
    ↓ boosted by
Layer 5: Prestige (×1.5 permanent)
```

**Plus orthogonal systems that don't multiply income directly:**
- More Springs (spawn multiplier → more animals per second)
- Obstacle Tree (stronger slowdowns → longer flow time per animal)
- Garden Beauty (passive income independent of animals)
- Twin Springs (double spawn chance)
- Swift Current (faster animal speed → more throughput)

**Why it works:** The player has to think about WHICH layer to invest in. Koi Value at level 5 is expensive, but Garden Harmony at level 1 is cheap and multiplies everything. That creates strategy.

---

## 7. Controlled Acceleration

**Principle:** Rapid early progress → friction → breakthrough → friction → prestige. The game should never feel stuck *forever* — just long enough to push the player toward the next decision.

**How Zen River paces the experience:**

| Phase | Time | Feeling | What happens |
|---|---|---|---|
| **Minutes 1–5** | Fast | "This is easy!" | Buy Koi Value, Spawn Rate. Money flows freely. |
| **Minutes 5–15** | Slowing | "Costs are going up..." | First wall. Fish Tree Goldfish ($300) breaks it. |
| **Minutes 15–30** | Medium | "So many options" | Wildlife trees, obstacles, garden beauty open up. Decision paralysis (in a good way). |
| **Minutes 30–60** | Slow wall | "I need something big" | Advanced tier + Harmony visible. Golden Current breaks the wall. |
| **Hour 1–2** | Grinding | "Almost there..." | Prestige becomes visible at $30k. Player pushes toward it. |
| **Prestige 1** | Reset! | "Let's go again" | 1.5× makes everything faster. Blast through early game in minutes. |
| **Prestige 2+** | Mastery | "I know the meta" | Optimal upgrade paths. Spirit Fish ($200k) and Panda ($300k) become reachable. |

**Offline earnings** keep the loop running even when the player isn't active — they come back to "+$X while you rested" and can make a purchase that was previously out of reach.

---

## Summary

The 7 tenets work together as a system:

1. **Core Loop** provides the activity
2. **Exponential Growth** provides the dopamine
3. **Exponential Costs** provide the friction
4. **Walls → Breakthroughs** provide the drama
5. **Prestige** provides longevity
6. **Layered Systems** provide strategic depth
7. **Controlled Acceleration** ties the pacing together

A well-tuned idle game makes the player feel like they're always *just about* to break through — and when they do, the next wall is already visible in the distance.

---

## Current Zen River Implementation Status

| Tenet | Status | Details |
|---|---|---|
| Core loop | ✅ Fully wired | Generate (koi flow) → spend (shop) → grow (multiplicative upgrades) → repeat |
| Exponential growth | ✅ 5 multiplier layers | Koi ×1.15, Flow ×1.12, Golden ×1.10, Harmony ×1.08, Prestige ×1.5 — all compound |
| Exponential costs | ✅ 16 upgrades + 25 tree levels | baseCost × scale^level, plus fixed-cost rarity trees |
| Walls + breakthroughs | ✅ 7 milestones | Notifications at $50/$200/$1k/$5k/$15k/$30k/$100k. Wildlife trees are breakthroughs. |
| Prestige | ✅ Zen Mastery | ×1.5 compound, resets all except prestige level. Each run faster than the last. |
| Layered systems | ✅ 5 income + 5 orthogonal | Income layers compound; obstacle/garden/spawner/speed/twin systems are orthogonal |
| Controlled acceleration | ✅ Full pacing | Offline earnings (50%), animated $/sec counter, confirm modal with income preview |

### UI Feedback (making the economy visible)

| Feature | Status |
|---|---|
| Animated money counter | ✅ Rolls up smoothly, pulses on collection |
| Live $/sec display | ✅ Below money pill, updates every 0.5s |
| Confirm purchase modal | ✅ Current→after stat, estimated income change, Buy/Cancel |
| Breakthrough celebrations | ✅ Full-width gold banner on wildlife tree unlocks |
| Multiplier breakdown | ✅ Small pills in shop header showing each active ×multiplier |
| Prestige preview | ✅ Shows permanent multiplier transition + warning |
| Milestone notifications | ✅ 7 thresholds with themed messages |

### River System

| Feature | Status |
|---|---|
| Chaikin polyline smoothing | ✅ 2 iterations on commit, 1 on draft preview |
| Filled polygon banks | ✅ Organic wobble shorelines, mossy edge strokes |
| Water particle system | ✅ 4 layers: surface blobs (additive), streaks, caustics, foam |
| Self-intersection prevention | ✅ Rejects points within 90% of width of earlier path |
| Smooth fish movement | ✅ Wide-span angle averaging, position lerping, gentle wobble |
| Stale cache flush | ✅ Samples + particles rebuild on river clear/commit |

## Tuning Levers

If the game feels too fast or too slow, adjust these:

- **Base costs** in `shop.js` UPGRADES — lower = faster early game
- **Scale factors** — higher = steeper walls
- **Prestige cost** ($50k) — lower = earlier prestige, more runs
- **Tree species costs** — these are the breakthrough price tags
- **Passive income rates** in GARDEN_TREE — higher = more idle-friendly
- **Spawner multipliers** in SPAWNER_TREE — higher = more throughput
- **Flow coefficient base** (0.3) — higher = more reward for long rivers
- **Offline efficiency** (50%) — higher = more AFK-friendly
