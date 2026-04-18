extends Node
## GameData — autoload singleton for economy, upgrades, save/load.
## Ported from the HTML5 version's shop.js.

signal money_changed(amount: int)
signal animal_collected(payout: int, flow_time: float)
signal milestone_reached(message: String)
signal upgrade_purchased(id: String)

var money: float = 0.0
var total_earned: float = 0.0
var prestige_level: int = 0
var round_started: bool = false
var rock_inventory: int = 0

# ---- Upgrade definitions ----
var upgrades: Dictionary = {
	"koi_value":      { "label": "Koi Value",      "desc": "×1.15 base income / lvl",        "base_cost": 12,    "level": 0, "max_level": 30, "scale": 1.5 },
	"spawn_rate":     { "label": "Spawn Rate",     "desc": "Faster spawning",                "base_cost": 25,    "level": 0, "max_level": 15, "scale": 1.85 },
	"flow_mult":      { "label": "Flow Bonus",     "desc": "×1.12 flow coefficient / lvl",   "base_cost": 35,    "level": 0, "max_level": 20, "scale": 1.7 },
	"wider_river":    { "label": "Wider River",    "desc": "+15% river width / lvl",          "base_cost": 200,   "level": 0, "max_level": 8,  "scale": 2.0 },
	"expand_garden":  { "label": "Expand Garden",  "desc": "Zoom out — forces redraw",       "base_cost": 2000,  "level": 0, "max_level": 6,  "scale": 4.5 },
	"rock":           { "label": "River Rock",     "desc": "+1 rock to place",                "base_cost": 80,    "level": 0, "max_level": 99, "scale": 1.75 },
	"double_spawn":   { "label": "Twin Springs",   "desc": "15% double spawn / lvl",          "base_cost": 800,   "level": 0, "max_level": 5,  "scale": 2.5, "requires_earned": 500 },
	"golden_current": { "label": "Golden Current",  "desc": "×1.10 all payouts / lvl",        "base_cost": 1000,  "level": 0, "max_level": 10, "scale": 2.2, "requires_earned": 700 },
	"swift_current":  { "label": "Swift Current",   "desc": "+8% speed / lvl",                "base_cost": 600,   "level": 0, "max_level": 8,  "scale": 1.9, "requires_earned": 400 },
	"garden_harmony": { "label": "Garden Harmony",  "desc": "×1.08 ALL income / lvl",         "base_cost": 500,   "level": 0, "max_level": 15, "scale": 2.4, "requires_earned": 1500 },
	"prestige":       { "label": "Zen Mastery",     "desc": "Reset for ×1.5 permanent",       "base_cost": 50000, "level": 0, "max_level": 10, "scale": 5.0, "requires_earned": 30000 },
}

# Tree upgrades (wildlife, obstacles, garden, spawner)
var fish_tree: Array = [
	{ "id": "goldfish",   "label": "Goldfish",    "mult": 2,   "weight": 0.35,  "cost": 300 },
	{ "id": "catfish",    "label": "Catfish",      "mult": 5,   "weight": 0.15,  "cost": 1500 },
	{ "id": "dragonfish", "label": "Dragon Fish",  "mult": 12,  "weight": 0.06,  "cost": 8000 },
	{ "id": "goldenkoi",  "label": "Golden Koi",   "mult": 30,  "weight": 0.025, "cost": 40000 },
	{ "id": "spiritfish", "label": "Spirit Fish",  "mult": 80,  "weight": 0.01,  "cost": 200000 },
]
var lilypad_tree: Array = [
	{ "id": "frog",   "label": "Frog",   "mult": 3,   "weight": 0.28, "cost": 500 },
	{ "id": "turtle", "label": "Turtle", "mult": 8,   "weight": 0.12, "cost": 2500 },
	{ "id": "duck",   "label": "Duck",   "mult": 15,  "weight": 0.06, "cost": 12000 },
	{ "id": "crane",  "label": "Crane",  "mult": 40,  "weight": 0.02, "cost": 60000 },
	{ "id": "panda",  "label": "Panda",  "mult": 100, "weight": 0.008, "cost": 300000 },
]
var obstacle_tree: Array = [
	{ "id": "log",       "label": "Log",        "slow": 0.28, "range": 0.045, "cost": 400 },
	{ "id": "whirlpool", "label": "Whirlpool",  "slow": 0.15, "range": 0.06,  "cost": 3000 },
	{ "id": "waterfall", "label": "Waterfall",  "slow": 0.08, "range": 0.08,  "cost": 15000 },
	{ "id": "dam",       "label": "Dam",        "slow": 0.05, "range": 0.10,  "cost": 80000 },
	{ "id": "zenbridge", "label": "Zen Bridge", "slow": 0.02, "range": 0.12,  "cost": 400000 },
]
var garden_tree: Array = [
	{ "id": "bamboo",  "label": "Bamboo",       "income": 0.5,  "cost": 200 },
	{ "id": "bonsai",  "label": "Bonsai Tree",  "income": 2.0,  "cost": 1000 },
	{ "id": "lantern", "label": "Stone Lantern", "income": 8.0, "cost": 5000 },
	{ "id": "bridge",  "label": "Moon Bridge",  "income": 30.0, "cost": 25000 },
	{ "id": "torii",   "label": "Torii Gate",   "income": 100.0, "cost": 150000 },
]
var spawner_tree: Array = [
	{ "id": "spring2", "label": "Second Spring",  "mult": 2.0, "cost": 2000 },
	{ "id": "spring3", "label": "Third Spring",   "mult": 3.0, "cost": 10000 },
	{ "id": "golden",  "label": "Golden Spring",  "mult": 4.0, "cost": 50000 },
	{ "id": "sacred",  "label": "Sacred Spring",  "mult": 5.5, "cost": 250000 },
	{ "id": "eternal", "label": "Eternal Spring", "mult": 8.0, "cost": 1000000 },
]

var tree_levels: Dictionary = {
	"fish": 0, "lilypad": 0, "obstacle": 0, "garden": 0, "spawner": 0,
}

# ---- Milestones ----
var milestones: Array = [
	{ "at": 50,    "msg": "Your garden begins to grow..." },
	{ "at": 200,   "msg": "New wildlife spotted nearby" },
	{ "at": 1000,  "msg": "The river hums with life" },
	{ "at": 5000,  "msg": "Advanced techniques revealed" },
	{ "at": 15000, "msg": "The garden approaches harmony" },
	{ "at": 30000, "msg": "Zen mastery beckons..." },
	{ "at": 100000,"msg": "A legendary garden" },
]
var last_milestone_at: float = 0.0

# ---- Computed multipliers (all multiplicative, compound with each other) ----
func get_koi_multiplier() -> float:
	return pow(1.15, upgrades["koi_value"]["level"])

func get_flow_coefficient() -> float:
	return 0.3 * pow(1.12, upgrades["flow_mult"]["level"])

func get_golden_multiplier() -> float:
	return pow(1.10, upgrades["golden_current"]["level"])

func get_harmony_multiplier() -> float:
	return pow(1.08, upgrades["garden_harmony"]["level"])

func get_prestige_multiplier() -> float:
	return pow(1.5, prestige_level)

func get_speed_multiplier() -> float:
	return 1.0 + upgrades["swift_current"]["level"] * 0.08

func get_double_spawn_chance() -> float:
	return upgrades["double_spawn"]["level"] * 0.15

func get_river_width_bonus() -> float:
	return 1.0 + upgrades["wider_river"]["level"] * 0.15

func get_view_scale() -> float:
	return max(0.45, pow(0.82, upgrades["expand_garden"]["level"]))

func get_spawner_multiplier() -> float:
	var lvl = tree_levels["spawner"]
	if lvl <= 0 or lvl > spawner_tree.size():
		return 1.0
	return spawner_tree[lvl - 1]["mult"]

func get_passive_income() -> float:
	var total = 0.0
	var lvl = tree_levels["garden"]
	for i in range(min(lvl, garden_tree.size())):
		total += garden_tree[i]["income"]
	return total * get_harmony_multiplier() * get_prestige_multiplier()

# ---- Payout calculation ----
func calculate_payout(base_value: float, flow_time: float) -> int:
	var koi = get_koi_multiplier()
	var flow = 1.0 + flow_time * get_flow_coefficient()
	var golden = get_golden_multiplier()
	var harmony = get_harmony_multiplier()
	var prestige = get_prestige_multiplier()
	return max(1, roundi(base_value * koi * flow * golden * harmony * prestige))

# ---- Upgrade cost ----
func get_upgrade_cost(id: String) -> int:
	var u = upgrades.get(id)
	if not u:
		return 999999999
	return roundi(u["base_cost"] * pow(u["scale"], u["level"]))

func get_tree_cost(tree_name: String) -> int:
	var tree = _get_tree(tree_name)
	var lvl = tree_levels.get(tree_name, 0)
	if lvl >= tree.size():
		return 999999999
	return tree[lvl]["cost"]

func _get_tree(name: String) -> Array:
	match name:
		"fish": return fish_tree
		"lilypad": return lilypad_tree
		"obstacle": return obstacle_tree
		"garden": return garden_tree
		"spawner": return spawner_tree
	return []

# ---- Purchase ----
func buy_upgrade(id: String) -> bool:
	var u = upgrades.get(id)
	if not u or u["level"] >= u["max_level"]:
		return false
	var cost = get_upgrade_cost(id)
	if money < cost:
		return false
	money -= cost
	u["level"] += 1
	if id == "rock":
		rock_inventory += 1
	if id == "prestige":
		_do_prestige()
	emit_signal("upgrade_purchased", id)
	emit_signal("money_changed", money)
	save_game()
	return true

func buy_tree_level(tree_name: String) -> bool:
	var tree = _get_tree(tree_name)
	var lvl = tree_levels.get(tree_name, 0)
	if lvl >= tree.size():
		return false
	var cost = tree[lvl]["cost"]
	if money < cost:
		return false
	money -= cost
	tree_levels[tree_name] = lvl + 1
	emit_signal("upgrade_purchased", tree_name)
	emit_signal("money_changed", money)
	save_game()
	return true

func collect_animal(base_value: float, flow_time: float) -> int:
	var payout = calculate_payout(base_value, flow_time)
	money += payout
	total_earned += payout
	_check_milestones()
	emit_signal("money_changed", money)
	emit_signal("animal_collected", payout, flow_time)
	save_game()
	return payout

func _do_prestige():
	prestige_level += 1
	money = 0
	round_started = false
	rock_inventory = 0
	for key in upgrades:
		if key != "prestige":
			upgrades[key]["level"] = 0
	upgrades["prestige"]["level"] = prestige_level
	for key in tree_levels:
		tree_levels[key] = 0
	save_game()

func _check_milestones():
	for m in milestones:
		if total_earned >= m["at"] and last_milestone_at < m["at"]:
			last_milestone_at = m["at"]
			emit_signal("milestone_reached", m["msg"])
			break

# ---- Save / Load ----
const SAVE_PATH = "user://zen_river_save.json"

func save_game():
	var upgrade_state = {}
	for key in upgrades:
		upgrade_state[key] = upgrades[key]["level"]
	var data = {
		"money": money,
		"total_earned": total_earned,
		"prestige_level": prestige_level,
		"round_started": round_started,
		"rock_inventory": rock_inventory,
		"upgrades": upgrade_state,
		"tree_levels": tree_levels,
		"last_milestone_at": last_milestone_at,
	}
	var file = FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if file:
		file.store_string(JSON.stringify(data))

func load_game():
	if not FileAccess.file_exists(SAVE_PATH):
		return
	var file = FileAccess.open(SAVE_PATH, FileAccess.READ)
	if not file:
		return
	var json = JSON.new()
	if json.parse(file.get_as_text()) != OK:
		return
	var data = json.data
	if not data is Dictionary:
		return
	money = data.get("money", 0.0)
	total_earned = data.get("total_earned", 0.0)
	prestige_level = data.get("prestige_level", 0)
	round_started = data.get("round_started", false)
	rock_inventory = data.get("rock_inventory", 0)
	last_milestone_at = data.get("last_milestone_at", 0.0)
	var saved_upgrades = data.get("upgrades", {})
	for key in saved_upgrades:
		if upgrades.has(key):
			upgrades[key]["level"] = saved_upgrades[key]
	var saved_trees = data.get("tree_levels", {})
	for key in saved_trees:
		tree_levels[key] = saved_trees[key]
	if upgrades.has("prestige"):
		upgrades["prestige"]["level"] = prestige_level

func reset_all():
	money = 0.0
	total_earned = 0.0
	prestige_level = 0
	round_started = false
	rock_inventory = 0
	last_milestone_at = 0.0
	for key in upgrades:
		upgrades[key]["level"] = 0
	for key in tree_levels:
		tree_levels[key] = 0
	if FileAccess.file_exists(SAVE_PATH):
		DirAccess.remove_absolute(SAVE_PATH)

func _ready():
	load_game()
