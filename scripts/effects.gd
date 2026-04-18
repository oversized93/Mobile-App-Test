extends Node2D
## Effects — float text payouts and collection burst particles.

var float_texts: Array = []
var burst_particles: Array = []

func spawn_float_text(pos: Vector2, text: String):
	float_texts.append({
		"pos": pos,
		"text": text,
		"life": 1.4,
		"max_life": 1.4,
		"vy": -34.0,
	})

func spawn_burst(pos: Vector2):
	for i in range(14):
		var angle = randf() * TAU
		var spd = randf_range(30, 60)
		burst_particles.append({
			"pos": pos,
			"vx": cos(angle) * spd,
			"vy": sin(angle) * spd,
			"life": 0.8,
			"max_life": 0.8,
			"rot": randf() * TAU,
			"vrot": randf_range(-2.5, 2.5),
			"red": randf() < 0.5,
		})

func _process(delta: float):
	var dirty = false
	# Update float texts
	var i = float_texts.size() - 1
	while i >= 0:
		var ft = float_texts[i]
		ft["pos"].y += ft["vy"] * delta
		ft["vy"] *= 0.96
		ft["life"] -= delta
		if ft["life"] <= 0:
			float_texts.remove_at(i)
		dirty = true
		i -= 1
	# Update burst particles
	i = burst_particles.size() - 1
	while i >= 0:
		var bp = burst_particles[i]
		bp["pos"].x += bp["vx"] * delta
		bp["pos"].y += bp["vy"] * delta
		bp["vy"] += 100 * delta
		bp["rot"] += bp["vrot"] * delta
		bp["life"] -= delta
		if bp["life"] <= 0:
			burst_particles.remove_at(i)
		dirty = true
		i -= 1
	if dirty:
		queue_redraw()

func _draw():
	# Float texts
	for ft in float_texts:
		var a = clamp(ft["life"] / ft["max_life"], 0, 1)
		# Shadow
		draw_string(ThemeDB.fallback_font, ft["pos"] + Vector2(1, 1), ft["text"],
			HORIZONTAL_ALIGNMENT_CENTER, -1, 15, Color(0.12, 0.07, 0.02, a * 0.5))
		# Gold text
		draw_string(ThemeDB.fallback_font, ft["pos"], ft["text"],
			HORIZONTAL_ALIGNMENT_CENTER, -1, 15, Color(0.78, 0.63, 0.31, a))
	# Burst particles (maple leaf petals)
	for bp in burst_particles:
		var a = clamp(bp["life"] / bp["max_life"], 0, 1)
		var c = Color(0.78, 0.27, 0.16, a) if bp["red"] else Color(0.88, 0.48, 0.17, a)
		var pts = PackedVector2Array()
		var r = bp["rot"]
		for j in range(8):
			var ang = TAU * j / 8 + r
			var rad = 3.6 if j % 2 == 0 else 2.2
			pts.append(bp["pos"] + Vector2(cos(ang) * rad, sin(ang) * rad * 0.6))
		draw_colored_polygon(pts, c)
