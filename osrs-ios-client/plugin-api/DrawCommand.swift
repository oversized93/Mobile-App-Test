// DrawCommand — render-target-agnostic overlay output.
//
// Plugins return [DrawCommand]; they NEVER touch Metal directly. A renderer
// (MetalOverlayRenderer on device, DebugCanvasRenderer in SwiftUI previews and
// tests) consumes the list. This decouples plugin logic from the GPU pipeline
// and makes overlays testable without a device. See DESIGN.md boundary #2.
//
// Interface sketch — not a compiling target.

import CoreGraphics

/// Colors/anchors stay abstract so the same command renders identically in a
/// SwiftUI debug canvas and in the Metal pipeline.
struct OverlayColor: Equatable {
    var r, g, b, a: Double   // 0...1
}

enum ScreenAnchor {
    case topLeft, topRight, bottomLeft, bottomRight, center
    case followWorld(WorldPoint)   // pinned to a world tile, projected each frame
}

enum DrawCommand {
    /// Highlight a world tile (the classic tile marker). Defined in WORLD
    /// space — the renderer projects it; the plugin doesn't do screen math.
    case tileHighlight(tile: WorldPoint, fill: OverlayColor, border: OverlayColor)

    /// A marker pinned to a world point (NPC indicator, ground-item dot).
    case worldMarker(at: WorldPoint, color: OverlayColor, radius: Double)

    /// A line between two world points (route hints, distance lines).
    case line(from: WorldPoint, to: WorldPoint, color: OverlayColor, width: Double)

    /// Text. Anchored to screen OR followed to a world point.
    case text(String, anchor: ScreenAnchor, color: OverlayColor, size: Double)

    /// A bitmap (item icon, clue step image).
    case image(named: String, anchor: ScreenAnchor, size: CGSize)
}

/// Overlays are pure: given current state, return what to draw this frame.
/// No GPU calls, no main-thread blocking, no side effects on game state.
protocol Overlay: AnyObject {
    /// Higher z draws on top. Lets the OverlayManager order across plugins.
    var z: Int { get }
    func render(state: GameStateSource) -> [DrawCommand]
}

/// Consumes commands. Plugins are blind to which renderer they hit.
protocol OverlayRenderer: AnyObject {
    func draw(_ commands: [DrawCommand])
}
