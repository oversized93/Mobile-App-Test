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

## GolfTopia parity run — status (gt1–gt48, autonomous polish loop)

Shipped by the looped polish sessions. The visual/ambience layer is far
ahead of the original milestone plan; economy depth (M2.5) is now the
biggest remaining gap.

- **Terrain**: painted albedo ground with mow stripes (diagonal), first-cut
  bands, teal fringe/tee trim, rake-lined recessed bunker bowls, crowned
  greens, terraced relief, rocky cliff skirt, sandy coastline coves
- **Atmosphere**: day/night cycle on the resort clock (golden hours, cool
  nights, sweeping sun shadows), gradient sky (fog bug fixed), night water
  dimming, path lamps, fireflies, lighthouse beacon
- **Life**: walking golfer pairs playing every hole (pause-to-swing,
  celebration hops), wandering visitors who rest at benches/gazebos and
  stop at kiosks, driving golf cart, hover groundskeeper bots, gulls,
  butterflies, drifting leaves, pond fountains with splash rings, bobbing
  buoys, circling sailboat
- **Signature look**: teal shot arcs with flying balls, pulsing pin rings,
  floating hole badges, glossy UI, navy hole inspector with stat bars,
  hole flyover camera, live 3D backdrops behind menu and manage screens
- **Player agency**: full decor system — 10 placeable props (Meshy-generated
  clubhouse, arch, kiosk, gazebo, windmill, lighthouse, fountain + Kenney
  bench/flowers/stall/cart), tap-to-rotate, erase, tap-target rings,
  build-mode grid overlay; brush sizes 1–11 cover tile-precise editing
- **Pipeline**: commit-pinned jsDelivr releases, screenshot harness with
  3-hole demo resort, Meshy text-to-3d pipeline scripts

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

### M2 — The closed design loop
- Shot-trace preview: headless sim of an average golfer along the waypoint
  line; painted terrain changes recalculate the trace
- Computed par + design score from simulation (replaces length-derived par)
- Per-hole Open/Closed status
- Test-play your own hole with the full shot sim (tap tee → play)

### M2.5 — Economy grounding
- Build costs per terrain/object; daily upkeep (needs world clock)
- Fun/score-based payouts replace the abstract coin formula
- Retire legacy career courses + 2D builder (~600-900 dead lines)

### M3 — Living resort
- Shuttle arrivals at the entrance; persistent NPC golfers (stats/skill/
  leveling across visits) stored in the save
- NPCs walk paths when available, cut across grass when not (dynamic
  path-routing rule); play open holes via the headless sim with skill-based
  scatter
- Instanced low-poly NPC bodies (single draw call for hundreds)

### M4 — Feedback & depth
- Thought bubbles + pinpointed complaint tracking (click complaint → map pin)
- Queues + benches; comfort systems
- Tournaments (simulated leaderboards first)
- Clubhouse + facility props as placed 3D objects with per-facility stats

### M5 — Atmosphere & expansion
- Night cycle + lighting-as-mechanic (lights, upkeep)
- Map-generation sliders at new-course creation (water level, hills, trees)
- Land expansion purchases; biomes

## Deferred / parked decisions
- Brush vs tile placement granularity (revisit during M2 playtesting)
- Event bus + real entity system (add when NPC count actually hurts)
- Sci-fi obstacle lane (explicitly out for now)
