extends Node2D
## Animal — a single creature flowing along the river.

var animal_type: String = "fish"
var base_value: float = 1.0
var path_t: float = 0.0
var speed: float = 70.0
var flow_time: float = 0.0
var side_offset: float = 0.0
var wobble: float = 0.0

# Smooth rendering state (lerped for buttery motion)
var render_pos: Vector2 = Vector2.ZERO
var render_angle: float = 0.0
var style: String = "swim"  # "swim" or "lilypad"

# Body + spot colors
var body_color: Color = Color("#f6ede0")
var spot_color: Color = Color("#d65a2a")

const ANIMAL_DATA = {
	"fish":       { "value": 1,   "speed": 1.0,  "style": "swim",    "body": "#f6ede0", "spot": "#d65a2a" },
	"goldfish":   { "value": 2,   "speed": 1.05, "style": "swim",    "body": "#ffd866", "spot": "#e8a030" },
	"catfish":    { "value": 5,   "speed": 0.88, "style": "swim",    "body": "#5a6670", "spot": "#3a4550" },
	"dragonfish": { "value": 12,  "speed": 0.82, "style": "swim",    "body": "#e84848", "spot": "#8a1818" },
	"goldenkoi":  { "value": 30,  "speed": 0.78, "style": "swim",    "body": "#fff0c0", "spot": "#c8942a" },
	"spiritfish": { "value": 80,  "speed": 0.7,  "style": "swim",    "body": "#d4c8ff", "spot": "#8a6add" },
	"frog":       { "value": 3,   "speed": 0.9,  "style": "lilypad", "body": "#5aaa3a", "spot": "#2d6618" },
	"turtle":     { "value": 8,   "speed": 0.55, "style": "lilypad", "body": "#7a6a4a", "spot": "#4a3a2a" },
	"duck":       { "value": 15,  "speed": 0.78, "style": "lilypad", "body": "#f5e540", "spot": "#d9a020" },
	"crane":      { "value": 40,  "speed": 0.6,  "style": "lilypad", "body": "#f0ece8", "spot": "#1a1a20" },
	"panda":      { "value": 100, "speed": 0.4,  "style": "lilypad", "body": "#f0ece8", "spot": "#2a2a30" },
}

func setup(type_id: String):
	animal_type = type_id
	var data = ANIMAL_DATA.get(type_id, ANIMAL_DATA["fish"])
	base_value = data["value"]
	speed = 70.0 * data["speed"]
	style = data["style"]
	body_color = Color(data["body"])
	spot_color = Color(data["spot"])
	side_offset = randf_range(-0.95, 0.95)
	wobble = randf() * TAU

func update_flow(delta: float, river_length: float, speed_mult: float):
	var effective_speed = speed * speed_mult
	path_t += (effective_speed / max(river_length, 1.0)) * delta
	flow_time += delta
	wobble += delta * 2.5
	# Gentle meandering
	side_offset += sin(wobble * 0.4 + flow_time * 0.3) * 0.003
	side_offset = clamp(side_offset, -0.95, 0.95)

func update_render(target_pos: Vector2, target_angle: float, river_width: float):
	# Compute offset position within the river width
	var offset = side_offset * river_width * 0.42
	var normal = Vector2(-sin(target_angle), cos(target_angle))
	var final_pos = target_pos + normal * offset
	# Smooth lerp
	render_pos = render_pos.lerp(final_pos, 0.12)
	var angle_diff = wrapf(target_angle - render_angle, -PI, PI)
	render_angle += angle_diff * 0.1
	position = render_pos
	rotation = render_angle + sin(wobble) * 0.08

func _draw():
	var scale_factor = GameData.get_view_scale()
	if style == "lilypad":
		_draw_lilypad(scale_factor)
	else:
		_draw_swimmer(scale_factor)

func _draw_swimmer(s: float):
	var len = 14.0 * s
	var wid = 7.0 * s
	# Shadow
	draw_set_transform(Vector2(0.5, 1.0))
	draw_colored_polygon(
		_make_ellipse(Vector2.ZERO, len, wid * 0.55),
		Color(0.12, 0.07, 0.03, 0.3)
	)
	draw_set_transform(Vector2.ZERO)
	# Body
	draw_colored_polygon(_make_ellipse(Vector2.ZERO, len, wid), body_color)
	# Spots
	draw_colored_polygon(
		_make_ellipse(Vector2(-len * 0.3, -wid * 0.25), len * 0.35, wid * 0.45),
		spot_color
	)
	draw_colored_polygon(
		_make_ellipse(Vector2(len * 0.15, wid * 0.2), len * 0.3, wid * 0.4),
		spot_color
	)
	# Tail
	var tail = PackedVector2Array([
		Vector2(-len, 0),
		Vector2(-len * 1.6, -wid * 0.7),
		Vector2(-len * 1.6, wid * 0.7),
	])
	draw_colored_polygon(tail, body_color)
	# Eye
	draw_circle(Vector2(len * 0.55, -wid * 0.2), wid * 0.18, Color(0.1, 0.1, 0.12))

func _draw_lilypad(s: float):
	var pad_r = 8.0 * s
	# Pad shadow
	draw_colored_polygon(_make_ellipse(Vector2(0, 1.5), pad_r + 1, (pad_r + 1) * 0.7), Color(0.16, 0.31, 0.08, 0.35))
	# Pad
	draw_colored_polygon(_make_ellipse(Vector2.ZERO, pad_r, pad_r * 0.8), Color("#5a9a38"))
	# Rider blob
	var blob_r = pad_r * 0.55
	draw_colored_polygon(_make_ellipse(Vector2(0, -blob_r * 0.3), blob_r, blob_r), body_color)
	draw_colored_polygon(
		_make_ellipse(Vector2(-blob_r * 0.2, -blob_r * 0.4), blob_r * 0.45, blob_r * 0.45),
		spot_color
	)
	# Eye
	draw_circle(Vector2(blob_r * 0.35, -blob_r * 0.5), blob_r * 0.15, Color(0.1, 0.1, 0.12))

func _make_ellipse(center: Vector2, rx: float, ry: float, segments: int = 16) -> PackedVector2Array:
	var pts = PackedVector2Array()
	for i in range(segments):
		var angle = TAU * i / segments
		pts.append(center + Vector2(cos(angle) * rx, sin(angle) * ry))
	return pts
