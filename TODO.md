# Golf Tycoon — TODO

## Completed Features

### 3D Rendering
- [x] Three.js integration with continuous heightmap PlaneGeometry terrain
- [x] Per-vertex heights from smoothstep noise (rolling hills, not jagged)
- [x] Per-vertex colors via priority vote (sand > green/tee > fairway > rough/tree > water)
- [x] Fairway mowing stripes (alternating brightness every 3 rows)
- [x] Bunker lips (vertices near sand darkened for edge definition)
- [x] Tree shadow patches (rough near trees darkened)
- [x] Procedural grass canvas texture (256x256, speckles + blade strokes)
- [x] Tree variety — pines, oaks, bushes with size variation
- [x] Distant scenery — 160 background trees + 8 hills visible from behind-ball cam
- [x] Dual canvas: Three.js behind, 2D HUD overlay on top
- [x] Behind-ball low-angle camera (ground level, dramatic over-the-shoulder feel)
- [x] Tilted overhead camera (~55°) so hills are visible during aim
- [x] Chase-cam follow during ball flight
- [x] Immediate camera pan (no lerp shakiness)
- [x] Pinch zoom + twist rotate drive 3D camera
- [x] Ocean ground plane, gradient skybox, scattered clouds, teal fog

### Shot Flow — Golf Clash Three-Step
- [x] Overhead aim with animated concentric ring target and floating yardage pill
- [x] Target auto-placed toward hole, clamped to club max range
- [x] TAKE SHOT bar visible from the start (use auto-aim directly) or after manual aim
- [x] Cancel button when manually aimed
- [x] Drag-back mini-game after TAKE SHOT:
  - [x] Camera swings behind ball
  - [x] Pulsing dashed "DRAG BACK" circle appears below ball
  - [x] Touch ball, pull down — virtual ball follows finger with green glow trail
  - [x] Crossing threshold engages accuracy sweep arc
  - [x] Release on white line to fire
- [x] Re-Aim button to back out of drag-back mode to overhead aim
- [x] Accuracy deviation scaled by zone: green < 0.33, yellow < 0.66, red > 0.66

### Putting
- [x] Drag-back from ball on the green
- [x] Glowing cyan slope-aware curved putt guide
- [x] Accuracy arc runs during drag, release on white captures deviation
- [x] Pure Strike / Pulled Left / Pushed Right feedback notifications

### Ball Physics (Realistic Rolling)
- [x] Non-linear launch: `vz = launch * powerPct^1.4`
- [x] No air drag — clean `velocity = distance / time` math, 230 yd driver travels 230 yds
- [x] Gravity = 304 (tuned for 15% slower flight, 20% higher arc)
- [x] Lie modifiers: rough 80% power, sand 55%, path 95%, clean surfaces 100%
- [x] **Slope-based rolling on all terrain** via heightmap gradient
- [x] **Landing angle affects bounce** — cos³(angle) for aggressive steep-shot stopping
- [x] **Backspin checks back** — first-bounce reverse impulse on green/fairway
- [x] **First-bounce kick** — preserves ~40% of vz so drives actually bounce
- [x] **Stop threshold respects slope** — no freezing on a hill
- [x] Wind: continuous force while airborne, tuned so 10mph crosswind ≈ 10-15 yd drift
- [x] Curl: continuous lateral force perpendicular to velocity during flight
- [x] Sidespin: initial velocity offset perpendicular to aim

### Course Design (Decisions, not Realism)
- [x] 9 hand-designed holes with one clear risk/reward decision each
- [x] Course 1 Sunny Meadows — teaches core loop:
  - [x] First Swing (par 3): dead-simple intro
  - [x] The Fork (par 4): split fairway, safe vs risky
  - [x] Go For It (par 5): water bisects, lay up or reach in 2
- [x] Course 2 Oceanside Links — water + angles:
  - [x] Corner Cut (par 4): dogleg with water on inside
  - [x] Island Green (par 3): pure precision, no bailout
  - [x] Peninsula (par 5): snaking fairway between three water pockets
- [x] Course 3 Mountain Ridge — precision + commitment:
  - [x] The Chute (par 4): ultra-narrow tree corridor
  - [x] Serpent (par 5): double dogleg with two water carries
  - [x] Abyss (par 3): tiny green over massive water
- [x] Rough gap between every tee box and fairway (no more painted-over tees)
- [x] `treeLine` hardened — never overwrites fairway/green/tee/sand/water/path
- [x] Programmatic validation: every tee and pin lands on correct terrain

### Club System
- [x] 6 clubs: Driver 230y, 3W 195y, 5I 160y, 7I 120y, PW 80y, Putter 40y
- [x] Auto-select based on distance to hole
- [x] Left-side vertical stack with up/down arrows
- [x] Putter locked on green

### UI / UX
- [x] Compact top bar (44px) — shot counter, HOLE + PAR boxes
- [x] Wind as compact left pill with orange directional arrow
- [x] Spin control: glass circle with glowing red draggable dot
- [x] TAKE SHOT bar — orange gradient button, full-width when no manual aim
- [x] Camera control circles (glass style, +/-/rotate/reset)
- [x] Aim line behind-camera clipping (`worldToScreen3D.behind` flag)
- [x] Main Menu: gradient bg, glass player card, gradient pill buttons
- [x] Character: color swatches, name pills, glow ball preview
- [x] Career Select: glass cards with colored accents, gold best-score pills, lock overlays
- [x] Hole Complete + Round Complete: vignette, glass cards, gradient buttons

### Course Builder
- [x] 2D canvas, paint terrain types
- [x] Place tee and hole
- [x] Adjustable brush size
- [x] Save/load to localStorage
- [x] Test-play custom holes directly

## Known Issues
- [ ] Some camera angles still show subtle edge seams at terrain boundaries
- [ ] Ball guide dots prediction doesn't account for slope gradient yet

## Next Up

### Priority (gameplay feel)
- [ ] **Rough sub-zones** — first cut vs deep rough with different friction
- [ ] **Ball guide slope preview** — show predicted path curl on sidehill lies
- [ ] **Wind gusts** — slight variation during flight instead of constant force
- [ ] **Elevation-aware yardage** — "plays like 170 yds" for uphill/downhill shots

### Should Have
- [ ] **Overpower mechanic** — drag target past max range, accuracy gets harder
- [ ] **Club upgrades** — earn coins to level up clubs
- [ ] **More courses** — desert, winter, tropical, links themes
- [ ] **Sound effects** — shot impact, rolling, splash, hole-in-one
- [ ] **Replay system** — watch your shot from a different angle

### Nice to Have
- [ ] **3D preview in builder** — toggle 3D view of custom course
- [ ] **Ball types** — premium balls with stat bonuses
- [ ] **Tournaments** — multi-round events
- [ ] **Multiplayer** — turn-based head-to-head
- [ ] **Course sharing** — export/import JSON

## Design Decisions

- **Hybrid rendering** — Three.js 3D for gameplay, 2D Canvas for menus/builder/HUD
- **Continuous heightmap mesh** — single PlaneGeometry with per-vertex heights, not per-cell meshes (massive perf win + smooth hills)
- **Priority-based vertex colors** — majority vote among neighboring cells prevents blending artifacts at terrain boundaries
- **3D raycasting for input** — `screenToWorld3D` for accurate target placement with hills
- **No air drag** — clean physics, club range = actual flight distance
- **Wind as skill** — affects ball but NOT aim guides, player must compensate
- **Drag-back mini-game** — the three-step shot flow (aim → take shot → drag back) gates the accuracy sweep behind a commitment gesture, matching Golf Clash
- **Slope-based rolling on all terrain** — heightmap gradient is sampled every frame, ball rolls downhill everywhere (not just greens)
- **Landing angle uses cos³** — aggressive enough to actually stop a wedge while letting a driver run out
- **Decisions over realism** — every hole is a 5-second puzzle with one clear risk/reward choice
- **Accuracy zones synced** — visual arc colors exactly match code thresholds (0.33 / 0.66)
