// GameStateSource — the swappable boundary between plugins and "where state
// comes from". MockStateSource, ManualStateSource, and (gated) LiveStateSource
// all conform to this. Plugins depend ONLY on this protocol, never on a
// concrete source. See ROADMAP.md Phase 3 for why this matters.
//
// Interface sketch — not a compiling target.

import Foundation

// MARK: - World model

/// OSRS world coordinate. Region/plane aware so overlays survive the
/// desktop -> touch UX rethink (world markers are defined in world space).
struct WorldPoint: Equatable {
    var x: Int
    var y: Int
    var plane: Int          // 0...3
}

struct Player: Equatable {
    var position: WorldPoint
    var animationId: Int?
    var skills: [SkillId: SkillState]
}

struct SkillState: Equatable {
    var level: Int          // current (boosted) level
    var realLevel: Int
    var experience: Int
}

struct Item: Equatable {
    var id: Int
    var quantity: Int
}

struct NPC: Equatable {
    var index: Int
    var id: Int
    var position: WorldPoint
    var name: String?
}

struct GameObject: Equatable {
    var id: Int
    var position: WorldPoint
}

struct GroundItem: Equatable {
    var item: Item
    var position: WorldPoint
}

// Identifiers kept opaque so plugins don't hardcode magic ints everywhere.
struct SkillId: Hashable { let raw: Int }
struct VarbitId: Hashable { let raw: Int }
struct VarpId: Hashable { let raw: Int }
struct WidgetId: Hashable { let group: Int; let child: Int }

// MARK: - Capabilities

/// What a given source can actually supply. A MockStateSource may expose
/// everything; a ManualStateSource exposes only what the user entered. The
/// runtime uses this to gracefully disable plugins whose required inputs are
/// unavailable, rather than letting them read empty data and misbehave.
struct StateCapabilities: OptionSet {
    let rawValue: Int
    static let player      = StateCapabilities(rawValue: 1 << 0)
    static let inventory   = StateCapabilities(rawValue: 1 << 1)
    static let equipment   = StateCapabilities(rawValue: 1 << 2)
    static let npcs        = StateCapabilities(rawValue: 1 << 3)
    static let objects     = StateCapabilities(rawValue: 1 << 4)
    static let groundItems = StateCapabilities(rawValue: 1 << 5)
    static let widgets     = StateCapabilities(rawValue: 1 << 6)
    static let varbits     = StateCapabilities(rawValue: 1 << 7)
    static let chat        = StateCapabilities(rawValue: 1 << 8)
}

// MARK: - The protocol

/// READ-ONLY by construction. There is intentionally no method here that writes
/// state back into the game — that is the structural enforcement of the
/// "no automation / no input injection" boundary (see DESIGN.md "Safety").
protocol GameStateSource: AnyObject {
    var capabilities: StateCapabilities { get }

    var player: Player? { get }
    var inventory: [Item] { get }
    var equipment: [Item] { get }
    var npcs: [NPC] { get }
    var objects: [GameObject] { get }
    var groundItems: [GroundItem] { get }

    func widgetIsOpen(_ id: WidgetId) -> Bool
    func varbit(_ id: VarbitId) -> Int?
    func varp(_ id: VarpId) -> Int?

    /// Plugins subscribe via the EventBus, but a source needs a way to publish.
    /// The runtime wires this to the bus; plugins never call it.
    var eventPublisher: GameEventPublisher? { get set }
}

// MARK: - Events

/// Typed game events. The EventBus delivers these to subscribed plugins.
enum GameEvent {
    case playerMoved(from: WorldPoint, to: WorldPoint)
    case inventoryChanged(items: [Item])
    case equipmentChanged(items: [Item])
    case npcSpawned(NPC)
    case npcDespawned(NPC)
    case groundItemSpawned(GroundItem)
    case groundItemDespawned(GroundItem)
    case widgetOpened(WidgetId)
    case widgetClosed(WidgetId)
    case varbitChanged(VarbitId, value: Int)
    case experienceChanged(SkillId, newXp: Int, delta: Int)
    case chatMessage(sender: String?, text: String)
    case tick   // OSRS game tick (~600ms); sources approximate when not live
}

protocol GameEventPublisher: AnyObject {
    func publish(_ event: GameEvent)
}
