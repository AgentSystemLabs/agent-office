"""The office dog's breeds: one preset each, which build_dog.py models, rigs and
animates. Every breed has the same bones, sockets, materials and clips (the
contract with world/dog.ts); only proportions, shapes and poses differ, so a
preset is a set of numbers over the pup's.

Blender space, metres: the dog faces -Y, Z is up and +X is its left. Points on
one side of the body are given on the left (+X) and mirrored.
"""

# A patch is where a skin material goes, as a list of shapes: each is an ellipsoid (centre, radii),
# or None for everywhere, cut by conditions on the point ("z<": 0.06 keeps what's below 6 cm, "|x|<"
# what's within that of the middle). The patch is every shape together.

PUP = dict(
    # Torso: a waist (from, to, radius at each end) between a chest and a rump (centre, radii).
    waist=((0, 0.12, 0.35), (0, -0.12, 0.36), 0.132, 0.138),
    chest=((0, -0.15, 0.35), (0.145, 0.135, 0.15)),
    rump=((0, 0.13, 0.35), (0.135, 0.125, 0.135)),
    # More round shapes melted into the skin, [(centre, radii)], mirrored when off the middle.
    extra=(),
    # How many even quads the skin is laid out in (see aokit.fuse).
    quads=2800,
    # Where the hips, spine and chest bones start (y, z); the chest's runs on to the neck.
    spine=((0.15, 0.35), (0.0, 0.36), (-0.14, 0.365)),
    neck=((0, -0.17, 0.40), (0, -0.25, 0.51)),
    neck_r=(0.095, 0.09),
    # How far up the neck the collar sits (0 at its root, 1 at the head).
    collar_at=0.42,
    head=(0, -0.29, 0.57),
    head_r=(0.155, 0.145, 0.14),
    # Soft cheeks either side of the muzzle (the left one), or None.
    cheeks=((0.06, -0.33, 0.525), (0.07, 0.07, 0.06)),
    # The muzzle; the mouth, chin, tongue and jaw are placed and sized from it.
    muzzle=((0, -0.405, 0.525), (0.082, 0.095, 0.064)),
    nose=((0, -0.497, 0.56), (0.037, 0.026, 0.027)),
    # The left eye: where, how big, and how far it turns to look out to the side.
    eye=(0.066, -0.412, 0.595),
    eye_r=(0.024, 0.016, 0.031),
    eye_turn=0.32,
    # Ears: 'hang' (a flat teardrop hanging from its top) or 'up' (a pointed ear standing up from
    # its base). Where the left one's top (or base) is, how long it is, how it's tilted (about x,
    # then y), its radius at the top and the bottom, and how flat it is.
    ear="hang",
    ear_top=(0.098, -0.262, 0.628),
    ear_len=0.15,
    ear_tilt=(0.12, -0.26),
    ear_r=(0.04, 0.064),
    ear_flat=0.36,
    # Legs, the left ones: across, along, the top joint's height and the middle joint's.
    front=(0.078, -0.17, 0.31, 0.15),
    back=(0.088, 0.14, 0.30, 0.13),
    # Thicker or thinner legs, and the paws' radii.
    leg_r=1.0,
    paw_r=(0.052, 0.066, 0.034),
    # The round haunch over each back leg: its height and radii.
    haunch=(0.30, (0.075, 0.1, 0.105)),
    # A leg pulls on the body only below the first height, fading out by the second (see soften_legs).
    reach_front=(0.2, 0.3),
    reach_back=(0.17, 0.29),
    # The tail: [(point, radius)] from the root, 3n + 1 of them; its bones run through every nth.
    tail=(((0, 0.22, 0.40), 0.048), ((0, 0.29, 0.47), 0.04), ((0, 0.325, 0.55), 0.032), ((0, 0.325, 0.63), 0.022)),
    # Where the coat is light (Light), and where it's the ear colour (Ear).
    light=(
        # Muzzle, a blaze up the nose, a bib down the chest, the belly, socks and the tail tip.
        ((0, -0.405, 0.525), (0.082 * 1.12, 0.095 * 1.12, 0.064 * 1.12), {"y<": -0.355}),
        ((0, -0.36, 0.5), (0.026, 0.12, 0.14), {"z>": 0.555}),
        ((0, -0.27, 0.32), (0.1, 0.11, 0.15), {"z>": 0.235}),
        ((0, -0.03, 0.19), (0.075, 0.15, 0.07), {"|x|<": 0.05}),
        (None, None, {"z<": 0.062}),
        (None, None, {"z>": 0.6, "y>": 0.28}),
    ),
    mask=(),
    # ---- How it moves -----------------------------------------------------------------------------
    # Frames a walk (trot) and a run (gallop) cycle take at 24 fps. Every breed covers the same ground
    # a second at its own clip speed (dog.ts's STRIDE_SPEED), so shorter legs take shorter, quicker
    # strides: the stride follows from these.
    walk_frames=12,
    run_frames=19,
    # How high a paw lifts, walking and running, and how far the hips dip (walking: always, and twice
    # a stride; running: on average, and once a stride). Short legs reach a gallop's long stride by
    # running low.
    walk_lift=0.045,
    run_lift=0.075,
    walk_bob=(0.022, 0.01),
    run_bob=(0.02, 0.025),
    # How much the back arches and stretches galloping.
    run_arch=1.0,
    # Sitting: how far the hips tip back and drop, and where the hind paws go (sideways, back).
    sit=(-0.62, 0.19),
    bark_lean=-0.55,
    sit_back=(0.035, 0.02),
    # Lying: how far the hips drop, how far forward the front paws go, and where the hind paws go.
    lie=(0.2, 0.2),
    lie_back=(0.06, 0.05),
    # How much of each clip's ear and tail movement it does: ears turning forward and back (x),
    # out to the side (z), the tips flopping, the tail going up and down, and wagging.
    ear_x=1.0,
    ear_z=1.0,
    ear_tip=1.0,
    tail_lift=1.0,
    tail_swing=1.0,
)


class Breed:
    """One breed: the pup's numbers (PUP), with whatever the preset sets instead."""

    def __init__(self, name, **kw):
        unknown = set(kw) - set(PUP)
        if unknown:
            raise KeyError(f"{name}: no such setting {sorted(unknown)}")
        self.name = name
        self.__dict__.update(PUP)
        self.__dict__.update(kw)


BREEDS = {
    "pup": Breed("pup"),
    # Long and low on very short legs, big upright ears, a fox's face, a stubby tail and a fluffy rump.
    "corgi": Breed(
        "corgi",
        waist=((0, 0.16, 0.25), (0, -0.18, 0.255), 0.125, 0.13),
        chest=((0, -0.2, 0.25), (0.14, 0.14, 0.135)),
        rump=((0, 0.17, 0.25), (0.135, 0.13, 0.125)),
        # The fluffy rump, and a ruff on its chest.
        extra=(((0.055, 0.25, 0.235), (0.085, 0.075, 0.095)), ((0, -0.3, 0.25), (0.11, 0.08, 0.1))),
        spine=((0.18, 0.25), (0.0, 0.255), (-0.18, 0.26)),
        neck=((0, -0.22, 0.30), (0, -0.30, 0.40)),
        neck_r=(0.09, 0.085),
        collar_at=0.62,
        head=(0, -0.34, 0.45),
        head_r=(0.142, 0.135, 0.127),
        cheeks=((0.055, -0.38, 0.41), (0.062, 0.06, 0.052)),
        muzzle=((0, -0.455, 0.405), (0.058, 0.09, 0.05)),
        nose=((0, -0.54, 0.43), (0.031, 0.022, 0.023)),
        eye=(0.058, -0.452, 0.47),
        eye_r=(0.021, 0.014, 0.027),
        ear="up",
        ear_top=(0.075, -0.33, 0.53),
        ear_len=0.16,
        ear_tilt=(-0.08, 0.34),
        ear_r=(0.064, 0.012),
        ear_flat=0.5,
        front=(0.08, -0.22, 0.2, 0.1),
        back=(0.09, 0.18, 0.2, 0.09),
        leg_r=1.15,
        paw_r=(0.055, 0.066, 0.034),
        haunch=(0.2, (0.08, 0.1, 0.1)),
        reach_front=(0.12, 0.19),
        reach_back=(0.09, 0.19),
        tail=(((0, 0.28, 0.30), 0.042), ((0, 0.31, 0.32), 0.036), ((0, 0.33, 0.335), 0.03), ((0, 0.345, 0.34), 0.022)),
        light=(
            ((0, -0.455, 0.405), (0.067, 0.1, 0.058), {"y<": -0.41}),
            ((0, -0.41, 0.38), (0.024, 0.12, 0.13), {"z>": 0.43}),
            ((0, -0.3, 0.26), (0.105, 0.1, 0.15), {"z>": 0.13}),
            ((0, 0.0, 0.12), (0.08, 0.2, 0.06), {"|x|<": 0.06}),
            ((0, 0.27, 0.19), (0.13, 0.08, 0.09), {"z<": 0.22}),
            (None, None, {"z<": 0.085}),
        ),
        walk_frames=8,
        run_frames=13,
        walk_lift=0.03,
        run_lift=0.045,
        walk_bob=(0.02, 0.006),
        run_bob=(0.05, 0.012),
        run_arch=0.6,
        sit=(-0.3, 0.095),
        bark_lean=-0.26,
        sit_back=(0.025, 0.012),
        lie=(0.113, 0.12),
        lie_back=(0.04, 0.03),
        ear_x=-0.35,
        ear_z=0.6,
        ear_tip=-0.15,
        tail_lift=0.4,
        tail_swing=0.7,
    ),
    # A very long body with a deep chest, very short legs, a long head, long floppy ears and a long thin tail.
    "dachshund": Breed(
        "dachshund",
        waist=((0, 0.2, 0.235), (0, -0.22, 0.235), 0.11, 0.12),
        chest=((0, -0.24, 0.23), (0.125, 0.14, 0.13)),
        rump=((0, 0.2, 0.235), (0.115, 0.12, 0.115)),
        # The keel of its chest, low between the front legs.
        extra=(((0, -0.2, 0.155), (0.1, 0.14, 0.075)),),
        spine=((0.22, 0.235), (0.0, 0.24), (-0.22, 0.245)),
        neck=((0, -0.27, 0.28), (0, -0.35, 0.38)),
        neck_r=(0.08, 0.075),
        collar_at=0.45,
        head=(0, -0.39, 0.42),
        head_r=(0.12, 0.13, 0.11),
        cheeks=((0.05, -0.44, 0.39), (0.055, 0.06, 0.05)),
        muzzle=((0, -0.52, 0.385), (0.058, 0.12, 0.052)),
        nose=((0, -0.636, 0.405), (0.03, 0.022, 0.024)),
        eye=(0.055, -0.49, 0.45),
        eye_r=(0.02, 0.014, 0.026),
        ear_top=(0.09, -0.37, 0.48),
        ear_len=0.19,
        ear_tilt=(0.1, -0.2),
        ear_r=(0.04, 0.07),
        ear_flat=0.34,
        front=(0.07, -0.26, 0.17, 0.085),
        back=(0.075, 0.22, 0.17, 0.08),
        leg_r=1.05,
        paw_r=(0.048, 0.062, 0.032),
        haunch=(0.18, (0.07, 0.09, 0.085)),
        reach_front=(0.09, 0.16),
        reach_back=(0.08, 0.16),
        tail=(((0, 0.3, 0.26), 0.03), ((0, 0.38, 0.29), 0.024), ((0, 0.46, 0.31), 0.018), ((0, 0.54, 0.34), 0.011)),
        light=(
            ((0, -0.52, 0.385), (0.065, 0.13, 0.058), {"y<": -0.56}),
            ((0.052, -0.483, 0.483), (0.014, 0.012, 0.01), {}),
            ((-0.052, -0.483, 0.483), (0.014, 0.012, 0.01), {}),
            ((0, -0.33, 0.24), (0.08, 0.08, 0.1), {"z<": 0.3}),
            (None, None, {"z<": 0.05}),
        ),
        walk_frames=8,
        run_frames=9,
        walk_lift=0.025,
        run_lift=0.055,
        walk_bob=(0.018, 0.005),
        run_bob=(0.035, 0.008),
        run_arch=0.25,
        sit=(-0.21, 0.09),
        bark_lean=-0.18,
        sit_back=(0.02, 0.01),
        lie=(0.07, 0.1),
        lie_back=(0.035, 0.025),
        ear_z=0.8,
        tail_lift=0.6,
    ),
    # Squat and round, a big round head with a flat face, big eyes, little folded ears, a curly tail.
    "pug": Breed(
        "pug",
        waist=((0, 0.08, 0.28), (0, -0.08, 0.285), 0.15, 0.155),
        chest=((0, -0.1, 0.28), (0.165, 0.14, 0.155)),
        rump=((0, 0.1, 0.28), (0.155, 0.13, 0.145)),
        spine=((0.12, 0.28), (0.0, 0.285), (-0.1, 0.29)),
        neck=((0, -0.14, 0.32), (0, -0.2, 0.4)),
        neck_r=(0.11, 0.105),
        collar_at=0.4,
        head=(0, -0.25, 0.46),
        head_r=(0.165, 0.15, 0.15),
        # Jowls either side of a short, wide muzzle.
        cheeks=((0.06, -0.34, 0.395), (0.07, 0.055, 0.06)),
        muzzle=((0, -0.37, 0.41), (0.085, 0.05, 0.055)),
        nose=((0, -0.425, 0.448), (0.032, 0.02, 0.022)),
        eye=(0.075, -0.37, 0.485),
        eye_r=(0.03, 0.02, 0.034),
        eye_turn=0.45,
        # Little flaps folded forward over the top corners of its head.
        ear_top=(0.12, -0.235, 0.575),
        ear_len=0.08,
        ear_tilt=(-0.75, -0.55),
        ear_r=(0.035, 0.048),
        ear_flat=0.35,
        front=(0.09, -0.12, 0.23, 0.11),
        back=(0.095, 0.1, 0.22, 0.095),
        leg_r=1.2,
        paw_r=(0.05, 0.06, 0.032),
        haunch=(0.22, (0.08, 0.1, 0.1)),
        reach_front=(0.13, 0.22),
        reach_back=(0.11, 0.21),
        # Curled up tight over its rump.
        tail=(((0, 0.21, 0.35), 0.04), ((0, 0.26, 0.40), 0.038), ((0, 0.255, 0.46), 0.035), ((0, 0.21, 0.49), 0.032),
              ((0, 0.16, 0.475), 0.028), ((0, 0.15, 0.445), 0.024), ((0, 0.18, 0.435), 0.018)),
        light=(
            ((0, -0.23, 0.22), (0.1, 0.08, 0.1), {}),
            ((0, 0.0, 0.14), (0.09, 0.14, 0.06), {"|x|<": 0.07}),
        ),
        # The dark mask over its face: muzzle, jowls and round its eyes.
        mask=(
            ((0, -0.38, 0.44), (0.15, 0.1, 0.1), {"y<": -0.32}),
        ),
        walk_frames=9,
        run_frames=13,
        walk_lift=0.035,
        run_lift=0.05,
        walk_bob=(0.02, 0.008),
        run_bob=(0.05, 0.015),
        run_arch=0.8,
        sit=(-0.62, 0.12),
        bark_lean=-0.55,
        sit_back=(0.03, 0.015),
        lie=(0.11, 0.14),
        lie_back=(0.05, 0.04),
        ear_x=0.4,
        ear_z=0.5,
        ear_tip=0.3,
        tail_lift=0.15,
        tail_swing=0.35,
    ),
    "shiba": Breed(
        "shiba",
        waist=((0, 0.12, 0.34), (0, -0.12, 0.345), 0.12, 0.125),
        chest=((0, -0.15, 0.34), (0.13, 0.13, 0.14)),
        rump=((0, 0.12, 0.34), (0.125, 0.12, 0.13)),
        # A ruff down its chest.
        extra=(((0, -0.24, 0.35), (0.1, 0.08, 0.12)),),
        spine=((0.14, 0.34), (0.0, 0.345), (-0.14, 0.35)),
        neck=((0, -0.17, 0.39), (0, -0.25, 0.5)),
        neck_r=(0.09, 0.085),
        collar_at=0.6,
        head=(0, -0.29, 0.56),
        head_r=(0.145, 0.135, 0.13),
        # Wide fluffy cheeks, and a narrow muzzle.
        cheeks=((0.07, -0.33, 0.52), (0.075, 0.07, 0.065)),
        muzzle=((0, -0.41, 0.512), (0.06, 0.09, 0.052)),
        nose=((0, -0.495, 0.54), (0.03, 0.022, 0.023)),
        eye=(0.062, -0.403, 0.585),
        eye_r=(0.02, 0.013, 0.022),
        eye_turn=0.35,
        ear="up",
        ear_top=(0.075, -0.27, 0.65),
        ear_len=0.12,
        ear_tilt=(0.12, 0.25),
        ear_r=(0.052, 0.01),
        ear_flat=0.5,
        front=(0.075, -0.17, 0.3, 0.145),
        back=(0.085, 0.13, 0.29, 0.125),
        haunch=(0.29, (0.072, 0.095, 0.1)),
        reach_front=(0.2, 0.29),
        reach_back=(0.17, 0.28),
        # Bushy, curled up over its back and a little to one side.
        tail=(((0, 0.21, 0.40), 0.05), ((0, 0.27, 0.47), 0.055), ((0.005, 0.27, 0.55), 0.055), ((0.015, 0.21, 0.6), 0.05),
              ((0.025, 0.14, 0.585), 0.045), ((0.03, 0.11, 0.55), 0.038), ((0.03, 0.13, 0.525), 0.028)),
        light=(
            ((0, -0.41, 0.512), (0.07, 0.105, 0.062), {}),
            ((0.07, -0.33, 0.52), (0.085, 0.08, 0.075), {"z<": 0.55}),
            ((-0.07, -0.33, 0.52), (0.085, 0.08, 0.075), {"z<": 0.55}),
            ((0, -0.26, 0.38), (0.1, 0.12, 0.2), {"y<": -0.2}),
            ((0, -0.02, 0.21), (0.08, 0.17, 0.08), {"|x|<": 0.06}),
            ((0.05, -0.393, 0.622), (0.016, 0.014, 0.011), {}),
            ((-0.05, -0.393, 0.622), (0.016, 0.014, 0.011), {}),
            (None, None, {"z<": 0.075}),
        ),
        sit=(-0.6, 0.18),
        bark_lean=-0.53,
        lie=(0.19, 0.2),
        ear_x=-0.3,
        ear_z=0.5,
        ear_tip=-0.1,
        tail_lift=0.15,
        tail_swing=0.35,
    ),
}
