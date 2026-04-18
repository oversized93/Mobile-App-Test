shader_type canvas_item;
// Flow-map water shader for Zen River.
// Applied to a Line2D or Polygon2D shaped to the river.
// UV.x = across the river width, UV.y = along the flow direction.

uniform vec4 deep_color : source_color = vec4(0.055, 0.125, 0.19, 1.0);
uniform vec4 surface_color : source_color = vec4(0.27, 0.58, 0.71, 1.0);
uniform vec4 highlight_color : source_color = vec4(0.65, 0.85, 0.92, 1.0);
uniform vec4 foam_color : source_color = vec4(0.94, 0.97, 0.98, 1.0);

uniform float flow_speed : hint_range(0.01, 1.0) = 0.15;
uniform float wave_scale : hint_range(1.0, 40.0) = 12.0;
uniform float wave_strength : hint_range(0.0, 0.3) = 0.08;
uniform float foam_threshold : hint_range(0.0, 1.0) = 0.72;
uniform float caustic_scale : hint_range(1.0, 30.0) = 8.0;
uniform float caustic_speed : hint_range(0.01, 1.0) = 0.08;
uniform float edge_foam_width : hint_range(0.0, 0.3) = 0.12;
uniform float depth_gradient : hint_range(0.0, 1.0) = 0.6;

// Simple hash-based noise (no texture needed)
float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f); // smoothstep
	float a = hash(i);
	float b = hash(i + vec2(1.0, 0.0));
	float c = hash(i + vec2(0.0, 1.0));
	float d = hash(i + vec2(1.0, 1.0));
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
	float v = 0.0;
	v += noise(p) * 0.5;
	v += noise(p * 2.0) * 0.25;
	v += noise(p * 4.0) * 0.125;
	return v;
}

void fragment() {
	vec2 uv = UV;

	// Flow: scroll UV along the river direction (Y axis) over time
	float t = TIME * flow_speed;

	// Two-phase flow scrolling (prevents visible seam when texture wraps)
	float phase0 = fract(t);
	float phase1 = fract(t + 0.5);
	float blend = abs(phase0 - 0.5) * 2.0;

	// Animated wave distortion perpendicular to flow
	float wave0 = fbm(vec2(uv.x * wave_scale, (uv.y - phase0) * wave_scale));
	float wave1 = fbm(vec2(uv.x * wave_scale, (uv.y - phase1) * wave_scale));
	float wave = mix(wave0, wave1, blend);

	// Distort UVs by the wave pattern
	vec2 distorted_uv = uv + vec2(wave * wave_strength, 0.0);

	// Depth: darker at edges (banks), lighter in center
	float edge_dist = abs(uv.x - 0.5) * 2.0; // 0 at center, 1 at edges
	float depth = 1.0 - pow(edge_dist, 1.5) * depth_gradient;

	// Base water color: blend deep → surface based on depth + wave
	vec4 water = mix(deep_color, surface_color, depth * (0.7 + wave * 0.3));

	// Caustic highlights — dancing light patches
	float caustic0 = fbm(vec2(uv.x * caustic_scale + TIME * caustic_speed, (uv.y - phase0) * caustic_scale));
	float caustic1 = fbm(vec2(uv.x * caustic_scale + TIME * caustic_speed, (uv.y - phase1) * caustic_scale));
	float caustic = mix(caustic0, caustic1, blend);
	water = mix(water, highlight_color, smoothstep(0.55, 0.75, caustic) * 0.4 * depth);

	// Foam at the river edges (bank foam)
	float edge_foam = smoothstep(1.0 - edge_foam_width, 1.0, edge_dist);
	float foam_noise = fbm(vec2(uv.x * 20.0, (uv.y - t * 0.5) * 15.0));
	edge_foam *= smoothstep(0.3, 0.6, foam_noise);
	water = mix(water, foam_color, edge_foam * 0.6);

	// Surface foam streaks along the current
	float foam_streak = fbm(vec2(distorted_uv.x * 6.0, (distorted_uv.y - t) * 18.0));
	float streak_mask = smoothstep(foam_threshold, foam_threshold + 0.1, foam_streak) * depth;
	water = mix(water, foam_color, streak_mask * 0.35);

	COLOR = water;
}
