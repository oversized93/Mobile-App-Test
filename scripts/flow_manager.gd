extends Node2D
## FlowManager — spawns animals, updates their flow along the river,
## handles collection at the pond, and manages obstacles.

const AnimalScene = preload("res://scripts/animal.gd")

@export var base_spawn_interval: float = 2.2
@export var base_animal_speed: float = 70.0
@export var max_animals: int = 80

var spawn_timer: float = 1.0
var river_drawer: Node2D = null  # set by main.gd
var test_droplet_t: float = -1.0
var test_droplet_time: float = 0.0
var rocks: Array = []  # [{ "path_t": float }, ...]

signal animal_reached_pond(animal_type: String, base_value: float, flow_time: float)
signal test_flow_complete(flow_time: float)

# ---- Animal type rolling (uses unlock weights from GameData) ----
func _get_spawn_weights() -> Dictionary:
	var weights = { "fish": 1.0 }
	# Fish tree unlocks
	var fish_lvl = GameData.tree_levels.get("fish", 0)
	var fish_tree = GameData.fish_tree
	for i in range(min(fish_lvl, fish_tree.size())):
		weights[fish_tree[i]["id"]] = fish_tree[i]["weight"]
	# Lilypad tree unlocks
	var lily_lvl = GameData.tree_levels.get("lilypad", 0)
	var lily_tree = GameData.lilypad_tree
	for i in range(min(lily_lvl, lily_tree.size())):
		weights[lily_tree[i]["id"]] = lily_tree[i]["weight"]
	return weights

func _roll_animal_type() -> String:
	var weights = _get_spawn_weights()
	var total = 0.0
	for w in weights.values():
		total += w
	var roll = randf() * total
	for type_id in weights:
		roll -= weights[type_id]
		if roll <= 0:
			return type_id
	return "fish"

# ---- Spawn interval (affected by upgrades) ----
func get_spawn_interval() -> float:
	var lvl = GameData.upgrades["spawn_rate"]["level"]
	var spawner_mult = GameData.get_spawner_multiplier()
	return max(0.15, base_spawn_interval * pow(0.85, lvl) / spawner_mult)

# ---- Spawning ----
func spawn_animal(forced_type: String = ""):
	if not river_drawer or not river_drawer.has_river:
		return
	if get_child_count() >= max_animals:
		return
	var type_id = forced_type if forced_type != "" else _roll_animal_type()
	var animal = Node2D.new()
	animal.set_script(AnimalScene)
	animal.setup(type_id)
	# Set initial position
	var start = river_drawer.sample_point(0.0)
	animal.render_pos = start["pos"]
	animal.render_angle = start["angle"]
	add_child(animal)

func start_test_flow():
	test_droplet_t = 0.0
	test_droplet_time = 0.0

func cancel_test_flow():
	test_droplet_t = -1.0

# ---- Per-frame update ----
func _process(delta: float):
	if not river_drawer or not river_drawer.has_river:
		return
	if not GameData.round_started:
		_update_test_droplet(delta)
		return

	# Spawn timer
	spawn_timer -= delta
	if spawn_timer <= 0:
		spawn_animal()
		if randf() < GameData.get_double_spawn_chance():
			spawn_animal()
		spawn_timer = get_spawn_interval()

	# Passive income
	var passive = GameData.get_passive_income() * delta
	if passive > 0:
		GameData.money += passive
		GameData.total_earned += passive

	# Update all animals
	var river_len = river_drawer.get_total_length()
	var speed_mult = GameData.get_speed_multiplier()

	for child in get_children():
		if child is Node2D and child.has_method("update_flow"):
			# Apply rock slowdown
			var effective_mult = speed_mult
			for rock in rocks:
				var obs_range = 0.035
				var obs_slow = 0.35
				# Use best obstacle from obstacle tree
				var obs_lvl = GameData.tree_levels.get("obstacle", 0)
				if obs_lvl > 0 and obs_lvl <= GameData.obstacle_tree.size():
					var obs = GameData.obstacle_tree[obs_lvl - 1]
					obs_range = obs["range"]
					obs_slow = obs["slow"]
				if abs(child.path_t - rock["path_t"]) < obs_range:
					effective_mult *= obs_slow
					break
			child.update_flow(delta, river_len, effective_mult)
			var sample = river_drawer.sample_point(child.path_t)
			child.update_render(sample["pos"], sample["angle"], river_drawer.get_river_width())
			child.queue_redraw()
			if child.path_t >= 1.0:
				var payout = GameData.collect_animal(child.base_value, child.flow_time)
				child.queue_free()

	# Update test droplet too
	_update_test_droplet(delta)

func _update_test_droplet(delta: float):
	if test_droplet_t < 0:
		return
	if not river_drawer or not river_drawer.has_river:
		return
	var river_len = river_drawer.get_total_length()
	test_droplet_t += (base_animal_speed / max(river_len, 1.0)) * delta
	test_droplet_time += delta
	if test_droplet_t >= 1.0:
		emit_signal("test_flow_complete", test_droplet_time)
		test_droplet_t = -1.0

func _draw():
	# Draw test droplet
	if test_droplet_t >= 0 and river_drawer and river_drawer.has_river:
		var sample = river_drawer.sample_point(test_droplet_t)
		var pos = sample["pos"]
		# Glow
		draw_circle(pos, 22, Color(0.78, 0.94, 1.0, 0.3))
		draw_circle(pos, 12, Color(0.78, 0.94, 1.0, 0.5))
		# Core
		draw_circle(pos, 5, Color(0.85, 0.96, 1.0, 0.9))
		draw_circle(pos - Vector2(1.4, 1.4), 2.2, Color(1, 1, 1, 0.9))
		queue_redraw()

func clear_all():
	for child in get_children():
		child.queue_free()
	spawn_timer = 1.0
	test_droplet_t = -1.0
	rocks.clear()
