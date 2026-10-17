"""The office cat: modelled, rigged and animated by this script and exported to
src/client/models/dog-cat.glb for src/client/features/dog/world.ts, which runs it as
it runs the dog. It's built the dog's way (build_dog.py does the skin, the rig,
the skinning and the export) from a cat's numbers, with a cat's parts and a
cat's clips. The bone, socket, material and clip names are the dog's (the
contract in blender/README.md), so the office poses, picks and dresses up the
cat with the dog's code.

Headless, from the repo root (`-- --shots` also writes review sheets):

    blender --background --factory-startup --python blender/scripts/build_cat.py [-- --shots]

Through the Blender MCP bridge (module globals don't survive between calls, so
import it every time):

    import sys, importlib
    sys.path.insert(0, r"<repo>/blender/scripts")
    import aokit, dog_breeds, build_dog, build_cat
    for m in (aokit, dog_breeds, build_dog, build_cat): importlib.reload(m)
    build_cat.main()
"""
import bpy, bmesh, math, os, sys
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aokit as ao
from aokit import Pose, UP, wave, ease
import build_dog as dog
from dog_breeds import Breed

# A cartoon house cat as big as the pup, in the dog's style: a round head with big eyes, pointed ears,
# fluffy cheeks and a tiny muzzle, a slim body on slender legs with small round paws, and a long tail
# held up in a question mark.
CAT = Breed(
    "cat",
    waist=((0, 0.12, 0.3), (0, -0.12, 0.305), 0.1, 0.105),
    chest=((0, -0.14, 0.31), (0.11, 0.115, 0.12)),
    rump=((0, 0.13, 0.305), (0.11, 0.12, 0.115)),
    quads=2800,
    spine=((0.15, 0.3), (0.0, 0.305), (-0.14, 0.31)),
    neck=((0, -0.17, 0.35), (0, -0.22, 0.45)),
    neck_r=(0.075, 0.07),
    collar_at=0.45,
    head=(0, -0.26, 0.5),
    head_r=(0.135, 0.12, 0.115),
    cheeks=((0.065, -0.315, 0.462), (0.068, 0.055, 0.05)),
    # A tiny muzzle: two little pads under the nose.
    muzzle=((0, -0.352, 0.455), (0.042, 0.032, 0.03)),
    extra=(((0.02, -0.368, 0.452), (0.026, 0.022, 0.022)),),
    nose=((0, -0.383, 0.478), (0.015, 0.01, 0.01)),
    eye=(0.052, -0.35, 0.515),
    eye_r=(0.026, 0.016, 0.033),
    eye_turn=0.3,
    ear="up",
    ear_top=(0.072, -0.245, 0.585),
    ear_len=0.1,
    ear_tilt=(-0.08, 0.32),
    ear_r=(0.05, 0.006),
    ear_flat=0.62,
    front=(0.058, -0.15, 0.27, 0.13),
    back=(0.064, 0.15, 0.27, 0.12),
    leg_r=0.78,
    paw_r=(0.036, 0.044, 0.025),
    haunch=(0.27, (0.062, 0.09, 0.095)),
    reach_front=(0.18, 0.27),
    reach_back=(0.15, 0.26),
    # Up from the rump and over in a question mark, thinning to the tip: 3n + 1 points, n = 2.
    tail=(((0, 0.22, 0.33), 0.03), ((0, 0.3, 0.37), 0.026), ((0, 0.345, 0.44), 0.024), ((0, 0.36, 0.52), 0.022),
          ((0, 0.35, 0.6), 0.02), ((0, 0.32, 0.655), 0.018), ((0, 0.28, 0.675), 0.014)),
    light=(
        # Muzzle and chin, a bib down the chest, the belly and white socks.
        ((0, -0.355, 0.448), (0.05, 0.04, 0.036), {"y<": -0.335, "z<": 0.47}),
        ((0, -0.2, 0.33), (0.075, 0.08, 0.12), {"y<": -0.16}),
        ((0, 0.0, 0.2), (0.065, 0.16, 0.06), {"|x|<": 0.05}),
        (None, None, {"z<": 0.04}),
    ),
    # Tabby stripes in the ear colour: across the back, and an M on the forehead.
    mask=(
        ((0, -0.08, 0.4), (0.13, 0.016, 0.06), {"z>": 0.33}),
        ((0, 0.02, 0.4), (0.13, 0.016, 0.06), {"z>": 0.33}),
        ((0, 0.12, 0.4), (0.13, 0.016, 0.06), {"z>": 0.33}),
        ((0, -0.31, 0.6), (0.012, 0.06, 0.03), {"z>": 0.56}),
        ((0.03, -0.32, 0.6), (0.01, 0.06, 0.028), {"z>": 0.57}),
        ((-0.03, -0.32, 0.6), (0.01, 0.06, 0.028), {"z>": 0.57}),
    ),
    walk_frames=14,
    run_frames=14,
    walk_lift=0.04,
    run_lift=0.07,
    walk_bob=(0.016, 0.004),
    run_bob=(0.02, 0.02),
    run_arch=1.5,
    sit=(-0.7, 0.16),
    bark_lean=-0.7,
    sit_back=(0.03, 0.02),
    lie=(0.19, 0.0),
    lie_back=(0.02, 0.06),
    ear_x=-0.4,
    ear_z=0.6,
    ear_tip=-0.1,
    tail_lift=1.0,
    tail_swing=1.0,
)

COLORS = dict(dog.COLORS, Fur="#e0a458", Ear="#b36f35", Nose="#f29bb0")


def material(name):
    return ao.material(name, COLORS[name])


# ---- Parts ---------------------------------------------------------------------------------------

def bell(bm):
    """A little round bell hanging from the front of the collar, """
    m = dog.collar_matrix() @ Matrix.Translation((0, -(dog.collar_radius() + 0.016), -0.018))
    ao.ellipsoid(bm, m.translation, (0.019, 0.019, 0.019), segs=16, rings=10)


def collar(bm):
    """A slimmer collar than the dog's, for a slimmer neck."""
    m = dog.collar_matrix()
    ao.torus(bm, m.translation, dog.collar_radius(), 0.012, rot=m.to_euler(), n=28, m=8)


def whiskers(bm, sx):
    """Three whiskers fanning out from the side of the muzzle."""
    (cx, cy, cz), (rx, _, _) = CAT.muzzle
    root = Vector((sx * (rx * 0.7), cy - 0.01, cz + 0.004))
    for up in (0.018, 0.0, -0.018):
        tip = root + Vector((sx * 0.095, 0.018, up * 2.2))
        ao.limb(bm, root, tip, 0.0022, 0.0012, segs=6, rings=3)


def parts():
    obs = []
    for sx in (-1, 1):
        side = "L" if sx > 0 else "R"
        obs.append(dog.part(f"ear_{side}", "Ear", lambda bm, sx=sx: dog.ear(bm, sx), dog.ear_weights(sx), [("Light", dog.inner_ear(sx))]))
        obs.append(dog.part(f"eye_{side}", "Ink", lambda bm, sx=sx: dog.eye(bm, sx), dog.rigid(f"eye_{side}")))
        obs.append(dog.part(f"shine_{side}", "Shine", lambda bm, sx=sx: dog.shine(bm, sx), dog.rigid(f"eye_{side}")))
        obs.append(dog.part(f"whiskers_{side}", "Ink", lambda bm, sx=sx: whiskers(bm, sx), dog.rigid("head")))
    obs.append(dog.part("nose", "Nose", lambda bm: ao.ellipsoid(bm, *CAT.nose, segs=12, rings=8), dog.rigid("head")))
    obs.append(dog.part("mouth", "Ink", lambda bm: ao.ellipsoid(bm, *dog.mouth_part((0, 0.01, -0.036), (0.034, 0.05, 0.014)), segs=12, rings=6), dog.rigid("head")))
    obs.append(dog.part("chin", "Light", lambda bm: ao.ellipsoid(bm, *dog.mouth_part((0, 0.02, -0.06), (0.04, 0.055, 0.02)), segs=14, rings=8), dog.rigid("jaw")))
    obs.append(dog.part("tongue", "Tongue", lambda bm: ao.ellipsoid(bm, *dog.mouth_part((0, -0.02, -0.032), (0.032, 0.05, 0.011)), segs=12, rings=6), dog.rigid("jaw")))
    obs.append(dog.part("collar", "Collar", collar, dog.rigid("neck")))
    obs.append(dog.part("tag", "Tag", bell, dog.rigid("neck")))
    return obs


# ---- Clips ---------------------------------------------------------------------------------------
#
# Every clip is the dog's (same names, same rig, same IK on the paws), moved the way a cat moves: a walk
# that sets down one paw after another, a gallop that bends the whole back, a sit with the tail wrapped
# round the front paws, a loaf, a curl, grooming, a meow and, petted, a tail straight up and a head rub.

# The walk carries the cat at the dog's clip speed (world.ts's STRIDE_SPEED), each paw down most of the time.
WALK_STANCE, RUN_STANCE = 0.62, 0.32


def twitch(t, at, width=0.04):
    """A quick flick at `at` through a looping clip: 0, up to 1 and back, over about `width`."""
    d = (t - at + 0.5) % 1 - 0.5
    return math.exp(-(d / width) ** 2)


def tail(p, t, lift=0.0, side=0.0, curl=0.0, sway=0.0, n=1, tip=0.0, tip_n=3):
    """The tail: lifted up (x on the root, + up), swept to the side (about the vertical, + to its left),
    curled at the tip (+ over forward), swaying from the root, and the tip flicking."""
    p.turn("tail_1", "x", lift).turn("tail_1", UP, side + sway * wave(t, n))
    p.turn("tail_2", UP, side * 0.8 + sway * 0.6 * wave(t, n, -0.08)).turn("tail_2", "x", curl * 0.5)
    p.turn("tail_3", UP, side * 0.6 + sway * 0.4 * wave(t, n, -0.16) + tip * wave(t, tip_n)).turn("tail_3", "x", curl)


def ears(p, forward=0.0, out=0.0, flick=0.0):
    """Both ears turned forward or flattened back (x), out to the side (z), and the left one flicked."""
    p.both("ear", "x", forward).both("ear", "z", -out, mirrored=True)
    p.turn("ear_L", "z", -0.5 * flick)


def stand(t):
    """Standing about: breathing, looking round slowly, ears swivelling, the tail up in a question mark."""
    p = Pose()
    dog.breathe(p, t, 2)
    p.turn("neck", UP, 0.25 * wave(t, 1, 0.25)).turn("head", "y", 0.1 * wave(t, 1))
    ears(p, flick=twitch(t, 0.62))
    p.turn("ear_R", "z", 0.4 * twitch(t, 0.3))
    tail(p, t, lift=0.1, sway=0.12, curl=0.15 * wave(t, 2))
    return p


def walk(t):
    """A cat's walk: one paw after another (back, front, other back, other front), the back level and
    the head steady and a little low, the shoulders rolling, the tail held up and swaying."""
    p = Pose()
    length = dog.stride(dog.WALK_SPEED, WALK_STANCE, CAT.walk_frames)
    for kind, s, ph in (("back", "L", 0.0), ("front", "L", 0.25), ("back", "R", 0.5), ("front", "R", 0.75)):
        dog.step(p, kind, s, (t + ph) % 1, length, CAT.walk_lift, stance=WALK_STANCE, curl=0.45)
    p.move("hips", z=-CAT.walk_bob[0] - CAT.walk_bob[1] * math.cos(dog.TAU * 2 * t))
    p.turn("hips", "y", 0.05 * wave(t, 1)).turn("chest", "y", -0.06 * wave(t, 1, 0.25))
    p.turn("hips", UP, 0.04 * wave(t, 1)).turn("chest", UP, -0.04 * wave(t, 1, 0.25))
    p.turn("neck", "x", 0.12).turn("head", "x", -0.1)
    ears(p, forward=-0.1)
    tail(p, t, lift=0.15, sway=0.1, curl=0.2)
    return p


def run(t):
    """A gallop: the back legs push off together, the back curls up and then stretches long as the front
    legs reach, with a moment in the air, the head level and the tail streaming out behind."""
    p = Pose()
    length = dog.stride(dog.RUN_SPEED, RUN_STANCE, CAT.run_frames)
    for kind, s, ph in (("back", "L", 0.0), ("back", "R", 0.06), ("front", "L", 0.46), ("front", "R", 0.54)):
        dog.step(p, kind, s, (t - ph) % 1, length, CAT.run_lift, stance=RUN_STANCE, curl=0.9)
    p.move("hips", z=-CAT.run_bob[0] + CAT.run_bob[1] * wave(t, 1, 0.1))
    a = CAT.run_arch
    p.turn("hips", "x", 0.16 * a * wave(t, 1, 0.3))
    p.turn("spine", "x", 0.14 * a * wave(t, 1, 0.05)).turn("chest", "x", -0.1 * a * wave(t, 1, 0.05))
    p.turn("neck", "x", 0.05 - 0.12 * wave(t, 1, 0.3)).turn("head", "x", 0.12 * wave(t, 1, 0.4))
    ears(p, forward=-0.35)
    tail(p, t, lift=-1.0, curl=-0.3, sway=0.05)
    p.turn("tail_2", "x", 0.15 * wave(t, 1, 0.2))
    return p


def wag(t):
    """Petted: the tail goes straight up with its tip quivering, it pushes its head and cheek against
    the hand, back arched up into it, and kneads with its front paws. world.ts closes its eyes."""
    p = Pose()
    tail(p, t, lift=0.3, curl=-0.5, tip=0.12, tip_n=8)
    p.turn("spine", "x", -0.08).turn("chest", "x", 0.04)
    p.move("hips", z=0.006 * wave(t, 2))
    p.turn("neck", "x", -0.1).turn("neck", UP, 0.2 * wave(t, 1)).turn("head", "y", 0.3 * wave(t, 1, 0.1)).turn("head", "x", -0.15)
    ears(p, forward=0.2, out=0.25)
    p.move("ik_front_L", z=0.03 * max(0.0, wave(t, 2)))
    p.move("ik_front_R", z=0.03 * max(0.0, wave(t, 2, 0.5)))
    return p


def sitting(p, lean):
    """Sat upright on its haunches, front legs straight under its chest."""
    dog.sitting(p, lean)


# The sat tail, (sweep about the vertical, bend down) for each tail bone: found by a search that keeps it
# on the floor (floor_report) and ends the tip beside the front paws.
WRAP = ((2.4, -0.5), (0.8, -0.4), (-0.4, -1.2))


def wrapped(p, t, lean, flick=0.0):
    """The tail down on the floor and swept round the right side to the front paws, the tip flicking. The
    hips are tilted back by `lean`, so the vertical is turned back with them."""
    up = (0.0, math.sin(lean), math.cos(lean))
    for k, (side, down) in enumerate(WRAP, 1):
        if k == 3:
            side += flick * wave(t, 2)
        p.turn(f"tail_{k}", up, side).turn(f"tail_{k}", "x", down)


def sniff(t):
    """Washing: sat up, one front paw raised to its mouth, licking it, then wiping it over its face."""
    p = Pose()
    sitting(p, CAT.sit[0])
    wrapped(p, t, CAT.sit[0])
    lick = 0.5 + 0.5 * wave(t, 6)
    p.move("ik_front_L", x=-0.02, y=-0.06, z=0.17)
    p.turn("ik_front_L", "x", -1.2)
    p.turn("neck", "x", 0.45).turn("neck", UP, 0.3).turn("head", "x", 0.15 + 0.12 * lick).turn("head", "y", -0.2)
    ears(p, out=0.2)
    return p


def sit(t):
    p = Pose()
    sitting(p, CAT.sit[0])
    dog.breathe(p, t, 2, 0.02)
    p.turn("neck", UP, 0.2 * wave(t, 1)).turn("head", "y", 0.08 * wave(t, 1, 0.3))
    ears(p, flick=twitch(t, 0.7))
    wrapped(p, t, CAT.sit[0], flick=0.12)
    return p


def bark(t):
    """Meowing at a worker that needs someone: sat up tall, looking up at the desk, ears forward, the tip of
    its tail lashing. The mouth opening is world.ts's."""
    p = Pose()
    sitting(p, CAT.bark_lean)
    p.turn("neck", "x", -0.1).turn("head", "x", -0.3)
    ears(p, forward=0.2)
    wrapped(p, t, CAT.bark_lean, flick=0.35)
    return p


# The tail lying on the floor (sweep about the vertical, bend down) for each tail bone, searched like WRAP:
# along the right side up to the front paws for the loaf, round to the nose for the curl.
LOAF_TAIL = ((2.6, -1.0), (0.8, -1.2), (0.8, 0.0))
CURL_TAIL = ((-2.6, -1.3), (0.0, -0.4), (0.0, -0.6))


def lay_tail(p, t, bends, flick=0.0):
    for k, (side, down) in enumerate(bends, 1):
        if k == 3:
            side += flick * wave(t, 2)
        p.turn(f"tail_{k}", UP, side).turn(f"tail_{k}", "x", down)


def loafing(p):
    """Lying down with the front paws folded up under the chest (a loaf), the back paws tucked in."""
    dog.lying(p)
    for s in ("L", "R"):
        p.move(f"ik_front_{s}", z=0.04)


def lie(t):
    """A loaf: lying with its paws tucked away under its chest, head up, the tail along its side."""
    p = Pose()
    loafing(p)
    dog.breathe(p, t, 3)
    p.turn("neck", "x", -0.15).turn("head", "x", 0.1).turn("neck", UP, 0.3 * wave(t, 1))
    ears(p, flick=twitch(t, 0.4))
    lay_tail(p, t, LOAF_TAIL, flick=0.1)
    return p


def nap(t):
    """Curled up asleep: the back bent round, the head turned back toward its tail, the chin down, the
    tail round the front to its nose, breathing slow. world.ts shuts the eyes."""
    p = Pose()
    loafing(p)
    dog.breathe(p, t, 1, 0.03)
    # The rump turned one way and the back bent round the other, so the cat lies in a ring.
    p.turn("hips", UP, -0.45)
    for b, k in (("spine", 0.55), ("chest", 0.55)):
        p.turn(b, UP, k)
    for s in ("L", "R"):
        p.move(f"ik_back_{s}", x=-0.06, y=-0.02)
        p.move(f"ik_front_{s}", x=0.08, y=0.04)
    p.move("ik_back_R", x=-0.025, y=0.025, z=0.02)  # the outer hind paw, so its knee stays above the floor
    p.turn("neck", UP, 0.8).turn("neck", "x", 0.3).turn("head", "x", 0.35).turn("head", "y", 0.4)
    ears(p, forward=-0.2, out=0.3)
    lay_tail(p, t, CURL_TAIL)
    return p


def clips():
    """name: (frames at 24 fps, pose at t in 0..1)"""
    return {
        "stand": (96, stand),
        "walk": (CAT.walk_frames, walk),
        "run": (CAT.run_frames, run),
        "wag": (48, wag),
        "sniff": (48, sniff),
        "sit": (96, sit),
        "bark": (24, bark),
        "lie": (96, lie),
        "nap": (96, nap),
    }


# ---- Build ---------------------------------------------------------------------------------------

def main(write=True):
    """Builds the cat (and exports it as dog-cat.glb, a breed as far as the office goes)."""
    # build_dog's helpers read the breed, the parts and the clips from its module.
    dog.B, dog.COLORS, dog.parts, dog.clips = CAT, COLORS, parts, clips
    ao.clear()
    body = dog.body_mesh()
    ao.fuse(body, quads=CAT.quads)
    ao.paint(body, material("Fur"), [(material("Light"), dog.field(CAT.light)), (material("Ear"), dog.field(CAT.mask))])
    arm = ao.armature("DogRig", dog.bones())
    dog.skin(arm, body, parts())
    for name, (bone, at) in dog.sockets().items():
        ao.socket(arm, name, bone, at)
    dog.ik_setup(arm)
    ao.key_clips(arm, clips())
    if write:
        ao.export("dog-cat", arm)
    return arm, body


def review():
    base = "cat"
    out = [dog.sheet(base, [(None, 0, "tq"), ("walk", 0.25, "side"), ("run", 0.3, "side"), ("wag", 0.1, "front"),
                            ("sniff", 0.3, "tq"), ("sit", 0, "tq"), ("lie", 0, "tq"), ("nap", 0, "tq")])]
    out.append(dog.sheet(base + "-more", [("walk", 0.0, "side"), ("walk", 0.5, "tq"), ("sit", 0, "side"), ("sit", 0, "back"),
                                          ("bark", 0, "tq"), ("lie", 0, "back"), ("run", 0.6, "side"), ("nap", 0, "top")]))
    out.append(dog.sheet(base + "-face", [(None, 0, "front"), (None, 0, "tq"), (None, 0, "side"), ("wag", 0.25, "tq")],
                         target=(0, -0.3, 0.48), dist=0.75))
    return out


if __name__ == "__main__" and bpy.app.background:
    a = ao.args()
    main()
    body = bpy.data.objects["Dog"]
    report = dog.floor_report()
    print(f"cat: {ao.tris(body)} tris, floor {report}")
    faults = dog.floor_faults(report)
    if faults:
        print(f"cat: FLOOR CHECK FAILS {faults}")
    if "--shots" in a:
        print("cat sheets:", review())
