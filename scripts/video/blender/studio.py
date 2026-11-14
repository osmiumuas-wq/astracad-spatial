"""Blender studio for the demo video: renders the app's real exported parts (artifacts/video/parts/*.stl).

Run headless:  blender -b -P scripts/video/blender/studio.py -- <shot> [--frames N] [--still]
Shots render PNG frames to artifacts/video/blender/<shot>/.
Every part shown is the STL the app's kernel built and its truth gate verified (tests/video-export.test.ts).
"""
import math
import os
import sys

import bpy
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
PARTS = os.path.join(ROOT, 'artifacts', 'video', 'parts')
OUT = os.path.join(ROOT, 'artifacts', 'video', 'blender')
FPS = 30

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SHOT = argv[0] if argv else 'test'
STILL = '--still' in argv


# ---------------------------------------------------------------------------
# Scene basics
# ---------------------------------------------------------------------------

def clean():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps = FPS
    sc.render.resolution_x = 1920
    sc.render.resolution_y = 1080
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    sc.unit_settings.scale_length = 0.001
    eng = sc.render
    try:
        eng.engine = 'BLENDER_EEVEE_NEXT'
    except TypeError:
        eng.engine = 'BLENDER_EEVEE'
    ee = sc.eevee
    for attr, val in (('taa_render_samples', 32), ('use_raytracing', True), ('use_shadows', True),
                      ('use_gtao', True), ('use_bloom', True)):
        if hasattr(ee, attr):
            setattr(ee, attr, val)
    if hasattr(ee, 'ray_tracing_options'):
        ee.ray_tracing_options.resolution_scale = '1'
    world = bpy.data.worlds.new('World')
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.006, 0.007, 0.016, 1)
    bg.inputs[1].default_value = 1.0
    return sc


def material_pla(name, color, rough=0.42):
    """Printed PLA: slightly glossy plastic with fine horizontal layer lines."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    if 'Coat Weight' in bsdf.inputs:
        bsdf.inputs['Coat Weight'].default_value = 0.15
    if 'Subsurface Weight' in bsdf.inputs:
        bsdf.inputs['Subsurface Weight'].default_value = 0.05
    # Layer lines every 0.2 mm (object units are mm): a sine of world Z drives a tiny bump.
    tex = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    mul = nt.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = 2 * math.pi / 0.2
    sine = nt.nodes.new('ShaderNodeMath')
    sine.operation = 'SINE'
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.08
    bump.inputs['Distance'].default_value = 0.02
    nt.links.new(tex.outputs['Object'], sep.inputs[0])
    nt.links.new(sep.outputs['Z'], mul.inputs[0])
    nt.links.new(mul.outputs[0], sine.inputs[0])
    nt.links.new(sine.outputs[0], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def material_emit(name, color, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0, 0, 0, 1)
    bsdf.inputs['Emission Color'].default_value = (*color, 1)
    bsdf.inputs['Emission Strength'].default_value = strength
    return m


def material_plinth():
    m = bpy.data.materials.new('plinth')
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0.012, 0.013, 0.022, 1)
    bsdf.inputs['Roughness'].default_value = 0.32
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = 0.6
    return m


LAY_FLAT = {'flange-plate'}


def load_part(job, mat, location=(0, 0, 0), lift=True):
    """Import the app's STL (mm), centre it on X/Y, stand it on Z = 0 (Blender Z up; the app's Y up)."""
    path = os.path.join(PARTS, f'{job}.stl')
    before = set(bpy.data.objects)
    bpy.ops.wm.stl_import(filepath=path, up_axis='Y', forward_axis='NEGATIVE_Z')
    obj = (set(bpy.data.objects) - before).pop()
    obj.name = job
    # Parts sketched on the front plane as discs lie flat on the bench in the app: lay them flat here too.
    if job in LAY_FLAT:
        obj.rotation_euler = (math.radians(90), 0, 0)
        bpy.context.view_layer.update()
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')
    obj.location = (0, 0, 0)
    bpy.context.view_layer.update()
    zmin = min((obj.matrix_world @ Vector(c)).z for c in obj.bound_box)
    obj.location = (location[0], location[1], location[2] - (zmin if lift else 0))
    bpy.ops.object.shade_auto_smooth(angle=math.radians(35)) if hasattr(bpy.ops.object, 'shade_auto_smooth') else None
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    obj.select_set(False)
    return obj


def floor(size=60000, z=0):
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, z))
    f = bpy.context.object
    f.data.materials.append(material_plinth())
    return f


def plinth(radius, height, location):
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=radius, depth=height, location=(location[0], location[1], location[2] - height / 2))
    p = bpy.context.object
    bpy.ops.object.shade_smooth()
    p.data.materials.append(material_plinth())
    # A thin glowing ring at the rim, the app's bench colour.
    bpy.ops.mesh.primitive_torus_add(major_radius=radius, minor_radius=0.6, location=location)
    ring = bpy.context.object
    ring.data.materials.append(material_emit('rim', (0.25, 0.95, 0.55), 6))
    return p


def area_light(name, location, rotation, power, size, color=(1, 1, 1)):
    d = bpy.data.lights.new(name, 'AREA')
    d.energy = power
    d.size = size
    d.color = color
    o = bpy.data.objects.new(name, d)
    bpy.context.scene.collection.objects.link(o)
    o.location = location
    o.rotation_euler = rotation
    return o


def look_at(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def camera(lens=50, fstop=2.8, focus=None):
    d = bpy.data.cameras.new('cam')
    d.lens = lens
    d.clip_start = 1
    d.clip_end = 100000
    if focus is not None:
        d.dof.use_dof = True
        d.dof.aperture_fstop = fstop
        d.dof.focus_distance = focus
    o = bpy.data.objects.new('cam', d)
    bpy.context.scene.collection.objects.link(o)
    bpy.context.scene.camera = o
    return o


def key(obj, frame, **props):
    for k, v in props.items():
        setattr(obj, k, v)
        obj.keyframe_insert(data_path=k, frame=frame)


def smooth_keys(obj):
    ad = obj.animation_data
    if not ad or not ad.action:
        return
    # Blender 4.4+ layered actions keep curves in channelbags; older ones in fcurves.
    curves = []
    if hasattr(ad.action, 'fcurves') and ad.action.fcurves is not None:
        try:
            curves = list(ad.action.fcurves)
        except TypeError:
            curves = []
    if not curves and hasattr(ad.action, 'layers'):
        for layer in ad.action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    curves.extend(bag.fcurves)
    for fc in curves:
        for kp in fc.keyframe_points:
            kp.interpolation = 'BEZIER'
            kp.easing = 'EASE_IN_OUT'


def orbit_camera(cam, center, radius, height, a0, a1, f0, f1, lens_target=None):
    """Keyframe a camera along an arc round `center`, always looking at it (one key every 5 frames)."""
    for f in range(f0, f1 + 1, 5):
        t = (f - f0) / max(1, f1 - f0)
        t = t * t * (3 - 2 * t)
        a = math.radians(a0 + (a1 - a0) * t)
        cam.location = (center[0] + radius * math.cos(a), center[1] + radius * math.sin(a), center[2] + height)
        look_at(cam, center)
        cam.keyframe_insert('location', frame=f)
        cam.keyframe_insert('rotation_euler', frame=f)


def render(name, f0, f1):
    sc = bpy.context.scene
    sc.frame_start = f0
    sc.frame_end = f1
    out = os.path.join(OUT, name)
    os.makedirs(out, exist_ok=True)
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = os.path.join(out, 'f')
    if STILL:
        sc.frame_set((f0 + f1) // 2)
        sc.render.filepath = os.path.join(OUT, f'{name}_still.png')
        bpy.ops.render.render(write_still=True)
    else:
        bpy.ops.render.render(animation=True)


# ---------------------------------------------------------------------------
# Shots
# ---------------------------------------------------------------------------

PLA_WHITE = (0.62, 0.64, 0.67)
PLA_BLUE = (0.07, 0.28, 0.85)
PLA_ORANGE = (0.95, 0.42, 0.08)
PLA_VIOLET = (0.38, 0.2, 0.85)


def studio_lights(scale=1.0, power=1.0, at=(0, 0, 0)):
    """Low-key product lighting: a soft warm key, a strong cool rim, almost no fill (dark, glossy floor)."""
    k = scale * scale * power
    area_light('key', (at[0] - 170 * scale, at[1] - 150 * scale, at[2] + 200 * scale), (math.radians(50), 0, math.radians(-45)), 260000 * k, 140 * scale, (1.0, 0.95, 0.9))
    area_light('rim', (at[0] + 170 * scale, at[1] + 170 * scale, at[2] + 110 * scale), (math.radians(68), 0, math.radians(135)), 520000 * k, 70 * scale, (0.5, 0.68, 1.0))
    area_light('kick', (at[0] - 200 * scale, at[1] + 140 * scale, at[2] + 60 * scale), (math.radians(80), 0, math.radians(-125)), 180000 * k, 50 * scale, (0.62, 0.45, 1.0))
    area_light('fill', (at[0], at[1] - 260 * scale, at[2] + 40 * scale), (math.radians(88), 0, 0), 9000 * k, 300 * scale, (0.7, 0.75, 1.0))


def shot_cold_open():
    """Macro push-in across three real parts on one wide plinth, a thin light sliding over them (12 s)."""
    clean()
    floor(z=-40)
    plinth(170, 40, (0, 0, 0))
    a = load_part('project-box', material_pla('pla_a', PLA_WHITE), location=(-70, 20, 0.2))
    a.rotation_euler = (0, 0, math.radians(18))
    b = load_part('pull-handle', material_pla('pla_b', PLA_ORANGE), location=(40, -55, 0.2))
    b.rotation_euler = (0, 0, math.radians(-12))
    c = load_part('flange-plate', material_pla('pla_c', PLA_VIOLET), location=(75, 65, 0.2))
    studio_lights(2.0, 0.8)
    sweep = area_light('sweep', (-320, -120, 160), (math.radians(60), 0, math.radians(-70)), 200000, 22, (0.6, 0.85, 1.0))
    key(sweep, 1, location=Vector((-320, -120, 160)))
    key(sweep, 360, location=Vector((320, -120, 160)))
    cam = camera(lens=70, fstop=2.0, focus=330)
    for f, pos, tgt in ((1, (-260, -330, 170), (-20, 0, 15)), (360, (-120, -300, 105), (10, 0, 12))):
        cam.location = pos
        look_at(cam, tgt)
        cam.keyframe_insert('location', frame=f)
        cam.keyframe_insert('rotation_euler', frame=f)
    smooth_keys(cam)
    smooth_keys(sweep)
    # Rack focus from the box to the handle.
    cam.data.dof.focus_distance = 360
    cam.data.dof.keyframe_insert('focus_distance', frame=1)
    cam.data.dof.focus_distance = 290
    cam.data.dof.keyframe_insert('focus_distance', frame=300)
    render('cold_open', 1, 360)


def shot_lineup():
    """Every part on its own plinth, the camera tracking down the line (10 s)."""
    clean()
    floor(z=-40)
    jobs = ['project-box', 'pull-handle', 'tapered-foot', 'hinge', 'flange-plate', 'wall-bracket', 'knob', 'phone-stand']
    colors = [PLA_WHITE, PLA_ORANGE, PLA_BLUE, PLA_WHITE, PLA_VIOLET, PLA_WHITE, PLA_ORANGE, PLA_BLUE]
    gap = 150
    for i, (j, c) in enumerate(zip(jobs, colors)):
        x = i * gap
        plinth(58, 40, (x, 0, 0))
        p = load_part(j, material_pla(f'pla{i}', c), location=(x, 0, 0.2))
        p.rotation_euler = (0, 0, math.radians(-30 + 8 * i))
        key(p, 1, rotation_euler=p.rotation_euler.copy())
        p.rotation_euler.z += math.radians(40)
        key(p, 300, rotation_euler=p.rotation_euler.copy())
    for i in range(0, len(jobs), 2):
        studio_lights(1.8, 0.75, at=(i * gap + gap / 2, 0, 0))
    cam = camera(lens=45, fstop=3.5, focus=470)
    for f, x in ((1, -60), (300, (len(jobs) - 1) * gap + 60)):
        cam.location = (x - 60, -420, 190)
        look_at(cam, (x + 40, 0, 20))
        cam.keyframe_insert('location', frame=f)
        cam.keyframe_insert('rotation_euler', frame=f)
    smooth_keys(cam)
    render('lineup', 1, 300)


def shot_hero(job, name, color, frames=180, radius=230, height=110, lens=70, a0=-120, a1=-40):
    """One part on a plinth, slow orbit (turntable feel) for a feature beat."""
    clean()
    floor(z=-30)
    plinth(75, 30, (0, 0, 0))
    load_part(job, material_pla('pla', color), location=(0, 0, 0.2))
    studio_lights(1.4)
    cam = camera(lens=lens, fstop=2.8, focus=radius * 1.08)
    orbit_camera(cam, (0, 0, 22), radius, height, a0, a1, 1, frames)
    smooth_keys(cam)
    render(name, 1, frames)


def shot_finale():
    """The parts in a ring, the camera rising out of it (12 s): ground for the closing text."""
    clean()
    floor(z=-30)
    jobs = ['project-box', 'pull-handle', 'tapered-foot', 'hinge', 'flange-plate', 'wall-bracket', 'knob', 'phone-stand', 'fit-clip', 'cradle']
    colors = [PLA_WHITE, PLA_ORANGE, PLA_BLUE, PLA_WHITE, PLA_VIOLET, PLA_WHITE, PLA_ORANGE, PLA_BLUE, PLA_VIOLET, PLA_WHITE]
    r = 260
    for i, (j, c) in enumerate(zip(jobs, colors)):
        a = 2 * math.pi * i / len(jobs)
        loc = (r * math.cos(a), r * math.sin(a), 0)
        plinth(55, 30, loc)
        p = load_part(j, material_pla(f'pla{i}', c), location=(loc[0], loc[1], 0.2))
        p.rotation_euler = (0, 0, a + math.pi / 2)
    studio_lights(3.5)
    # A soft glow at the centre of the ring.
    bpy.ops.mesh.primitive_torus_add(major_radius=120, minor_radius=1.2, location=(0, 0, 1))
    bpy.context.object.data.materials.append(material_emit('halo', (0.35, 0.55, 1.0), 8))
    cam = camera(lens=40, fstop=4.0, focus=520)
    for f, (pos) in ((1, (0, -520, 90)), (360, (0, -380, 520))):
        cam.location = pos
        look_at(cam, (0, 0, 10))
        cam.keyframe_insert('location', frame=f)
        cam.keyframe_insert('rotation_euler', frame=f)
    smooth_keys(cam)
    render('finale', 1, 360)


SHOTS = {
    'cold_open': shot_cold_open,
    'lineup': shot_lineup,
    'hero_box': lambda: shot_hero('project-box', 'hero_box', PLA_WHITE),
    'hero_handle': lambda: shot_hero('pull-handle', 'hero_handle', PLA_ORANGE, radius=300, height=150),
    'hero_foot': lambda: shot_hero('tapered-foot', 'hero_foot', PLA_BLUE, radius=220),
    'hero_hinge': lambda: shot_hero('hinge', 'hero_hinge', PLA_WHITE, radius=200),
    'finale': shot_finale,
}

if __name__ == '__main__':
    SHOTS[SHOT]()
