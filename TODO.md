# Golf Tycoon — TODO

## Completed Features

### 3D Rendering
- [x] Three.js integration: terrain mesh, ball, flag, trees, water, skybox, shadows
- [x] Teal water ground plane — course surrounded by ocean
- [x] Gradient skybox blending to teal at horizon
- [x] Scattered cloud planes
- [x] Hole with white rim, dark interior, recessed cylinder
- [x] Trees with size variation, ~80% density, varied green colors
- [x] Dual canvas: Three.js behind, 2D HUD overlay on top
- [x] Behind-ball low-angle camera (dramatic ground-level view)
- [x] Overhead camera for aiming
- [x] Follow camera during ball flight
- [x] Camera panning with immediate response (no lerp shakiness)
- [x] Camera persists after pan (doesn't snap back)
- [x] Pinch zoom controls 3D camera height
- [x] Orbit buttons rotate 3D camera
- [x] Fog matches water for seamless horizon blending

### Core Gameplay
- [x] Golf Clash-style target aiming (drag target on course)
- [x] Animated concentric ring target (rotating outer, pulsing middle)
- [x] Floating yardage pill near target
- [x] Target clamped to club max range
- [x] One-finger: target drag or camera pan
- [x] Two-finger: pinch zoom, twist rotate, drag pan
- [x] Accuracy fan arc (green/yellow/red zones, sweeping arrow)
- [x] Green zone = 0° deviation, yellow = 0-5°, red = 5-12°
- [x] Curl (drag L/R during arc, 15px dead zone)
- [x] Ball spin (top/back/side via control ball)
- [x] Physics-based flight distance — no air drag, clean math
- [x] Ball guide dots (bounce/roll prediction)
- [x] Green slope forces on ball + in putt guide simulation
- [x] Glowing curved putt guide with arrow + distance
- [x] Club system: 6 clubs, auto-select, compact left-side stack UI
- [x] Wind: random per hole, compact HUD, NOT in guides
- [x] Shot feedback: Perfect!/Great!/Good/Hook!/Slice!
- [x] Distance-based zoom
- [x] Hole flyover at start

### UI/UX (Polished)
- [x] Compact top bar (44px) — shot counter pill, HOLE + PAR boxes
- [x] Wind as compact left pill with orange arrow
- [x] Club selector as left-side vertical stack
- [x] Spin control with glowing red dot + glass background
- [x] TAKE SHOT slim bottom bar (orange gradient + ghost Cancel)
- [x] Camera control circles (glass style)
- [x] Aim line behind-camera clipping fix
- [x] Main Menu: gradient bg, decorative circles, glass card, gradient pill buttons with icons
- [x] Character: circle swatches, pill name buttons, glow ball preview
- [x] Career Select: glass cards, colored accents, gold best-score pills, lock overlays
- [x] Hole Complete: vignette, glass card, gradient button
- [x] Round Complete: glass scorecard, gold/green unlock pills
- [x] Accuracy arc: 40 segments, outer glow, inner ring, glow center line

### Course & Builder
- [x] 3 career courses, 9 holes with par-length scaling
- [x] Course builder (2D, terrain paint, save/load, test-play)
- [x] Career unlock progression

## Known Issues
- [ ] Green slopes funnel too strongly toward the hole — need more random, weaker slopes
- [ ] Putt guide curves too aggressively toward hole
- [ ] Ball on green auto-rolls into hole without needing to putt
- [ ] Terrain cell edges still slightly visible at certain camera angles

## Next Up

### Priority (gameplay feel)
- [ ] **Fix green slopes** — Make slope directions more random (not all toward hole), reduce force strength so putting requires skill
- [ ] **Putt accuracy mini-game** — Arrow alignment like Golf Clash putting (not just release)
- [ ] **Better course terrain** — Smoother edges, grass-like appearance, less pixelated

### Should Have
- [ ] **Overpower mechanic** — Drag target past max range, accuracy gets harder
- [ ] **Club upgrades** — Earn coins to level up clubs
- [ ] **More courses** — Desert, winter, tropical, links themes
- [ ] **Elevation/height map** — Uphill/downhill affects flight time and wind
- [ ] **Terrain textures** — Use Three.js texture maps for grass/sand/water instead of flat colors
- [ ] **Better 3D trees** — Multiple canopy layers, leaf detail
- [ ] **Course edge foam** — White foam/fringe where course meets water

### Nice to Have
- [ ] **Sound effects** — Shot, rolling, splash, hole-in-one
- [ ] **3D preview in builder** — Toggle 3D view of custom course
- [ ] **Multiplayer** — Turn-based head-to-head
- [ ] **Ball types** — Premium balls with stat bonuses
- [ ] **Course sharing** — Export/import JSON
- [ ] **Tournaments** — Multi-round events
- [ ] **Replay system** — Watch your shot from different angles
- [ ] **Mountains/scenery** — Background geometry visible from behind-ball view

## Design Decisions
- **Hybrid rendering** — Three.js 3D for gameplay, 2D Canvas for menus/builder/HUD
- **Dual canvas overlay** — 2D on top of Three.js for crisp HUD text
- **3D raycasting for input** — `screenToWorld3D` for accurate target placement
- **Immediate pan** — `panCamera3D` moves position directly, `cam3dSkipLerp` prevents lerp fights
- **No air drag** — Clean physics. `velocity = distance / time`. Club range = actual flight distance.
- **Wind as skill** — Affects ball but NOT aim guides. Player must read compass and compensate.
- **Behind camera clipping** — `worldToScreen3D` returns `behind` flag to prevent inverted rendering
- **Accuracy zones synced** — Visual arc colors exactly match code thresholds (0.33/0.66)
- **Curl dead zone** — 15px before curl activates, prevents accidental curl on tap
- **Teal water world** — Course surrounded by ocean for visual impact (matches reference games)
