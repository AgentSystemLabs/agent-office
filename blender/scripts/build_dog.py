"""The office dog: modelled, rigged and animated by this script, and exported to
src/client/models/dog.glb for src/client/world/dog.ts. The shared helpers are in
aokit.py and the conventions in blender/README.md.

Headless, from the repo root (`-- --shots` also writes review sheets):

    blender --background --factory-startup --python blender/scripts/build_dog.py [-- --shots]

Through the Blender MCP bridge (module globals don't survive between calls, so
import it every time):

    import sys, importlib
    sys.path.insert(0, r"<repo>/blender/scripts")
    import aokit, build_dog; importlib.reload(aokit); importlib.reload(build_dog)
    build_dog.main()

Two runs give the same dog but not the same bytes (the exporter's triangle order
and the last bit of a few weights vary), so commit the .glb only when the dog
changed. Bone, socket, material and clip names are a contract with dog.ts and
tests/dog-model.test.ts, so rename them in all three places.
"""
import bpy, bmesh, math, os, sys
from mathutils import Euler, Matrix, Vector

# Run headless, Blender doesn't put this folder on the import path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aokit as ao
from aokit import Pose, UP, TAU, wave, ease

# Preview colours only (the golden coat); dog.ts recolours the coat and swaps every
# material for its own toon one by name.
COLORS = {
    "Fur": "#e0a458",
    "Light": "#fff1d6",
    "Ear": "#b36f35",
    "Ink": "#1d1d1d",
    "Nose": "#1d1d1d",
    "Tongue": "#ff7f9a",
    "Collar": "#ef476f",
    "Tag": "#ffd166",
    "Shine": "#ffffff",
}


def material(name):
    return ao.material(name, COLORS[name])


# Where things are (Blender space, metres). Head centre and the hip hinge match the
# old procedural dog, so costume offsets tuned for it still land.
HEAD = (0, -0.29, 0.57)
FRONT_X, BACK_X = 0.078, 0.088
FRONT_Y, BACK_Y = -0.17, 0.14
MUZZLE = ((0, -0.405, 0.525), (0.082, 0.095, 0.064))
TAIL = [(0, 0.22, 0.40), (0, 0.29, 0.47), (0, 0.325, 0.55), (0, 0.325, 0.63)]
NECK = ((0, -0.17, 0.40), (0, -0.25, 0.51))


def leg(kind, sx):
    """A leg's top joint, its middle joint, where the paw starts and the tip of the toes. The
    middle joint sits a little off the straight line so the leg always knows which way it
    bends: front wrists forward, back hocks backward."""
    if kind == "front":
        x = sx * FRONT_X * 1.05
        return (sx * FRONT_X, FRONT_Y, 0.31), (x, FRONT_Y - 0.024, 0.15), (x, FRONT_Y - 0.012, 0.045), (x, FRONT_Y - 0.1, 0.03)
    x = sx * BACK_X
    return (x, BACK_Y + 0.005, 0.30), (x, BACK_Y + 0.055, 0.13), (x, BACK_Y + 0.02, 0.045), (x, BACK_Y - 0.065, 0.03)


def body_mesh():
    """Everything that is one skin: body, neck, head, muzzle, legs, tail."""
    bm = bmesh.new()
    # Torso: a round chest, a slimmer waist, a round rump.
    ao.limb(bm, (0, 0.12, 0.35), (0, -0.12, 0.36), 0.132, 0.138)
    ao.ellipsoid(bm, (0, -0.15, 0.35), (0.145, 0.135, 0.15))
    ao.ellipsoid(bm, (0, 0.13, 0.35), (0.135, 0.125, 0.135))
    ao.limb(bm, *NECK, 0.095, 0.09)
    # Head: round and big, puppy-like, with soft cheeks and one bean of a muzzle.
    ao.ellipsoid(bm, HEAD, (0.155, 0.145, 0.14))
    for sx in (-1, 1):
        ao.ellipsoid(bm, (sx * 0.06, -0.33, 0.525), (0.07, 0.07, 0.06))
    ao.ellipsoid(bm, *MUZZLE)
    for sx in (-1, 1):
        # Front legs: shoulder, wrist, then a round paw.
        top, joint, foot, _ = leg("front", sx)
        ao.limb(bm, top, joint, 0.058, 0.046)
        ao.limb(bm, joint, foot, 0.046, 0.043)
        ao.ellipsoid(bm, (foot[0], foot[1] - 0.023, 0.032), (0.052, 0.066, 0.034))
        # Back legs: a big round haunch, then the hock and a paw.
        top, joint, foot, _ = leg("back", sx)
        ao.ellipsoid(bm, (top[0], BACK_Y, 0.30), (0.075, 0.1, 0.105))
        ao.limb(bm, (top[0], BACK_Y + 0.01, 0.26), joint, 0.06, 0.046)
        ao.limb(bm, joint, foot, 0.046, 0.043)
        ao.ellipsoid(bm, (foot[0], foot[1] - 0.025, 0.032), (0.052, 0.066, 0.034))
    # Tail: up and back in a curve, thick at the root, thinning to a tip.
    for a, b, ra, rb in zip(TAIL, TAIL[1:], (0.048, 0.04, 0.032), (0.04, 0.032, 0.022)):
        ao.limb(bm, a, b, ra, rb)
    return ao.mesh_object("Dog", bm)


def light_patch(p):
    """Where the coat is light (negative) or not (positive): muzzle, a blaze up the nose, a bib
    down the chest, the belly, socks and the tail tip."""
    blob = ao.blob
    return min(
        max(blob(p, MUZZLE[0], tuple(r * 1.12 for r in MUZZLE[1])), (p.y + 0.355) * 12),
        max(blob(p, (0, -0.36, 0.5), (0.026, 0.12, 0.14)), (0.555 - p.z) * 12),
        max(blob(p, (0, -0.27, 0.32), (0.1, 0.11, 0.15)), (0.235 - p.z) * 12),
        max(blob(p, (0, -0.03, 0.19), (0.075, 0.15, 0.07)), (abs(p.x) - 0.05) * 12),
        (p.z - 0.062) * 12,
        max((0.6 - p.z) * 12, (0.28 - p.y) * 12),
    )


# ---- Loose parts (each its own shape, skinned rigidly to one or two bones) ----------------------

def part(name, mat, build, groups):
    """A separate little mesh with one material. `groups` maps each vertex (by its position) to
    {bone: weight}."""
    bm = bmesh.new()
    build(bm)
    ob = ao.mesh_object(name, bm, [material(mat)])
    for v in ob.data.vertices:
        for bone, w in groups(v.co).items():
            vg = ob.vertex_groups.get(bone) or ob.vertex_groups.new(name=bone)
            vg.add([v.index], w, 'REPLACE')
    return ob


def rigid(bone):
    return lambda co: {bone: 1.0}


EAR_TOP = (0.098, -0.262, 0.628)
EAR_LEN = 0.15
EAR_TILT = (0.12, -0.26, 0)


def ear(bm, sx):
    """A floppy ear: a flat teardrop hanging from the side of the head, wider at the bottom."""
    verts = ao.limb(bm, (0, 0, 0), (0, 0, -EAR_LEN), 0.04, 0.064)
    m = (Matrix.Translation((sx * EAR_TOP[0], EAR_TOP[1], EAR_TOP[2]))
         @ Euler((EAR_TILT[0], sx * EAR_TILT[1], 0), 'XYZ').to_matrix().to_4x4()
         @ Matrix.Diagonal((0.36, 1.0, 1.0, 1.0)))
    bmesh.ops.transform(bm, matrix=m, verts=verts)


def ear_weights(sx):
    side = "L" if sx > 0 else "R"
    def w(co):
        k = min(1.0, max(0.0, (EAR_TOP[2] - 0.035 - co.z) / 0.08))
        return {f"ear_{side}": 1 - k, f"ear_tip_{side}": k} if k > 0 else {f"ear_{side}": 1.0}
    return w


EYE = (0.066, -0.412, 0.595)


def eye(bm, sx):
    ao.ellipsoid(bm, (sx * EYE[0], EYE[1], EYE[2]), (0.024, 0.016, 0.031), rot=(0, 0, -sx * 0.32), segs=16, rings=10)


def shine(bm, sx):
    ao.ellipsoid(bm, (sx * (EYE[0] + 0.006), EYE[1] - 0.013, EYE[2] + 0.012), (0.008, 0.005, 0.009), segs=10, rings=6)


def collar_matrix():
    a, b = (Vector(p) for p in NECK)
    turn = (b - a).to_track_quat('Z', 'Y').to_matrix().to_4x4()
    return Matrix.Translation(a.lerp(b, 0.42)) @ turn


def collar(bm):
    m = collar_matrix()
    ao.torus(bm, m.translation, 0.1, 0.019, rot=m.to_euler(), n=28, m=8)


def tag(bm):
    geom = bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.026, radius2=0.026, depth=0.008)
    # Hanging at the front of the collar, facing forward.
    m = collar_matrix() @ Matrix.Translation((0, -0.118, -0.03)) @ Euler((math.pi / 2, 0, 0), 'XYZ').to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=m, verts=geom["verts"])


JAW = ((0, -0.34, 0.49), (0, -0.47, 0.472))


def parts():
    obs = []
    for sx in (-1, 1):
        side = "L" if sx > 0 else "R"
        obs.append(part(f"ear_{side}", "Ear", lambda bm, sx=sx: ear(bm, sx), ear_weights(sx)))
        obs.append(part(f"eye_{side}", "Ink", lambda bm, sx=sx: eye(bm, sx), rigid(f"eye_{side}")))
        obs.append(part(f"shine_{side}", "Shine", lambda bm, sx=sx: shine(bm, sx), rigid(f"eye_{side}")))
    obs.append(part("nose", "Nose", lambda bm: ao.ellipsoid(bm, (0, -0.497, 0.56), (0.037, 0.026, 0.027), segs=16, rings=10), rigid("head")))
    # The mouth: a dark inside under the muzzle, a lower jaw that drops open, a tongue on it.
    obs.append(part("mouth", "Ink", lambda bm: ao.ellipsoid(bm, (0, -0.405, 0.479), (0.042, 0.068, 0.02), segs=16, rings=8), rigid("head")))
    obs.append(part("chin", "Light", lambda bm: ao.ellipsoid(bm, (0, -0.4, 0.47), (0.05, 0.07, 0.026), segs=18, rings=10), rigid("jaw")))
    obs.append(part("tongue", "Tongue", lambda bm: ao.ellipsoid(bm, (0, -0.425, 0.493), (0.032, 0.05, 0.011), segs=14, rings=8), rigid("jaw")))
    obs.append(part("collar", "Collar", collar, rigid("neck")))
    obs.append(part("tag", "Tag", tag, rigid("neck")))
    return obs


# ---- Skeleton -----------------------------------------------------------------------------------

def bones():
    """(name, head, tail, parent, deforms the body skin)."""
    out = [
        ("root", (0, 0, 0), (0, -0.12, 0), None, False),
        ("hips", (0, 0.15, 0.35), (0, 0.0, 0.36), "root", True),
        ("spine", (0, 0.0, 0.36), (0, -0.14, 0.365), "hips", True),
        ("chest", (0, -0.14, 0.365), NECK[0], "spine", True),
        ("neck", NECK[0], NECK[1], "chest", True),
        ("head", NECK[1], (0, -0.25, 0.70), "neck", True),
        ("jaw", JAW[0], JAW[1], "head", False),
        ("tail_1", TAIL[0], TAIL[1], "hips", True),
        ("tail_2", TAIL[1], TAIL[2], "tail_1", True),
        ("tail_3", TAIL[2], TAIL[3], "tail_2", True),
    ]
    for sx in (-1, 1):
        s = "L" if sx > 0 else "R"
        top = Vector((sx * EAR_TOP[0], EAR_TOP[1], EAR_TOP[2]))
        down = Euler((EAR_TILT[0], sx * EAR_TILT[1], 0), 'XYZ').to_matrix() @ Vector((0, 0, -1))
        mid = top + down * (EAR_LEN * 0.45)
        out += [
            (f"eye_{s}", (sx * EYE[0], EYE[1], EYE[2] - 0.02), (sx * EYE[0], EYE[1], EYE[2] + 0.02), "head", False),
            (f"ear_{s}", tuple(top), tuple(mid), "head", False),
            (f"ear_tip_{s}", tuple(mid), tuple(top + down * (EAR_LEN + 0.05)), f"ear_{s}", False),
        ]
        for kind, parent in (("front", "chest"), ("back", "hips")):
            top, joint, foot, toe = leg(kind, sx)
            out += [
                (f"{kind}_upper_{s}", top, joint, parent, True),
                (f"{kind}_lower_{s}", joint, foot, f"{kind}_upper_{s}", True),
                (f"{kind}_paw_{s}", foot, toe, f"{kind}_lower_{s}", True),
            ]
    return out


# (leg bone, the torso bone it hangs from, fully the leg's below this height, not at all above this)
LEG_REACH = [(f"{k}_upper_{s}", torso, lo, hi)
             for k, torso, lo, hi in (("front", "chest", 0.2, 0.3), ("back", "hips", 0.17, 0.29))
             for s in ("L", "R")]


def soften_legs(body):
    """A leg pulls on the body only low down, fading out up the flank, so a swinging or folded leg
    doesn't drag creases into the side; the torso bone takes what the leg lets go of."""
    groups = {g.name: g for g in body.vertex_groups}
    for v in body.data.vertices:
        for leg_bone, torso, lo, hi in LEG_REACH:
            try:
                w = groups[leg_bone].weight(v.index)
            except RuntimeError:
                continue
            k = min(1.0, max(0.0, (hi - v.co.z) / (hi - lo)))
            if k < 1.0:
                groups[leg_bone].add([v.index], w * k, 'REPLACE')
                groups[torso].add([v.index], w * (1 - k), 'ADD')


def skin(arm, body, loose):
    """The body gets automatic (heat) weights from the bones that bend it; the loose parts come
    with their own. Then every part joins the body, one mesh with a material per part."""
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    soften_legs(body)
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
    bpy.ops.object.vertex_group_smooth(group_select_mode='ALL', factor=0.5, repeat=3)
    bpy.ops.object.mode_set(mode='OBJECT')
    # glTF skins take four bones a vertex; trim here so Blender deforms it the same way.
    with bpy.context.temp_override(object=body, active_object=body, selected_objects=[body]):
        bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
        bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
    # Every bone counts as deforming from here on, so the exporter keeps them all (root included,
    # though nothing is weighted to it) and leaves out only the IK targets added later.
    for b in arm.data.bones:
        b.use_deform = True
    return ao.join(body, loose)


SOCKETS = {
    # name: (bone, where; the old procedural dog's head group and torso origin)
    "socket_head": ("head", HEAD[:2] + (0.56,)),
    "socket_back": ("spine", (0, 0.17, 0.30)),
}


# ---- Animation ----------------------------------------------------------------------------------
#
# The legs are posed with IK: each paw follows a target bone (ik_front_L, ...) that the clips
# move around, and the exporter samples the solved pose into plain keyframes. The targets
# themselves don't deform anything and aren't exported.

LEGS = [(k, s) for k in ("front", "back") for s in ("L", "R")]


def ik_setup(arm):
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.data.edit_bones
    for kind, s in LEGS:
        paw = eb[f"{kind}_paw_{s}"]
        t = eb.new(f"ik_{kind}_{s}")
        t.head, t.tail, t.roll = paw.head.copy(), paw.tail.copy(), paw.roll
        t.parent = eb["root"]
    bpy.ops.object.mode_set(mode='OBJECT')
    for kind, s in LEGS:
        arm.data.bones[f"ik_{kind}_{s}"].use_deform = False
        ik = arm.pose.bones[f"{kind}_lower_{s}"].constraints.new('IK')
        ik.target, ik.subtarget, ik.chain_count = arm, f"ik_{kind}_{s}", 2
        keep = arm.pose.bones[f"{kind}_paw_{s}"].constraints.new('COPY_ROTATION')
        keep.target, keep.subtarget = arm, f"ik_{kind}_{s}"
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'


def step(p, kind, s, u, stride, lift, stance=0.5, curl=0.6):
    """A paw's place `u` (0..1) through its cycle: planted and sliding back for `stance`, then up,
    toes curled, and swung forward."""
    if u < stance:
        fwd, up, flex = stride / 2 - stride * (u / stance), 0.0, 0.0
    else:
        v = (u - stance) / (1 - stance)
        fwd, up, flex = -stride / 2 + stride * ease(v), lift * math.sin(math.pi * v), math.sin(math.pi * v)
    p.move(f"ik_{kind}_{s}", y=-fwd, z=up)
    p.turn(f"ik_{kind}_{s}", "x", curl * flex * (1 if kind == "front" else 0.5))


def tail_wag(p, t, n, amount, up=0.0):
    p.turn("tail_1", "x", up)
    for i, k in enumerate((1.0, 0.55, 0.4)):
        p.turn(f"tail_{i + 1}", "z", amount * k * wave(t, n, -0.07 * i))


def breathe(p, t, n, amount=0.015):
    p.turn("spine", "x", amount * wave(t, n)).turn("chest", "x", -amount * wave(t, n))


def stand(t):
    p = Pose()
    breathe(p, t, 2)
    p.turn("head", "y", 0.18 * wave(t, 1)).turn("head", "z", 0.05 * wave(t, 1, 0.25))
    p.both("ear", "x", 0.06 * wave(t, 2))
    tail_wag(p, t, 3, 0.3)
    return p


def walk(t):
    """A trot: diagonal legs together, the body bobbing twice a stride."""
    p = Pose()
    for kind, s, ph in (("front", "L", 0), ("back", "R", 0), ("front", "R", 0.5), ("back", "L", 0.5)):
        step(p, kind, s, (t + ph) % 1, WALK_STRIDE, 0.045, curl=0.35)
    p.move("hips", z=-0.022 - 0.01 * math.cos(TAU * 2 * t))
    p.turn("hips", UP, 0.05 * wave(t, 1)).turn("spine", UP, -0.03 * wave(t, 1))
    p.turn("neck", "x", -0.06).turn("head", "x", 0.05 * wave(t, 2, 0.15))
    p.both("ear", "x", 0.16 * wave(t, 2, 0.2)).both("ear_tip", "x", 0.25 * wave(t, 2, 0.32))
    tail_wag(p, t, 1, 0.35, up=0.1)
    return p


def run(t):
    """A gallop: back legs, then front legs, a flying moment, the back arching and stretching."""
    p = Pose()
    for kind, s, ph in (("back", "L", 0.0), ("back", "R", 0.07), ("front", "L", 0.42), ("front", "R", 0.5)):
        step(p, kind, s, (t - ph) % 1, RUN_STRIDE, 0.075, stance=0.36, curl=0.8)
    p.move("hips", z=-0.02 + 0.025 * wave(t, 1, 0.1))
    p.turn("hips", "x", 0.16 * wave(t, 1, 0.3))
    p.turn("spine", "x", 0.12 * wave(t, 1, 0.05)).turn("chest", "x", -0.1 * wave(t, 1, 0.05))
    p.turn("neck", "x", -0.1 - 0.1 * wave(t, 1, 0.3)).turn("head", "x", 0.1 * wave(t, 1, 0.4))
    p.both("ear", "x", 0.55 + 0.2 * wave(t, 2)).both("ear_tip", "x", 0.35 + 0.25 * wave(t, 2, 0.2))
    tail_wag(p, t, 1, 0.12, up=-0.55)
    return p


def wag(t):
    """Happy: the whole back end wiggles with the tail, head tipped, front paws dancing."""
    p = Pose()
    tail_wag(p, t, 4, 0.75, up=0.25)
    p.turn("hips", UP, 0.13 * wave(t, 2)).turn("hips", "y", 0.05 * wave(t, 2))
    p.turn("spine", UP, -0.08 * wave(t, 2))
    p.move("hips", z=-0.006 + 0.008 * abs(wave(t, 4)))
    p.turn("neck", "x", -0.05).turn("head", "x", -0.14).turn("head", "z", 0.22 + 0.05 * wave(t, 1))
    p.both("ear", "z", -0.25, mirrored=True).both("ear", "x", -0.1)
    p.move("ik_front_L", z=0.035 * max(0.0, wave(t, 2)))
    p.move("ik_front_R", z=0.035 * max(0.0, wave(t, 2, 0.5)))
    return p


def sniff(t):
    """Nose to the floor, sweeping side to side, snuffling."""
    p = Pose()
    p.move("hips", z=-0.03).turn("hips", "x", 0.1)
    p.turn("neck", UP, 0.4 * wave(t, 1)).turn("neck", "x", 0.55)
    p.turn("head", "x", 0.3 + 0.08 * wave(t, 12)).turn("head", "y", 0.12 * wave(t, 1))
    p.both("ear", "x", -0.25)
    tail_wag(p, t, 4, 0.3, up=0.35)
    return p


def sitting(p, lean=-0.62):
    p.turn("hips", "x", lean).move("hips", z=-0.19)
    p.turn("neck", "x", 0.25).turn("head", "x", -lean - 0.25)
    # The hind paws stay about under the hips, so the hock folds back onto the floor behind
    # them (a paw pulled forward folds the hock down through the floor instead).
    for s, sx in (("L", 1), ("R", -1)):
        p.move(f"ik_back_{s}", x=sx * SIT_BACK[0], y=SIT_BACK[1])


def sit(t):
    p = Pose()
    sitting(p)
    breathe(p, t, 2, 0.02)
    p.turn("head", "y", 0.12 * wave(t, 1))
    tail_wag(p, t, 2, 0.25, up=-1.1)
    return p


def bark(t):
    """Sitting up, alert, ears up, tail going: the woof itself (jaw, hop) is dog.ts's."""
    p = Pose()
    sitting(p, lean=-0.55)
    p.turn("head", "x", -0.15)
    p.both("ear", "z", -0.45, mirrored=True).both("ear_tip", "x", -0.3)
    tail_wag(p, t, 3, 0.5, up=-0.45)
    p.move("hips", z=0.008 * abs(wave(t, 2)))
    return p


def lying(p):
    p.move("hips", z=-0.2)
    for s, sx in (("L", 1), ("R", -1)):
        p.move(f"ik_front_{s}", y=-0.2)
        p.move(f"ik_back_{s}", x=sx * LIE_BACK[0], y=LIE_BACK[1])


def lie(t):
    p = Pose()
    lying(p)
    breathe(p, t, 3)
    p.turn("neck", "x", 0.1).turn("head", "y", 0.4 * wave(t, 1)).turn("head", "x", -0.05)
    tail_wag(p, t, 2, 0.15, up=-1.2)
    return p


def nap(t):
    """Chin down on its paws, tail curled round, breathing slow. dog.ts shuts the eyes."""
    p = Pose()
    lying(p)
    breathe(p, t, 1, 0.03)
    p.turn("neck", "x", 0.42).turn("head", "x", 0.3).turn("head", "z", 0.15)
    p.turn("tail_1", "x", -1.2).turn("tail_1", UP, 0.9).turn("tail_2", UP, 0.5)
    return p


# Where the hind paws go (sideways, back) from where they stand, sitting and lying.
SIT_BACK = (0.035, 0.02)
LIE_BACK = (0.06, 0.05)
WALK_STRIDE = 0.2
RUN_STRIDE = 0.34
CLIPS = {
    # name: (frames at 24 fps, pose at t in 0..1)
    "stand": (48, stand),
    "walk": (12, walk),
    "run": (12, run),
    "wag": (24, wag),
    "sniff": (96, sniff),
    "sit": (48, sit),
    "bark": (24, bark),
    "lie": (96, lie),
    "nap": (72, nap),
}


# ---- Review -------------------------------------------------------------------------------------

def floor_report(samples=8):
    """How far each clip pushes the skin under the floor (metres, negative is under), and which
    material dips lowest: a check to run after touching any pose."""
    arm, body = bpy.data.objects["DogRig"], bpy.data.objects["Dog"]
    out = {}
    for clip in CLIPS:
        worst = (1.0, None)
        for k in range(samples):
            ao.show(arm, CLIPS, clip, k / samples)
            ev = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
            me = ev.to_mesh()
            for p in me.polygons:
                z = min(me.vertices[i].co.z for i in p.vertices)
                if z < worst[0]:
                    worst = (z, body.material_slots[p.material_index].name)
            ev.to_mesh_clear()
        out[clip] = (round(worst[0], 3), worst[1])
    ao.show(arm, CLIPS, None, 0)
    return out


def sheet(name, shots, **kw):
    """Review renders side by side: `shots` is [(clip or None for rest, t, view)]."""
    arm = bpy.data.objects["DogRig"]
    kw.setdefault("target", (0, -0.03, 0.3))
    path = ao.sheet(name, [(lambda c=clip, t=t: ao.show(arm, CLIPS, c, t), view) for clip, t, view in shots], **kw)
    ao.show(arm, CLIPS, None, 0)
    return path


def main(write=True):
    ao.clear()
    body = body_mesh()
    ao.fuse(body)
    ao.paint(body, material("Fur"), [(material("Light"), light_patch)])
    arm = ao.armature("DogRig", bones())
    skin(arm, body, parts())
    for name, (bone, at) in SOCKETS.items():
        ao.socket(arm, name, bone, at)
    ik_setup(arm)
    ao.key_clips(arm, CLIPS)
    if write:
        ao.export("dog", arm)
    return arm, body


if __name__ == "__main__" and bpy.app.background:
    main()
    if "--shots" in ao.args():
        print("sheet:", sheet("dog", [(None, 0, "tq"), ("walk", 0.25, "side"), ("run", 0.3, "side"), ("wag", 0.1, "front"),
                                      ("sniff", 0.1, "side"), ("sit", 0, "tq"), ("lie", 0, "tq"), ("nap", 0, "tq")]))
