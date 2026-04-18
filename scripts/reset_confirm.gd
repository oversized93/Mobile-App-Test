extends Control
## ResetConfirm — modal dialog for resetting all progress.

signal confirmed()
signal cancelled()

func _draw():
	# Dim overlay
	draw_rect(Rect2(0, 0, size.x, size.y), Color(0.04, 0.08, 0.02, 0.65))
	# Parchment card
	var cw = min(size.x - 40, 340)
	var ch = 220
	var cx = (size.x - cw) / 2
	var cy = (size.y - ch) / 2
	draw_rect(Rect2(cx, cy, cw, ch), Color(0.97, 0.91, 0.77, 0.97), true, -1, 20)
	draw_rect(Rect2(cx, cy, cw, ch), Color(0.24, 0.14, 0.07, 0.6), false, 1.5, 20)
	# Title
	draw_string(ThemeDB.fallback_font, Vector2(cx + cw / 2 - 75, cy + 48),
		"Reset everything?", HORIZONTAL_ALIGNMENT_LEFT, -1, 19, Color("#2a1810"))
	# Body
	draw_string(ThemeDB.fallback_font, Vector2(cx + cw / 2 - 90, cy + 86),
		"Money, river, and all upgrades", HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Color(0.16, 0.09, 0.04, 0.65))
	draw_string(ThemeDB.fallback_font, Vector2(cx + cw / 2 - 85, cy + 104),
		"will be erased. Cannot be undone.", HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Color(0.16, 0.09, 0.04, 0.65))
	# Buttons
	var btn_w = cw * 0.42
	var btn_h = 46
	var btn_y = cy + ch - btn_h - 16
	# Cancel
	draw_rect(Rect2(cx + 12, btn_y, btn_w, btn_h), Color(0.16, 0.09, 0.04, 0.08), true, -1, 23)
	draw_rect(Rect2(cx + 12, btn_y, btn_w, btn_h), Color(0.24, 0.14, 0.07, 0.45), false, 1, 23)
	draw_string(ThemeDB.fallback_font, Vector2(cx + 12 + btn_w / 2 - 22, btn_y + 30),
		"Cancel", HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Color("#2a1810"))
	# Confirm
	draw_rect(Rect2(cx + cw - btn_w - 12, btn_y, btn_w, btn_h), Color("#c65540"), true, -1, 23)
	draw_string(ThemeDB.fallback_font, Vector2(cx + cw - btn_w - 12 + btn_w / 2 - 18, btn_y + 30),
		"Reset", HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Color.WHITE)

func _gui_input(event: InputEvent):
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		_handle_tap(event.position)
	elif event is InputEventScreenTouch and not event.pressed:
		_handle_tap(event.position)

func _handle_tap(pos: Vector2):
	var cw = min(size.x - 40, 340)
	var ch = 220
	var cx = (size.x - cw) / 2
	var cy = (size.y - ch) / 2
	var btn_w = cw * 0.42
	var btn_h = 46
	var btn_y = cy + ch - btn_h - 16
	if Rect2(cx + 12, btn_y, btn_w, btn_h).has_point(pos):
		emit_signal("cancelled")
	elif Rect2(cx + cw - btn_w - 12, btn_y, btn_w, btn_h).has_point(pos):
		emit_signal("confirmed")
