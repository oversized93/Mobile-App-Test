"""Rig the shipped golfer.glb with a 10-bone skeleton, manual weights,
and three authored clips (Idle, Walk, Swing). Outputs golfer_rigged.glb.
Blender axes here: X width, Y depth (face = -Y), Z up.
"""
import bpy
import numpy as np
from mathutils import Vector

SRC = '/home/user/Mobile-App-Test/assets/meshy/golfer.glb'
OUT = '/tmp/claude-0/-home-user-Mobile-App-Test/5c431b49-45b0-5637-9142-2ede58db169e/scratchpad/rig/golfer_rigged.glb'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
mesh_obj = next(o for o in bpy.data.objects if o.type == 'MESH')
me = mesh_obj.data
n = len(me.vertices)
co = np.empty(n * 3)
me.vertices.foreach_get('co', co)
co = co.reshape(-1, 3)

# ---- Skeleton layout (from slice analysis) ----
# name: (head, tail, parent)
BONES = {
    'hips':   ((0.13, 0.02, -0.32), (0.13, 0.01, -0.10), None),
    'spine':  ((0.13, 0.01, -0.10), (0.13, 0.00, 0.18), 'hips'),
    'chest':  ((0.13, 0.00, 0.18), (0.12, 0.00, 0.50), 'spine'),
    'head':   ((0.12, 0.00, 0.50), (0.10, 0.00, 0.95), 'chest'),
    'thighA': ((0.05, 0.02, -0.35), (0.05, 0.02, -0.65), 'hips'),
    'shinA':  ((0.05, 0.02, -0.65), (0.05, 0.05, -0.95), 'thighA'),
    'thighB': ((0.23, 0.02, -0.35), (0.23, 0.02, -0.65), 'hips'),
    'shinB':  ((0.23, 0.02, -0.65), (0.23, 0.05, -0.95), 'thighB'),
    'arms':   ((0.12, -0.02, 0.42), (-0.02, -0.17, 0.02), 'chest'),
    'club':   ((-0.02, -0.17, 0.02), (-0.35, -0.02, -0.93), 'arms'),
    'base':   ((0.13, 0.0, -0.95), (0.13, 0.12, -0.95), None),
}
ORDER = list(BONES.keys())

arm_data = bpy.data.armatures.new('GolferRig')
arm_obj = bpy.data.objects.new('GolferRig', arm_data)
bpy.context.scene.collection.objects.link(arm_obj)
bpy.context.view_layer.objects.active = arm_obj
bpy.ops.object.mode_set(mode='EDIT')
ebs = {}
for name in ORDER:
    h, t, parent = BONES[name]
    eb = arm_data.edit_bones.new(name)
    eb.head = Vector(h)
    eb.tail = Vector(t)
    if parent:
        eb.parent = ebs[parent]
    ebs[name] = eb
bpy.ops.object.mode_set(mode='OBJECT')

# ---- Manual weights: nearest bone segment with sharp falloff ----
def seg_dist(p, a, b):
    ab = b - a
    tt = np.clip(((p - a) @ ab) / (ab @ ab + 1e-12), 0, 1)
    proj = a + tt[:, None] * ab
    return np.linalg.norm(p - proj, axis=1)

P = co
dists = np.stack([
    seg_dist(P, np.array(BONES[nm][0]), np.array(BONES[nm][1]))
    for nm in ORDER
], axis=1)  # (n, nbones)

# Region overrides keep the sharp boundaries honest
z = P[:, 2]; x = P[:, 0]; y = P[:, 1]
iHead = ORDER.index('head'); iArms = ORDER.index('arms')
iClub = ORDER.index('club')
# Cap/head zone: nothing else may claim it
dists[z > 0.55, iArms] += 10
dists[z > 0.55, iClub] += 10
# Club may ONLY claim its own thin tube (shaft) plus a tight cluster
# around the club head — without this it stole shorts and base-slab
# verts and the swing tore them off in sheets
club_d = dists[:, iClub]
head_pt = np.array((-0.35, -0.02, -0.93))
near_head = np.linalg.norm(P - head_pt, axis=1) < 0.11
club_ok = (club_d < 0.06) | near_head
dists[~club_ok, iClub] += 10
# ...and conversely the legs/hips stay out of the club tube
for nm in ('thighA', 'shinA', 'thighB', 'shinB', 'hips', 'spine'):
    dists[club_ok & (x < -0.15), ORDER.index(nm)] += 10
# Arms only claim geometry that protrudes in front of the torso
dists[y > -0.04, iArms] += 10
# Base slab: the thin plinth under the shoes stays pinned to the
# stationary base bone so nothing drags it mid-swing
iBase = ORDER.index('base')
# Shoe footprints stay OUT of the pin: distance to each shoe's axis
# (foot joint extended toward the toe) keeps soles with their shins
def shoe_axis_dist(fx):
    a = np.array((fx, 0.05, -0.93))
    b = np.array((fx, -0.20, -0.93))
    return seg_dist(P, a, b)
shoeA = shoe_axis_dist(0.05) < 0.085
shoeB = shoe_axis_dist(0.23) < 0.085
slab = (z < -0.915) & ~near_head & ~shoeA & ~shoeB
dists[:, iBase] += 10             # base claims nothing by distance...
dists[slab, iBase] -= 20          # ...except the slab, which it owns


best2 = np.argsort(dists, axis=1)[:, :2]
d1 = dists[np.arange(n), best2[:, 0]]
d2 = dists[np.arange(n), best2[:, 1]]
w1 = 1.0 / (d1 + 1e-5) ** 4
w2 = 1.0 / (d2 + 1e-5) ** 4
tot = w1 + w2
w1 /= tot; w2 /= tot
# Hard assign when dominant
hard = d1 < 0.5 * d2
w1[hard] = 1.0; w2[hard] = 0.0

groups = {nm: mesh_obj.vertex_groups.new(name=nm) for nm in ORDER}
for vi in range(n):
    b1, b2 = best2[vi]
    groups[ORDER[b1]].add([vi], float(w1[vi]), 'REPLACE')
    if w2[vi] > 0.01:
        groups[ORDER[b2]].add([vi], float(w2[vi]), 'REPLACE')

mod = mesh_obj.modifiers.new('Armature', 'ARMATURE')
mod.object = arm_obj
mesh_obj.parent = arm_obj

# ---- Animation authoring ----
import math
FPS = 24
bpy.context.scene.render.fps = FPS
bpy.context.view_layer.objects.active = arm_obj
bpy.ops.object.mode_set(mode='POSE')
pb = arm_obj.pose.bones
for b in pb:
    b.rotation_mode = 'XYZ'

def clip(name, length, keys):
    """keys: {frame: {bone: (rx, ry, rz) degrees}}"""
    action = bpy.data.actions.new(name)
    arm_obj.animation_data_create()
    arm_obj.animation_data.action = action
    for b in pb:
        b.rotation_euler = (0, 0, 0)
        b.location = (0, 0, 0)
    for frame in sorted(keys):
        bpy.context.scene.frame_set(frame)
        # reset all, then apply specified
        for b in pb:
            b.rotation_euler = (0, 0, 0)
        for bone, rot in keys[frame].items():
            if bone == '_loc':
                for bn, loc in rot.items():
                    pb[bn].location = loc
                    pb[bn].keyframe_insert('location', frame=frame)
                continue
            pb[bone].rotation_euler = tuple(math.radians(v) for v in rot)
        for b in pb:
            b.keyframe_insert('rotation_euler', frame=frame)
    # push to NLA so the exporter emits it as its own glTF animation
    tr = arm_obj.animation_data.nla_tracks.new()
    tr.name = name
    tr.strips.new(name, 1, action)
    arm_obj.animation_data.action = None
    return action

# Idle: weight shift + head look, 72f loop
clip('Idle', 72, {
    1:  {},
    24: {'spine': (0, 0, 2.0), 'chest': (1.2, 0, 1.0), 'head': (0, 0, 5),
         'hips': (0, 0, -1.2), 'arms': (2, 0, 0)},
    48: {'spine': (0, 0, -1.5), 'chest': (-0.8, 0, -1.2), 'head': (0, 0, -4),
         'hips': (0, 0, 1.0), 'arms': (-1.5, 0, 0)},
    72: {},
})

# Walk: leg swings around X (forward = -Y), 24f loop
W = 26
clip('Walk', 24, {
    1:  {'thighA': (-W, 0, 0), 'shinA': (12, 0, 0),
         'thighB': (W, 0, 0), 'shinB': (20, 0, 0),
         'spine': (4, 0, 0), 'arms': (6, 0, 0), 'hips': (0, 2, 0)},
    7:  {'thighA': (0, 0, 0), 'shinA': (24, 0, 0),
         'thighB': (0, 0, 0), 'shinB': (6, 0, 0),
         'spine': (5.5, 0, 0), 'arms': (7.5, 0, 0)},
    13: {'thighA': (W, 0, 0), 'shinA': (20, 0, 0),
         'thighB': (-W, 0, 0), 'shinB': (12, 0, 0),
         'spine': (4, 0, 0), 'arms': (6, 0, 0), 'hips': (0, -2, 0)},
    19: {'thighA': (0, 0, 0), 'shinA': (6, 0, 0),
         'thighB': (0, 0, 0), 'shinB': (24, 0, 0),
         'spine': (5.5, 0, 0), 'arms': (7.5, 0, 0)},
    24: {'thighA': (-W, 0, 0), 'shinA': (12, 0, 0),
         'thighB': (W, 0, 0), 'shinB': (20, 0, 0),
         'spine': (4, 0, 0), 'arms': (6, 0, 0), 'hips': (0, 2, 0)},
})

# Swing: address -> backswing -> strike -> follow-through, 48f
clip('Swing', 48, {
    1:  {},
    14: {'chest': (0, 0, -34), 'spine': (0, 0, -12),
         'arms': (-55, 0, -20), 'club': (55, 0, 0),
         'hips': (0, 0, -8), 'head': (0, 0, 20)},
    20: {'chest': (0, 0, -36), 'spine': (0, 0, -13),
         'arms': (-62, 0, -22), 'club': (70, 0, 0),
         'hips': (0, 0, -9), 'head': (0, 0, 22)},
    26: {'chest': (0, 0, 18), 'spine': (0, 0, 8),
         'arms': (8, 0, 10), 'club': (-10, 0, 0),
         'hips': (0, 0, 6), 'head': (0, 0, -4)},
    34: {'chest': (0, 0, 38), 'spine': (0, 0, 14),
         'arms': (-40, 0, 26), 'club': (40, 0, 0),
         'hips': (0, 0, 10), 'head': (0, 0, -16)},
    48: {},
})

bpy.ops.object.mode_set(mode='OBJECT')

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    export_animations=True,
    export_skins=True,
    export_yup=True,
    export_apply=False,
    export_animation_mode='NLA_TRACKS',
)
import os
print('exported', OUT, os.path.getsize(OUT), 'bytes')
