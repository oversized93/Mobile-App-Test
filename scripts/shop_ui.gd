extends Control
## ShopUI — scrollable upgrade card list with tier headers,
## confirm purchase modal, and multiplier breakdown.

signal close_requested()
signal purchase_confirmed(upgrade_id: String)

var scroll_offset: float = 0.0
var drag_start_y: float = 0.0
var drag_start_scroll: float = 0.0
var is_dragging: bool = false
var pending_purchase: String = ""  # upgrade id awaiting confirmation

const CARD_H = 68
const GAP = 8
const HEADER_H = 32
const TIER_COLORS = {
	"Basics": Color("#5a8a4a"),
	"River": Color("#4a7a9a"),
	"Wildlife": Color("#6a9a4a"),
	"Obstacles": Color("#7a7a4a"),
	"Garden": Color("#4a8a6a"),
	"Advanced": Color("#9a8a4a"),
	"Harmony": Color("#8a6a9a"),
	"Zen Mastery": Color("#8a6aaa"),
}

func _ready():
	# Connect close button
	var close_btn = get_node_or_null("../ShopCloseBtn")
	if close_btn:
		close_btn.pressed.connect(func(): emit_signal("close_requested"))

func _gui_input(event: InputEvent):
	if event is InputEventScreenTouch:
		if event.pressed:
			drag_start_y = event.position.y
			drag_start_scroll = scroll_offset
			is_dragging = true
		else:
			is_dragging = false
			# If it wasn't a drag, check for card taps
			if not _was_drag(event.position.y):
				_handle_tap(event.position)
	elif event is InputEventScreenDrag:
		if is_dragging:
			scroll_offset = drag_start_scroll - (event.position.y - drag_start_y)
			scroll_offset = max(0, scroll_offset)
			queue_redraw()
	# Mouse fallback
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			drag_start_y = event.position.y
			drag_start_scroll = scroll_offset
			is_dragging = true
		else:
			is_dragging = false
			if not _was_drag(event.position.y):
				_handle_tap(event.position)
	elif event is InputEventMouseMotion and is_dragging:
		scroll_offset = drag_start_scroll - (event.position.y - drag_start_y)
		scroll_offset = max(0, scroll_offset)
		queue_redraw()

func _was_drag(end_y: float) -> bool:
	return abs(end_y - drag_start_y) > 10

func _handle_tap(pos: Vector2):
	if pending_purchase != "":
		_handle_confirm_tap(pos)
		return
	# Check which card was tapped
	var y = 80.0 - scroll_offset
	for tier in GameData.UPGRADE_TIERS if "UPGRADE_TIERS" in GameData else _get_tiers():
		y += HEADER_H
		for key in tier["keys"]:
			if not _is_visible(key):
				continue
			if pos.y >= y and pos.y <= y + CARD_H:
				var btn_x = size.x - 130
				if pos.x >= btn_x and _can_afford(key):
					pending_purchase = key
					queue_redraw()
					return
			y += CARD_H + GAP
		y += 6

func _handle_confirm_tap(pos: Vector2):
	var card_w = min(size.x - 32, 340)
	var card_h = 220
	var cx = (size.x - card_w) / 2
	var cy = (size.y - card_h) / 2
	var btn_w = card_w * 0.42
	var btn_h = 46
	var btn_y = cy + card_h - btn_h - 16
	# Cancel
	if Rect2(cx + 12, btn_y, btn_w, btn_h).has_point(pos):
		pending_purchase = ""
		queue_redraw()
		return
	# Buy
	if Rect2(cx + card_w - btn_w - 12, btn_y, btn_w, btn_h).has_point(pos):
		var id = pending_purchase
		pending_purchase = ""
		# Check if it's a tree upgrade
		if id in ["fish", "lilypad", "obstacle", "garden", "spawner"]:
			GameData.buy_tree_level(id)
		else:
			GameData.buy_upgrade(id)
		emit_signal("purchase_confirmed", id)
		queue_redraw()

func _get_tiers() -> Array:
	return [
		{ "name": "Basics", "keys": ["koi_value", "spawn_rate", "flow_mult"] },
		{ "name": "River", "keys": ["wider_river", "expand_garden"] },
		{ "name": "Wildlife", "keys": ["fish", "lilypad"] },
		{ "name": "Obstacles", "keys": ["rock", "obstacle"] },
		{ "name": "Garden", "keys": ["garden", "spawner"] },
		{ "name": "Advanced", "keys": ["double_spawn", "golden_current", "swift_current"] },
		{ "name": "Harmony", "keys": ["garden_harmony"] },
		{ "name": "Zen Mastery", "keys": ["prestige"] },
	]

func _is_tree(key: String) -> bool:
	return key in ["fish", "lilypad", "obstacle", "garden", "spawner"]

func _is_visible(key: String) -> bool:
	if _is_tree(key):
		return true
	var u = GameData.upgrades.get(key)
	if not u:
		return false
	var req = u.get("requires_earned", 0)
	if req > 0 and GameData.total_earned < req * 0.5:
		return false
	return true

func _is_unlocked(key: String) -> bool:
	if _is_tree(key):
		return true
	var u = GameData.upgrades.get(key)
	if not u:
		return false
	var req = u.get("requires_earned", 0)
	return GameData.total_earned >= req

func _can_afford(key: String) -> bool:
	if _is_tree(key):
		return GameData.money >= GameData.get_tree_cost(key)
	var u = GameData.upgrades.get(key)
	if not u or u["level"] >= u["max_level"]:
		return false
	if not _is_unlocked(key):
		return false
	return GameData.money >= GameData.get_upgrade_cost(key)

func _get_cost(key: String) -> int:
	if _is_tree(key):
		return GameData.get_tree_cost(key)
	return GameData.get_upgrade_cost(key)

func _get_label(key: String) -> String:
	if _is_tree(key):
		var names = { "fish": "River Fish", "lilypad": "Lily Pad Riders", "obstacle": "Better Obstacles", "garden": "Garden Beauty", "spawner": "More Springs" }
		return names.get(key, key)
	var u = GameData.upgrades.get(key)
	return u["label"] if u else key

func _get_level(key: String) -> int:
	if _is_tree(key):
		return GameData.tree_levels.get(key, 0)
	var u = GameData.upgrades.get(key)
	return u["level"] if u else 0

func _get_max_level(key: String) -> int:
	if _is_tree(key):
		return GameData._get_tree(key).size()
	var u = GameData.upgrades.get(key)
	return u["max_level"] if u else 0

func _draw_rounded_rect(rect: Rect2, color: Color, filled: bool = true, width: float = -1.0, radius: float = 0.0):
	if radius <= 0:
		draw_rect(rect, color, filled, width)
		return
	# Approximate rounded rect with a polygon
	var pts = PackedVector2Array()
	var r = min(radius, rect.size.x / 2, rect.size.y / 2)
	var corners = [
		[rect.position + Vector2(r, 0), rect.position, rect.position + Vector2(0, r)],
		[rect.end - Vector2(0, r), Vector2(rect.end.x, rect.position.y), rect.end - Vector2(r, 0)],
		[rect.end - Vector2(r, 0), rect.end, rect.end - Vector2(0, r) + Vector2(0, 0)],
	]
	# Simple: just draw a regular rect for now (proper rounded rect needs more points)
	# The visual difference is minor on mobile
	draw_rect(rect, color, filled, width)

func _draw():
	# Background already handled by ShopBg ColorRect
	var w = size.x
	# Money display
	draw_string(ThemeDB.fallback_font, Vector2(w - 100, 40), "$" + str(int(GameData.money)),
		HORIZONTAL_ALIGNMENT_RIGHT, -1, 18, Color("#c8a04f"))
	# Multiplier pills
	_draw_multiplier_pills()
	# Card area
	var y = 80.0 - scroll_offset
	for tier in _get_tiers():
		var visible_keys = tier["keys"].filter(func(k): return _is_visible(k))
		if visible_keys.is_empty():
			continue
		# Tier header
		var tier_color = TIER_COLORS.get(tier["name"], Color.GRAY)
		draw_string(ThemeDB.fallback_font, Vector2(24, y + HEADER_H / 2 + 5),
			tier["name"].to_upper(), HORIZONTAL_ALIGNMENT_LEFT, -1, 14, tier_color)
		draw_line(Vector2(24, y + HEADER_H - 2), Vector2(w - 24, y + HEADER_H - 2),
			Color(0.96, 0.91, 0.77, 0.25), 1)
		y += HEADER_H

		for key in visible_keys:
			_draw_card(key, y, w)
			y += CARD_H + GAP
		y += 6

	# Confirm modal on top
	if pending_purchase != "":
		_draw_confirm_modal()

func _draw_multiplier_pills():
	var x = 20.0
	var y = 54.0
	var mults = [
		["Koi", GameData.get_koi_multiplier()],
		["Golden", GameData.get_golden_multiplier()],
		["Harmony", GameData.get_harmony_multiplier()],
		["Prestige", GameData.get_prestige_multiplier()],
	]
	for m in mults:
		if m[1] <= 1.001:
			continue
		var text = "%s ×%.2f" % [m[0], m[1]]
		var tw = ThemeDB.fallback_font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, 10).x + 12
		_draw_rounded_rect(Rect2(x, y, tw, 16), Color(0.96, 0.91, 0.77, 0.15), true, -1, 8)
		draw_string(ThemeDB.fallback_font, Vector2(x + 6, y + 12), text,
			HORIZONTAL_ALIGNMENT_LEFT, -1, 10, Color(0.96, 0.91, 0.77, 0.8))
		x += tw + 4

func _draw_card(key: String, y: float, w: float):
	var unlocked = _is_unlocked(key)
	var level = _get_level(key)
	var max_lvl = _get_max_level(key)
	var maxed = level >= max_lvl
	var afford = _can_afford(key)

	# Card background
	var card_color = Color(0.96, 0.91, 0.77, 0.09 if unlocked else 0.04)
	_draw_rounded_rect(Rect2(16, y, w - 32, CARD_H), card_color, true, -1, 14)
	_draw_rounded_rect(Rect2(16, y, w - 32, CARD_H), Color(0.96, 0.91, 0.77, 0.2 if unlocked else 0.1), false, 1, 14)

	# Label
	var label_color = Color(0.96, 0.91, 0.77, 0.95 if unlocked else 0.4)
	draw_string(ThemeDB.fallback_font, Vector2(30, y + 22), _get_label(key),
		HORIZONTAL_ALIGNMENT_LEFT, -1, 15, label_color)

	# Level pill
	if unlocked and max_lvl > 1:
		var lvl_text = "LV %d" % level
		_draw_rounded_rect(Rect2(30, y + 50, 50, 14), Color(0.96, 0.91, 0.77, 0.15), true, -1, 7)
		draw_string(ThemeDB.fallback_font, Vector2(35, y + 62), lvl_text,
			HORIZONTAL_ALIGNMENT_LEFT, -1, 10, Color(0.96, 0.91, 0.77, 0.7))

	# Buy button
	var btn_x = w - 126.0
	var btn_y = y + (CARD_H - 38) / 2
	var btn_w = 100.0
	var btn_h = 38.0
	if not unlocked:
		_draw_rounded_rect(Rect2(btn_x, btn_y, btn_w, btn_h), Color(0.96, 0.91, 0.77, 0.06), true, -1, 19)
		var req_text = "Locked"
		var u = GameData.upgrades.get(key)
		if u and u.get("requires_earned", 0) > 0:
			req_text = "Earn $%d" % u["requires_earned"]
		draw_string(ThemeDB.fallback_font, Vector2(btn_x + 10, btn_y + 24), req_text,
			HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color(0.96, 0.91, 0.77, 0.35))
	elif maxed:
		_draw_rounded_rect(Rect2(btn_x, btn_y, btn_w, btn_h), Color(0.42, 0.61, 0.29, 0.3), true, -1, 19)
		draw_string(ThemeDB.fallback_font, Vector2(btn_x + 35, btn_y + 25), "MAX",
			HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Color(0.42, 0.61, 0.29, 0.9))
	else:
		var bg_color = Color("#c8a04f") if afford else Color(0.96, 0.91, 0.77, 0.12)
		_draw_rounded_rect(Rect2(btn_x, btn_y, btn_w, btn_h), bg_color, true, -1, 19)
		var cost_text = "$%d" % _get_cost(key)
		var text_color = Color("#1f120a") if afford else Color(0.96, 0.91, 0.77, 0.35)
		draw_string(ThemeDB.fallback_font, Vector2(btn_x + 15, btn_y + 25), cost_text,
			HORIZONTAL_ALIGNMENT_LEFT, -1, 14, text_color)

func _draw_confirm_modal():
	# Dim overlay
	_draw_rounded_rect(Rect2(0, 0, size.x, size.y), Color(0.04, 0.08, 0.02, 0.7))
	var cw = min(size.x - 32, 340)
	var ch = 220
	var cx = (size.x - cw) / 2
	var cy = (size.y - ch) / 2
	# Parchment card
	_draw_rounded_rect(Rect2(cx, cy, cw, ch), Color(0.97, 0.91, 0.77, 0.97), true, -1, 20)
	_draw_rounded_rect(Rect2(cx, cy, cw, ch), Color(0.24, 0.14, 0.07, 0.6), false, 1.5, 20)
	# Title
	var label = _get_label(pending_purchase)
	var level = _get_level(pending_purchase)
	var title = "%s LV %d → %d" % [label, level, level + 1]
	draw_string(ThemeDB.fallback_font, Vector2(cx + cw / 2 - 80, cy + 35), title,
		HORIZONTAL_ALIGNMENT_LEFT, -1, 17, Color("#2a1810"))
	# Cost
	var cost = _get_cost(pending_purchase)
	draw_string(ThemeDB.fallback_font, Vector2(cx + cw / 2 - 30, cy + 130), "Cost: $%d" % cost,
		HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Color("#2a1810"))
	# Cancel button
	var btn_w = cw * 0.42
	var btn_h = 46
	var btn_y = cy + ch - btn_h - 16
	_draw_rounded_rect(Rect2(cx + 12, btn_y, btn_w, btn_h), Color(0.16, 0.09, 0.04, 0.08), true, -1, 23)
	_draw_rounded_rect(Rect2(cx + 12, btn_y, btn_w, btn_h), Color(0.24, 0.14, 0.07, 0.45), false, 1, 23)
	draw_string(ThemeDB.fallback_font, Vector2(cx + 12 + btn_w / 2 - 20, btn_y + 30), "Cancel",
		HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Color("#2a1810"))
	# Buy button
	_draw_rounded_rect(Rect2(cx + cw - btn_w - 12, btn_y, btn_w, btn_h), Color("#c8a04f"), true, -1, 23)
	draw_string(ThemeDB.fallback_font, Vector2(cx + cw - btn_w - 12 + btn_w / 2 - 25, btn_y + 30),
		"Buy $%d" % cost, HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Color("#1f120a"))
