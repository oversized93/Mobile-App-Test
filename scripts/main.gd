extends Node2D
## Main — full game controller. State machine, input routing,
## HUD management, and screen transitions.

enum State { MENU, PLAY_DRAWING, PLAY_PREROUND, PLAY_RUNNING, SHOP, RESET_CONFIRM }
var current_state: State = State.MENU

@onready var background: Node2D = $Background
@onready var spring_pond: Node2D = $SpringPond
@onready var river_drawer: Node2D = $RiverDrawer
@onready var flow_manager: Node2D = $FlowManager
@onready var hud_layer: CanvasLayer = $HUD
@onready var money_label: Label = $HUD/MoneyLabel
@onready var income_label: Label = $HUD/IncomeLabel
@onready var home_btn: Button = $HUD/HomeBtn
@onready var shop_btn: Button = $HUD/ShopBtn
@onready var draw_again_btn: Button = $HUD/DrawAgainBtn
@onready var test_flow_btn: Button = $HUD/TestFlowBtn
@onready var start_round_btn: Button = $HUD/StartRoundBtn
@onready var menu_layer: CanvasLayer = $MenuLayer
@onready var menu_begin_btn: Button = $MenuLayer/BeginBtn
@onready var menu_reset_btn: Button = $MenuLayer/ResetBtn
@onready var menu_title: Label = $MenuLayer/TitleLabel
@onready var shop_layer: CanvasLayer = $ShopLayer
@onready var shop_ui: Control = $ShopLayer/ShopControl
@onready var notification_label: Label = $HUD/NotificationLabel
@onready var effects: Node2D = $Effects
@onready var obstacles_node: Node2D = $Obstacles
@onready var reset_layer: CanvasLayer = $ResetLayer
@onready var reset_confirm: Control = $ResetLayer/ResetControl

var display_money: float = 0.0
var income_update_timer: float = 0.0
var cached_income: float = 0.0
var notification_timer: float = 0.0

func _ready():
	GameData.load_game()
	# Wire up flow manager
	flow_manager.river_drawer = river_drawer
	# Connect signals
	GameData.money_changed.connect(_on_money_changed)
	GameData.milestone_reached.connect(_on_milestone)
	GameData.animal_collected.connect(_on_animal_collected)
	GameData.upgrade_purchased.connect(_on_upgrade_purchased)
	river_drawer.river_committed.connect(_on_river_committed)
	river_drawer.river_cleared.connect(_on_river_cleared)
	flow_manager.test_flow_complete.connect(_on_test_flow_complete)
	# Connect buttons
	if home_btn: home_btn.pressed.connect(func(): _change_state(State.MENU))
	if shop_btn: shop_btn.pressed.connect(func(): _change_state(State.SHOP))
	if draw_again_btn: draw_again_btn.pressed.connect(_on_draw_again)
	if test_flow_btn: test_flow_btn.pressed.connect(_on_test_flow)
	if start_round_btn: start_round_btn.pressed.connect(_on_start_round)
	if menu_begin_btn: menu_begin_btn.pressed.connect(_on_menu_begin)
	if menu_reset_btn: menu_reset_btn.pressed.connect(func(): _change_state(State.RESET_CONFIRM))
	if shop_ui: shop_ui.close_requested.connect(_on_shop_close)
	if shop_ui: shop_ui.purchase_confirmed.connect(_on_shop_purchase)
	if reset_confirm:
		reset_confirm.confirmed.connect(_on_reset_confirmed)
		reset_confirm.cancelled.connect(func(): _change_state(State.MENU))
	# Initial state
	if GameData.round_started and river_drawer.has_river:
		_change_state(State.PLAY_RUNNING)
	elif river_drawer.has_river:
		_change_state(State.PLAY_PREROUND)
	else:
		_change_state(State.MENU)
	display_money = GameData.money

func _process(delta: float):
	# Animate money display
	if display_money < GameData.money:
		display_money += max(0.5, (GameData.money - display_money) * 0.12)
		if display_money > GameData.money:
			display_money = GameData.money
	else:
		display_money = GameData.money
	if money_label:
		money_label.text = "$" + str(int(display_money))

	# Update income rate
	income_update_timer -= delta
	if income_update_timer <= 0:
		income_update_timer = 0.5
		cached_income = _estimate_income()
	if income_label and current_state == State.PLAY_RUNNING:
		income_label.text = "$%.1f/s" % cached_income
		income_label.visible = cached_income > 0.01
	elif income_label:
		income_label.visible = false

	# Notification fade
	if notification_timer > 0:
		notification_timer -= delta
		if notification_timer <= 0 and notification_label:
			notification_label.visible = false

	# Spring/pond need to redraw for animated sparkle/ripple
	if spring_pond and current_state != State.MENU:
		spring_pond.queue_redraw()

func _estimate_income() -> float:
	if not river_drawer.has_river or not GameData.round_started:
		return GameData.get_passive_income()
	var river_len = river_drawer.get_total_length()
	var avg_flow_time = river_len / max(base_animal_speed_for_estimate(), 1.0)
	var avg_payout = GameData.calculate_payout(1.0, avg_flow_time)
	var spawn_interval = flow_manager.get_spawn_interval()
	var spawns_per_sec = 1.0 / max(spawn_interval, 0.1)
	return avg_payout * spawns_per_sec + GameData.get_passive_income()

func base_animal_speed_for_estimate() -> float:
	return 70.0 * GameData.get_speed_multiplier()

# ---- Input handling ----
func _unhandled_input(event: InputEvent):
	if event is InputEventScreenTouch:
		if event.pressed:
			_on_touch_start(event.position)
		else:
			_on_touch_end(event.position)
	elif event is InputEventScreenDrag:
		_on_touch_move(event.position)
	# Mouse fallback for desktop testing
	elif event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_LEFT:
			if event.pressed:
				_on_touch_start(event.position)
			else:
				_on_touch_end(event.position)
	elif event is InputEventMouseMotion and Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT):
		_on_touch_move(event.position)

func _on_touch_start(pos: Vector2):
	match current_state:
		State.PLAY_DRAWING:
			var spring_rect = spring_pond.get_spring_rect() if spring_pond else Rect2()
			if spring_rect.has_point(pos):
				river_drawer.start_drawing(pos)
			else:
				_show_notification("Start at the spring")
		State.PLAY_RUNNING:
			if GameData.rock_inventory > 0 and river_drawer.has_river:
				_try_place_rock(pos)

func _on_touch_move(pos: Vector2):
	if current_state == State.PLAY_DRAWING and river_drawer.is_drawing:
		river_drawer.extend_drawing(pos)

func _on_touch_end(pos: Vector2):
	if current_state == State.PLAY_DRAWING and river_drawer.is_drawing:
		var pond_rect = spring_pond.get_pond_rect() if spring_pond else Rect2()
		if river_drawer.finish_drawing(pond_rect):
			_change_state(State.PLAY_PREROUND)
		else:
			river_drawer.cancel_drawing()
			_show_notification("Reach the pond")

# ---- State transitions ----
func _change_state(new_state: State):
	current_state = new_state
	_update_visibility()

func _update_visibility():
	var is_play = current_state in [State.PLAY_DRAWING, State.PLAY_PREROUND, State.PLAY_RUNNING]
	# Game world
	if background: background.visible = true
	if spring_pond: spring_pond.visible = is_play
	if river_drawer: river_drawer.visible = is_play
	if flow_manager: flow_manager.visible = is_play
	# HUD
	if hud_layer: hud_layer.visible = is_play
	if home_btn: home_btn.visible = is_play
	if shop_btn: shop_btn.visible = is_play
	if money_label: money_label.visible = is_play
	# Pre-round buttons
	var show_preround = current_state == State.PLAY_PREROUND
	if draw_again_btn: draw_again_btn.visible = show_preround
	if test_flow_btn: test_flow_btn.visible = show_preround
	if start_round_btn: start_round_btn.visible = show_preround
	# Menu
	if menu_layer: menu_layer.visible = current_state == State.MENU
	# Shop
	if shop_layer: shop_layer.visible = current_state == State.SHOP
	# Reset confirm
	if reset_layer: reset_layer.visible = current_state == State.RESET_CONFIRM
	# Obstacles
	if obstacles_node: obstacles_node.visible = is_play
	# Effects
	if effects: effects.visible = is_play

# ---- Button callbacks ----
func _on_menu_begin():
	if river_drawer.has_river:
		if GameData.round_started:
			_change_state(State.PLAY_RUNNING)
		else:
			_change_state(State.PLAY_PREROUND)
	else:
		_change_state(State.PLAY_DRAWING)

func _on_draw_again():
	river_drawer.clear_river()
	flow_manager.clear_all()
	GameData.round_started = false
	_change_state(State.PLAY_DRAWING)
	_show_notification("Draw a new river")

func _on_test_flow():
	flow_manager.start_test_flow()

func _on_start_round():
	GameData.round_started = true
	flow_manager.clear_all()
	flow_manager.spawn_timer = 0.5
	GameData.save_game()
	_change_state(State.PLAY_RUNNING)
	_show_notification("The river flows")

# ---- Signal handlers ----
func _on_money_changed(_amount):
	pass # money_label updates in _process via display_money lerp

func _on_milestone(msg: String):
	_show_notification(msg)

func _on_animal_collected(payout: int, flow_time: float):
	if effects and river_drawer.has_river:
		var end_pos = river_drawer.sample_point(1.0)["pos"]
		effects.spawn_float_text(end_pos + Vector2(0, -10), "+$%d  %.1fs" % [payout, flow_time])
		effects.spawn_burst(end_pos)

func _on_upgrade_purchased(id: String):
	if id == "expand_garden":
		river_drawer.clear_river()
		flow_manager.clear_all()
		_change_state(State.PLAY_DRAWING)

func _on_river_committed(_points):
	_show_notification("River drawn — Test Flow or Start Round")

func _on_river_cleared():
	pass

func _on_test_flow_complete(flow_time: float):
	_show_notification("Flow time: %.1fs" % flow_time)

# ---- Notifications ----
func _show_notification(text: String):
	if notification_label:
		notification_label.text = text
		notification_label.visible = true
		notification_timer = 2.5

# ---- Rock placement ----
func _try_place_rock(pos: Vector2):
	if not river_drawer.has_river or GameData.rock_inventory <= 0:
		return
	# Project tap position onto the river to find pathT
	var best_t = 0.0
	var best_dist = INF
	var total_len = river_drawer.get_total_length()
	# Sample along the river to find closest point
	for i in range(200):
		var t = float(i) / 199.0
		var sample = river_drawer.sample_point(t)
		var d = pos.distance_to(sample["pos"])
		if d < best_dist:
			best_dist = d
			best_t = t
	# Must be within the river width
	if best_dist > river_drawer.get_river_width() * 0.55:
		return
	GameData.rock_inventory -= 1
	var rock = Node2D.new()
	rock.set_script(preload("res://scripts/rock_obstacle.gd"))
	rock.setup(best_t, river_drawer)
	if obstacles_node:
		obstacles_node.add_child(rock)
	# Store for flow slowdown + persistence
	var rock_data = { "path_t": best_t }
	flow_manager.rocks.append(rock_data)
	GameData.rock_positions.append(rock_data)
	GameData.save_game()
	_show_notification("Rock placed")

func _on_shop_close():
	if not river_drawer.has_river:
		_change_state(State.PLAY_DRAWING)
	elif GameData.round_started:
		_change_state(State.PLAY_RUNNING)
	else:
		_change_state(State.PLAY_PREROUND)

# ---- Shop purchase handler ----
func _on_shop_purchase(id: String):
	if id == "expand_garden":
		river_drawer.clear_river()
		flow_manager.clear_all()
		if obstacles_node:
			for child in obstacles_node.get_children():
				child.queue_free()
		_change_state(State.PLAY_DRAWING)

# ---- Reset handler ----
func _on_reset_confirmed():
	GameData.reset_all()
	river_drawer.clear_river()
	flow_manager.clear_all()
	if obstacles_node:
		for child in obstacles_node.get_children():
			child.queue_free()
	_change_state(State.MENU)
	_show_notification("The garden rests")
