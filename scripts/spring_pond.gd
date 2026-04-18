extends Node2D
## SpringPond — draws the source spring (top) and outlet pond (bottom).

@export var spring_y: float = 80.0
@export var pond_y: float = 700.0

func _ready():
	_update_positions()

func _update_positions():
	var h = get_viewport_rect().size.y
	spring_y = 70.0
	pond_y = h - 155.0

func _draw():
	var w = get_viewport_rect().size.x
	_draw_spring(w)
	_draw_pond(w)

func _draw_spring(screen_w: float):
	var cx = screen_w / 2.0
	var cy = spring_y

	# Source zone ground tint
	draw_rect(Rect2(0, 48, screen_w, 56), Color(0.12, 0.24, 0.08, 0.4))

	# Stone outcroppings
	_draw_stone(cx - 60, cy, 52, 36)
	_draw_stone(cx + 60, cy, 52, 36)

	# Spring pool
	_draw_ellipse(Vector2(cx, cy + 2), 50, 10, Color("#32343a"))
	_draw_ellipse(Vector2(cx, cy), 44, 8, Color("#1d3c55"))
	_draw_ellipse(Vector2(cx, cy - 1), 38, 6, Color("#4a8fb5"))
	_draw_ellipse(Vector2(cx, cy - 2), 28, 4, Color("#a5d8e8"))

	# Sparkle
	var sparkle_x = cx + sin(Time.get_ticks_msec() / 400.0) * 8
	draw_circle(Vector2(sparkle_x, cy - 1), 1.6, Color(1, 1, 1, 0.65))

func _draw_pond(screen_w: float):
	var cx = screen_w / 2.0
	var cy = pond_y
	var pw = min(180.0, screen_w * 0.52)
	var ph = 30.0

	# Earth ring
	_draw_ellipse(Vector2(cx, cy + 2), pw * 0.52, ph * 0.62, Color(0.08, 0.16, 0.05, 0.55))
	# Stone rim
	_draw_ellipse(Vector2(cx, cy), pw * 0.48, ph * 0.58, Color("#32343a"))
	# Deep water
	_draw_ellipse(Vector2(cx, cy), pw * 0.43, ph * 0.5, Color("#1a3244"))
	# Surface sheen
	_draw_ellipse(Vector2(cx, cy), pw * 0.41, ph * 0.47, Color(0.64, 0.78, 0.85, 0.55))

	# Lily pads
	var pads = [
		Vector2(cx - pw * 0.22, cy - ph * 0.1),
		Vector2(cx + pw * 0.18, cy + ph * 0.08),
		Vector2(cx - pw * 0.05, cy + ph * 0.14),
	]
	for pad_pos in pads:
		_draw_ellipse(pad_pos + Vector2(0, 1), 9, 5, Color("#2e5220"))
		_draw_ellipse(pad_pos, 8, 5, Color("#6ea848"))

	# Ripple
	var ripple_r = fmod(Time.get_ticks_msec() / 800.0, 1.0) * pw * 0.3
	draw_arc(Vector2(cx, cy), ripple_r, 0, TAU, 32, Color(0.86, 0.94, 0.98, 0.22), 1.0)

func get_spring_rect() -> Rect2:
	var cx = get_viewport_rect().size.x / 2.0
	var w = min(160.0, get_viewport_rect().size.x * 0.42)
	return Rect2(cx - w / 2 - 10, spring_y - 12, w + 20, 44)

func get_pond_rect() -> Rect2:
	var cx = get_viewport_rect().size.x / 2.0
	var w = min(180.0, get_viewport_rect().size.x * 0.52)
	return Rect2(cx - w / 2, pond_y - 20, w, 60)

func _draw_stone(cx: float, cy: float, w: float, h: float):
	_draw_ellipse(Vector2(cx, cy + 4), w * 0.5, h * 0.55, Color("#32343a"))
	_draw_ellipse(Vector2(cx, cy), w * 0.47, h * 0.5, Color("#4a4d55"))
	_draw_ellipse(Vector2(cx - 2, cy - 3), w * 0.35, h * 0.35, Color("#6e7178"))
	# Moss cap
	_draw_ellipse(Vector2(cx, cy - h * 0.3), w * 0.42, h * 0.18, Color("#2e5220"))
	_draw_ellipse(Vector2(cx - 1, cy - h * 0.35), w * 0.35, h * 0.13, Color("#7ab358"))

func _draw_ellipse(center: Vector2, rx: float, ry: float, color: Color, segments: int = 24):
	var pts = PackedVector2Array()
	for i in range(segments):
		var angle = TAU * i / segments
		pts.append(center + Vector2(cos(angle) * rx, sin(angle) * ry))
	draw_colored_polygon(pts, color)
