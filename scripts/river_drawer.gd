extends Node2D
## RiverDrawer — handles touch input for drawing the river polyline,
## Chaikin smoothing, self-intersection prevention, and rendering
## via a Polygon2D with the water shader.

signal river_committed(points: PackedVector2Array)
signal river_cleared()

@export var base_width: float = 66.0
@export var min_point_dist: float = 3.0
@export var self_overlap_factor: float = 0.9
@export var smoothing_iterations: int = 2

var river_points: PackedVector2Array = PackedVector2Array()
var draft_points: PackedVector2Array = PackedVector2Array()
var is_drawing: bool = false
var has_river: bool = false

@onready var river_polygon: Polygon2D = $RiverPolygon
@onready var bank_line_left: Line2D = $BankLineLeft
@onready var bank_line_right: Line2D = $BankLineRight

func get_river_width() -> float:
	return base_width * GameData.get_view_scale() * GameData.get_river_width_bonus()

# ---- Drawing lifecycle ----
func start_drawing(pos: Vector2):
	if has_river:
		return
	draft_points = PackedVector2Array([pos])
	is_drawing = true

func extend_drawing(pos: Vector2):
	if not is_drawing:
		return
	var last = draft_points[-1]
	var dist = pos.distance_to(last)
	if dist < min_point_dist:
		return
	# Self-intersection check
	var min_dist = get_river_width() * self_overlap_factor
	var check_end = max(0, draft_points.size() - 25)
	for i in range(0, check_end, 3):
		if pos.distance_to(draft_points[i]) < min_dist:
			return
	draft_points.append(pos)

func finish_drawing(pond_rect: Rect2) -> bool:
	is_drawing = false
	if draft_points.size() < 3:
		draft_points = PackedVector2Array()
		return false
	# Must reach the pond
	if not pond_rect.has_point(draft_points[-1]):
		draft_points = PackedVector2Array()
		return false
	# Smooth and commit
	river_points = _smooth_polyline(draft_points, smoothing_iterations)
	draft_points = PackedVector2Array()
	has_river = true
	_rebuild_river_mesh()
	emit_signal("river_committed", river_points)
	return true

func cancel_drawing():
	is_drawing = false
	draft_points = PackedVector2Array()

func clear_river():
	river_points = PackedVector2Array()
	draft_points = PackedVector2Array()
	has_river = false
	is_drawing = false
	if river_polygon:
		river_polygon.polygon = PackedVector2Array()
	if bank_line_left:
		bank_line_left.clear_points()
	if bank_line_right:
		bank_line_right.clear_points()
	emit_signal("river_cleared")

# ---- River total length ----
func get_total_length() -> float:
	var total = 0.0
	for i in range(1, river_points.size()):
		total += river_points[i].distance_to(river_points[i - 1])
	return total

# ---- Sample a point along the river at t (0..1) ----
func sample_point(t: float) -> Dictionary:
	if river_points.size() < 2:
		return { "pos": Vector2.ZERO, "angle": 0.0 }
	var total_len = get_total_length()
	var target = clamp(t, 0.0, 1.0) * total_len
	var acc = 0.0
	for i in range(1, river_points.size()):
		var a = river_points[i - 1]
		var b = river_points[i]
		var seg = a.distance_to(b)
		if acc + seg >= target or i == river_points.size() - 1:
			var k = seg if seg > 0 else 1.0
			var frac = (target - acc) / k
			var pos = a.lerp(b, clamp(frac, 0, 1))
			var angle = (b - a).angle()
			return { "pos": pos, "angle": angle }
		acc += seg
	return { "pos": river_points[-1], "angle": 0.0 }

# ---- Chaikin corner-cutting smoothing ----
func _smooth_polyline(pts: PackedVector2Array, iterations: int) -> PackedVector2Array:
	var result = pts
	for _iter in range(iterations):
		var smoothed = PackedVector2Array([result[0]])
		for i in range(result.size() - 1):
			var a = result[i]
			var b = result[i + 1]
			smoothed.append(a * 0.75 + b * 0.25)
			smoothed.append(a * 0.25 + b * 0.75)
		smoothed.append(result[-1])
		result = smoothed
	return result

# ---- Build the river polygon mesh + bank lines ----
func _rebuild_river_mesh():
	if river_points.size() < 2:
		return
	var half_w = get_river_width() / 2.0
	var left_bank: PackedVector2Array = PackedVector2Array()
	var right_bank: PackedVector2Array = PackedVector2Array()

	for i in range(river_points.size()):
		var normal = _get_smooth_normal(i)
		# Organic wobble
		var wobble = sin(i * 0.22 + 42.0) * 3.5 + sin(i * 0.55 + 71.0) * 1.5
		left_bank.append(river_points[i] + normal * (half_w + wobble))
		right_bank.append(river_points[i] - normal * (half_w - wobble * 0.7))

	# Build polygon: left bank forward, right bank backward
	var polygon = PackedVector2Array()
	polygon.append_array(left_bank)
	var right_reversed = right_bank.duplicate()
	right_reversed.reverse()
	polygon.append_array(right_reversed)

	# Build UVs: x=0 at left bank, x=1 at right bank, y=arclength normalized
	var uvs = PackedVector2Array()
	var total_len = get_total_length()
	var arc = 0.0
	for i in range(left_bank.size()):
		if i > 0:
			arc += river_points[i].distance_to(river_points[i - 1])
		var v = arc / max(total_len, 1.0)
		uvs.append(Vector2(0.0, v))
	arc = total_len
	for i in range(right_bank.size() - 1, -1, -1):
		if i < right_bank.size() - 1:
			arc -= river_points[i + 1].distance_to(river_points[i])
		var v = arc / max(total_len, 1.0)
		uvs.append(Vector2(1.0, v))

	if river_polygon:
		river_polygon.polygon = polygon
		river_polygon.uv = uvs

	# Bank lines for mossy edge strokes
	if bank_line_left:
		bank_line_left.clear_points()
		for p in left_bank:
			bank_line_left.add_point(p)
	if bank_line_right:
		bank_line_right.clear_points()
		for p in right_bank:
			bank_line_right.add_point(p)

func _get_smooth_normal(i: int) -> Vector2:
	var pts = river_points
	if pts.size() < 2:
		return Vector2.UP
	var tangent: Vector2
	if i == 0:
		tangent = (pts[1] - pts[0]).normalized()
	elif i == pts.size() - 1:
		tangent = (pts[i] - pts[i - 1]).normalized()
	else:
		# Average direction over a wider window for smoothness
		var back = max(0, i - 8)
		var fwd = min(pts.size() - 1, i + 8)
		tangent = (pts[fwd] - pts[back]).normalized()
	return Vector2(-tangent.y, tangent.x) # perpendicular

# ---- Preview the draft while drawing ----
func _draw():
	if is_drawing and draft_points.size() >= 2:
		var smoothed = _smooth_polyline(draft_points, 1)
		var color = Color(0.27, 0.58, 0.71, 0.5)
		for i in range(1, smoothed.size()):
			draw_line(smoothed[i - 1], smoothed[i], color, get_river_width(), true)

func _process(_delta):
	if is_drawing:
		queue_redraw()
