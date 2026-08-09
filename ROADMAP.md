# Golf Tycoon — Roadmap (plan of record)

Locked after the codebase audit + genre research (Resort-tycoon trailer, GolfTopia
trailer + dev demo). Update this file when milestones ship or scope decisions change.

## Design pillars (decided, not up for casual re-litigation)

1. **Hand-authored course design is the core fantasy.** The player customizes
   every aspect — terrain, hazards, hole routing — with direct-manipulation
   tools (currently brush-based; brush vs tile granularity may be revisited).
   No fully procedural courses.
2. **Waypoints = designer intent, simulation = reality.** The hole wizard's
   hand-drawn polyline is the *intended line* (used for NPC aim routing and
   camera framing). A headless shot simulation computes what golfers *actually*
   achieve on that line — driving the trace preview, computed par, design
   score, and complaint generation. The gap between intent and simulation is
   the difficulty-tuning signal.
3. **Realistic, cozy RCT-style presentation.** No sci-fi boosters/gadgets
   (GolfTopia's "go crazy" lane) — revisit only after the core loop ships.
4. **Landscape-only, phone + tablet.**
5. **One headless shot simulator powers everything.** Trace preview, par,
   NPC golfers, complaints — all thin layers over the same physics that the
   player's own shots use. Never fork the physics.

## Key architecture facts (from the 3-agent audit)

- Ball physics is grid-agnostic (`terrainAt` = `floor(w/CELL)` on whatever
  grid `currentHole` points at) — it runs on the 120x80 world grid unchanged.
- Rendering fidelity issues are configuration (color pipeline, lights,
  shadows), not architecture. Scene is far under budget (~29 draw calls).
- Structural debt: 4,377-line game.js, ~127 globals, ad-hoc state machine,
  no save versioning, economy gated to the Manage screen, two hole schemas.

## GolfTopia parity run — status (gt1–gt163, autonomous polish loop)

Shipped by the looped polish sessions, guided mid-run by five user-provided
GolfTopia reference screenshots (island creator, in-game HUD, golfer
inspector, night scene, terrain tools). Every major element visible in
those references is now in the game.

- **World look**: painted albedo terrain (mow stripes, first cut, bunker
  bowls, crowned greens, terraces, cliff skirt), GolfTopia palette (dirt
  mottling via value noise, mossy greens, ~35% autumn forests), electric
  teal glowing shorelines, day/night cycle with golden-hour sun glow,
  crescent moon, starfield, rain system with wet ground
- **Night dressing**: neon hole-number tee signs, luminous green washes,
  warm lamp light pools, lighthouse beacon, fireflies
- **Life**: named golfers (12-name roster) playing real rounds with
  per-shot strokes, foursomes at 30+ members, spectator galleries during
  tournaments, real low-poly golfer character (Meshy, instanced), smooth
  turning, greeting hop on inspect, swing glints, celebration/freakout
  animations; visitors, cart (with courtesy honk), gulls over beaches,
  dragonflies over ponds, butterflies, leaves, buoys, sailboat
- **Golfer sim**: per-golfer skills (name-hash; Putter/Recovery/Driver
  genuinely shape scoring), needs (hunger/thirst) driving kiosk/stall
  purchases with emoji sale popups, moods with timestamped thought logs,
  freakouts (cost a member), membership tiers (Basic/Silver/Gold fee
  multipliers), record rivalries, rare par-3 holes-in-one
- **Competition**: daily noon–3PM tournament (par-relative leaderboard,
  rotating top-3 banner, rating-scaled purse, champions history + hall of
  fame in roster), per-hole play records (avg, % under par, course record
  + holder badges), score callouts (ACE/Eagle/Birdie/Par/Bogey)
- **Economy**: green fees by computed difficulty, stall sales, daily
  ledger with midnight upkeep (per-hole + decor %), Finances panel
  (today/yesterday/lifetime), balanced income curves (sim-verified),
  membership milestones, resort anniversaries, star rating (0–5 with
  next-star hint) feeding tournament purses
- **Player agency**: Create Your Island procedural generator (sliders,
  seed, fact sheet, starting-property picker) as the new-game flow, Buy
  Property parcels (dashed lines, escalating prices, shortfall hints),
  drag-to-move decor with placed-count badges, drag-to-aim tee/pin with
  live yardage, hole + resort renaming, double-tap flyovers, weather
  forecast panel, tournament countdown, speed controls (pause/1x/4x)
- **Audio** (all synthesized): wind, birdsong, crickets, frogs at pond
  nights, gull cries, rain patter, strike tocks, purchase chime,
  tournament fanfare, cart honk
- **Reliability**: quota-hardened saves, GPU leak-free terrain rebuilds
  (traverse dispose + per-build texture registry), veteran-save migration
  (all parcels granted), regression matrix harness (all screens × two
  viewports) kept green at checkpoints, design-only share codes
- **Pipeline**: commit-pinned jsDelivr releases, screenshot harness fleet,
  Meshy text-to-3d scripts (9 props + golfer + grandstand shipped)

### Parity run continued (gt194–gt221)
Shipped after the sim-rounds arc: wizard shot-trace overlay + brutal-carry
warning, per-hole Open/Closed, complaint pins/badge/aging + hole-card
flags, shuttle arrivals (toast-gated), per-facility sales books + vendor
cards, island biomes (creator chips, Manage switcher, tuned ambience:
wind/leaves/gulls), walkway path-routing for vendor detours, rain
umbrellas for playing golfers, birds-eye minimap (live golfer/complaint
layer, day/night tint + lamp dots, tap-to-fly, mute chip beside it),
course report + mood faces in the roster, record-break pin fireworks,
biome-themed tournaments with purse streaks, tee-queue arcs, bad-day
early departures + 6 AM fresh tee sheet, night ramp landing by 9 PM,
and two clean checkpoints (gt198 sim-leak fix, gt213 4x-speed audit).

### Parity run continued (gt222–gt276)
The economy became a real tycoon loop: land pacing measured and tuned
(\$750 base, 1.7x growth), affordability nudges, purchase celebrations,
the wizard/decor/waypoint surfaces all enforce ownership, and the
clubhouse grew into a three-tier ladder (bigger building, fee
multipliers, star rating, permanent member capacity — capacity now a
visible stat). Par went fully measured: the wizard plays three real
rounds per edit for its label ('plays ~N'), the Simulate button plays
real physics, and hillside golf was made fair (grabby rough, adaptive
sim golfers). The resort gained a daily rhythm — close of play at 9 PM,
empty course overnight (fees verified silent, shuttle held), fresh tee
sheet at 6 AM — and the NPCs became convincing: hole rotation, no
teleports (instrumented), pond-skirting walks for every class,
typed vendor runs (stalls sell food, kiosks drinks), grandstand
galleries, eagle applause, stacked name labels, live roster activity.
Robustness: idle autosave (offline-clock stamped), deleted holes clean
their records, share codes strip play history, dt-clamped movement,
2D-builder crash armor. Checkpoints gt230/gt246/gt263 + suites all
green.

### Parity run continued (gt277–gt295)
Lifecycle + designer-loop hardening: iOS audio resume and instant
background saves, weather-neutral hole ratings, unique golfer names at
scale (96 combos), skip-to-morning with its own onboarding toast,
share-code load confirmation, storage-denial survival, tournament
grandstand crowds + eagle applause, exhibition guards, in-place hole
layout editing (wizard reopens preloaded, records preserved), and the
gt294 staleness fix — non-paint taps (hole confirm/delete, open/closed
toggle) now rebuild the scene immediately, a latent bug since gt195.
Post-change full battery (matrix, land flow, NPC movement, edit flow)
all green at checkpoint gt295.

### Parity run continued (gt296–gt321)
First-impression + living-ball sprint. Load path: procedural island
icons/splash screen, two-phase heavy-asset swap, and grid-cluster GLB
decimation (golfer 2.3MB→392KB, grandstand 1.1MB→348KB — whole asset
set now under 3.5MB). Then the ball became real: every ambient strike
launches a visible arcing ball with vapor trail (gt305), landings hop
twice / splash in water / plug in sand with grit (gt306–307), approaches
trickle to the cup (gt308), putts roll on the ground (gt312), shots draw
and fade by driver skill (gt315), and bad rounds get a lip-out with a
green-side tantrum (gt318–319). Around it: dawn sprinklers on a 5:30–
7:30 window (gt309), pre-shot facing fix — stance, flash, and ball
departure finally agree (gt310), score-aware celebrations (gt311), golf
bags beside waiting players (gt313), divot flecks on full swings
(gt314), stiff-approach gallery murmurs + tournament applause (gt317),
hole-card recent-form sparkline (gt316), roster last-score chips
(gt320), and caddie tips on under-par finishes riding the fee pipeline
(gt321). Full matrix green at checkpoints gt304, gt309, gt313, gt317,
gt320. One save from a dead-code drift: a duplicate firefly system was
caught pre-commit in gt317 — fireflies already existed.

### Parity run continued (gt322–gt345)
Systems-depth sprint: weather, service, and consequence. Weather grew
teeth — heavy rain thins the field with a 30% per-hole-out quit roll
(gt327) that shelter amenities argue down to 8% (gt328), quitters
brolly-dash for the exit (gt329), rain pops puddle rings on the ground
(gt343), and dawn dew lays a sheen on the turf (gt323). Service became
theater: snack carts grew spaced queues (gt337), counter-facing +
a vendor-books regression fix the queue itself caused (gt338), and
one-at-a-time staged service (gt339). Consequence loops closed:
complaints follow up with concrete fix suggestions (gt330), boredom
speaks up and drives hole migration (gt345), caddie tips reward
under-par design (gt321) and show up separated in the finance panel
(gt324), and the top bar grew a live daily-net ticker (gt344).
Broadcast flavor: flyover lower-thirds (gt333) reused as a wizard
draft preview (gt336), NPC champions get fireworks + counted dynasties
(gt334-335), badges wear difficulty pips (gt340), the pin flag waves
(gt325), shuttle passengers ride in view (gt341), spectators track
flights (gt332), pre-shot crouch ritual (gt342), water's-edge ball
fishing (gt326). Perf: projection hot paths de-allocated (gt331).
Full matrix green at gt324, gt328, gt331, gt335, gt339, gt342, gt346.

### Parity run continued (gt346–gt365)
Two coherent arcs. The wind became one atmosphere (gt349–358): flights
draw crosswind drift, the weather chip reads direction+mph, the breeze
random-walks on the world clock, storms gust it upward, the playtest
flag turned wind sock, leaves/sprinkler spray/rain all ride the same
vector, and gulls fly downwind-stretched eggs. Then the membership
tier ladder got teeth (gt361–365): gold/silver/basic bags via
instance colors on exclusive geometry (VAO-safe), premium cart
pricing on the fee ladder, clubhouse tiers actually minting premium
members (Grand upsells half the basics, Lodge half the silvers —
verified 32/32/32 → 16/22/58), roster header medal counts, and a
gold-share purse bonus up to +30%. Around them: zoom-decrescendo UI
(nameplates gt347, popups gt348 — complaint pins tried and rejected,
camera default sits at 2600), difficulty pips on badges (gt340
lineage), fee shown on the hole card (gt360), onboarding refreshed
with both pillars (gt359), pacing re-audited healthy (parcel two
mid-day-two). gt350 milestone ran the full battery green; matrix
checkpoints gt354, gt358, gt362, gt366.

### Resolved in-house: skinned golfer animations (gt370)
The Mixamo wait ended by doing the rigging ourselves: headless Blender
(pip-installed bpy) builds a 10-bone rig over the shipped decimated
golfer — manual segment-distance weights with region guards (club tube,
pinned base slab, shoe exclusions) — and authors Idle / Walk / Swing
clips, exported as assets/meshy/golfer_rigged.glb (536KB, 3 clips).
Named route golfers upgrade to skinned clones with AnimationMixer
states (walkers stay instanced statics); strikes retrigger the Swing
from mid-coil. Build script preserved at tools/rig_golfer.py. Mixamo
FBX clips can still replace these later — the mixer wiring is done.

### Open thread: Mixamo skinned animations (superseded by gt370)
`assets/meshy/golfer_for_mixamo.obj` is committed for Mixamo auto-rigging.
When FBX clips (Idle, Walking, Golf Drive, Golf Putt + celebration;
FBX Binary, With Skin, 30fps) land in `assets/mixamo/`, convert via the
scratchpad fbx2gltf toolchain and replace the instanced static golfer with
per-character skinned meshes + AnimationMixer states (fallback to static
instancing on low-end devices).

## Milestones

### M1 — Foundation sprint (in progress)
- [x] Graphics config pass: sRGB + ACES tone mapping, hemisphere light,
      soft shadows, world heightmap for the overworld
- [x] Unify hole schema (`pin` vs `hole.hole`) + `playContext` indirection —
      physics becomes headless-callable, worldCourse holes become playable
      (Test Play button on the hole inspector card)
- [x] `tickWorld(dt)` unconditional in gameLoop + persisted world clock;
      `simulateRound` reads the player's resort, not legacy career courses
- [x] Save versioning + migrations ({__v, data} envelope; legacy saves load
      as v0 through per-key migration chains)
- [x] `setState()` with enter/exit hooks; onTouchStart monkey-patch removed
- [ ] Three.js version bump off r128 (before M3 NPC/facility investment)
- [ ] Split game.js along section-comment seams (last, after the above)

### M2 — The closed design loop (core delivered by the sim-rounds arc)
- [x] Headless sim of golfers along the hole (simulateHoleRound over the
      real physics; terrain edits invalidate + remeasure via terrainRev)
- [x] Computed par + difficulty from simulation (par = measured mean −0.6
      clamped 3-5; stars from strokes-over-par; replaces length/heuristic)
- [x] Test-play your own hole with the full shot sim (playtests count in
      records and tournaments)
- [x] Visual shot-trace preview overlay while designing (gt194: wizard
      shape step replays the hole with real physics on every design edit,
      throttled 1/sec; numbered landing dots + dashed trace + sim score
      in the readout; splashes marked, holed shot gold)
- [x] Per-hole Open/Closed status (gt195: chip toggle on the hole card;
      closed holes lose their shot arcs, pin beacon, stationed golfers,
      playing groups and green fees, and draw a CLOSED badge on the map)

### M2.5 — Economy grounding
- [x] Object costs + daily upkeep (decor priced, land parcels gate
      expansion, per-hole/decor/clubhouse-tier upkeep at midnight;
      terrain painting stays deliberately free — hand-authoring is the
      core joy per pillar 1, land is the cost gate instead)
- [x] Fun/score-based payouts replace the abstract coin formula
      (gt284: playtests pay green-fee scale, away rounds pay tour
      prizes, membership decoupled)
- [ ] Retire legacy career courses + 2D builder (~600-900 dead lines)

### M3 — Living resort (largely shipped by the parity run)
- [x] Persistent NPC golfers — names, skills, careers (rounds/best) in the
      course save; records and rivalries across sessions
- [x] Instanced low-poly NPC bodies (Meshy golfer, one InstancedMesh/part)
- [x] Route play with skill-based scoring scatter (duff/putt odds by skill)
- [x] Shuttle arrivals at the entrance (gt197: a shuttle rolls up the
      entrance drive every few in-game hours — more often as membership
      grows — honks, drops visitors who stroll up the walk, and departs;
      one reused group, zero per-arrival allocations)
- [x] Dynamic path-routing (gt202: BFS route helper over the walkway
      network; vendor detours and the walk back to the tee follow paths
      when both ends are near the network, beeline otherwise; one small
      route array per detour, nothing per-frame)
- [x] Headless-sim-driven NPC rounds (presimulated through the real
      physics via a throttled queue; statistical scoring is fallback only)

### M4 — Feedback & depth (largely shipped by the parity run)
- [x] Thought logs with mood deltas + timestamps (inspector), freakouts
- [x] Benches/gazebos as rest + rain shelter; needs drive stall purchases
- [x] Tournaments — daily event, leaderboard, purse, champions history,
      player can enter and win
- [x] Facility props placed as 3D objects (decor system)
- [x] Pinpointed complaint tracking (gt196: sim water/OOB penalties pin
      amber gripes at the actual splash cell, freakouts pin red where the
      tantrum happened; tap to read + acknowledge, unread pins age out
      after ~3 game hours; cap 12)
- [x] Per-facility stats panels (gt200: kiosks/stalls keep daily +
      lifetime sales books with an hourly histogram; tap one with the
      hand tool for an inspector card — sales today, lifetime revenue,
      busiest hour; daily books reset at the midnight ledger rollover)

### M5 — Atmosphere & expansion (largely shipped by the parity run)
- [x] Night cycle (signs, glows, lamp pools, moon, stars) — lighting is
      cosmetic, not yet a mechanic with upkeep
- [x] Map-generation sliders at new-game (Create Your Island)
- [x] Land expansion purchases (Buy Property parcels)
- [x] Biomes beyond the temperate island (gt201: Meadows / Autumn /
      Links chips in the island creator; the albedo painter tints wild
      terrain and the foliage system reshapes the canopy per biome —
      autumn floods with fall color, links thins the forest and doubles
      the rocks; play surfaces stay identical; veteran saves = Meadows)

## Deferred / parked decisions
- Brush vs tile placement granularity (revisit during M2 playtesting)
- Event bus + real entity system (add when NPC count actually hurts)
- Sci-fi obstacle lane (explicitly out for now)
