# Design

## Why RuneLite is the wrong *starting shape* (but the right *conceptual* source)

OSRS running natively on iPhone proves the game can run on iOS. The dream isn't
impossible because the device is weak. It's hard because RuneLite is shaped like
a **Java desktop client** — injected hooks, a plugin/event API, Swing/AWT
assumptions, a desktop renderer and mouse/keyboard input. Its public API even
exposes desktop concepts like `java.awt.Canvas`, which is a direct signal that
the codebase is not mobile-shaped.

| RuneLite / Desktop piece     | iOS-native replacement        |
| ---------------------------- | ----------------------------- |
| Java window / Canvas / AWT   | UIKit / SwiftUI view          |
| OpenGL / LWJGL rendering      | Metal renderer                |
| Mouse / keyboard input        | Touch + gesture input         |
| Desktop filesystem / configs  | iOS sandbox storage           |
| Plugin sidebar                | Bottom sheets / mobile panels |
| Java event bus                | Swift event bus               |
| Plugin JAR sideloading        | Compiled-in / vetted modules  |
| JVM + runtime patching        | (not available — design away) |

So we **keep the ideas** (plugin architecture, event bus, overlays as abstract
draw commands, config model, world/tile/item/NPC models, pure-logic plugin
code) and **throw away the desktop substrate** (AWT/Swing, the Java render
pipeline, launcher and JAR-sideload assumptions, JIT/injection).

## The two abstraction boundaries that make this buildable *today*

The whole design hinges on two interfaces. Get these right and Phase 1 ships
without a single line of live-game integration.

### 1. `GameStateSource` — plugins never know where state comes from

Plugins read game state through one protocol. The implementation behind it can
be a **mock/sample feed** (Phase 1), **manual user entry** (Phase 2), or a
**live bridge** (Phase 3, if it ever exists). Plugins don't change.

```
Plugin ──reads──▶ GameStateSource (protocol)
                      ├── MockStateSource     (sample data, scripted scenarios)
                      ├── ManualStateSource    (user-entered: gear, location…)
                      └── LiveStateSource       (gated — see ROADMAP Phase 3)
```

This is the single most important decision in the project. It means the live
bridge — the part we may never be allowed to build — is *one swappable
implementation*, not a dependency that blocks everything else.

### 2. `Overlay` emits draw *commands*, never touches Metal

RuneLite overlays effectively describe what to draw. We make that explicit: an
overlay returns a list of **render-target-agnostic draw commands**
(`.tileHighlight`, `.text`, `.line`, `.worldMarker`, `.image`). A renderer
consumes them.

```
Overlay ──returns──▶ [DrawCommand] ──consumed by──▶ Renderer
                                                       ├── MetalOverlayRenderer (device)
                                                       └── DebugCanvasRenderer   (SwiftUI, for tests/preview)
```

Benefits: plugins are testable without a GPU, the same overlay works in a
SwiftUI preview and on-device, and the Metal pipeline can evolve independently
of plugin code.

## Architecture

```
iOS App
├── Native Client Layer
│   ├── Renderer        — Metal (DrawCommand consumer)
│   ├── Input           — touch / gesture → semantic actions
│   ├── UI              — SwiftUI / UIKit (plugin panels = bottom sheets)
│   └── Storage         — iOS sandbox (config, tile markers, profiles)
│
├── Game State Bridge   — GameStateSource protocol
│   ├── player position / region
│   ├── inventory + equipment (item IDs)
│   ├── widgets / interface state
│   ├── NPCs / objects / ground items
│   ├── varbits / varps (quest + game state)
│   └── chat / messages
│
├── Plugin Runtime
│   ├── EventBus        — typed publish/subscribe
│   ├── ConfigManager   — typed, persisted, per-plugin
│   ├── OverlayManager  — collects DrawCommands, z-orders, hands to renderer
│   ├── ActionModel     — menu entries / tap targets
│   └── SafetyPolicy    — enforces the "no automation" boundary at the API level
│
└── Plugins
    ├── Tile Markers      ├── XP Tracker
    ├── NPC Indicators    ├── Clue Helper
    ├── Ground Items      └── Quest Helper
```

## Plugin lifecycle

```
register → configure → onEnable → (receive events, emit overlays/actions) → onDisable
```

- **register**: plugin declares id, name, default config, and required state
  capabilities (e.g. "needs inventory"). Capabilities let the runtime disable a
  plugin gracefully when the active `GameStateSource` can't supply its inputs.
- **onEnable / onDisable**: subscribe/unsubscribe from the bus, alloc/free
  overlay resources.
- Plugins are **pure with respect to rendering** — they react to events and
  return draw commands; they never block the main thread or call the GPU.

## Safety as an API property, not a guideline

The "no automation" boundary is enforced structurally:

- The plugin API exposes **read** access to `GameStateSource` and **write**
  access only to overlays, config, and panels.
- There is **no API surface** for input injection, tap synthesis, or action
  dispatch into the game. A plugin literally cannot perform gameplay because the
  capability isn't in its hands.
- `SafetyPolicy` is the chokepoint every plugin action passes through, so the
  rule is auditable in one place.

This mirrors the real-world boundary: RuneLite is Jagex-approved on desktop, but
that approval does not extend to arbitrary custom clients/plugins. Designing the
unsafe capability *out* keeps the project on the right side of that line.

## Mobile-first, not desktop-ported

Phase 4 plugins are designed for touch from the start, not copied from desktop:
bottom-sheet plugin controls, tap-friendly clue panels, large text, gesture-aware
tile markers, "tap target" highlighting, minimized sidebar clutter. The overlay
DrawCommand model already supports this — `worldMarker` and `tileHighlight` are
defined in world coordinates so they survive the desktop→touch UX rethink.
