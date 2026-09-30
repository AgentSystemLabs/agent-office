"""Agent-office's modelling kit: what every build_*.py script shares.

Each model in the office is made by a script in this folder, never by hand: the
script is the source and the .glb it exports to src/client/models/ is output. The
conventions every model keeps are in blender/README.md; this module is the code
behind them (shapes, the smooth skin, painted patches, rigs and clips, export, and
review renders).

Blender space is Z up. A model faces -Y here, which the glTF exporter turns into
+Z, the office's forward, and its left is +X. Units are metres, and the origin
sits on the floor.
"""
import bpy, bmesh, math, os, sys, tempfile
from mathutils import Euler, Matrix, Quaternion, Vector

_HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(_HERE, os.pardir, os.pardir))
MODELS = os.path.join(ROOT, "src", "client", "models")
# Review renders are scratch, never in the repo.
SHOT_DIR = os.environ.get("AO_SHOTS") or os.path.join(tempfile.gettempdir(), "ao-shots")

FPS = 24
TAU = 2 * math.pi
UP = (0.0, 0.0, 1.0)


def args():
    """The script's own arguments: whatever follows `--` on Blender's command line."""
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


# ---- Scene ----------------------------------------------------------------------------------------

def clear():
    """An empty scene to build in (the startup cube, camera and light, or the last build, gone)."""
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.actions,
                 bpy.data.cameras, bpy.data.lights, bpy.data.metaballs, bpy.data.curves):
        for d in list(coll):
            coll.remove(d)
    bpy.context.scene.render.fps = FPS


def _linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def material(name, color):
    """A material by name, with `color` (a hex string) as its viewport colour. The office swaps
    every material for its own toon one by this name, so the colour is only for review renders."""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    h = color.lstrip("#")
    m.diffuse_color = tuple(_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (1.0,)
    return m


def mesh_object(name, bm, mats=(), smooth=True):
    """Turns a bmesh into an object in the scene (and frees the bmesh). `mats` are its materials;
    faces keep whatever material_index the bmesh gave them."""
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    for p in me.polygons:
        p.use_smooth = smooth
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def apply_modifier(ob, name):
    with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob]):
        bpy.ops.object.modifier_apply(modifier=name)


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def join(target, others):
    """Joins `others` into `target`: one object, a material slot per material."""
    bpy.ops.object.select_all(action='DESELECT')
    for ob in others:
        ob.select_set(True)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.join()
    # Joining leaves something validate() tidies (no geometry changes); do it here so the
    # exporter doesn't warn.
    target.data.validate()
    return target


def set_origin(ob, at):
    """Moves an object's origin to `at` (world space) without moving its geometry: a moving part's
    origin is its pivot, the point the office turns it about."""
    local = ob.matrix_world.inverted() @ Vector(at)
    ob.data.transform(Matrix.Translation(-local))
    ob.matrix_world = ob.matrix_world @ Matrix.Translation(local)


# ---- Shapes (added to a bmesh) --------------------------------------------------------------------

def _place(bm, verts, center, rot, scale=(1, 1, 1)):
    m = Matrix.Translation(center) @ Euler(rot, 'XYZ').to_matrix().to_4x4() @ Matrix.Diagonal((*scale, 1))
    bmesh.ops.transform(bm, matrix=m, verts=verts)
    return verts


def ellipsoid(bm, center, radii, rot=(0, 0, 0), segs=24, rings=16):
    """A squashed sphere, turned by `rot` (XYZ euler) about its own centre."""
    verts = bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0)["verts"]
    return _place(bm, verts, center, rot, radii)


def limb(bm, a, b, ra, rb, segs=18, rings=14):
    """A capsule from `a` (radius ra) to `b` (radius rb)."""
    a, b = Vector(a), Vector(b)
    verts = bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0)["verts"]
    length = (b - a).length
    for v in verts:
        v.co = v.co * rb + Vector((0, 0, length)) if v.co.z >= 0 else v.co * ra
    turn = (b - a).to_track_quat('Z', 'Y').to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation(a) @ turn, verts=verts)
    return verts


def _merge(bm, part):
    """Adds a finished bmesh `part` to `bm` (and frees it). Shapes that bevel are built on their own
    first, so the bevel and the placing only ever touch that shape."""
    me = bpy.data.meshes.new("_part")
    part.to_mesh(me)
    part.free()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)


def box(bm, center, size, bevel=0.0, rot=(0, 0, 0), segments=3):
    """A box `size` (x, y, z) big, its edges rounded over `bevel` metres (0 for sharp)."""
    part = bmesh.new()
    bmesh.ops.create_cube(part, size=1.0)
    bmesh.ops.scale(part, vec=size, verts=part.verts[:])
    if bevel > 0:
        bmesh.ops.bevel(part, geom=part.edges[:], offset=min(bevel, min(size) / 2 - 1e-4), segments=segments,
                        profile=0.5, affect='EDGES', clamp_overlap=True)
    _place(part, part.verts[:], center, rot)
    _merge(bm, part)


def cylinder(bm, a, b, r, rb=None, segs=24, cap=True):
    """A cylinder (or cone, with `rb`) from point `a` to point `b`."""
    a, b = Vector(a), Vector(b)
    geom = bmesh.ops.create_cone(bm, cap_ends=cap, segments=segs, radius1=r, radius2=r if rb is None else rb,
                                 depth=(b - a).length)
    turn = (b - a).to_track_quat('Z', 'Y').to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ turn, verts=geom["verts"])
    return geom["verts"]


def torus(bm, center, R, r, rot=(0, 0, 0), n=28, m=8):
    """A ring of radius R, tube radius r, lying in its XY plane before `rot` turns it."""
    grid = []
    for i in range(n):
        a = TAU * i / n
        grid.append([bm.verts.new(((R + r * math.cos(c)) * math.cos(a), (R + r * math.cos(c)) * math.sin(a), r * math.sin(c)))
                     for c in (TAU * j / m for j in range(m))])
    for i in range(n):
        for j in range(m):
            bm.faces.new((grid[i][j], grid[(i + 1) % n][j], grid[(i + 1) % n][(j + 1) % m], grid[i][(j + 1) % m]))
    return _place(bm, [v for row in grid for v in row], center, rot)


def lathe(bm, profile, center=(0, 0, 0), rot=(0, 0, 0), segs=32):
    """Spins a profile [(radius, height), ...] (bottom to top) about the up axis: bowls, bells,
    speaker cones, bottles, lamp shades. A radius of 0 closes that end to a point."""
    rings = []
    for r, z in profile:
        if r <= 1e-6:
            rings.append([bm.verts.new((0, 0, z))])
        else:
            rings.append([bm.verts.new((r * math.cos(TAU * i / segs), r * math.sin(TAU * i / segs), z)) for i in range(segs)])
    for lo, hi in zip(rings, rings[1:]):
        for i in range(segs):
            quad = [lo[i % len(lo)], lo[(i + 1) % len(lo)], hi[(i + 1) % len(hi)], hi[i % len(hi)]]
            quad = [v for k, v in enumerate(quad) if v not in quad[:k]]
            if len(quad) >= 3:
                bm.faces.new(quad)
    return _place(bm, [v for ring in rings for v in ring], center, rot)


def outline(bm, points, depth, center=(0, 0, 0), rot=(0, 0, 0), bevel=0.0):
    """A flat outline [(x, z), ...] (counter-clockwise, seen from +Y) extruded `depth` along Y and
    centred on it: a cabinet's side, a jukebox's arch, a car's silhouette. `bevel` rounds its edges."""
    part = bmesh.new()
    front = [part.verts.new((x, -depth / 2, z)) for x, z in points]
    back = [part.verts.new((x, depth / 2, z)) for x, z in points]
    part.faces.new(front[::-1])
    part.faces.new(back)
    n = len(points)
    for i in range(n):
        part.faces.new((front[i], front[(i + 1) % n], back[(i + 1) % n], back[i]))
    if bevel > 0:
        bmesh.ops.bevel(part, geom=part.edges[:], offset=bevel, segments=3, profile=0.5, affect='EDGES', clamp_overlap=True)
    bmesh.ops.recalc_face_normals(part, faces=part.faces[:])
    _place(part, part.verts[:], center, rot)
    _merge(bm, part)


# ---- One smooth skin ------------------------------------------------------------------------------

def fuse(ob, voxel=0.0065, smooth=10, quads=4200):
    """Melts overlapping shapes into one skin, rounds off the seams, then lays even quads over it.
    Evenly sized quads bend cleanly at joints; thinning with Decimate instead leaves long slivers
    that pinch and streak when a skinned part folds."""
    rm = ob.modifiers.new("Remesh", 'REMESH')
    rm.mode = 'VOXEL'
    rm.voxel_size = voxel
    rm.adaptivity = 0
    sm = ob.modifiers.new("Smooth", 'SMOOTH')
    sm.factor = 0.5
    sm.iterations = smooth
    apply_modifier(ob, "Remesh")
    apply_modifier(ob, "Smooth")
    dense = len(ob.data.polygons)
    with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob]):
        bpy.ops.object.quadriflow_remesh(target_faces=quads, use_mesh_symmetry=True, use_preserve_sharp=False,
                                         use_preserve_boundary=False, seed=1, mode='FACES')
    if len(ob.data.polygons) >= dense:  # QuadriFlow gives up on meshes it can't handle
        dec = ob.modifiers.new("Decimate", 'DECIMATE')
        dec.ratio = min(1.0, quads * 2 / max(1, tris(ob)))
        apply_modifier(ob, "Decimate")
    for p in ob.data.polygons:
        p.use_smooth = True


def blob(p, center, radii):
    """Roughly the distance outside an ellipsoid, in its own radii (negative inside). Patch fields
    are built from these: unions are min, intersections max."""
    return math.sqrt(sum(((p[i] - center[i]) / radii[i]) ** 2 for i in range(3))) - 1.0


def cut_along(bm, field):
    """Splits every face the field's zero line crosses, exactly along that line, so a patch's edge
    is a clean curve instead of a staircase of whole faces."""
    val = {v: field(v.co) for v in bm.verts}
    crossing = [e for e in bm.edges if (val[e.verts[0]] < 0) != (val[e.verts[1]] < 0)
                and abs(val[e.verts[0]]) > 1e-6 and abs(val[e.verts[1]]) > 1e-6]
    on = set(v for v in bm.verts if abs(val[v]) <= 1e-6)
    for e in crossing:
        a, b = e.verts
        _, v = bmesh.utils.edge_split(e, a, val[a] / (val[a] - val[b]))
        val[v] = 0.0
        on.add(v)
    for f in list({f for v in on for f in v.link_faces}):
        ends = [v for v in f.verts if v in on]
        if len(ends) == 2 and not any(ends[1] in (e.other_vert(ends[0]),) for e in ends[0].link_edges):
            bmesh.utils.face_split(f, ends[0], ends[1])
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    return val


def paint(ob, base, patches):
    """Paints a skin: `base` everywhere, then each (material, field) in `patches` where its field is
    negative (the first that claims a face wins), cut in along smooth edges."""
    me = ob.data
    me.materials.clear()
    me.materials.append(base)
    for m, _ in patches:
        me.materials.append(m)
    bm = bmesh.new()
    bm.from_mesh(me)
    for _, field in patches:
        cut_along(bm, field)
    # A cut that passes right by a vertex leaves slivers; fold them away.
    bmesh.ops.dissolve_degenerate(bm, dist=1e-4, edges=bm.edges[:])
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    for f in bm.faces:
        c = f.calc_center_median()
        f.material_index = next((i + 1 for i, (_, field) in enumerate(patches) if field(c) < 0), 0)
        f.smooth = True
    bm.to_mesh(me)
    bm.free()


# ---- Rigs and clips -------------------------------------------------------------------------------

def armature(name, spec):
    """An armature from [(bone, head, tail, parent or None, deforms)]. Rolls are set so every bone's
    local X is the model's +X: a positive X turn tips a bone's far end forward and down (a nod, a
    jaw opening), or swings a hanging leg's foot back."""
    data = bpy.data.armatures.new(name)
    arm = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for bone, head, tail, parent, _ in spec:
        b = data.edit_bones.new(bone)
        b.head, b.tail = head, tail
        if parent:
            b.parent = data.edit_bones[parent]
    for b in data.edit_bones:
        # align_roll points the bone's Z axis, so aim Z at +X cross the bone to get X along +X.
        b.align_roll(Vector((1, 0, 0)).cross((b.tail - b.head).normalized()))
    bpy.ops.object.mode_set(mode='OBJECT')
    for bone, _, _, _, deform in spec:
        data.bones[bone].use_deform = deform
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    return arm


def socket(arm, name, bone, at):
    """An empty on a bone, at `at` (world space) and square to the world at rest: where the office
    hangs things on a model (a hat on a head)."""
    s = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(s)
    s.empty_display_size = 0.05
    s.parent = arm
    s.parent_type = 'BONE'
    s.parent_bone = bone
    s.matrix_world = Matrix.Translation(at)
    return s


class Pose:
    """One moment of a clip: turns (about a bone's own x/y/z, or about a world axis given as a
    vector, applied in order) and moves (world-space offsets from the rest pose)."""

    def __init__(self):
        self.turns, self.moves = {}, {}

    def turn(self, bone, axis, angle):
        self.turns.setdefault(bone, []).append((axis, angle))
        return self

    def move(self, bone, x=0.0, y=0.0, z=0.0):
        old = self.moves.get(bone, (0, 0, 0))
        self.moves[bone] = (old[0] + x, old[1] + y, old[2] + z)
        return self

    def both(self, bone, axis, angle, mirrored=False):
        """The same turn on the _L and _R bone; `mirrored` flips it on the right."""
        self.turn(f"{bone}_L", axis, angle)
        self.turn(f"{bone}_R", axis, -angle if mirrored else angle)
        return self


AXES = {"x": Vector((1, 0, 0)), "y": Vector((0, 1, 0)), "z": Vector((0, 0, 1))}


def pose(arm, p):
    """Sets every bone from `p` (bones it doesn't mention go back to rest)."""
    for pb in arm.pose.bones:
        rest = pb.bone.matrix_local.to_3x3().inverted()
        q = Quaternion()
        for axis, angle in p.turns.get(pb.name, ()):
            v = AXES[axis] if isinstance(axis, str) else (rest @ Vector(axis)).normalized()
            q = q @ Quaternion(v, angle)
        pb.rotation_quaternion = q
        off = p.moves.get(pb.name)
        pb.location = rest @ Vector(off) if off else Vector()


def wave(t, n, phase=0.0):
    """n full sine waves over a clip's t = 0..1, so the clip loops cleanly."""
    return math.sin(TAU * (n * t + phase))


def ease(v):
    return v * v * (3 - 2 * v)


def key_clips(arm, clips):
    """Keys each clip {name: (frames at FPS, pose at t in 0..1)} as its own looping action, every
    bone on every frame, so a clip always sets the whole pose."""
    arm.animation_data_create()
    for name, (frames, fn) in clips.items():
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        arm.animation_data.action = act
        for f in range(frames + 1):
            pose(arm, fn(f / frames))
            for pb in arm.pose.bones:
                pb.keyframe_insert("rotation_quaternion", frame=f + 1)
                pb.keyframe_insert("location", frame=f + 1)
        act.use_frame_range = True
        act.frame_start, act.frame_end = 1, frames + 1
        act.use_cyclic = True
    arm.animation_data.action = None
    pose(arm, Pose())


def show(arm, clips, clip, t):
    """Puts the rig at `t` (0..1) through a clip, for a review render; clip None is the rest pose."""
    if clip is None:
        arm.animation_data.action = None
        pose(arm, Pose())
        return
    arm.animation_data.action = bpy.data.actions[clip]
    bpy.context.scene.frame_set(1 + round(t * clips[clip][0]))


# ---- Export ---------------------------------------------------------------------------------------

def export(name, arm=None, uvs=False):
    """Writes src/client/models/<name>.glb from everything in the scene. With a rig, its actions go
    in as clips (only bones that deform, so helper bones such as IK targets stay behind); `uvs` keeps
    texture coordinates, for a surface the office paints a canvas onto."""
    if arm is not None:
        arm.animation_data.action = None
        pose(arm, Pose())
    path = os.path.join(MODELS, name + ".glb")
    os.makedirs(MODELS, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        export_yup=True,
        export_apply=True,
        export_texcoords=uvs,
        export_cameras=False,
        export_lights=False,
        export_animations=arm is not None,
        export_animation_mode='ACTIONS',
        export_force_sampling=True,
        export_anim_slide_to_zero=True,
        # Drops repeated keyframes, but keeps every bone keyed in every clip, so a clip always
        # sets the whole pose (a held sit keeps its legs).
        export_optimize_animation_size=True,
        export_optimize_animation_keep_anim_armature=True,
        export_reset_pose_bones=True,
        export_def_bones=arm is not None,
    )
    return path


# ---- Review renders -------------------------------------------------------------------------------

VIEWS = {
    "tq": (0.95, -1.0, 0.55),
    "side": (1.0, 0.0, 0.12),
    "front": (0.0, -1.0, 0.18),
    "back": (-0.6, 1.0, 0.5),
    "top": (0.0, -0.05, 1.0),
    "low": (0.9, -1.0, 0.1),
}


def shoot(name, view="tq", target=(0, 0, 0.35), dist=1.9, res=(900, 700)):
    """A Workbench render with outlines to SHOT_DIR/<name>.png, for looking at while modelling.
    `view` is a VIEWS name or a direction to look from."""
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sh = sc.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'MATERIAL'
    sh.show_object_outline = True
    sh.object_outline_color = (0.17, 0.18, 0.26)
    sh.show_shadows = False
    sh.show_cavity = False
    sh.show_specular_highlight = False
    sc.display.render_aa = '8'
    if sc.world is None:
        sc.world = bpy.data.worlds.new("World")
    sc.world.color = (0.52, 0.76, 1.0)
    cam = sc.camera
    if cam is None:
        cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
        sc.collection.objects.link(cam)
        sc.camera = cam
    cam.data.lens = 50
    cam.data.clip_end = max(100.0, dist * 4)
    d = Vector(VIEWS.get(view, view)).normalized()
    t = Vector(target)
    cam.location = t + d * dist
    cam.rotation_euler = (t - cam.location).to_track_quat('-Z', 'Y').to_euler()
    os.makedirs(SHOT_DIR, exist_ok=True)
    sc.render.filepath = os.path.join(SHOT_DIR, name + ".png")
    bpy.ops.render.render(write_still=True)
    return sc.render.filepath


def sheet(name, shots, cell=(420, 330), target=(0, 0, 0.35), dist=1.7):
    """Several renders side by side in one PNG, four to a row: `shots` is [(setup, view)], where
    `setup` (or None) poses the scene for that tile. Returns the PNG's path."""
    import numpy as np
    tiles = []
    for i, (setup, view) in enumerate(shots):
        if setup:
            setup()
        path = shoot(f"_{name}_tile{i}", view, target=target, dist=dist, res=cell)
        img = bpy.data.images.load(path, check_existing=False)
        tiles.append(np.array(img.pixels[:], dtype=np.float32).reshape(cell[1], cell[0], 4))
        bpy.data.images.remove(img)
    rows = [np.concatenate(tiles[i:i + 4], axis=1) for i in range(0, len(tiles), 4)]
    width = max(r.shape[1] for r in rows)
    rows = [np.pad(r, ((0, 0), (0, width - r.shape[1]), (0, 0))) for r in rows]
    # Blender's pixels run bottom row first, so the first row of tiles goes last.
    full = np.concatenate(rows[::-1], axis=0)
    path = os.path.join(SHOT_DIR, name + ".png")
    out = bpy.data.images.new(name, full.shape[1], full.shape[0], alpha=True)
    out.pixels = full.ravel()
    out.filepath_raw = path
    out.file_format = 'PNG'
    out.save()
    bpy.data.images.remove(out)
    return path
