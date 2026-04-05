# Golf Tycoon — TODO

## Completed Features

### Core Gameplay
- [x] Golf Clash drag-back-to-aim touch controls with power meter
- [x] Ball physics: ground friction per terrain, airborne parabolic arc
- [x] Air shots fly over water, trees, and hazards; land with bounce + roll
- [x] Club system: 6 clubs (Driver → Putter) with distinct power/launch/range
- [x] Auto club selection based on distance + manual switching via arrows
- [x] Max distance ring on course showing selected club's range
- [x] Landing zone indicator showing estimated ball landing spot while aiming
- [x] Wind system: random 1-13 mph per hole, compass HUD, affects ball physics
- [x] Hole flyover: camera shows full hole layout at start, tap to skip
- [x] Camera scouting: drag to pan and look ahead, release to snap back
- [x] Shot trail (dotted line showing ball path after each shot)

### Screens & UI
- [x] Main Menu with Play Career, Course Builder, Custom Courses, Character
- [x] Character Creator (name + ball color picker)
- [x] Career Select with lock/unlock, course info, best scores
- [x] Gameplay HUD (hole name, par, strokes, terrain, club bar, wind compass, quit)
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

## Next Up (improvements)

### Should Have
- [ ] **Terrain rendering polish** — Add subtle noise/texture to terrain, not just flat colors.
- [ ] **Shot accuracy/timing mechanic** — Golf Clash has a needle-swing timing element for shot accuracy. Could add similar skill gate.
- [ ] **Ball spin** — Top spin, back spin, and curl to add shot shaping.
- [ ] **Club upgrades** — Earn coins to level up clubs (increase range, accuracy, spin).
- [ ] **More courses** — Add 2-3 more career courses with unique themes.

### Nice to Have (future features)
- [ ] **Multiple holes in builder** — Build full 3+ hole courses, not just single holes.
- [ ] **Course sharing** — Export/import course JSON via copy-paste.
- [ ] **Elevation/slopes** — Terrain height that pulls the ball downhill.
- [ ] **Sound effects** — Shot hit, ball rolling, splash, hole-in-one fanfare.
- [ ] **Unlockable ball skins** — Earn new ball colors/patterns through career.
- [ ] **Leaderboard** — Local leaderboard per course.
- [ ] **Decorations in builder** — Benches, flowers, fountains (cosmetic only).
- [ ] **Undo in builder** — Undo/redo brush strokes.
- [ ] **Multiplayer** — Turn-based or real-time head-to-head via shared links.

## Design Decisions
- **Single HTML + JS files** — No build tools, no bundler, runs anywhere.
- **Emoji-free rendering** — All graphics drawn with Canvas 2D (shapes, not emoji) for consistent look across devices.
- **Golf Clash controls** — Drag backward from ball to aim. Power = drag distance. Simple and intuitive on mobile.
- **Grid-based terrain** — 16px cells (`CELL = 16`). Simple collision, easy to paint in builder.
- **Consistent yard system** — `YDS_TO_WORLD = 3` (1 yard = 3 world units). All distance calculations use this constant.
- **localStorage persistence** — Player data, custom courses, and best scores all saved locally with `gt_` prefix.
