extends Node2D
## RockObstacle — a placed obstacle on the river that slows animals.

var path_t: float = 0.0  # position along the river (0..1)

func setup(t: float, river_drawer):
	path_t = t
	var sample = river_drawer.sample_point(t)
	position = sample["pos"]

func _draw():
	var s = GameData.get_view_scale()
	var r = 9.0 * s
	# Get the best obstacle type's visual
	# Dark stone base
	_draw_ellipse(Vector2(0, r * 0.2), r * 1.1, r * 0.9, Color("#32343a"))
	# Lighter cap
	_draw_ellipse(Vector2(-r * 0.15, -r * 0.1), r * 0.95, r * 0.75, Color("#4a4d55"))
	_draw_ellipse(Vector2(-r * 0.25, -r * 0.25), r * 0.55, r * 0.42, Color("#6e7178"))
	# Moss on top
	_draw_ellipse(Vector2(-r * 0.2, -r * 0.45), r * 0.75, r * 0.25, Color("#7ab358"))
	# Foam eddy
	draw_arc(Vector2(r * 0.6, 0), r * 0.8, -0.5, 0.5, 12, Color(0.94, 0.97, 0.98, 0.55), 1)

func _draw_ellipse(center: Vector2, rx: float, ry: float, color: Color, segments: int = 16):
	var pts = PackedVector2Array()
	for i in range(segments):
		var angle = TAU * i / segments
		pts.append(center + Vector2(cos(angle) * rx, sin(angle) * ry))
	draw_colored_polygon(pts, color)
