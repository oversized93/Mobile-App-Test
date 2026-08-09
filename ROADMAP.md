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

### Open thread: Mixamo skinned animations
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
- Build costs per terrain/object; daily upkeep (needs world clock)
- Fun/score-based payouts replace the abstract coin formula
- Retire legacy career courses + 2D builder (~600-900 dead lines)

### M3 — Living resort (largely shipped by the parity run)
- [x] Persistent NPC golfers — names, skills, careers (rounds/best) in the
      course save; records and rivalries across sessions
- [x] Instanced low-poly NPC bodies (Meshy golfer, one InstancedMesh/part)
- [x] Route play with skill-based scoring scatter (duff/putt odds by skill)
- [x] Shuttle arrivals at the entrance (gt197: a shuttle rolls up the
      entrance drive every few in-game hours — more often as membership
      grows — honks, drops visitors who stroll up the walk, and departs;
      one reused group, zero per-arrival allocations)
- [ ] Dynamic path-routing (walk paths when available, cut grass when not)
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
- [ ] Biomes beyond the temperate island

## Deferred / parked decisions
- Brush vs tile placement granularity (revisit during M2 playtesting)
- Event bus + real entity system (add when NPC count actually hurts)
- Sci-fi obstacle lane (explicitly out for now)
