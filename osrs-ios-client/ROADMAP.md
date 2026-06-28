# Roadmap

Four phases. The split is deliberate: **Phases 1–2 are buildable today** and
deliver real value. **Phase 3 is gated** on a legitimate game-state access path
that does not currently exist — we build *toward* it with a clean interface, but
we do not block the project on it. **Phase 4** is UX polish that rides on
whatever state source is available.

---

## Phase 1 — Mobile RuneLite shell  ✅ buildable now

Prove the plugin framework with **zero** live-game dependency.

- [ ] `GameStateSource` protocol + `MockStateSource` (scripted scenarios)
- [ ] EventBus (typed publish/subscribe)
- [ ] ConfigManager (typed, persisted to iOS sandbox)
- [ ] Overlay `DrawCommand` model + `DebugCanvasRenderer` (SwiftUI)
- [ ] World/tile coordinate system + a basic map view
- [ ] Plugin list + per-plugin settings UI (bottom sheets)
- [ ] One reference plugin end-to-end (Tile Markers) running on mock state

**Exit criterion:** a plugin reacts to mock events and draws a tile highlight on
the map, with persisted settings — all without any OSRS integration.

## Phase 2 — Easy plugins  ✅ buildable now

Port plugins that need no deep client hooks. Back them with `ManualStateSource`
(user-entered) where they need any state at all.

- [ ] Timers
- [ ] Calculators (skilling/combat)
- [ ] Gear setup helpers / inventory checklists
- [ ] Clue note helpers
- [ ] World map tools + route planner
- [ ] Tile marker editor
- [ ] Loot / XP trackers (manual entry)
- [ ] GE price lookup + hiscores (public data sources)

**Exit criterion:** a genuinely useful companion app a player would install,
with several plugins, no live hooks required.

## Phase 3 — Live state bridge  ⛔ gated (external dependency)

This is the monster step and the one we **cannot unilaterally unblock**. A real
"RuneLite on iPhone" needs the iOS client to expose live game state into the
plugin system. The only legitimate routes are:

- an official plugin/SDK API from Jagex (does not exist today), **or**
- a fully custom native client implementation, **or**
- some other sanctioned interface.

Until one of those exists, this phase is **design-only**. What we *can* do now:

- [ ] Keep `LiveStateSource` as a stubbed implementation of `GameStateSource`
- [ ] Maintain capability declarations so plugins degrade gracefully without it
- [ ] Document exactly which plugins would "light up" if a bridge appears

**We will not pursue injection, runtime patching, memory reading, or anything
that bypasses intended interaction to fake this bridge.** That path is both a
rules risk and outside this project's scope.

## Phase 4 — Mobile-first plugins  ⟂ rides on whatever source exists

Redesign UX for touch rather than copying desktop layouts.

- [ ] Tap-friendly clue panels
- [ ] Bottom-sheet plugin controls everywhere
- [ ] Simplified, large-text overlays
- [ ] Gesture-aware tile markers
- [ ] "Tap target" highlighting
- [ ] Minimized sidebar clutter

---

## Dependency summary

```
Phase 1 ──▶ Phase 2 ──▶ Phase 4
                │
                └──▶ Phase 3 (gated on external state-access path)
                          │
                          └──▶ unlocks the "live" subset of Phase 4
```

The framework (1), companion plugins (2), and most mobile UX (4) ship
independently of the gated bridge (3). That's the point of the
`GameStateSource` abstraction.
