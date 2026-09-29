"""The lounge's furniture: the sofa facing the TV, a throw pillow for it, a round floor pouf and the
round coffee table. Modelled by this script and exported to src/client/models/lounge.glb for
src/client/world/office.ts, which places each piece on its own (the pillow twice and the pouf twice,
each copy in its own colour), so the office's editor can one day move them round one by one. The
shared helpers are in aokit.py and the conventions in blender/README.md.

Headless, from the repo root (`-- --shots` also writes a review sheet per piece and one of the
lounge as office.ts lays it out):

    blender --background --factory-startup --python blender/scripts/build_lounge.py [-- --shots]

Through the Blender MCP bridge (module globals don't survive between calls, so import it every
time):

    import sys, importlib
    sys.path.insert(0, r"<repo>/blender/scripts")
    import aokit, build_lounge; importlib.reload(aokit); importlib.reload(build_lounge)
    build_lounge.main()

Each piece is a root of its own, `sofa`, `pillow`, `pouf` and `coffee_table`, standing on the floor
at the origin under its middle and facing forward (the pillow's origin is under its middle too, at
its bottom edge). office.ts turns the sofa round to face the TV and leans a pillow on it either side
of the middle. The pieces keep the old code-built lounge's sizes, so its colliders, seats and the
holiday pumpkin on the table fit as before. The roots' names and the material names are a contract
with office.ts and tests/lounge-model.test.ts, so rename them in all three places.

The pieces are built the way build_furniture.py builds the office's desks and chairs, and use its
material names where they're the same stuff (Wood, Frame, WoodDark, Cloth), so they sit next to
that furniture with one look and one palette.
"""
import bpy, bmesh, math, os, sys
from mathutils import Euler, Matrix, Vector

# Run headless, Blender doesn't put this folder on the import path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aokit as ao
from aokit import TAU

# Preview colours only: office.ts paints every material by name with the colours the old lounge had.
# Sofa is the old couch's blue, Wood and Frame the coffee table's top and pedestal (the office's
# wood and its desks' legs), WoodDark the sofa's feet. Cloth, a pillow's or a pouf's, is each copy's
# own colour; the one here is only for the renders.
COLORS = {
    "Sofa": "#5b8def",
    "WoodDark": "#8a5a3b",
    "Wood": "#c98b5a",
    "Frame": "#3d405b",
    "Cloth": "#ffd166",
}


def material(name):
    return ao.material(name, COLORS[name])


# The sizes the office's code counts on. Blender can't read TypeScript, so they're copied here, and
# tests/lounge-model.test.ts checks the model against them.
# The couch in office.ts: 4.2 long and 1.0 deep, its collider's top on the seat cushions, and three
# places on it 1.2 apart where a sitter's hips go 0.5 up and 0.05 back from its middle.
SOFA = {"length": 4.2, "depth": 1.0}
# The seat cushions' tops. A sitter's bottom is 0.1 under their hips, so they sink a little in.
SEAT_TOP = 0.47
# The coffee table in office.ts: a round top 0.9 round, its surface at 0.46 (the holiday pumpkin
# stands on it), inside a collider 0.8 either way of its middle.
TABLE = {"radius": 0.9, "height": 0.46}
# A floor pouf in office.ts: a collider 0.5 either way of its middle with its top on the pouf's, and
# a sitter's hips 0.42 up and 0.1 back from its middle. Its top is a touch under their hips, so they sink a little in and their
# legs lie along it.
POUF = {"radius": 0.52, "height": 0.4}
# Where office.ts leans the pillows, in the sofa's own axes: either side of its middle, halfway
# between its places so they're clear of whoever sits there, standing on the seat and tipped back
# against the back cushions. (Tucked against the arms they'd be in the side sitters' way: there's
# only 0.17 m between a sitter's elbow and an arm.)
PILLOWS = {"x": 0.6, "z": -0.08, "tilt": 0.15}


# ---- Laying things out the office's way -----------------------------------------------------------
#
# Every number below is in the office's axes: (x across, y up, z forward), metres, the piece's origin
# on the floor under its middle. at() turns them into Blender's (z up, forward is -y). A turn about x
# is the same angle in both. These helpers are build_furniture.py's, so the pieces shade alike.

def at(x, y, z):
    return (x, -z, y)


def rounded_rect(hx, hz, r, segs):
    """A rectangle's outline [(x, z), ...] seen from above, 2hx by 2hz, its corners rounded over `r`."""
    pts = []
    for cx, cz, a0 in ((hx - r, hz - r, 0), (-(hx - r), hz - r, 90), (-(hx - r), -(hz - r), 180), (hx - r, -(hz - r), 270)):
        for i in range(segs + 1):
            a = math.radians(a0 + 90 * i / segs)
            pts.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    return pts


def slab(bm, w, d, y0, y1, corner, edge, x=0.0, z=0.0, bottom=None, csegs=4, esegs=3, turn=None):
    """A table top, or a cushion: `w` across and `d` deep from y0 up to y1, its corners rounded over
    `corner` seen from above and its top edge rounded over `edge` (its bottom edge over `bottom`, the
    same unless given). Its top and bottom are single flat faces, shaded flat, and its rounded sides
    smooth, so the toon ramp lays one clean band over each face and its bands turn on the rims.
    `turn` (a centre and Blender's XYZ euler) stands it up somewhere else, built round the origin."""
    eb = edge if bottom is None else bottom
    profile = [(eb * (1 - math.sin(a)), y0 + eb * (1 - math.cos(a))) for a in (math.pi / 2 * i / esegs for i in range(esegs + 1))]
    profile += [(edge * (1 - math.cos(a)), y1 - edge + edge * math.sin(a)) for a in (math.pi / 2 * i / esegs for i in range(esegs + 1))]
    rings = []
    for inset, y in profile:
        hx, hz = w / 2 - inset, d / 2 - inset
        r = max(1e-3, min(corner - inset, hx, hz))
        rings.append([bm.verts.new(at(x + px, y, z + pz)) for px, pz in rounded_rect(hx, hz, r, csegs)])
    n = len(rings[0])
    faces = [bm.faces.new(rings[0][::-1]), bm.faces.new(rings[-1])]
    for lo, hi in zip(rings, rings[1:]):
        for k in range(n):
            faces.append(bm.faces.new((lo[k], lo[(k + 1) % n], hi[(k + 1) % n], hi[k])))
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    for i, f in enumerate(faces):
        f.smooth = i >= 2
    if turn:
        center, rot = turn
        m = Matrix.Translation(at(*center)) @ Euler(rot, 'XYZ').to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=m, verts=[v for ring in rings for v in ring])


def turned(bm, profile, x=0.0, y=0.0, z=0.0, segs=24):
    """A lathe about the up axis, [(radius, height), ...] from the bottom, standing at (x, y, z)."""
    ao.lathe(bm, profile, center=at(x, y, z), segs=segs)


def arc(r, cr, cy, a0, a1, n):
    """Points [(radius, height)] round a quarter (or so) of a circle centred (cr, cy), `r` round, from
    angle a0 to a1 (degrees, 0 pointing out, 90 up): a lathe profile's rounded rim."""
    return [(cr + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a))) for a in
            (a0 + (a1 - a0) * i / n for i in range(n + 1))]


def flat_faces(bm, start, threshold=0.999):
    """Shades the faces from `start` on flat where they face straight up or down (a top, a bottom),
    and smooth elsewhere."""
    bm.faces.ensure_lookup_table()
    bm.normal_update()
    for f in bm.faces[start:]:
        f.smooth = abs(f.normal.z) < threshold


# Smooth shading keeps edges sharper than this crisp (a disc's rim, a foot's end).
SHARP = math.radians(48)


class Piece:
    """One piece's shapes, a bmesh per material, joined into one object at the end."""

    def __init__(self):
        self.parts = {}

    def add(self, mat, build, *args, smooth=True, **kw):
        """Adds a shape: `build(bm, *args, **kw)`. `smooth` is True, False, a test on each of its
        faces, or None to keep what the shape set itself (a slab's flat top and bottom)."""
        bm = self.parts.setdefault(mat, bmesh.new())
        start = len(bm.faces)
        build(bm, *args, **kw)
        bm.faces.ensure_lookup_table()
        bm.normal_update()
        if smooth is not None:
            for f in bm.faces[start:]:
                f.smooth = smooth(f) if callable(smooth) else smooth

    def finish(self, name):
        obs = []
        for mat, bm in self.parts.items():
            me = bpy.data.meshes.new(f"{name}_{mat}")
            bm.to_mesh(me)
            bm.free()
            me.materials.append(material(mat))
            ob = bpy.data.objects.new(f"{name}_{mat}", me)
            bpy.context.scene.collection.objects.link(ob)
            obs.append(ob)
        ob = ao.join(obs[0], obs[1:]) if len(obs) > 1 else obs[0]
        ob.data.set_sharp_from_angle(angle=SHARP)
        ob.name = name
        # The mesh is named apart from its node, so the loader never has to tell them apart.
        ob.data.name = name + "_mesh"
        return ob


# ---- The sofa ---------------------------------------------------------------------------------------
#
# A plump three-seater facing forward: a cushion for each of the office's three places on a low base,
# three back cushions tipped back a little against a back that runs the whole length, round-topped
# arms at the ends, and little wooden feet. The back cushions stand where a sitter's back comes to,
# so someone sitting leans into them rather than floating in front or sinking through.

FEET = 0.07
ARM_W = 0.32
ARM_TOP = 0.74
BACK_TOP = 0.98
BACK_D = 0.16
# The back cushions: how thick, how far they're tipped back, and how high they come.
BACK_T = 0.11
BACK_TILT = 0.05
BACK_CUSHION_TOP = 0.93
CUSHION_H = 0.19
# Between the arms, where the cushions go.
INNER = SOFA["length"] - 2 * ARM_W


def sofa():
    L, D = SOFA["length"], SOFA["depth"]
    s = Piece()
    base_top = SEAT_TOP - CUSHION_H + 0.01

    def frame(bm):
        # The base the seat cushions sit on, tucked between the arms.
        slab(bm, INNER + 0.1, D - 0.06, FEET, base_top, corner=0.06, edge=0.04, bottom=0.03, z=0.0, csegs=2, esegs=2)
        # The back, the whole length behind the arms and the cushions, round along its top.
        slab(bm, L, BACK_D, FEET, BACK_TOP, corner=0.06, edge=BACK_D / 2 - 0.002, bottom=0.03, z=-D / 2 + BACK_D / 2, csegs=3, esegs=4)
        # The arms, rolled over along their tops.
        for sx in (-1, 1):
            slab(bm, ARM_W, D - BACK_D + 0.04, FEET, ARM_TOP, corner=0.1, edge=0.12, bottom=0.03,
                 x=sx * (L / 2 - ARM_W / 2), z=(BACK_D - 0.04) / 2, csegs=3, esegs=4)

    def cushions(bm):
        w = INNER / 3
        back_front = -D / 2 + BACK_D
        # A back cushion stands on the seat cushions, its top leaning on the back.
        bottom, h, t = SEAT_TOP - 0.03, BACK_CUSHION_TOP - (SEAT_TOP - 0.03), BACK_T
        mid_z = back_front + t / 2 * math.cos(BACK_TILT) + h / 2 * math.sin(BACK_TILT)
        for i in (-1, 0, 1):
            # A seat cushion from the back to a touch proud of the base's front.
            slab(bm, w - 0.012, D / 2 - back_front - 0.01, SEAT_TOP - CUSHION_H, SEAT_TOP, corner=0.1, edge=0.07,
                 bottom=0.04, x=i * w, z=(back_front + D / 2) / 2, csegs=3, esegs=3)
            # Built lying face up and stood on end, tipped back.
            slab(bm, w - 0.03, h, -t / 2, t / 2, corner=0.1, edge=0.06, bottom=0.04, csegs=3, esegs=3,
                 turn=((i * w, bottom + h / 2, mid_z), (math.pi / 2 - BACK_TILT, 0, 0)))

    def feet(bm):
        # Little turned feet, tapering to the floor, under the arms' corners and the middle.
        profile = [(0.0, 0.0), (0.03, 0.0), (0.034, 0.006), (0.042, FEET), (0.0, FEET)]
        for x in (-(L / 2 - 0.14), 0.0, L / 2 - 0.14):
            for z in (-D / 2 + 0.1, D / 2 - 0.1):
                turned(bm, profile, x=x, z=z, segs=10)

    s.add("Sofa", frame, smooth=None)
    s.add("Sofa", cushions, smooth=None)
    s.add("WoodDark", feet)
    return s.finish("sofa")


# ---- The pillow ---------------------------------------------------------------------------------------
#
# A square throw pillow standing up, its face forward: plump in the middle and thin at its seam, its
# sides drawn in and its corners poking out the way a stuffed pillow's do. A seam band runs round its
# edge, so even edge-on it has a rim for the outline, not a paper-thin one.

PILLOW = {"w": 0.46, "h": 0.44, "t": 0.17}


def pillow():
    W, H, T = PILLOW["w"], PILLOW["h"], PILLOW["t"]
    bm = bmesh.new()
    n = 12
    seam = 0.025

    def point(u, v, side):
        # The outline, drawn in along each side's middle and full out at the corners.
        x = u * W / 2 * (1 - 0.09 * (1 - v * v))
        y = H / 2 + v * H / 2 * (1 - 0.09 * (1 - u * u))
        puff = math.sqrt(max(0.0, (1 - u * u) * (1 - v * v)))
        z = side * (seam / 2 + (T / 2 - seam / 2) * puff ** 0.8)
        return at(x, y, z)

    grids = {}
    for side in (1, -1):
        grids[side] = [[bm.verts.new(point(-1 + 2 * i / n, -1 + 2 * j / n, side)) for j in range(n + 1)] for i in range(n + 1)]
    for side in (1, -1):
        g = grids[side]
        for i in range(n):
            for j in range(n):
                quad = (g[i][j], g[i + 1][j], g[i + 1][j + 1], g[i][j + 1])
                bm.faces.new(quad if side == 1 else quad[::-1])
    # The edges of the two sides go round in step; the band joins them.
    def ring(g):
        return [g[i][0] for i in range(n)] + [g[n][j] for j in range(n)] + [g[i][n] for i in range(n, 0, -1)] + [g[0][j] for j in range(n, 0, -1)]

    front, back = ring(grids[1]), ring(grids[-1])
    m = len(front)
    for k in range(m):
        bm.faces.new((front[k], back[k], back[(k + 1) % m], front[(k + 1) % m]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ob = ao.mesh_object("pillow", bm, [material("Cloth")])
    ob.data.name = "pillow_mesh"
    return ob


# ---- The pouf -------------------------------------------------------------------------------------------
#
# A round floor pouf, soft as a marshmallow: a squat drum bulging round its middle, its bottom edge
# rounded under and its top edge rolled well over (so a sitter's legs come out over the front of it),
# piping round its widest, where its top is sewn to its bottom, and a button pulled into the middle of
# its flat top. It's round and plain on purpose: puffs gathered round its sides made the toon ramp's
# edge zigzag across them.

def pouf():
    R, H = POUF["radius"], POUF["height"]
    s = Piece()
    rim, under = 0.14, 0.08
    seam = 0.2
    # Up from the floor, round under the bottom edge, out over the bulge, and in over the rolled top
    # edge onto the flat top, then down into the dimple the button sits in.
    profile = [(0.0, 0.0), (R - under - 0.01, 0.0)]
    profile += arc(under, R - under - 0.01, under, -90, 0, 3)[1:]
    profile += [(R, 0.15), (R + 0.004, seam), (R + 0.002, 0.24)]
    profile += arc(rim, R - rim, H - rim, 0, 90, 5)[1:]
    profile += [(0.09, H), (0.06, H - 0.014), (0.0, H - 0.018)]

    def body(bm):
        start = len(bm.faces)
        turned(bm, profile, segs=36)
        flat_faces(bm, start)

    def piping(bm):
        ao.torus(bm, at(0, seam, 0), R + 0.004, 0.017, n=32, m=6)

    def button(bm):
        turned(bm, [(0.0, H - 0.02), (0.046, H - 0.018), (0.054, H - 0.004), (0.042, H + 0.012), (0.0, H + 0.017)], segs=10)

    s.add("Cloth", body, smooth=None)
    s.add("Cloth", piping)
    s.add("Cloth", button)
    return s.finish("pouf")


# ---- The coffee table -------------------------------------------------------------------------------------
#
# A round wooden top on a pedestal: a thick disc with a rounded edge, its surface at TABLE's height,
# on a column that flares out to a round foot on the floor and up to a bracket under the top.

def coffee_table():
    R, H = TABLE["radius"], TABLE["height"]
    s = Piece()
    t = 0.075
    e = 0.028

    def top(bm):
        start = len(bm.faces)
        profile = [(0.0, H - t), (R - 0.012, H - t)] + arc(0.012, R - 0.012, H - t + 0.012, -90, 0, 2)[1:]
        profile += arc(e, R - e, H - e, 0, 90, 3) + [(0.0, H)]
        turned(bm, profile, segs=32)
        flat_faces(bm, start)

    def pedestal(bm):
        start = len(bm.faces)
        top_y = H - t
        profile = [(0.0, 0.0), (0.4, 0.0)] + arc(0.022, 0.4 - 0.022, 0.022, -90, 90, 3)[1:]
        profile += [(0.32, 0.052), (0.2, 0.08), (0.135, 0.12), (0.115, 0.17), (0.11, top_y - 0.1), (0.13, top_y - 0.05),
                    (0.24, top_y - 0.022), (0.26, top_y - 0.006), (0.24, top_y), (0.0, top_y)]
        turned(bm, profile, segs=20)
        flat_faces(bm, start)

    s.add("Wood", top, smooth=None)
    s.add("Frame", pedestal, smooth=None)
    return s.finish("coffee_table")


# ---- Build, export, review --------------------------------------------------------------------------

PIECES = [sofa, pillow, pouf, coffee_table]


def main(write=True):
    ao.clear()
    roots = [make() for make in PIECES]
    if write:
        ao.export("lounge")
    return roots


def placed(ob, x, y, z, turn=0.0, tilt=0.0):
    """Puts `ob` at (x, y, z) in office axes, turned `turn` about the up axis (office's way round,
    counter-clockwise seen from above) and tipped back by `tilt` (its top toward -z) first."""
    ob.matrix_world = Matrix.Translation(at(x, y, z)) @ Matrix.Rotation(turn, 4, 'Z') @ Matrix.Rotation(-tilt, 4, 'X')


def only(*names, extra=None):
    """Shows just the objects called `names` in the review renders, each at the origin unless
    `extra` ({name: callable}) puts it somewhere."""
    def setup():
        for ob in bpy.context.scene.objects:
            if ob.type != 'MESH':
                continue
            ob.hide_render = ob.name not in names
            ob.matrix_world = Matrix.Identity(4)
            if extra and ob.name in extra:
                extra[ob.name](ob)
    return setup


def lounge_layout():
    """The lounge the way office.ts lays it out, seen from the room: the sofa at (10.5, 0) facing the
    TV (+x), its pillows, the table at (13, 0) and a pouf either side, turned to the TV. Moved so the
    table's middle is at the origin, and turned so the TV is off to -Y (the renders' front)."""
    # The pillow's second copy, only for the renders.
    other = bpy.data.objects.get("pillow_2")
    if other is None:
        other = bpy.data.objects["pillow"].copy()
        other.name = "pillow_2"
        bpy.context.scene.collection.objects.link(other)
    # office (x, z) -> review (x', z'): the TV's +x becomes the renders' forward (+z office axes).
    def spot(x, z):
        return (-(z - 0.0), (x - 13.0))

    def sofa_at(ob):
        sx, sz = spot(10.5, 0.0)
        placed(ob, sx, 0, sz)

    def pillow_at(sign):
        def put(ob):
            sx, sz = spot(10.5, 0.0)
            placed(ob, sx + sign * PILLOWS["x"], SEAT_TOP - 0.01, sz + PILLOWS["z"], tilt=PILLOWS["tilt"])
        return put

    def table_at(ob):
        placed(ob, *(lambda p: (p[0], 0, p[1]))(spot(13.0, 0.0)))

    def pouf_at(ob):
        px, pz = spot(12.5, 3.5)
        placed(ob, px, 0, pz)

    return only("sofa", "pillow", "pillow_2", "coffee_table", "pouf",
                extra={"sofa": sofa_at, "pillow": pillow_at(-1), "pillow_2": pillow_at(1), "coffee_table": table_at, "pouf": pouf_at})


def review():
    # three's toon materials draw front faces only; show the same, so a face turned the wrong way
    # shows here as a hole rather than first in the office.
    bpy.context.scene.display.shading.show_backface_culling = True
    views = ("tq", "front", "side", "back")
    paths = []
    sofa_set = only("sofa", "pillow", "pillow_2", extra={
        "pillow": lambda ob: placed(ob, -PILLOWS["x"], SEAT_TOP - 0.01, PILLOWS["z"], tilt=PILLOWS["tilt"]),
        "pillow_2": lambda ob: placed(ob, PILLOWS["x"], SEAT_TOP - 0.01, PILLOWS["z"], tilt=PILLOWS["tilt"]),
    })
    lounge_layout()  # makes pillow_2
    paths.append(ao.sheet("lounge_sofa", [(sofa_set, v) for v in views], cell=(520, 360), target=at(0, 0.45, 0), dist=7.0))
    paths.append(ao.sheet("lounge_pillow", [(only("pillow"), v) for v in views], target=at(0, 0.22, 0), dist=1.5))
    paths.append(ao.sheet("lounge_pouf", [(only("pouf"), v) for v in views], target=at(0, 0.2, 0), dist=2.6))
    paths.append(ao.sheet("lounge_table", [(only("coffee_table"), v) for v in views], target=at(0, 0.25, 0), dist=3.6))
    paths.append(ao.sheet("lounge_room", [(lounge_layout(), v) for v in ("front", "tq")], cell=(900, 560), target=at(-1.3, 0.4, -1.0), dist=12.0))
    # Back as exported: every piece at the origin, the review's copy gone.
    other = bpy.data.objects.get("pillow_2")
    if other is not None:
        bpy.data.objects.remove(other, do_unlink=True)
    only(*[p.__name__ for p in PIECES])()
    return paths


if __name__ == "__main__" and bpy.app.background:
    roots = main()
    for ob in roots:
        dims = ob.dimensions
        print(f"piece: {ob.name} {ao.tris(ob)} tris, {dims.x:.3f} x {dims.z:.3f} x {dims.y:.3f} (w x h x d), "
              f"materials {[m.name for m in ob.data.materials]}")
    print("glb:", os.path.getsize(os.path.join(ao.MODELS, "lounge.glb")), "bytes")
    if "--shots" in ao.args():
        for p in review():
            print("sheet:", p)
