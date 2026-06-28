# Plugin API sketch

These are **interface sketches**, not a compiling target — there's no Xcode
project here yet. The point is to force the design decisions that prose lets you
dodge. When Phase 1 starts, these become the real protocol definitions.

- **`GameStateSource.swift`** — the swappable state boundary (mock / manual /
  live all conform to this). The most important file.
- **`DrawCommand.swift`** — render-target-agnostic overlay output. Plugins
  return these; renderers consume them.
- **`Plugin.swift`** — the plugin contract: lifecycle, capabilities, event
  handling, config.

Read [../DESIGN.md](../DESIGN.md) first for *why* the boundaries sit where they
do.
