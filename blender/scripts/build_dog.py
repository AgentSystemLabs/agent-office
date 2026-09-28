"""The office dog, in every breed: modelled, rigged and animated by this script from
the presets in dog_breeds.py, and exported to src/client/models/dog-<breed>.glb
for src/client/world/dog.ts. The shared helpers are in aokit.py and the
conventions in blender/README.md.

Headless, from the repo root (`-- --shots` also writes review sheets, and
`--breed corgi` builds just that one):

    blender --background --factory-startup --python blender/scripts/build_dog.py [-- --shots] [--breed <name>]

Through the Blender MCP bridge (module globals don't survive between calls, so
import it every time):

    import sys, importlib
    sys.path.insert(0, r"<repo>/blender/scripts")
    import aokit, dog_breeds, build_dog
    for m in (aokit, dog_breeds, build_dog): importlib.reload(m)
    build_dog.main("pup")

Two runs give the same dog but not the same bytes (the exporter's triangle order
and the last bit of a few weights vary), so commit a .glb only when that breed
changed. Bone, socket, material and clip names are a contract with dog.ts and
tests/dog-model.test.ts, the same for every breed, so rename them in all three
places.
"""
import bpy, bmesh, math, os, sys
from mathutils import Euler, Matrix, Vector

# Run headless, Blender doesn't put this folder on the import path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aokit as ao
from aokit import Pose, UP, TAU, wave, ease
from dog_breeds import BREEDS, PUP

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

# The breed being built (main() picks it).
B = BREEDS["pup"]


def material(name):
    return ao.material(name, COLORS[name])


def left(p, sx):
    """A point given on the left, on side `sx` (1 left, -1 right)."""
    return (sx * p[0], p[1], p[2])


def leg(kind, sx):
    """A leg's top joint, its middle joint, where the paw starts and the tip of the toes. The
    middle joint sits a little off the straight line so the leg always knows which way it
    bends: front wrists forward, back hocks backward. Shorter legs bend in proportion."""
    toe = 0.1 * B.paw_r[1] / PUP["paw_r"][1]
    if kind == "front":
        fx, fy, top, mid = B.front
        k = (top - 0.045) / 0.265
        x = sx * fx * 1.05
        return (sx * fx, fy, top), (x, fy - 0.024 * k, mid), (x, fy - 0.012 * k, 0.045), (x, fy - toe, 0.03)
    bx, by, top, mid = B.back
    k = (top - 0.045) / 0.255
    x = sx * bx
    return (x, by + 0.005 * k, top), (x, by + 0.055 * k, mid), (x, by + 0.02 * k, 0.045), (x, by - toe * 0.65, 0.03)


def paw_centre(foot, back):
    return (foot[0], foot[1] - (0.025 if back else 0.023) * B.paw_r[1] / PUP["paw_r"][1], B.paw_r[2] - 0.002)


def body_mesh():
    """Everything that is one skin: body, neck, head, muzzle, legs, tail."""
    bm = bmesh.new()
    # Torso: a chest, a waist, a rump.
    ao.limb(bm, *B.waist)
    ao.ellipsoid(bm, *B.chest)
    ao.ellipsoid(bm, *B.rump)
    ao.limb(bm, *B.neck, *B.neck_r)
    # Head: round and big, puppy-like, with soft cheeks and one bean of a muzzle.
    ao.ellipsoid(bm, B.head, B.head_r)
    if B.cheeks:
        for sx in (-1, 1):
            ao.ellipsoid(bm, left(B.cheeks[0], sx), B.cheeks[1])
    ao.ellipsoid(bm, *B.muzzle)
    for centre, radii in B.extra:
        for sx in ((-1, 1) if centre[0] else (1,)):
            ao.ellipsoid(bm, left(centre, sx), radii)
    lr = B.leg_r
    # A thicker leg's end would poke out under its paw.
    ankle = min(0.043 * lr, 0.043)
    hz, hr = B.haunch
    for sx in (-1, 1):
        # Front legs: shoulder, wrist, then a round paw.
        top, joint, foot, _ = leg("front", sx)
        ao.limb(bm, top, joint, 0.058 * lr, 0.046 * lr)
        ao.limb(bm, joint, foot, 0.046 * lr, ankle)
        ao.ellipsoid(bm, paw_centre(foot, False), B.paw_r)
        # Back legs: a big round haunch, then the hock and a paw.
        top, joint, foot, _ = leg("back", sx)
        ao.ellipsoid(bm, (top[0], B.back[1], hz), hr)
        ao.limb(bm, (top[0], B.back[1] + 0.01, hz - 0.04), joint, 0.06 * lr, 0.046 * lr)
        ao.limb(bm, joint, foot, 0.046 * lr, ankle)
        ao.ellipsoid(bm, paw_centre(foot, True), B.paw_r)
    # Tail: from the root to the tip, thinning as it goes.
    for (a, ra), (b, rb) in zip(B.tail, B.tail[1:]):
        ao.limb(bm, a, b, ra, rb)
    return ao.mesh_object("Dog", bm)


def _cond(p, key, limit):
    """How far a point is on the wrong side of one of a patch's conditions (negative: the right side)."""
    axis, op = key[:-1], key[-1]
    v = abs(p.x) if axis == "|x|" else getattr(p, axis)
    return ((v - limit) if op == "<" else (limit - v)) * 12


def field(patch):
    """A patch (see dog_breeds.py) as a field: negative where it is, positive where it isn't."""
    def f(p):
        best = 1e9
        for centre, radii, conds in patch:
            v = ao.blob(p, centre, radii) if centre else -1e9
            for key, limit in conds.items():
                v = max(v, _cond(p, key, limit))
            best = min(best, v)
        return best
    return f


# ---- Loose parts (each its own shape, skinned rigidly to one or two bones) ----------------------

def part(name, mat, build, groups, patches=()):
    """A separate little mesh with one material (and `patches` of others painted on it, as
    [(material, field)]). `groups` maps each vertex (by its position) to {bone: weight}."""
    bm = bmesh.new()
    build(bm)
    ob = ao.mesh_object(name, bm, [material(mat)])
    if patches:
        ao.paint(ob, material(mat), [(material(m), f) for m, f in patches])
    for v in ob.data.vertices:
        for bone, w in groups(v.co).items():
            vg = ob.vertex_groups.get(bone) or ob.vertex_groups.new(name=bone)
            vg.add([v.index], w, 'REPLACE')
    return ob


def rigid(bone):
    return lambda co: {bone: 1.0}


def ear_frame(sx):
    """The left or right ear's top (its base, standing up), its turn, and the way it runs."""
    turn = Euler((B.ear_tilt[0], sx * B.ear_tilt[1], 0), 'XYZ').to_matrix()
    along = turn @ Vector((0, 0, -1 if B.ear == "hang" else 1))
    return Vector(left(B.ear_top, sx)), turn, along


def ear(bm, sx):
    """A hanging ear is a flat teardrop from the side of the head, wider at the bottom; one that
    stands up is a flat point facing forward, wide at the base."""
    top, turn, along = ear_frame(sx)
    hang = B.ear == "hang"
    verts = ao.limb(bm, (0, 0, 0), (0, 0, (-1 if hang else 1) * B.ear_len), *B.ear_r)
    squash = (B.ear_flat, 1.0, 1.0) if hang else (1.0, B.ear_flat, 1.0)
    m = Matrix.Translation(top) @ turn.to_4x4() @ Matrix.Diagonal(squash + (1.0,))
    bmesh.ops.transform(bm, matrix=m, verts=verts)


def inner_ear(sx):
    """The lighter inside of an upright ear: the middle of its front, from just above the head up
    to near the tip."""
    top, turn, _ = ear_frame(sx)
    back = turn.inverted()
    (r0, r1), length = B.ear_r, B.ear_len
    def f(co):
        q = back @ (Vector(co) - top)
        u = q.z / length
        r = r0 + (r1 - r0) * min(1.0, max(0.0, u))
        return max(q.y + 0.35 * r * B.ear_flat, abs(q.x) - 0.6 * r, (0.1 - u) * length)
    return f


def ear_weights(sx):
    """The ear's own bone near the head, its tip's further out."""
    side = "L" if sx > 0 else "R"
    top, _, _ = ear_frame(sx)
    s = B.ear_len / PUP["ear_len"]
    hang = B.ear == "hang"
    def w(co):
        d = (top.z - co.z) if hang else (co.z - top.z)
        k = min(1.0, max(0.0, (d - 0.035 * s) / (0.08 * s)))
        return {f"ear_{side}": 1 - k, f"ear_tip_{side}": k} if k > 0 else {f"ear_{side}": 1.0}
    return w


def eye_scale():
    return [B.eye_r[i] / PUP["eye_r"][i] for i in range(3)]


def eye(bm, sx):
    ao.ellipsoid(bm, left(B.eye, sx), B.eye_r, rot=(0, 0, -sx * B.eye_turn), segs=16, rings=10)


def shine(bm, sx):
    k = eye_scale()
    at = (B.eye[0] + 0.006 * k[0], B.eye[1] - 0.013 * k[1], B.eye[2] + 0.012 * k[2])
    ao.ellipsoid(bm, left(at, sx), (0.008 * k[0], 0.005 * k[1], 0.009 * k[2]), segs=10, rings=6)


def mouth_part(off, radii):
    """A mouth part's centre and radii, from where it is on the pup's muzzle (an offset from its
    centre, and radii), stretched to this breed's muzzle."""
    (c, r), pup = B.muzzle, PUP["muzzle"][1]
    s = [r[i] / pup[i] for i in range(3)]
    return tuple(c[i] + off[i] * s[i] for i in range(3)), tuple(radii[i] * s[i] for i in range(3))


def jaw_line():
    """Where the jaw bone runs, under the muzzle, back to front."""
    return mouth_part((0, 0.065, -0.035), (0, 0, 0))[0], mouth_part((0, -0.065, -0.053), (0, 0, 0))[0]


def collar_radius():
    return 0.1 * B.neck_r[0] / PUP["neck_r"][0]


def collar_matrix():
    a, b = (Vector(p) for p in B.neck)
    turn = (b - a).to_track_quat('Z', 'Y').to_matrix().to_4x4()
    return Matrix.Translation(a.lerp(b, B.collar_at)) @ turn


def collar(bm):
    m = collar_matrix()
    ao.torus(bm, m.translation, collar_radius(), 0.019, rot=m.to_euler(), n=28, m=8)


def tag(bm):
    geom = bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.026, radius2=0.026, depth=0.008)
    # Hanging at the front of the collar, facing forward.
    m = (collar_matrix() @ Matrix.Translation((0, -(collar_radius() + 0.018), -0.03))
         @ Euler((math.pi / 2, 0, 0), 'XYZ').to_matrix().to_4x4())
    bmesh.ops.transform(bm, matrix=m, verts=geom["verts"])


def parts():
    obs = []
    for sx in (-1, 1):
        side = "L" if sx > 0 else "R"
        inside = [("Light", inner_ear(sx))] if B.ear == "up" else []
        obs.append(part(f"ear_{side}", "Ear", lambda bm, sx=sx: ear(bm, sx), ear_weights(sx), inside))
        obs.append(part(f"eye_{side}", "Ink", lambda bm, sx=sx: eye(bm, sx), rigid(f"eye_{side}")))
        obs.append(part(f"shine_{side}", "Shine", lambda bm, sx=sx: shine(bm, sx), rigid(f"eye_{side}")))
    obs.append(part("nose", "Nose", lambda bm: ao.ellipsoid(bm, *B.nose, segs=16, rings=10), rigid("head")))
    # The mouth: a dark inside under the muzzle, a lower jaw that drops open, a tongue on it.
    obs.append(part("mouth", "Ink", lambda bm: ao.ellipsoid(bm, *mouth_part((0, 0, -0.046), (0.042, 0.068, 0.02)), segs=16, rings=8), rigid("head")))
    obs.append(part("chin", "Light", lambda bm: ao.ellipsoid(bm, *mouth_part((0, 0.005, -0.055), (0.05, 0.07, 0.026)), segs=18, rings=10), rigid("jaw")))
    obs.append(part("tongue", "Tongue", lambda bm: ao.ellipsoid(bm, *mouth_part((0, -0.02, -0.032), (0.032, 0.05, 0.011)), segs=14, rings=8), rigid("jaw")))
    obs.append(part("collar", "Collar", collar, rigid("neck")))
    obs.append(part("tag", "Tag", tag, rigid("neck")))
    return obs


# ---- Skeleton -----------------------------------------------------------------------------------

def tail_joints():
    """The tail bones' ends: every nth point of the tail, from the root to the tip."""
    n = (len(B.tail) - 1) // 3
    return [B.tail[i * n][0] for i in range(4)]


def bones():
    """(name, head, tail, parent, deforms the body skin)."""
    hips, spine, chest = ((0,) + tuple(p) for p in B.spine)
    neck_a, neck_b = B.neck
    tail = tail_joints()
    out = [
        ("root", (0, 0, 0), (0, -0.12, 0), None, False),
        ("hips", hips, spine, "root", True),
        ("spine", spine, chest, "hips", True),
        ("chest", chest, neck_a, "spine", True),
        ("neck", neck_a, neck_b, "chest", True),
        ("head", neck_b, (neck_b[0], neck_b[1], neck_b[2] + 0.19), "neck", True),
        ("jaw", *jaw_line(), "head", False),
        ("tail_1", tail[0], tail[1], "hips", True),
        ("tail_2", tail[1], tail[2], "tail_1", True),
        ("tail_3", tail[2], tail[3], "tail_2", True),
    ]
    for sx in (-1, 1):
        s = "L" if sx > 0 else "R"
        top, _, along = ear_frame(sx)
        mid = top + along * (B.ear_len * 0.45)
        eye_at = left(B.eye, sx)
        out += [
            (f"eye_{s}", (eye_at[0], eye_at[1], eye_at[2] - 0.02), (eye_at[0], eye_at[1], eye_at[2] + 0.02), "head", False),
            (f"ear_{s}", tuple(top), tuple(mid), "head", False),
            (f"ear_tip_{s}", tuple(mid), tuple(top + along * (B.ear_len + 0.05)), f"ear_{s}", False),
        ]
        for kind, parent in (("front", "chest"), ("back", "hips")):
            top, joint, foot, toe = leg(kind, sx)
            out += [
                (f"{kind}_upper_{s}", top, joint, parent, True),
                (f"{kind}_lower_{s}", joint, foot, f"{kind}_upper_{s}", True),
                (f"{kind}_paw_{s}", foot, toe, f"{kind}_lower_{s}", True),
            ]
    return out


def leg_reach():
    """(leg bone, the torso bone it hangs from, fully the leg's below this height, not at all above this)"""
    return [(f"{k}_upper_{s}", torso, lo, hi)
            for k, torso, (lo, hi) in (("front", "chest", B.reach_front), ("back", "hips", B.reach_back))
            for s in ("L", "R")]


def soften_legs(body):
    """A leg pulls on the body only low down, fading out up the flank, so a swinging or folded leg
    doesn't drag creases into the side; the torso bone takes what the leg lets go of."""
    groups = {g.name: g for g in body.vertex_groups}
    reach = leg_reach()
    for v in body.data.vertices:
        for leg_bone, torso, lo, hi in reach:
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


def sockets():
    """Where the office hangs things on the dog: name: (bone, where).
    - socket_head: centred over the head, 15 cm under its crown, as on the old procedural dog,
      so the hat and antlers tuned for it sit on any breed's crown;
    - socket_back: its torso origin, so the bat wings land just behind its shoulders;
    - socket_nose: the middle of its nose, for Rudolph's;
    - socket_neck: the middle of its collar, for the scarf."""
    hx, hy, hz = B.head
    chest, chest_r = B.chest
    return {
        "socket_head": ("head", (hx, hy, hz + B.head_r[2] - 0.15)),
        "socket_back": ("spine", (0, B.front[1] + 0.34, chest[2] + chest_r[2] - 0.2)),
        "socket_nose": ("head", B.nose[0]),
        "socket_neck": ("neck", tuple(collar_matrix().translation)),
    }


# ---- Animation ----------------------------------------------------------------------------------
#
# The legs are posed with IK: each paw follows a target bone (ik_front_L, ...) that the clips
# move around, and the exporter samples the solved pose into plain keyframes. The targets
# themselves don't deform anything and aren't exported.

LEGS = [(k, s) for k in ("front", "back") for s in ("L", "R")]

# Metres a second the walk and run clips carry every breed at (dog.ts's STRIDE_SPEED), and how much
# of a cycle each paw is down.
WALK_SPEED, WALK_STANCE = 0.8, 0.5
RUN_SPEED, RUN_STANCE = 1.2, 0.36


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


def stride(speed, stance, frames):
    """How far a paw slides back while it's down, for the clip to carry the dog at `speed`."""
    return speed * stance * frames / ao.FPS


def step(p, kind, s, u, length, lift, stance=0.5, curl=0.6):
    """A paw's place `u` (0..1) through its cycle: planted and sliding back for `stance`, then up,
    toes curled, and swung forward."""
    if u < stance:
        fwd, up, flex = length / 2 - length * (u / stance), 0.0, 0.0
    else:
        v = (u - stance) / (1 - stance)
        fwd, up, flex = -length / 2 + length * ease(v), lift * math.sin(math.pi * v), math.sin(math.pi * v)
    p.move(f"ik_{kind}_{s}", y=-fwd, z=up)
    p.turn(f"ik_{kind}_{s}", "x", curl * flex * (1 if kind == "front" else 0.5))


def ears(p, axis, angle, tip=False, mirrored=False):
    """Turns both ears (or their tips) as much as this breed's ears move (see dog_breeds.py)."""
    k = B.ear_tip if tip else (B.ear_x if axis == "x" else B.ear_z)
    p.both("ear_tip" if tip else "ear", axis, angle * k, mirrored=mirrored)


def tail_wag(p, t, n, amount, up=0.0):
    p.turn("tail_1", "x", up * B.tail_lift)
    for i, k in enumerate((1.0, 0.55, 0.4)):
        p.turn(f"tail_{i + 1}", "z", amount * B.tail_swing * k * wave(t, n, -0.07 * i))


def breathe(p, t, n, amount=0.015):
    p.turn("spine", "x", amount * wave(t, n)).turn("chest", "x", -amount * wave(t, n))


def stand(t):
    p = Pose()
    breathe(p, t, 2)
    p.turn("head", "y", 0.18 * wave(t, 1)).turn("head", "z", 0.05 * wave(t, 1, 0.25))
    ears(p, "x", 0.06 * wave(t, 2))
    tail_wag(p, t, 3, 0.3)
    return p


def walk(t):
    """A trot: diagonal legs together, the body bobbing twice a stride."""
    p = Pose()
    length = stride(WALK_SPEED, WALK_STANCE, B.walk_frames)
    for kind, s, ph in (("front", "L", 0), ("back", "R", 0), ("front", "R", 0.5), ("back", "L", 0.5)):
        step(p, kind, s, (t + ph) % 1, length, B.walk_lift, stance=WALK_STANCE, curl=0.35)
    p.move("hips", z=-B.walk_bob[0] - B.walk_bob[1] * math.cos(TAU * 2 * t))
    p.turn("hips", UP, 0.05 * wave(t, 1)).turn("spine", UP, -0.03 * wave(t, 1))
    p.turn("neck", "x", -0.06).turn("head", "x", 0.05 * wave(t, 2, 0.15))
    ears(p, "x", 0.16 * wave(t, 2, 0.2))
    ears(p, "x", 0.25 * wave(t, 2, 0.32), tip=True)
    tail_wag(p, t, 1, 0.35, up=0.1)
    return p


def run(t):
    """A gallop: back legs, then front legs, a flying moment, the back arching and stretching."""
    p = Pose()
    length = stride(RUN_SPEED, RUN_STANCE, B.run_frames)
    for kind, s, ph in (("back", "L", 0.0), ("back", "R", 0.07), ("front", "L", 0.42), ("front", "R", 0.5)):
        step(p, kind, s, (t - ph) % 1, length, B.run_lift, stance=RUN_STANCE, curl=0.8)
    p.move("hips", z=-B.run_bob[0] + B.run_bob[1] * wave(t, 1, 0.1))
    a = B.run_arch
    p.turn("hips", "x", 0.16 * a * wave(t, 1, 0.3))
    p.turn("spine", "x", 0.12 * a * wave(t, 1, 0.05)).turn("chest", "x", -0.1 * a * wave(t, 1, 0.05))
    p.turn("neck", "x", -0.1 - 0.1 * wave(t, 1, 0.3)).turn("head", "x", 0.1 * wave(t, 1, 0.4))
    ears(p, "x", 0.55 + 0.2 * wave(t, 2))
    ears(p, "x", 0.35 + 0.25 * wave(t, 2, 0.2), tip=True)
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
    ears(p, "z", -0.25, mirrored=True)
    ears(p, "x", -0.1)
    p.move("ik_front_L", z=0.035 * max(0.0, wave(t, 2)))
    p.move("ik_front_R", z=0.035 * max(0.0, wave(t, 2, 0.5)))
    return p


def sniff(t):
    """Nose to the floor, sweeping side to side, snuffling."""
    p = Pose()
    p.move("hips", z=-0.03).turn("hips", "x", 0.1)
    p.turn("neck", UP, 0.4 * wave(t, 1)).turn("neck", "x", 0.55)
    p.turn("head", "x", 0.3 + 0.08 * wave(t, 12)).turn("head", "y", 0.12 * wave(t, 1))
    ears(p, "x", -0.25)
    tail_wag(p, t, 4, 0.3, up=0.35)
    return p


def sitting(p, lean):
    p.turn("hips", "x", lean).move("hips", z=-B.sit[1])
    p.turn("neck", "x", 0.25).turn("head", "x", -lean - 0.25)
    # The hind paws stay about under the hips, so the hock folds back onto the floor behind
    # them (a paw pulled forward folds the hock down through the floor instead).
    for s, sx in (("L", 1), ("R", -1)):
        p.move(f"ik_back_{s}", x=sx * B.sit_back[0], y=B.sit_back[1])


def sit(t):
    p = Pose()
    sitting(p, B.sit[0])
    breathe(p, t, 2, 0.02)
    p.turn("head", "y", 0.12 * wave(t, 1))
    tail_wag(p, t, 2, 0.25, up=-1.1)
    return p


def bark(t):
    """Sitting up, alert, ears up, tail going: the woof itself (jaw, hop) is dog.ts's."""
    p = Pose()
    sitting(p, B.bark_lean)
    p.turn("head", "x", -0.15)
    ears(p, "z", -0.45, mirrored=True)
    ears(p, "x", -0.3, tip=True)
    tail_wag(p, t, 3, 0.5, up=-0.45)
    p.move("hips", z=0.008 * abs(wave(t, 2)))
    return p


def lying(p):
    p.move("hips", z=-B.lie[0])
    for s, sx in (("L", 1), ("R", -1)):
        p.move(f"ik_front_{s}", y=-B.lie[1])
        p.move(f"ik_back_{s}", x=sx * B.lie_back[0], y=B.lie_back[1])


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
    p.turn("tail_1", "x", -1.2 * B.tail_lift).turn("tail_1", UP, 0.9 * B.tail_swing).turn("tail_2", UP, 0.5 * B.tail_swing)
    return p


def clips():
    """name: (frames at 24 fps, pose at t in 0..1)"""
    return {
        "stand": (48, stand),
        "walk": (B.walk_frames, walk),
        "run": (B.run_frames, run),
        "wag": (24, wag),
        "sniff": (96, sniff),
        "sit": (48, sit),
        "bark": (24, bark),
        "lie": (96, lie),
        "nap": (72, nap),
    }


# ---- Review -------------------------------------------------------------------------------------

def floor_report(samples=None):
    """How far each clip pushes the skin under the floor (metres, negative is under), and which
    material dips lowest: a check to run after touching any pose. Every frame of the short clips is
    looked at (a paw can dip between samples), 24 of the long ones."""
    arm, body = bpy.data.objects["DogRig"], bpy.data.objects["Dog"]
    cl = clips()
    out = {}
    for clip, (frames, _) in cl.items():
        n = samples or min(frames, 24)
        worst = (1.0, None)
        for k in range(n):
            ao.show(arm, cl, clip, k / n)
            ev = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
            me = ev.to_mesh()
            for p in me.polygons:
                z = min(me.vertices[i].co.z for i in p.vertices)
                if z < worst[0]:
                    worst = (z, body.material_slots[p.material_index].name)
            ev.to_mesh_clear()
        out[clip] = (round(worst[0], 3), worst[1])
    ao.show(arm, cl, None, 0)
    return out


def floor_faults(report):
    """Clips that sink more than a centimetre into the floor, or that sit or lie on nothing."""
    down = ("sit", "bark", "lie", "nap")
    return {c: z for c, (z, _) in report.items() if z < -0.01 or (c in down and z > 0.005)}


def sheet(name, shots, **kw):
    """Review renders side by side: `shots` is [(clip or None for rest, t, view)]."""
    arm = bpy.data.objects["DogRig"]
    cl = clips()
    kw.setdefault("target", (0, -0.03, 0.3))
    path = ao.sheet(name, [(lambda c=clip, t=t: ao.show(arm, cl, c, t), view) for clip, t, view in shots], **kw)
    ao.show(arm, cl, None, 0)
    return path


def main(breed="pup", write=True):
    """Builds one breed (and exports it as dog-<breed>.glb)."""
    global B
    B = BREEDS[breed]
    ao.clear()
    body = body_mesh()
    ao.fuse(body, quads=B.quads)
    patches = [(material("Light"), field(B.light))]
    if B.mask:
        patches.append((material("Ear"), field(B.mask)))
    ao.paint(body, material("Fur"), patches)
    arm = ao.armature("DogRig", bones())
    skin(arm, body, parts())
    for name, (bone, at) in sockets().items():
        ao.socket(arm, name, bone, at)
    ik_setup(arm)
    ao.key_clips(arm, clips())
    if write:
        ao.export(f"dog-{breed}", arm)
    return arm, body


def review(breed):
    """The review sheets for one breed: its acts, then a close look at the trot and the sit for creases."""
    base = f"dog-{breed}"
    out = [sheet(base, [(None, 0, "tq"), ("walk", 0.25, "side"), ("run", 0.3, "side"), ("wag", 0.1, "front"),
                        ("sniff", 0.1, "side"), ("sit", 0, "tq"), ("lie", 0, "tq"), ("nap", 0, "tq")])]
    out.append(sheet(base + "-folds", [("walk", 0.0, "side"), ("walk", 0.5, "tq"), ("sit", 0, "side"), ("sit", 0, "back"),
                                       ("bark", 0, "tq"), ("lie", 0, "back"), ("run", 0.6, "side"), ("run", 0.1, "side")]))
    return out


if __name__ == "__main__" and bpy.app.background:
    a = ao.args()
    names = [a[a.index("--breed") + 1]] if "--breed" in a else list(BREEDS)
    for name in names:
        main(name)
        body = bpy.data.objects["Dog"]
        report = floor_report()
        print(f"{name}: {ao.tris(body)} tris, floor {report}")
        faults = floor_faults(report)
        if faults:
            print(f"{name}: FLOOR CHECK FAILS {faults}")
        if "--shots" in a:
            print(f"{name} sheets:", review(name))
