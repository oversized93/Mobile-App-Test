extends Node2D
## Background — renders the zen garden: grass, moss patches,
## grass tufts, pebbles, and Japanese maple silhouettes.

var decorations_baked: bool = false
var moss_patches: Array = []
var grass_tufts: Array = []
var pebbles: Array = []

func _ready():
	_bake_decorations()

func _bake_decorations():
	var rng = RandomNumberGenerator.new()
	rng.seed = 1337
	var w = get_viewport_rect().size.x
	var h = get_viewport_rect().size.y

	# Moss patches
	var moss_count = roundi(w * h / 22000.0)
	for i in range(moss_count):
		moss_patches.append({
			"pos": Vector2(rng.randf() * w, 48 + rng.randf() * (h - 158)),
			"rx": 40 + rng.randf() * 80, "ry": 22 + rng.randf() * 40,
			"shade": 0.5 + rng.randf() * 0.5,
			"dark": rng.randf() < 0.4,
		})

	# Grass tufts
	var tuft_count = roundi(w * h / 9000.0)
	for i in range(tuft_count):
		grass_tufts.append({
			"pos": Vector2(rng.randf() * w, 68 + rng.randf() * (h - 200)),
			"h": 5 + rng.randf() * 8,
			"lean": (rng.randf() - 0.5) * 4,
			"shade": 0.6 + rng.randf() * 0.4,
		})

	# Pebbles
	var pebble_count = roundi(w * h / 30000.0)
	for i in range(pebble_count):
		pebbles.append({
			"pos": Vector2(rng.randf() * w, 68 + rng.randf() * (h - 200)),
			"r": 1.5 + rng.randf() * 2.5,
			"shade": 0.3 + rng.randf() * 0.6,
		})

	decorations_baked = true

func _draw():
	var w = get_viewport_rect().size.x
	var h = get_viewport_rect().size.y

	# Base grass gradient
	var top = Color("#4c7a3a")
	var mid = Color("#3a6a2a")
	var bot = Color("#274a18")
	for y_step in range(0, int(h), 4):
		var t = float(y_step) / h
		var c: Color
		if t < 0.55:
			c = top.lerp(mid, t / 0.55)
		else:
			c = mid.lerp(bot, (t - 0.55) / 0.45)
		draw_rect(Rect2(0, y_step, w, 4), c)

	# Moss patches
	for m in moss_patches:
		var c: Color
		if m["dark"]:
			c = Color(0.08, 0.16, 0.05, 0.25 * m["shade"])
		else:
			c = Color(0.48, 0.7, 0.34, 0.18 * m["shade"])
		_draw_ellipse_filled(m["pos"], m["rx"], m["ry"], c)

	# Grass tufts
	for g in grass_tufts:
		var c = Color(0.35, 0.53, 0.2, g["shade"])
		for blade in range(-1, 2):
			var base = g["pos"] + Vector2(blade * 2, 0)
			var tip = base + Vector2(g["lean"], -g["h"])
			draw_line(base, tip, c, 1.2, true)

	# Pebbles
	for p in pebbles:
		draw_circle(p["pos"], p["r"], Color(0.12, 0.11, 0.08, 0.4 * p["shade"]))

	# Maple silhouettes in upper corners
	_draw_maple(-30, -20, 200, false)
	_draw_maple(w + 30, -10, 180, true)

	# Vignette
	# (Godot doesn't easily do radial gradient in _draw, skip for now
	#  — can add via a shader on a fullscreen ColorRect later)

func _draw_maple(cx: float, cy: float, size: float, flip: bool):
	var sx = -1.0 if flip else 1.0

	# Trunk
	var trunk_color = Color(0.12, 0.07, 0.03, 0.55)
	draw_line(
		Vector2(cx, cy + size * 0.6),
		Vector2(cx + sx * size * 0.25, cy + size * 0.1),
		trunk_color, 6, true
	)
	draw_line(
		Vector2(cx + sx * size * 0.18, cy + size * 0.2),
		Vector2(cx + sx * size * 0.42, cy + size * 0.05),
		trunk_color, 4, true
	)

	# Foliage blobs
	var blobs = [
		{ "offset": Vector2(sx * size * 0.25, 0), "r": size * 0.55, "c": Color("#c8442a"), "a": 0.85 },
		{ "offset": Vector2(sx * size * 0.1, -size * 0.1), "r": size * 0.48, "c": Color("#e07a2c"), "a": 0.8 },
		{ "offset": Vector2(sx * size * 0.45, -size * 0.05), "r": size * 0.42, "c": Color("#e5a838"), "a": 0.7 },
		{ "offset": Vector2(sx * size * 0.3, size * 0.15), "r": size * 0.38, "c": Color("#c8442a"), "a": 0.6 },
	]
	for b in blobs:
		var pos = Vector2(cx, cy) + b["offset"]
		var c = b["c"]
		c.a = b["a"]
		_draw_ellipse_filled(pos, b["r"], b["r"], c)

func _draw_ellipse_filled(center: Vector2, rx: float, ry: float, color: Color, segments: int = 24):
	var pts = PackedVector2Array()
	for i in range(segments):
		var angle = TAU * i / segments
		pts.append(center + Vector2(cos(angle) * rx, sin(angle) * ry))
	draw_colored_polygon(pts, color)
