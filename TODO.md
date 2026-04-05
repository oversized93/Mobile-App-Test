# Golf Tycoon — TODO

## Remaining Work

### Must Have (game isn't playable without these)
- [ ] **Touch input handlers for aiming** — Wire up `onTouchStart/Move/End` in game.js for the Golf Clash drag-back-to-aim mechanic. Show dotted aim line + power meter while dragging.
- [ ] **Screen: Main Menu** — Title, Play Career, Course Builder, Character buttons.
- [ ] **Screen: Career Select** — Show 3 courses (Sunny Meadows, Oceanside Links, Mountain Ridge) with lock/unlock state. Tap to start a round.
- [ ] **Screen: Gameplay HUD** — Hole name, par, stroke count, minimap.
- [ ] **Screen: Hole Complete** — Show strokes vs par, score name (birdie/bogey/etc), "Next Hole" button.
- [ ] **Screen: Round Complete** — Scorecard for all holes, total vs par, save best score.
- [ ] **Main game loop** — `requestAnimationFrame` loop that dispatches to the correct screen's update/draw based on `state`.
- [ ] **Builder integration** — Menu → Builder → test play → back to menu flow.

### Should Have (makes it way better)
- [ ] **Character Creator** — Pick name and ball color before career.
- [ ] **Career unlock progression** — Complete course 1 to unlock course 2, etc.
- [ ] **Best scores display** — Show personal best per course on career select.
- [ ] **Hole overview** — Brief zoom-out to show full hole before first shot.
- [ ] **Shot trail** — Fading dotted line showing ball's path after each shot.
- [ ] **Terrain rendering polish** — Add subtle noise/texture to terrain, not just flat colors.

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
