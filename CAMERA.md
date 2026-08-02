# Camera reference

This is the full map of every camera input, what it's *meant* to do, and where the code lives. Use it as a checklist when something feels wrong.

---

## Two camera modes

The 3D camera switches between two completely different control systems.

| Mode | When active | State driver | Position model |
|---|---|---|---|
| **Orbit** | `state === 'overworld'` (player is in their resort) | `cam3dOrbitMode = true` | Spherical coords around a ground pivot |
| **Positional** | All gameplay states (`'playing'`, `'holeDone'`, flyover, follow, etc.) | `cam3dOrbitMode = false` | `cam3dTarget.{x,y,z}` set directly by gameplay logic |

The mode flag is set in `enterOverworld()` / `exitOverworld()` (`game.js`).
Gestures and HUD code share the same physical buttons but route to different math depending on the mode.

---

## Orbit mode (overworld)

### State variables (`renderer3d.js:55-71`)

| Variable | Default | Range | Notes |
|---|---|---|---|
| `cam3dPivotX`, `cam3dPivotZ` | course center | unbounded | Ground point camera looks at and orbits around |
| `cam3dDistance` | 2600 | `60 – 10000` | Reset only via ⊙ button — pinch zoom no longer changes this |
| `cam3dYaw` | 0 | unbounded (any 360°+) | Radians, 0 = looking north |
| `cam3dPitch` | 50° | `12° – 88°` | Radians, 0 = horizontal, 90° = top-down |
| `cam3dFov` | 75° | `22° – 85°` | Perspective lens. Pinch zoom changes this |

### Math (`renderer3d.js:73-92`)

`applyOrbitCamera()` recomputes camera position from the spherical state:

```
camera.x = pivotX + d · cos(pitch) · sin(yaw)
camera.y =          d · sin(pitch)
camera.z = pivotZ + d · cos(pitch) · cos(yaw)
camera.lookAt = (pivotX, 0, pivotZ)
```

Then it **snaps** `camera3d.position` and `camera3d.lookAt()` directly — no lerp. Every state mutation produces an immediate visual update.

### Inputs

| Input | Intended behavior | Routes through |
|---|---|---|
| **One finger drag** | With the **hand tool** (default): pan the pivot on the ground plane. With a brush armed: paints — navigation requires the hand. No tilt, no zoom, no yaw change. | `overworldTouchMove → panCamera3D → panCameraOrbit → applyOrbitCamera` |
| **Two finger drag** | **Pan** (industry-standard map gesture). Applied per-frame so it composes with twisting. | `engine.js touchmove pinch branch → panCameraOrbit(stepDx, stepDy)` |
| **Two finger pinch (spread/close)** | Narrow / widen FOV. Camera position untouched. Spread = zoom in. | `engine.js touchmove pinch branch → setCameraFov(baseFov / scale)` |
| **Two finger twist** | Rotate yaw freely through 360°+. Accumulated frame-by-frame, normalized for ±π wraparound. | `engine.js touchmove pinch branch → setCameraOrbit(... newYaw ...)` |
| **Pitch / tilt** | ▲▼ hold buttons ONLY — there is no pitch gesture. (A shared two-finger gesture made accidental tilting too easy.) | `tickOverworldCamera → tiltCameraOrbit` |
| **HUD ▲ button (hold)** | Continuously tilt camera UP (toward overhead) at ~0.55 rad/sec. | `tickOverworldCamera → tiltCameraOrbit(-OW_TILT_SPEED * dt)` |
| **HUD ▼ button (hold)** | Continuously tilt DOWN (toward horizon). | Same, with positive sign |
| **HUD ↺ button (hold)** | Continuously rotate yaw LEFT at ~1.1 rad/sec (full spin in ~5.7s). | `tickOverworldCamera → rotateCameraOrbit(-OW_ROT_SPEED * dt)` |
| **HUD ↻ button (hold)** | Continuously rotate yaw RIGHT. | Same, positive |
| **HUD ⊙ button (tap)** | Reset to default view: pivot at course center, distance 2600, pitch 50°, yaw 0, FOV 75°. Instant. | `setCameraOrbit + resetCameraFov` |

### Pinch handler details (`engine.js:199-...`)

On `touchstart` with 2 fingers, we **snapshot** the orbit state into `cam._pinchOrbit*` fields:
- `_pinchOrbitDist` — distance at start (informational; not changed by pinch)
- `_pinchOrbitPitch` — pitch at start
- `_pinchOrbitYaw` — yaw at start
- `_pinchOrbitPivotX`, `_pinchOrbitPivotZ` — pivot at start (locked during gesture)
- `_pinchOrbitFov` — FOV at start
- `_pinchLastAngle`, `_pinchAccumRot` — for unbounded yaw accumulation

On every `touchmove`:
- `scale = currentDist / pinchStartDist`
- **FOV** ← `baseFov / scale` (absolute from baseline → no compounding)
- **Yaw** ← `baseYaw + accumulatedRotation` (frame deltas normalized to [-π, π])
- **Pan** ← midpoint delta applied per-frame via `panCameraOrbit` (uses the
  current yaw each step, so pan + twist compose correctly)
- **Pitch is never touched by gestures** — buttons only

**Intent gates:** zoom, rotate, and pan each engage only after crossing a
threshold (7% distance change / ~6° twist / 12px midpoint travel) and are
rebased at the engage moment — so micro-twist while zooming doesn't rotate,
micro-scale while panning doesn't zoom, and nothing snaps when a gate opens.

**Gesture handoff:** the engine calls `onPinchStart()` (game.js) the moment a
second finger lands. That cancels every one-finger interaction (pan-scouting,
paint stroke — banked via finishPaintStroke so undo stays per-stroke — wizard
waypoint drag, long-press, and in gameplay: aim drag / spin / drag-back).
When a pinch drops back to one finger, the engine re-baselines the tracked
touch coords. Together these kill the "camera jumps after pinching" bug.

This avoids four classes of bugs:
1. **Compounding** — applying ratios every frame instead of computing from baseline
2. **±π wraparound** — yaw delta jumping by 2π when the gesture crosses atan2 boundary
3. **Drift** — pivot creeping during pinch gestures
4. **Stale handoff** — leftover one-finger drag state firing after a pinch
5. **Liftoff smear** — fingers peeling off the glass drag the midpoint a few
   px in the travel direction on release; the last 60ms of applied pan is
   rewound when the gesture ends (`rewindLiftoffPan`)

### Single-finger pan (`overworldTouchMove`)

```js
if (scouting) {
    panCamera3D(dx, dy);   // routes to panCameraOrbit because orbit mode is on
}
```

`panCameraOrbit(dx, dy)` (`renderer3d.js`):
- `scale = cam3dDistance * 0.0022` — sensitivity scales with distance, NOT FOV
- Computes screen-right and screen-forward (yaw-aligned, projected to ground plane)
- Subtracts the screen-pixel deltas from `cam3dPivotX/Z`
- Calls `applyOrbitCamera()` which snaps `camera3d.position` immediately

### HUD button hold (`tickOverworldCamera` in `game.js`)

Runs every frame from the overworld branch of the game loop. While `owHeldCamBtn` is set (touchstart on a HUD button → set, touchend → clear), the appropriate orbit helper is called with `speed * dt`. Quick tap = ~16° nudge, long hold = continuous spin.

---

## Positional mode (gameplay)

### State variables

Just `cam3dTarget.{x,y,z}` and `cam3dLookAt.{x,y,z}`. The various gameplay setters write these directly:

| Setter | Used for |
|---|---|
| `setCameraOverhead(cx, cz, zoom)` | Default planning view; tilted ~50° |
| `setCameraBehindBall(bx, bz, tx, tz, dist)` | Behind-ball view during drag-back & meter |
| `setCameraFollowBall(bx, bz, vx, vy, bz)` | Low-angle chase cam during ball flight |

### Smoothing

`updateCamera3D(dt)` runs every frame (gameplay AND overworld) and lerps `camera3d.position` toward `cam3dTarget` at `3 * dt`. In orbit mode, `applyOrbitCamera` already snapped position to target, so this lerp is a no-op. In gameplay mode, it provides the smooth camera follow that gameplay needs.

`cam3dSkipLerp` is set true when the player is actively scouting / dragging in gameplay; it skips the X/Z lerp (Y still lerps for height changes).

---

## State transitions

```
menu → manage → enterOverworld()    sets cam3dOrbitMode = true
                                    + setCameraOrbit(center, 2600, 50°, 0)
                                    + resetCameraFov()

overworld → exitOverworld()         sets cam3dOrbitMode = false
                                    + resetCameraFov()
                                    → enterManage()

manage → career → playing           gameplay setters take over
                                    cam3dOrbitMode is already false

playing → menu                      orbit state ignored
```

---

## Things to verify when the camera "feels wrong"

| Symptom | First places to check |
|---|---|
| Pan drifts after release | `applyOrbitCamera` should snap position; `cam3dSkipLerp` shouldn't matter in orbit mode |
| Pinch zoom moves the camera | FOV should change instead. Check `setCameraFov` is being called and `cam3dDistance` isn't being mutated |
| Twist rotation snaps backward | Wraparound — verify `cam._pinchAccumRot` accumulator and the ±π normalize step |
| Pitch goes to 0 / 90° instantly | Sensitivity in `midDy * 0.004` may be too aggressive; or `CAM3D_PITCH_MIN/MAX` clamping isn't honored |
| Hold-button doesn't continuously rotate | `owHeldCamBtn` must be set AND `tickOverworldCamera(dt)` must be called from the game loop's overworld branch |
| Pan feels too fast/slow at one zoom | `panCameraOrbit` scales by `cam3dDistance * 0.0022` but distance is fixed in orbit mode — pan speed does NOT adapt to FOV. This is a known weak spot. |
| Two-finger gesture also pans | In orbit mode the pivot X/Z stay frozen during pinch. If you see panning, the legacy non-orbit branch is somehow being entered |
| Camera tilts unexpectedly during pan | Pan should not change pitch/yaw. If it does, check that `panCameraOrbit` only writes pivot X/Z (not pitch/yaw) |

---

## Known weak spots

1. **Pan sensitivity doesn't adapt to FOV.** At narrow FOV (zoomed-in), the visible world is small but pan speed is unchanged, so a swipe sweeps you off the visible area fast. Consider scaling pan by `cam3dFov / 75` so pan feels consistent across zoom levels.

2. ~~Pitch via two-finger midpoint conflicts with intuition.~~ **Resolved:**
   two-finger drag now pans; pitch is buttons-only. Also resolved: painting
   no longer hijacks one-finger drag — the hand tool is the default and
   brushes must be deliberately armed.

3. **Hold-button speed is tuned for "spin a few times then stop" feel.** If players want to make small tweaks they have to tap-and-instantly-release, which is hard. Could add a slow-tap-mode (single tap = small fixed nudge, hold = continuous).

4. **Reset doesn't restore distance to default.** If a future feature changes distance, reset may leave it stale. Currently safe because nothing else changes distance.
