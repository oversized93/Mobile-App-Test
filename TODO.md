# Golf Tycoon — TODO

## Completed Features

### Core Gameplay
- [x] Golf Clash-style target-based aiming (drag target on course to aim)
- [x] Target auto-places toward hole, clamped to club max range
- [x] One-finger drag: target = aim, elsewhere = pan camera
- [x] Two-finger: pinch zoom, twist rotate, drag pan (all simultaneous)
- [x] Accuracy meter: vertical bar, tap to stop marker at center, hook/slice on miss
- [x] Curl: drag left/right during accuracy meter to bend flight arc
- [x] Ball spin: topspin/backspin (affects roll), sidespin (curves flight)
- [x] Spin control ball UI with draggable dot
- [x] Ball physics: airborne parabolic arc, physics-based distance matching displayed range
- [x] Air shots fly over water/trees/hazards (~85% air, ~15% roll)
- [x] Ball guide line: predicted bounce/roll path shown as fading dots
- [x] Accuracy rings: 3 concentric circles around landing target
- [x] Green slope indicators: directional arrows showing break toward hole
- [x] Club system: 6 clubs (Driver → Putter) with distinct range/launch/behavior
- [x] Auto club selection + manual switching (auto-repositions target)
- [x] Max distance ring showing selected club's range
- [x] Wind system: random 1-13 mph per hole, compass HUD, affects ball physics
- [x] Wind NOT shown in aim guides (player must compensate manually — skill element)
- [x] Target repositions after every shot for approach/subsequent shots
- [x] Shot feedback: Perfect!/Great!/Good/Hook!/Slice!

### Camera
- [x] Hole flyover at start of each hole (tap to skip)
- [x] 360° camera rotation (two-finger twist + buttons)
- [x] Pinch-to-zoom (0.3x to 8x range)
- [x] Two-finger pan
- [x] One-finger pan (drag away from target to scout)
- [x] Rotation-aware panning (drag direction matches view orientation)
- [x] Manual zoom/rotate/recenter buttons (+/−/↻/↺/◎)
- [x] Manual zoom overrides auto-zoom until next shot
- [x] Auto-follow during ball flight, auto-zoom on green

### Screens & UI
- [x] Main Menu with Play Career, Course Builder, Custom Courses, Character
- [x] Character Creator (name + ball color picker)
- [x] Career Select with lock/unlock, course info, best scores
- [x] Gameplay HUD (hole name, par, strokes, terrain, club bar, wind compass)
- [x] TAKE SHOT + Cancel buttons when aim is locked
- [x] Hole Complete screen (score name, strokes vs par, running total)
- [x] Round Complete scorecard (per-hole breakdown, total, best score tracking)

### Course & Builder
- [x] 3 career courses, 9 holes with proper par-length scaling (par 3/4/5)
- [x] Course builder with terrain painting, brush sizes, tee/hole placement
- [x] Save/load custom courses to localStorage
- [x] Test-play custom holes directly from builder
- [x] Career unlock progression (complete a course to unlock the next)

### Polish
- [x] Water animation shimmer
- [x] Tree canopy detail rendering
- [x] Ball shadow + height visual when airborne
- [x] Green/red reach indicator on club bar
- [x] Canvas transform reset per frame (prevents rendering bugs)

## Next Up (improvements)

### Should Have
- [ ] **Overpower mechanic** — Drag target past max range, accuracy meter gets faster/harder. Risk/reward.
- [ ] **Club upgrades** — Earn coins to level up clubs (increase range, accuracy, spin capacity).
- [ ] **More courses** — Add 2-3 more career courses with unique themes (desert, winter, tropical).
- [ ] **Terrain rendering polish** — Add subtle noise/texture to terrain, not just flat colors.
- [ ] **Green slopes affecting ball** — Currently slopes are visual only. Make the ball actually break toward the slope direction during putts.
- [ ] **Better putting** — Add a ball guide line for putts that curves based on green slopes.

### Nice to Have (future features)
- [ ] **Multiple holes in builder** — Build full 3+ hole courses, not just single holes.
- [ ] **Course sharing** — Export/import course JSON via copy-paste or link.
- [ ] **Elevation/height map** — Uphill/downhill affects flight time and wind impact.
- [ ] **Sound effects** — Shot hit, ball rolling, splash, hole-in-one fanfare.
- [ ] **Unlockable ball skins** — Earn new ball colors/patterns through career.
- [ ] **Leaderboard** — Local leaderboard per course.
- [ ] **Decorations in builder** — Benches, flowers, fountains (cosmetic only).
- [ ] **Undo in builder** — Undo/redo brush strokes.
- [ ] **Multiplayer** — Turn-based or real-time head-to-head via shared links.
- [ ] **Tournaments** — Multi-round events with scoring across multiple courses.
- [ ] **Ball types** — Premium balls with wind resistance, extra spin, longer guide.

## Design Decisions
- **Single HTML + JS files** — No build tools, no bundler, runs anywhere via rawcdn.githack.com.
- **Canvas 2D rendering** — All graphics drawn with shapes (no emoji, no images) for consistent cross-device look.
- **Golf Clash-style controls** — Drag target on course to aim. Power = target distance. Accuracy = timing mini-game. Intuitive on mobile.
- **Grid-based terrain** — 16px cells (`CELL = 16`). Simple collision, easy to paint in builder.
- **Consistent yard system** — `YDS_TO_WORLD = 3` (1 yard = 3 world units). All distance calculations use this constant.
- **Physics-based flight** — Ball velocity calculated from air time so displayed range matches actual flight distance.
- **Wind as skill element** — Wind affects ball but NOT the aim guides. Player must read compass and compensate.
- **localStorage persistence** — Player data, custom courses, and best scores all saved locally with `gt_` prefix.
- **Separate aim vs execution** — Strategy phase (place target, set spin, choose club) is separate from execution phase (accuracy meter). Keeps both accessible.
