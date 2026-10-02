"""The garage's supercars: a Lambo (a low, sharp wedge with a wing) and a Ferrari (curvy, a long
hood and big rear haunches). Modelled by this script and exported to src/client/models/cars.glb for
src/client/features/cars/world.ts, which paints each car its own colour. The shared helpers are in
aokit.py and the conventions in blender/README.md.

Headless, from the repo root (`-- --shots` also writes a review sheet of each car):

    blender --background --factory-startup --python blender/scripts/build_cars.py [-- --shots]

Each car is four roots, named after its kind:
  <kind>          the body, with the rear wheels, lights, intakes, mirrors (and the Lambo's wing)
  <kind>_top      the glass cabin and its painted roof, which the office takes off while anyone's in it
  <kind>_open     what's left with the roof off: the windshield (see-through Screen), the dashboard, two
                  bucket seats and the steering wheel
  <kind>_wheel_l  the front wheels, each with its origin at its hub: the office turns them to steer
  <kind>_wheel_r

All stand on the floor at the origin under the car's middle, nose forward, in the old code-built cars'
footprint (shared/garage.ts's CAR: 4.6 long, 2 wide), wheels where they were, so the colliders, the
seats and the camera stay as they are. Roots and material names are a contract with
features/cars/world.ts and tests/cars-model.test.ts: rename them in all three places.

The body is lofted: a smooth cross-section (a rounded rectangle, narrower at the top) at stations nose
to tail, each with its own width, sill, height and how much higher its fenders stand than its middle,
splined between, then wheel arches cut into the fenders.
"""
import bpy, bmesh, math, os, sys
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aokit as ao
from aokit import TAU

# Preview colours only: features/cars/world.ts paints every material by name, Paint with each car's own colour.
COLORS = {
    "Paint": "#f2c230",
    "Glass": "#233347",
    "Screen": "#9fc3e6",
    "Dark": "#2b2d42",
    "Tire": "#1f1f26",
    "RimGold": "#e9b949",
    "RimSilver": "#d9dbe3",
    "Caliper": "#e63946",
    "Lamp": "#fff6c9",
    "Tail": "#ff2d3f",
    "Chrome": "#c9ccd6",
    "Badge": "#ffd400",
    "Seat": "#3a3340",
}


def material(name):
    return ao.material(name, COLORS[name])


# The sizes the office's code counts on (features/cars/world.ts and shared/garage.ts), copied here;
# tests/cars-model.test.ts checks the model against them.
LENGTH = 4.6
WHEEL_R = 0.36
WHEEL_Y = 0.37
WHEEL_X = 0.79
SEATS_X = 0.42
SEATS_Z = -0.5
AXLE = {"lambo": 1.42, "ferrari": 1.36}


def at(x, y, z):
    """Office axes (x left, y up, z forward) to Blender's (x left, -y forward, z up)."""
    return Vector((x, -z, y))


def obox(bm, c, size, bevel=0.0, pitch=0.0, yaw=0.0, roll=0.0, segments=3):
    """A box at office point `c`, `size` (across, up, along) in office axes. `pitch` lifts its back
    (tips its nose down), `yaw` turns its nose left, `roll` lifts its left side."""
    ao.box(bm, at(*c), (size[0], size[2], size[1]), bevel=bevel, rot=(pitch, roll, yaw), segments=segments)


def oball(bm, c, radii, pitch=0.0, yaw=0.0, roll=0.0, segs=20, rings=10):
    """A squashed sphere at office point `c`, `radii` (across, up, along) in office axes."""
    ao.ellipsoid(bm, at(*c), (radii[0], radii[2], radii[1]), rot=(pitch, roll, yaw), segs=segs, rings=rings)


# ---- The lofted body ------------------------------------------------------------------------------

# A station along the car (z, nose +): half its width, its sill and its top along the middle, how much
# higher the fenders stand than the middle (`crown`, at the sides), how round its corners are (2 is an
# ellipse, higher squarer), and how much narrower it is at the top (`tuck`).
STATIONS = {
    "lambo": [
        # z      hw     sill   top    crown  round tuck
        (-2.30, 0.86, 0.34, 0.80, 0.04, 5.0, 0.08),
        (-2.22, 0.93, 0.26, 0.92, 0.05, 6.0, 0.10),
        (-1.95, 0.97, 0.21, 0.95, 0.06, 6.0, 0.12),
        (-1.42, 0.99, 0.20, 0.93, 0.06, 6.0, 0.14),
        (-0.90, 0.97, 0.20, 0.86, 0.06, 6.0, 0.18),
        (-0.30, 0.95, 0.20, 0.78, 0.06, 6.0, 0.18),
        (0.40, 0.95, 0.20, 0.72, 0.10, 6.0, 0.16),
        (1.00, 0.96, 0.20, 0.66, 0.14, 6.0, 0.12),
        (1.42, 0.96, 0.20, 0.60, 0.21, 6.0, 0.10),
        (1.85, 0.93, 0.21, 0.52, 0.18, 6.0, 0.10),
        (2.16, 0.86, 0.23, 0.44, 0.10, 5.0, 0.08),
        (2.31, 0.72, 0.27, 0.36, 0.04, 4.0, 0.06),
    ],
    "ferrari": [
        (-2.27, 0.80, 0.34, 0.70, 0.02, 3.2, 0.10),
        (-2.18, 0.90, 0.26, 0.80, 0.04, 3.6, 0.12),
        (-1.85, 0.98, 0.21, 0.86, 0.08, 3.8, 0.14),
        (-1.36, 1.00, 0.20, 0.87, 0.10, 3.8, 0.16),
        (-0.85, 0.95, 0.20, 0.82, 0.08, 3.8, 0.18),
        (-0.25, 0.92, 0.20, 0.77, 0.08, 3.8, 0.18),
        (0.35, 0.93, 0.20, 0.72, 0.12, 3.8, 0.16),
        (0.95, 0.95, 0.20, 0.65, 0.16, 3.8, 0.14),
        (1.36, 0.96, 0.20, 0.60, 0.21, 3.6, 0.12),
        (1.80, 0.92, 0.21, 0.52, 0.16, 3.4, 0.10),
        (2.12, 0.82, 0.24, 0.44, 0.08, 3.0, 0.08),
        (2.28, 0.62, 0.29, 0.37, 0.02, 2.6, 0.06),
    ],
}

# The glass cabin over the body, nose to tail: where it is along the car, its foot (the beltline)
# and how wide it is there, and its top and how wide that is. It starts at nothing at the
# windshield's foot and runs out into the engine deck.
GREENHOUSE = {
    "lambo": [
        (1.15, 0.64, 0.70, 0.64, 0.60),
        (0.80, 0.68, 0.74, 0.88, 0.60),
        (0.30, 0.73, 0.76, 1.07, 0.56),
        (-0.30, 0.77, 0.76, 1.12, 0.54),
        (-0.95, 0.82, 0.72, 1.03, 0.50),
        (-1.65, 0.88, 0.64, 0.95, 0.46),
        (-1.95, 0.90, 0.60, 0.90, 0.44),
    ],
    "ferrari": [
        (0.80, 0.64, 0.70, 0.64, 0.60),
        (0.50, 0.68, 0.74, 0.86, 0.60),
        (0.05, 0.73, 0.76, 1.08, 0.56),
        (-0.50, 0.76, 0.76, 1.13, 0.54),
        (-1.10, 0.80, 0.72, 1.04, 0.50),
        (-1.65, 0.84, 0.64, 0.90, 0.46),
        (-1.85, 0.85, 0.60, 0.85, 0.44),
    ],
}
# Where the painted roof is (between these, along the car), and the windshield's foot and top with
# the roof off.
ROOF = {"lambo": (0.20, -0.95), "ferrari": (-0.05, -1.10)}
SCREEN = {"lambo": (1.12, 0.64, 0.28, 0.98), "ferrari": (0.78, 0.64, 0.12, 0.98)}


class Parts:
    """Shapes by material: each goes into its material's own mesh, and they're joined into one object
    at the end, a slot per material."""

    def __init__(self):
        self.meshes = {}

    def of(self, mat):
        return self.meshes.setdefault(mat.name, bmesh.new())

    def add(self, mat, fn, *a, **k):
        fn(self.of(mat), *a, **k)

    def build(self, name, smooth=True):
        obs = [ao.mesh_object(f"{name}.{m}", bm, [bpy.data.materials[m]], smooth=smooth) for m, bm in self.meshes.items()]
        ob = ao.join(obs[0], obs[1:])
        ob.name = ob.data.name = name
        return ob


def catmull(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)


def splined(stations, n):
    """`n` stations nose to tail, splined through the given ones (every value smoothly in between)."""
    out = []
    k = len(stations)
    for i in range(n):
        u = i / (n - 1) * (k - 1)
        j = min(int(u), k - 2)
        t = u - j
        rows = [stations[max(0, min(k - 1, j + d))] for d in (-1, 0, 1, 2)]
        out.append(tuple(catmull(*[r[c] for r in rows], t) for c in range(len(stations[0]))))
    return out


def section(st, m):
    """A station's cross-section, `m` points round it (x, y), from the bottom middle round by the left."""
    _, hw, sill, top, crown, rnd, tuck = st
    pts = []
    mid = (sill + top) / 2
    hh = (top - sill) / 2
    for i in range(m):
        a = TAU * i / m - math.pi / 2
        c, s = math.cos(a), math.sin(a)
        x = math.copysign(abs(c) ** (2 / rnd), c) * hw
        y = mid + math.copysign(abs(s) ** (2 / rnd), s) * hh
        f = max(0.0, (y - sill) / max(1e-6, top - sill))
        x *= 1 - tuck * f * f
        # The fenders stand above the middle as ridges out at the sides (over the wheels, higher than
        # their arches), and only on the top half.
        if s > 0:
            f = min(1.0, max(0.0, (abs(x) / hw - 0.3) / 0.32))
            y += crown * f * f * (3 - 2 * f) * s
        pts.append((x, y))
    return pts


def loft(bm, stations, rings=44, around=32):
    """The body's skin: a ring of `around` points at each of `rings` stations, nose and tail capped."""
    sts = splined(stations, rings)
    grid = []
    for st in sts:
        z = st[0]
        grid.append([bm.verts.new(at(x, y, z)) for x, y in section(st, around)])
    for a, b in zip(grid, grid[1:]):
        for i in range(around):
            bm.faces.new((a[i], a[(i + 1) % around], b[(i + 1) % around], b[i]))
    bm.faces.new(grid[0][::-1])
    bm.faces.new(grid[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return sts


def height_at(sts, z, x=0.0):
    """How high the body's top is at (x, z), from the splined stations."""
    best = min(sts, key=lambda s: abs(s[0] - z))
    pts = [p for p in section(best, 72) if p[1] > (best[2] + best[3]) / 2]
    return min(pts, key=lambda p: abs(p[0] - x))[1]


def width_at(sts, z, y):
    """How far out the body's side is at height y, at station z."""
    best = min(sts, key=lambda s: abs(s[0] - z))
    pts = [p for p in section(best, 72) if p[0] > 0]
    return min(pts, key=lambda p: abs(p[1] - y))[0]


def cut_arches(ob, axle, r=0.41, inner=0.62):
    """Wheel arches, cut up into the fenders over each axle (from `inner` out, so the hood between stays)."""
    cutters = []
    for z in (-axle, axle):
        for sx in (-1, 1):
            bm = bmesh.new()
            ao.cylinder(bm, at(sx * inner, WHEEL_Y, z), at(sx * 1.3, WHEEL_Y, z), r, segs=32)
            c = ao.mesh_object("_arch", bm)
            cutters.append(c)
    for c in cutters:
        mod = ob.modifiers.new("arch", 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.solver = 'EXACT'
        mod.object = c
        ao.apply_modifier(ob, "arch")
        bpy.data.objects.remove(c, do_unlink=True)
    # The arches' inside, so you don't see into the body through them.
    # Only over the wheel: an arc from the sill on one side round the top to the sill on the other.
    bm = bmesh.new()
    rr = r - 0.01
    a0 = math.asin(max(-1.0, min(1.0, (0.2 - WHEEL_Y) / rr)))
    for z in (-axle, axle):
        for sx in (-1, 1):
            n = 24
            ring = []
            for i in range(n + 1):
                a = a0 + (math.pi - 2 * a0) * i / n
                ring.append([bm.verts.new(at(x, WHEEL_Y + rr * math.sin(a), z + rr * math.cos(a))) for x in (sx * inner, sx * 0.9)])
            for p, q in zip(ring, ring[1:]):
                bm.faces.new((p[0], q[0], q[1], p[1]))
    liner = ao.mesh_object("_liner", bm, [material("Dark")])
    bpy.context.view_layer.update()
    return liner


# ---- Parts ----------------------------------------------------------------------------------------

def wheel(name, kind, x, z):
    """A front or rear wheel at (x, z): tire, a five-spoke rim, the hub, and the brake caliper behind
    the spokes. Its origin is the hub, the outside facing out (+x on the left)."""
    side = 1 if x > 0 else -1
    tire, rim, cal = material("Tire"), material("RimGold" if kind == "lambo" else "RimSilver"), material("Caliper")
    parts = Parts()
    w = 0.28
    # The tire: a lathe about the axle, rounded at the shoulders.
    prof = [(0.25, -w / 2), (0.31, -w / 2 - 0.004), (0.35, -w / 2 + 0.03), (WHEEL_R, -w / 4), (WHEEL_R, w / 4),
            (0.35, w / 2 - 0.03), (0.31, w / 2 + 0.004), (0.25, w / 2)]
    ao.lathe(parts.of(tire), prof, center=(0, 0, 0), rot=(0, math.pi / 2, 0), segs=28)
    # The rim: a dish inside the tire, its lip, five spokes and the hub, on the outer side.
    o = side * (w / 2 - 0.02)
    r = parts.of(rim)
    ao.cylinder(r, (side * -w / 2 * 0.6, 0, 0), (o - side * 0.01, 0, 0), 0.25, segs=28)
    ao.torus(r, (o, 0, 0), 0.245, 0.016, rot=(0, math.pi / 2, 0), n=28, m=5)
    ao.cylinder(r, (o - side * 0.04, 0, 0), (o + side * 0.012, 0, 0), 0.055, segs=16)
    for i in range(5):
        a = TAU * i / 5
        c, s = math.cos(a), math.sin(a)
        ao.box(r, (o - side * 0.005, -s * 0.14, c * 0.14), (0.03, 0.05, 0.2), bevel=0.01, rot=(a, 0, 0), segments=2)
    # The caliper, up at the front of the disc, behind the spokes.
    ao.box(parts.of(cal), (o - side * 0.07, -0.13, 0.12), (0.05, 0.12, 0.08), bevel=0.015, rot=(-0.8, 0, 0), segments=2)
    ob = parts.build(name)
    ob.location = at(x, WHEEL_Y, z)
    return ob


def cabin(kind, sts):
    """The glass cabin and its painted roof (the `top`), and the windshield, seats and steering wheel
    left with the roof off (the `open`)."""
    glass, paint, dark, seat = material("Glass"), material("Paint"), material("Dark"), material("Seat")
    rings = splined(GREENHOUSE[kind], 34)
    roof0, roof1 = ROOF[kind]
    bm = bmesh.new()
    half = 10
    grid = []
    for z, base, wb, top, wt in rings:
        pts = []
        for i in range(2 * half + 1):
            a = math.pi * i / (2 * half)
            s = math.sin(a) ** 0.55
            w = wb + (wt - wb) * s
            pts.append((math.cos(a) * w, base + s * (top - base)))
        grid.append([bm.verts.new(at(x, y, z)) for x, y in pts])
    for a, b in zip(grid, grid[1:]):
        for i in range(len(a) - 1):
            bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.normal_update()
    if any(f.normal.z < 0 for f in bm.faces if f.calc_center_median().z > 1.0):
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
        bm.normal_update()
    # The roof is paint: the band along the top between the windshield and the back glass.
    for f in bm.faces:
        c = f.calc_center_median()
        f.material_index = 1 if f.normal.z > 0.8 and roof1 < -c.y < roof0 else 0
    top = ao.mesh_object(f"{kind}_top", bm, [glass, paint], smooth=True)

    # Roof off: the windshield up from the hood in a frame, the bucket seats, the wheel.
    parts = Parts()
    z0, y0, z1, y1 = SCREEN[kind]
    length = math.hypot(z0 - z1, y1 - y0)
    rake = math.atan2(y1 - y0, z0 - z1)
    mid = ((z0 + z1) / 2, (y0 + y1) / 2)
    parts.add(material("Screen"), obox, (0, mid[1], mid[0]), (1.3, 0.025, length), bevel=0.01, pitch=rake, segments=2)
    d = parts.of(dark)
    for sx in (-1, 1):
        obox(d, (sx * 0.66, mid[1], mid[0]), (0.035, 0.035, length + 0.03), bevel=0.01, pitch=rake, segments=2)
    obox(d, (0, y1 + 0.005, z1), (1.36, 0.03, 0.035), bevel=0.01, segments=2)
    # The dashboard across under the windshield's foot, over the drivers' knees.
    obox(d, (0, 0.74, z0 - 0.22), (1.36, 0.14, 0.36), bevel=0.04, segments=2)
    # The steering wheel on its column, in front of the driver.
    ao.torus(d, at(SEATS_X, 0.96, SEATS_Z + 0.5), 0.16, 0.026, rot=(math.pi / 2 - 0.45, 0, 0), n=24, m=8)
    ao.cylinder(d, at(SEATS_X, 0.96, SEATS_Z + 0.5), at(SEATS_X, 0.84, SEATS_Z + 0.85), 0.03, segs=10)
    c = parts.of(seat)
    for sx in (-1, 1):
        x = sx * SEATS_X
        # A bucket seat: the cushion, the back raked behind it, bolsters up its sides, a headrest.
        obox(c, (x, 0.52, SEATS_Z - 0.02), (0.46, 0.1, 0.48), bevel=0.04, segments=2)
        obox(c, (x, 0.86, SEATS_Z - 0.32), (0.46, 0.6, 0.1), bevel=0.04, pitch=-0.2, segments=2)
        for bx in (-1, 1):
            obox(c, (x + bx * 0.22, 0.8, SEATS_Z - 0.27), (0.07, 0.46, 0.16), bevel=0.03, pitch=-0.2, segments=2)
        obox(c, (x, 1.22, SEATS_Z - 0.4), (0.28, 0.16, 0.1), bevel=0.04, pitch=-0.2, segments=2)
    opened = parts.build(f"{kind}_open")
    return top, opened


def details(kind, sts, axle):
    """The lights, intakes, grilles, mirrors, sills, diffuser, exhausts, badges (and the Lambo's wing),
    each in its material, to join into the body."""
    lamp, tail, dark, chrome, badge, paint = (material(n) for n in ("Lamp", "Tail", "Dark", "Chrome", "Badge", "Paint"))
    parts = Parts()
    add = parts.add

    nose = sts[-1][0]
    tailz = sts[0][0]
    # How steeply the hood falls toward the nose there, for things that lie on it.
    def slope(z, x=0.0):
        return math.atan2(height_at(sts, z - 0.1, x) - height_at(sts, z + 0.1, x), 0.2)

    for sx in (-1, 1):
        if kind == "lambo":
            # Headlights: long slits on the nose's corners, swept back.
            z = nose - 0.22
            add(lamp, obox, (sx * 0.62, height_at(sts, z, 0.62) - 0.012, z), (0.3, 0.04, 0.16), bevel=0.012, pitch=slope(z, 0.62), yaw=-sx * 0.35, segments=2)
            # A big intake in the bumper each side, and one up each flank behind the door.
            add(dark, obox, (sx * 0.48, 0.3, nose - 0.04), (0.36, 0.1, 0.08), bevel=0.02, segments=2)
            add(dark, oball, (sx * (width_at(sts, -0.95, 0.56) - 0.035), 0.56, -0.95), (0.05, 0.12, 0.34))
            # Taillights: a thin bar each side across the back, with a Y down its inner end.
            add(tail, obox, (sx * 0.5, 0.7, tailz + 0.05), (0.5, 0.06, 0.12), bevel=0.012, segments=2)
            add(tail, obox, (sx * 0.27, 0.63, tailz + 0.05), (0.06, 0.16, 0.12), bevel=0.012, roll=sx * 0.6, segments=2)
        else:
            z = nose - 0.34
            add(lamp, oball, (sx * 0.66, height_at(sts, z, 0.66) - 0.01, z), (0.18, 0.04, 0.2), pitch=slope(z, 0.66), yaw=-sx * 0.3)
            add(dark, obox, (sx * 0.62, 0.32, nose - 0.06), (0.3, 0.12, 0.08), bevel=0.03, segments=2)
            # Two round taillights a side, each in a chrome ring.
            for off in (0.32, 0.64):
                add(tail, ao.cylinder, at(sx * off, 0.62, tailz + 0.08), at(sx * off, 0.62, tailz - 0.02), 0.085, segs=20)
                add(chrome, ao.torus, at(sx * off, 0.62, tailz - 0.02), 0.09, 0.012, rot=(math.pi / 2, 0, 0), n=20, m=6)
            # The badge, yellow, on each flank behind the front wheel, and a scoop ahead of the rear one.
            add(badge, obox, (sx * (width_at(sts, 0.8, 0.58) + 0.005), 0.58, 0.8), (0.02, 0.12, 0.09), bevel=0.01, segments=2)
            add(dark, oball, (sx * (width_at(sts, -0.75, 0.5) - 0.03), 0.5, -0.75), (0.04, 0.09, 0.26))
        # Mirrors on stalks, out by the windshield's foot.
        mz = 0.62 if kind == "lambo" else 0.32
        add(paint, oball, (sx * 0.95, 0.88, mz), (0.06, 0.06, 0.11), segs=16, rings=8)
        add(dark, ao.cylinder, at(sx * 0.8, 0.82, mz + 0.03), at(sx * 0.91, 0.87, mz), 0.015, segs=8)
        # The sills along the bottom between the wheels, black.
        add(dark, obox, (sx * (width_at(sts, 0.0, 0.25) - 0.02), 0.24, 0.0), (0.05, 0.08, 2 * axle - 1.0), bevel=0.02, segments=2)
        # Exhausts out of the diffuser.
        ex = 0.2 if kind == "lambo" else 0.42
        add(chrome, ao.cylinder, at(sx * ex, 0.33, tailz + 0.12), at(sx * ex, 0.33, tailz - 0.01), 0.055, segs=16)
    # The diffuser under the tail, with its fins.
    add(dark, obox, (0, 0.28, tailz + 0.14), (1.5, 0.1, 0.3), bevel=0.02, segments=2)
    for fx in (-0.5, -0.17, 0.17, 0.5):
        add(dark, obox, (fx, 0.27, tailz + 0.1), (0.02, 0.12, 0.18), segments=1)
    if kind == "lambo":
        # A grille across the engine deck, and the wing on two struts.
        add(dark, obox, (0, height_at(sts, -1.8, 0.0) - 0.005, -1.8), (1.0, 0.03, 0.5), bevel=0.01, pitch=slope(-1.8), segments=1)
        add(dark, obox, (0, 1.12, -2.06), (1.86, 0.04, 0.32), bevel=0.015, pitch=0.1, segments=2)
        for sx in (-1, 1):
            add(dark, obox, (sx * 0.55, 1.02, -2.04), (0.04, 0.2, 0.12), bevel=0.01, segments=1)
            add(dark, obox, (sx * 0.93, 1.1, -2.06), (0.02, 0.12, 0.36), bevel=0.005, segments=1)
    else:
        # The badge on the nose, and a wide mouth under it.
        z = nose - 0.2
        add(badge, obox, (0, height_at(sts, z, 0.0) + 0.005, z), (0.08, 0.02, 0.1), bevel=0.01, pitch=slope(z), segments=2)
        add(dark, obox, (0, 0.3, nose - 0.04), (0.9, 0.12, 0.08), bevel=0.03, segments=2)
    return parts.build("_details")


# The cockpit, sunk into the body under the cabin: from just behind the windshield's foot, back behind
# the seats, between the doors, down to its floor.
COCKPIT = {"lambo": (0.95, -1.0), "ferrari": (0.62, -1.12)}


def cut_cockpit(ob, kind):
    """Hollows the cockpit out of the body, its floor and walls in Dark, so with the roof off you sit
    down in the car rather than on top of it."""
    front, back = COCKPIT[kind]
    bm = bmesh.new()
    obox(bm, (0, 1.0, (front + back) / 2), (1.44, 1.16, front - back), bevel=0.12, segments=3)
    cutter = ao.mesh_object("_cockpit", bm, [material("Dark")])
    mod = ob.modifiers.new("cockpit", 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.solver = 'EXACT'
    mod.material_mode = 'TRANSFER'
    mod.object = cutter
    ao.apply_modifier(ob, "cockpit")
    bpy.data.objects.remove(cutter, do_unlink=True)


def build(kind):
    """One car's four roots (see the module's doc)."""
    axle = AXLE[kind]
    bm = bmesh.new()
    sts = loft(bm, STATIONS[kind])
    body = ao.mesh_object(kind, bm, [material("Paint")], smooth=True)
    liner = cut_arches(body, axle)
    cut_cockpit(body, kind)
    rear = [wheel("_rear", kind, sx * WHEEL_X, -axle) for sx in (-1, 1)]
    for r in rear:
        bpy.context.view_layer.update()
        r.data.transform(r.matrix_world)
        r.matrix_world = Matrix.Identity(4)
    parts = [liner, details(kind, sts, axle), *rear]
    ao.join(body, parts)
    top, opened = cabin(kind, sts)
    wl = wheel(f"{kind}_wheel_l", kind, WHEEL_X, axle)
    wr = wheel(f"{kind}_wheel_r", kind, -WHEEL_X, axle)
    return [body, top, opened, wl, wr]


def main(write=True):
    ao.clear()
    roots = build("lambo") + build("ferrari")
    if write:
        ao.export("cars")
    return roots


def only(kind, offset=0.0):
    def setup():
        for ob in bpy.context.scene.objects:
            if ob.type == 'MESH':
                ob.hide_render = not ob.name.startswith(kind) or ob.name.endswith("_open")
    return setup


def opened(kind):
    def setup():
        for ob in bpy.context.scene.objects:
            if ob.type == 'MESH':
                ob.hide_render = not ob.name.startswith(kind) or ob.name.endswith("_top")
    return setup


if __name__ == "__main__":
    main()
    for ob in bpy.context.scene.objects:
        if ob.type == 'MESH':
            print(f"  {ob.name}: {ao.tris(ob)} tris, {[m.name for m in ob.data.materials if m]}")
    if "--shots" in ao.args():
        for kind in ("lambo", "ferrari"):
            print(ao.sheet(f"cars-{kind}", [(only(kind), "tq"), (None, "side"), (None, "front"), (None, "back"), (None, "low"), (None, "top"), (opened(kind), "tq")], cell=(560, 400), target=(0, 0, 0.55), dist=7.5))
