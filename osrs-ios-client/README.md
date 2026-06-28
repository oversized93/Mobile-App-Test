# OSRS iOS Client — RuneLite-inspired Plugin Framework

A native iPhone OSRS client with a RuneLite-style plugin layer. This is a
**design-stage** project: the goal of this directory is to capture the
architecture clearly enough that Phase 1 can be built without re-litigating
the big decisions.

The one-line framing:

> Don't port RuneLite. Build a new iOS-native client/plugin framework that
> borrows RuneLite's *concepts*, then port compatible plugins one by one.

## Documents

- **[DESIGN.md](DESIGN.md)** — architecture, the abstraction boundaries that
  make Phase 1 buildable today, and the decisions that matter.
- **[ROADMAP.md](ROADMAP.md)** — the phased plan, with explicit gates. Phase 1
  and 2 are buildable now; Phase 3 is gated on external factors outside our
  control, and we say so plainly.
- **[plugin-api/](plugin-api/)** — a concrete Swift sketch of the plugin
  contract: events, the render-agnostic overlay command model, and config.
  Prose is cheap; an interface forces the decisions.

## The honest part

Two things are true at once:

1. **The native-client shell is a real, dreamable architecture.** OSRS runs on
   iPhone, so the device is not the blocker. UIKit/SwiftUI + Metal + touch
   input is a known-good stack.
2. **The "Game State Bridge" is gated, not just hard.** RuneLite works because
   it has access to the *desktop Java client's internals*. There is no
   sanctioned way to read the official iOS client's live game state. Without
   that bridge you have a very good companion app, not "RuneLite on iPhone."

So the plan is structured to deliver maximum value on the **ungated** side
(the plugin framework + companion features) while keeping the live bridge as a
clean, swappable interface we light up *if* a legitimate path appears.

## Scope boundary (non-negotiable)

This project is **client UI / quality-of-life / plugin features only**. No
automation, no input injection, no bypassing intended interaction. Anything
that performs gameplay for the user is out of scope — that is where account
risk and rule risk go way up, and it is explicitly not what we are building.
