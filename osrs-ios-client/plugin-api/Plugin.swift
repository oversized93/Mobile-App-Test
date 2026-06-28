// Plugin — the contract every plugin conforms to.
//
// Borrows RuneLite's concepts (lifecycle, event subscription, typed config,
// overlays) but in a mobile, read-only, render-agnostic shape. A plugin can
// observe state and draw overlays/panels; it has NO capability to act on the
// game. That absence is the safety boundary (see DESIGN.md "Safety").
//
// Interface sketch — not a compiling target.

import Foundation

// MARK: - Config

/// Typed, persisted per-plugin config. The ConfigManager handles storage in the
/// iOS sandbox; plugins just declare a Codable settings type.
protocol PluginConfig: Codable {
    static var defaults: Self { get }
}

// MARK: - Descriptor

struct PluginDescriptor {
    let id: String                       // stable, reverse-DNS, e.g. "core.tilemarkers"
    let name: String
    let summary: String
    /// What this plugin needs from the active GameStateSource. If the source
    /// can't supply these, the runtime disables the plugin and tells the user
    /// why (rather than letting it read empty state). See ROADMAP Phase 3.
    let requiredCapabilities: StateCapabilities
}

// MARK: - Plugin

protocol Plugin: AnyObject {
    associatedtype Config: PluginConfig

    var descriptor: PluginDescriptor { get }
    var config: Config { get set }

    /// Overlays this plugin contributes (may be empty). The OverlayManager
    /// collects these across all enabled plugins and z-orders them.
    var overlays: [Overlay] { get }

    // Lifecycle
    func onEnable(context: PluginContext)
    func onDisable()

    // Event handling — called for events the plugin subscribed to via context.
    func handle(event: GameEvent)
}

/// Everything the runtime hands a plugin at enable time. Note what's present
/// (read state, subscribe, config, panels) and what is ABSENT: there is no
/// hook to dispatch input or actions into the game.
protocol PluginContext: AnyObject {
    var state: GameStateSource { get }              // read-only
    var config: ConfigManager { get }

    func subscribe(_ plugin: AnyObject, to events: [GameEventKind])
    func unsubscribe(_ plugin: AnyObject)

    /// Present a mobile panel (bottom sheet). The plugin's settings/clue/quest
    /// UI lives here. SwiftUI-backed.
    func presentPanel(_ panel: PluginPanel)
}

/// Coarse event kinds for subscription filtering (so a plugin only wakes for
/// what it cares about).
enum GameEventKind {
    case movement, inventory, equipment, npcs, groundItems
    case widgets, varbits, experience, chat, tick
}

protocol ConfigManager: AnyObject {
    func load<T: PluginConfig>(_ type: T.Type, for pluginId: String) -> T
    func save<T: PluginConfig>(_ config: T, for pluginId: String)
}

/// Marker for a SwiftUI-backed mobile panel. Concrete type defined in the app
/// layer; kept opaque here so the API doesn't drag in UIKit/SwiftUI.
protocol PluginPanel {}

// MARK: - Reference plugin (Phase 1 exit criterion)

/// Sketch of Tile Markers — the end-to-end reference plugin. Reacts to nothing
/// but player position, persists a set of marked tiles, and draws them. Proves
/// the framework with zero live-game dependency (runs on MockStateSource).
struct TileMarkersConfig: PluginConfig {
    var markedTiles: [WorldPoint] = []
    var fill = OverlayColor(r: 1, g: 1, b: 0, a: 0.25)
    var border = OverlayColor(r: 1, g: 1, b: 0, a: 0.9)
    static var defaults: TileMarkersConfig { .init() }
}
// markedTiles persists to the sandbox; the overlay returns one .tileHighlight
// per marked tile each frame. That's the whole Phase 1 vertical slice.
