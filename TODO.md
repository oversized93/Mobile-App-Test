# Golf Tycoon — TODO

## Completed Features

### 3D Rendering (NEW)
- [x] Three.js integration: 3D terrain, ball, flag, trees, water, skybox, shadows
- [x] Dual canvas: Three.js 3D behind, 2D canvas HUD overlay on top
- [x] 3D camera system: overhead, behind-ball, follow, scouting pan
- [x] Screen-to-world raycasting for target dragging in 3D
- [x] World-to-screen projection for aim guides overlay on 3D
- [x] Behind-ball view for accuracy meter (fan arc)
- [x] Behind-ball view for putting with glowing cyan guide line
- [x] Smooth camera transitions between modes
- [x] Camera panning with immediate response (no lerp shakiness)

### Core Gameplay
- [x] Golf Clash-style target-based aiming (drag target on course)
- [x] Target auto-places toward hole, clamped to club max range
- [x] One-finger drag: target = aim, elsewhere = pan 3D camera
- [x] Two-finger: pinch zoom (3D camera height)
- [x] Accuracy fan arc: colored green→yellow→red, sweeping arrow, tap to stop
- [x] Curl: drag left/right during accuracy arc to bend flight
- [x] Ball spin: topspin/backspin (affects roll), sidespin (curves flight)
- [x] Ball physics: airborne parabolic arc, physics-based distance matching
- [x] Air shots fly over water/trees/hazards (~85% air, ~15% roll)
- [x] Glowing putt guide with arrow and distance in feet
- [x] Putt direction via 3D raycasting (correct in behind-ball view)
- [x] Club system: 6 clubs with distinct range/launch/behavior
- [x] Auto club selection + manual switching (auto-repositions target)
- [x] Distance ring, aim line, accuracy rings projected on 3D
- [x] Wind system: random 1-13 mph, compass HUD, NOT in guides
- [x] Target repositions after every shot
- [x] Shot feedback: Perfect!/Great!/Good/Hook!/Slice!
- [x] Distance-based zoom (closer to hole = tighter zoom)

### Camera
- [x] Hole flyover at start of each hole (tap to skip)
- [x] Behind-ball camera for accuracy meter and putting
- [x] 3D camera panning (one-finger drag, immediate response)
- [x] Pinch-to-zoom (adjusts 3D camera height)
- [x] Camera resets between holes
- [x] Scouting skips auto-positioning to allow free pan

### Screens & UI
- [x] Main Menu, Character Creator, Career Select
- [x] Gameplay HUD (hole name, par, strokes, terrain, club bar, wind compass)
- [x] TAKE SHOT + Cancel buttons
- [x] Hole Complete + Round Complete scorecards
- [x] Zoom/rotate/recenter buttons

### Course & Builder
- [x] 3 career courses, 9 holes with proper par-length scaling
- [x] Course builder (2D canvas, terrain painting, save/load, test-play)
- [x] Career unlock progression

## Known Issues
- [ ] Camera resets to ball when finger is lifted after panning (scouting=false triggers auto-cam)
- [ ] Two-finger rotate not yet wired to 3D camera orbit
- [ ] Putt guide doesn't curve with green slopes yet (straight line only)

## Next Up

### Should Have
- [ ] **Persistent camera pan** — Don't snap back to ball on touch end, add recenter button instead
- [ ] **3D camera orbit** — Wire rotation buttons/two-finger twist to orbit 3D camera around ball
- [ ] **Curved putt guide** — Simulate green slopes in putt guide line
- [ ] **Putt accuracy mini-game** — Arrow alignment like Golf Clash putting
- [ ] **Overpower mechanic** — Drag target past max range, accuracy gets harder
- [ ] **Club upgrades** — Earn coins to level up clubs
- [ ] **More courses** — Desert, winter, tropical themes
- [ ] **Green slopes affecting ball** — Ball actually breaks toward slope during putts
- [ ] **Better 3D terrain** — Vertex colors, smooth edges, grass texture

### Nice to Have
- [ ] **Elevation/height map** — Uphill/downhill affects flight time and wind
- [ ] **Sound effects** — Shot, rolling, splash, hole-in-one
- [ ] **3D preview in builder** — Toggle 3D view of custom course
- [ ] **Multiplayer** — Turn-based head-to-head
- [ ] **Ball types** — Premium balls with stat bonuses
- [ ] **Course sharing** — Export/import JSON

## Design Decisions
- **Hybrid rendering** — Three.js 3D for gameplay, 2D Canvas for menus/builder/HUD. Best of both worlds.
- **Dual canvas overlay** — 2D canvas on top of Three.js for crisp HUD text and UI.
- **3D raycasting for input** — `screenToWorld3D` converts touches to ground plane hits for accurate target placement.
- **Immediate pan response** — `panCamera3D` moves camera position directly (not just target) to prevent lerp shakiness.
- **cam3dSkipLerp** — During scouting, position lerp is skipped so panning isn't fought by auto-positioning.
- **Physics-based flight** — Ball velocity calculated from air time so displayed range matches actual distance.
- **Wind as skill element** — Wind affects ball but NOT aim guides.
