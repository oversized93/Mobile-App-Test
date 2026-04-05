# Golf Tycoon — TODO

## Remaining Work

### Done
- [x] Touch input handlers for aiming (Golf Clash drag-back mechanic + power meter)
- [x] Main Menu with Play Career, Course Builder, Custom Courses, Character
- [x] Career Select with lock/unlock, course info, best scores
- [x] Gameplay HUD (hole name, par, stroke count, terrain indicator, quit button)
- [x] Hole Complete screen (score name, strokes vs par, running total)
- [x] Round Complete scorecard (per-hole breakdown, total, best score tracking)
- [x] Main game loop with state machine
- [x] Builder integration (menu → builder → test play → back)
- [x] Character Creator (name + ball color picker)
- [x] Career unlock progression (complete course to unlock next)
- [x] Best scores display on career select
- [x] Shot trail (dotted line showing ball path)
- [x] Water animation shimmer + tree detail rendering

### Should Have (next improvements)
- [ ] **Hole overview** — Brief zoom-out to show full hole before first shot.
- [ ] **Terrain rendering polish** — Add subtle noise/texture to terrain.

### Nice to Have (future features)
- [ ] **Multiple holes in builder** — Build full 3+ hole courses, not just single holes.
- [ ] **Course sharing** — Export/import course JSON via copy-paste.
- [ ] **Wind system** — Random wind direction/speed that affects ball trajectory.
- [ ] **Elevation/slopes** — Terrain height that pulls the ball downhill.
- [ ] **Sound effects** — Shot hit, ball rolling, splash, hole-in-one fanfare.
- [ ] **Unlockable ball skins** — Earn new ball colors/patterns through career.
- [ ] **Leaderboard** — Local leaderboard per course.
- [ ] **Decorations in builder** — Benches, flowers, fountains (cosmetic only).
- [ ] **Undo in builder** — Undo/redo brush strokes.

## Design Decisions
- **Single HTML + JS files** — No build tools, no bundler, runs anywhere.
- **Emoji-free rendering** — All graphics drawn with Canvas 2D (shapes, not emoji) for consistent look across devices.
- **Golf Clash controls** — Drag backward from ball to aim. Power = drag distance. Simple and intuitive on mobile.
- **Grid-based terrain** — 16px cells. Simple collision, easy to paint in builder.
- **localStorage persistence** — Player data, custom courses, and best scores all saved locally.
