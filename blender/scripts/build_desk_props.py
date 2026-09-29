"""The desks' knick-knacks: a mug of coffee and a few books, modelled by this script and exported
to src/client/models/desk_props.glb for src/client/world/office.ts, which puts one of them in a
back corner of most desks. The shared helpers are in aokit.py and the conventions in
blender/README.md.

Headless, from the repo root (`-- --shots` also writes a review sheet per piece and one of them all
side by side):

    blender --background --factory-startup --python blender/scripts/build_desk_props.py [-- --shots]

Through the Blender MCP bridge (module globals don't survive between calls, so import it every
time):

    import sys, importlib
    sys.path.insert(0, r"<repo>/blender/scripts")
    import aokit, build_desk_props; importlib.reload(aokit); importlib.reload(build_desk_props)
    build_desk_props.main()

Each piece is one object and a root of its own, so the office (or anything else) can place any of
them by itself: the `mug`, and the books in three arrangements, `books_upright` (three standing
side by side), `books_leaning` (two standing and one leaning on them) and `books_stack` (three
lying in a pile). Each stands on the desk at its origin and faces forward like every model: the
books' spines face whoever sits there. A pile of books has its origin in the middle of its
footprint; the mug has its in the middle of its body, with the handle out to +X. The object and
material names are a contract with office.ts and tests/desk-props-model.test.ts, so rename them in
all three places.

They keep the old code-built knick-knacks' sizes: the mug is the old 0.12 m cylinder with a
handle, and every arrangement of books fits in the old three boxes' 0.26 by 0.18 m and 0.24 m
tall, so the laptop, the holiday present and whoever dances on the desk stay clear of them as
before.
"""
import bpy, bmesh, math, os, sys
from mathutils import Matrix, Vector

# Run headless, Blender doesn't put this folder on the import path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aokit as ao

# Preview colours only: office.ts paints every material by name with the same colours (the old
# code-built books' covers, book.ts's page edges, and the coffee in the mug a worker carries,
# character.ts's coffeeMug()). It paints the mug's body in the colour of the desk's chair; the
# first chair's is here.
COLORS = {
    "Mug": "#ff8a5b",
    "Coffee": "#6f4518",
    "CoverRed": "#e63946",
    "CoverBlue": "#457b9d",
    "CoverOrange": "#f4a261",
    "Pages": "#f3ead8",
}

PIECES = ("mug", "books_upright", "books_leaning", "books_stack")


def material(name):
    return ao.material(name, COLORS[name])


# ---- Building an object from shapes --------------------------------------------------------------

class Shapes:
    """One object's shapes in one bmesh, a material slot per material. Each shape's faces are
    shaded flat or smooth as it says, and finish() leaves them that way."""

    def __init__(self):
        self.bm = bmesh.new()
        self.mats = []

    def slot(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def add(self, mat, build, *args, smooth=False, **kw):
        """Adds a shape: `build(bm, *args, **kw)` is one of aokit's shape functions (or this
        script's)."""
        bm = self.bm
        start = len(bm.faces)
        build(bm, *args, **kw)
        bm.faces.ensure_lookup_table()
        for f in bm.faces[start:]:
            f.smooth = smooth
            f.material_index = self.slot(mat)

    def add_part(self, mats, part):
        """Adds a finished bmesh `part` (and frees it). Its faces keep their own shading; their
        material_index picks from `mats`."""
        slots = [self.slot(m) for m in mats]
        for f in part.faces:
            f.material_index = slots[min(f.material_index, len(slots) - 1)]
        ao._merge(self.bm, part)

    def centre(self):
        """Moves everything across so the middle of its footprint is at the origin."""
        xs = [v.co.x for v in self.bm.verts]
        ys = [v.co.y for v in self.bm.verts]
        bmesh.ops.translate(self.bm, vec=(-(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2, 0.0), verts=self.bm.verts[:])

    def finish(self, name, sharp=None):
        """The object, its origin at the scene's origin. With `sharp` (radians), edges sharper than
        that stay sharp and the rest shade smooth across."""
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(material(m))
        if sharp is not None:
            me.set_sharp_from_angle(angle=sharp)
        me.validate()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


def faces_from(bm, start):
    """The faces added to `bm` since it had `start` of them."""
    bm.faces.ensure_lookup_table()
    return bm.faces[start:]


# ---- The mug --------------------------------------------------------------------------------------
#
# A chunky diner mug: a little wider at the rim than the foot, a rolled rim, coffee a couple of
# centimetres down, and a round handle out to +X. Its body is the old code-built mug's size (0.05 m
# round at the foot, 0.06 at the top, 0.12 tall).

MUG_H = 0.12
# Its outside from the middle of the foot up over the rim, then down the inside to the coffee:
# [(radius, height)], as for aokit.lathe.
MUG = [(0.0, 0.0), (0.046, 0.0), (0.05, 0.005), (0.057, 0.106), (0.0585, 0.114), (0.0565, 0.119),
       (0.0525, MUG_H), (0.049, 0.117), (0.0465, 0.098)]
# How high the coffee comes. Below it the mug is shut, so the handle's ends can go into the wall
# under this without showing inside.
COFFEE_Z = 0.098
# The handle's middle line, a curve out from the wall and back in (x, height), and how thick it is.
HANDLE = [(0.05, 0.086), (0.1, 0.092), (0.1, 0.026), (0.05, 0.032)]
HANDLE_R = 0.009


def cubic(p, n):
    """n + 1 points along the cubic Bezier curve through the four points `p`."""
    a, b, c, d = (Vector(q) for q in p)
    return [(1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c + t ** 3 * d
            for t in (i / n for i in range(n + 1))]


def tube(bm, points, r, segs=6):
    """A round tube along `points`, capped at both ends, its rings carried round the bends without
    twisting."""
    pts = [Vector(p) for p in points]
    n = len(pts)
    tangents = [(pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized() for i in range(n)]
    normal = tangents[0].orthogonal().normalized()
    rings = []
    for i, (p, t) in enumerate(zip(pts, tangents)):
        if i:
            normal = tangents[i - 1].rotation_difference(t) @ normal
        side = t.cross(normal)
        rings.append([bm.verts.new(p + r * (math.cos(a) * normal + math.sin(a) * side))
                      for a in (ao.TAU * k / segs for k in range(segs))])
    faces = [bm.faces.new(rings[0][::-1]), bm.faces.new(rings[-1])]
    for lo, hi in zip(rings, rings[1:]):
        for k in range(segs):
            faces.append(bm.faces.new((lo[k], lo[(k + 1) % segs], hi[(k + 1) % segs], hi[k])))
    bmesh.ops.recalc_face_normals(bm, faces=faces)


def mug():
    s = Shapes()
    s.add("Mug", ao.lathe, MUG, segs=16, smooth=True)
    # The handle stands in the mug's XZ plane, out to +X.
    line = [Vector((x, 0.0, z)) for x, z in HANDLE]
    s.add("Mug", tube, cubic(line, 8), HANDLE_R, segs=6, smooth=True)
    # The coffee, a little into the wall so no gap shows round it.
    s.add("Coffee", ao.lathe, [(0.0475, COFFEE_Z), (0.0, COFFEE_Z + 0.001)], segs=16, smooth=True)
    # The rim rolls over smoothly; only the foot's edge and the coffee's stay crisp.
    return s.finish("mug", sharp=math.radians(60))


# ---- The books ------------------------------------------------------------------------------------
#
# Chunky hardbacks: the boards and the spine are one U round a cream block of pages, which sits in
# from the boards at the top, the foot and the fore-edge, so a book reads as a book from any side.
# A raised band or a label across each spine, in the pages' cream, tells them apart.

BOARD = 0.008   # how thick the boards and the spine are
INSET = 0.004   # how far the pages sit in from the boards' edges
EDGE = 0.0025   # how far the boards' edges are rounded over


def book(t, h, d, bands=(), label=None):
    """A hardback standing on its foot, its foot's middle at the origin: `t` thick across X, `h`
    tall, and `d` from its spine (at -Y, facing forward) back to its fore-edge. `bands` are
    (height up the spine, how tall) for each raised band across it, `label` the same for a label
    on it. Returns a bmesh whose faces take material index 0 for the cover and 1 for the pages."""
    part = bmesh.new()
    x, y, c, k = t / 2, d / 2, BOARD, min(BOARD, t / 4)
    # The U seen from above: in along the right board, across the spine's inside, out along the
    # left board, then back round the outside, the spine's corners cut off.
    loop = [(x, y), (x - c, y), (x - c, -y + c), (-x + c, -y + c), (-x + c, y), (-x, y),
            (-x, -y + k), (-x + k, -y), (x - k, -y), (x, -y + k)]
    foot = [part.verts.new((u, v, 0.0)) for u, v in loop]
    top = [part.verts.new((u, v, h)) for u, v in loop]
    part.faces.new(foot)
    part.faces.new(top)
    n = len(loop)
    for i in range(n):
        part.faces.new((foot[i], foot[(i + 1) % n], top[(i + 1) % n], top[i]))
    bmesh.ops.recalc_face_normals(part, faces=part.faces[:])
    rims = [e for e in part.edges if abs(e.verts[0].co.z - e.verts[1].co.z) < 1e-6]
    bmesh.ops.bevel(part, geom=rims, offset=EDGE, segments=1, profile=0.5, affect='EDGES', clamp_overlap=True)
    bmesh.ops.triangulate(part, faces=[f for f in part.faces if len(f.verts) > 4])
    for f in part.faces:
        f.material_index = 0
    # The pages, in from the boards (and a hair in from their insides, so nothing is flush).
    start = len(part.faces)
    ao.box(part, (0.0, (c - INSET) / 2, h / 2), (t - 2 * c - 0.001, d - c - INSET, h - 2 * INSET))
    for f in faces_from(part, start):
        f.material_index = 1
    # Bands wrap round the spine onto the boards; a label sits on the spine's face.
    for z, tall in bands:
        start = len(part.faces)
        ao.box(part, (0.0, -y + 0.005, z), (t + 0.003, 0.014, tall))
        for f in faces_from(part, start):
            f.material_index = 1
    if label:
        z, tall = label
        start = len(part.faces)
        ao.box(part, (0.0, -y + 0.001, z), (t - 2 * k - 0.006, 0.005, tall))
        for f in faces_from(part, start):
            f.material_index = 1
    for f in part.faces:
        f.smooth = False
    return part


def place(part, x=0.0, y=0.0, z=0.0, lean=0.0, yaw=0.0, lie=False):
    """Stands a book from book() in its arrangement: laid on its side first if `lie` (its top toward
    -X), tipped over toward -X by `lean` (radians) about its foot, turned `yaw` about the up axis,
    then set down with its lowest point at `z` and moved `x` and `y` across. Returns the part."""
    turn = Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(-lean, 4, 'Y')
    if lie:
        turn = turn @ Matrix.Rotation(-math.pi / 2, 4, 'Y')
    bmesh.ops.transform(part, matrix=turn, verts=part.verts[:])
    low = min(v.co.z for v in part.verts)
    bmesh.ops.translate(part, vec=(x, y, z - low), verts=part.verts[:])
    return part


def extent(part, axis, lo=True, above=None):
    """The least (or with `lo` False the most) of a part's vertices along `axis` (0, 1 or 2), only
    counting those higher than `above` if given."""
    vals = [v.co[axis] for v in part.verts if above is None or v.co.z > above]
    return min(vals) if lo else max(vals)


def cover(name):
    return ("Cover" + name, "Pages")


# Each book in an arrangement: (cover, thick, tall, deep, bands, label). The spines line up at the
# front, give or take a few millimetres, the way books get pushed back against the wall.
UPRIGHT = [
    ("Red", 0.074, 0.234, 0.18, [(0.024, 0.012), (0.206, 0.012)], None),
    ("Blue", 0.066, 0.21, 0.166, [], (0.13, 0.05)),
    ("Orange", 0.078, 0.224, 0.174, [(0.19, 0.03)], None),
]


def books_upright():
    """Three standing side by side, the old boxes' colours in the old order."""
    s = Shapes()
    x = 0.0
    for i, (col, t, h, d, bands, label) in enumerate(UPRIGHT):
        s.add_part(cover(col), place(book(t, h, d, bands, label), x=x + t / 2, y=d / 2 + 0.003 * (i % 2)))
        x += t + 0.003
    s.centre()
    return s.finish("books_upright")


def books_leaning():
    """Two standing, and a third tipped over against them, resting its top on the second."""
    s = Shapes()
    blue = place(book(0.07, 0.226, 0.176, [(0.03, 0.014)], (0.14, 0.046)), x=0.035, y=0.088)
    orange = place(book(0.064, 0.212, 0.168, [(0.024, 0.012), (0.186, 0.012)]), x=0.073 + 0.032, y=0.086)
    wall = extent(orange, 0, lo=False)
    red = place(book(0.058, 0.198, 0.17, [(0.16, 0.024)]), lean=math.radians(16), y=0.087)
    # Over against the orange one: its top corner just touching the orange's side.
    bmesh.ops.translate(red, vec=(wall + 0.0005 - extent(red, 0, above=0.15), 0.0, 0.0), verts=red.verts[:])
    for col, part in (("Blue", blue), ("Orange", orange), ("Red", red)):
        s.add_part(cover(col), part)
    s.centre()
    return s.finish("books_leaning")


def books_stack():
    """Three lying in a pile, biggest at the bottom, each turned a little off the one under it and
    pushed back a little further, their spines toward the front."""
    s = Shapes()
    z = 0.0
    for col, t, h, d, bands, label, x, y, yaw in [
        ("Orange", 0.05, 0.24, 0.18, [(0.03, 0.014), (0.21, 0.014)], None, 0.0, 0.0, 0.0),
        ("Blue", 0.044, 0.216, 0.166, [], (0.108, 0.06), 0.006, 0.004, 5.0),
        ("Red", 0.04, 0.19, 0.15, [(0.16, 0.02)], None, -0.008, 0.012, -7.0),
    ]:
        part = place(book(t, h, d, bands, label), lie=True, yaw=math.radians(yaw), z=z)
        # Laid down, its middle is wherever turning it left it; put that at (x, y).
        mid = [(extent(part, i) + extent(part, i, lo=False)) / 2 for i in (0, 1)]
        bmesh.ops.translate(part, vec=(x - mid[0], y - mid[1], 0.0), verts=part.verts[:])
        z = extent(part, 2, lo=False) - 0.0005
        s.add_part(cover(col), part)
    s.centre()
    return s.finish("books_stack")


MAKERS = {"mug": mug, "books_upright": books_upright, "books_leaning": books_leaning, "books_stack": books_stack}


def main(write=True):
    ao.clear()
    obs = [MAKERS[name]() for name in PIECES]
    for ob in obs:
        size = ob.dimensions
        print(f"{ob.name}: {ao.tris(ob)} tris, {len(ob.data.materials)} materials, "
              f"{size.x:.3f} x {size.y:.3f} x {size.z:.3f} m")
    if write:
        ao.export("desk_props")
    return obs


# ---- Review renders -------------------------------------------------------------------------------

def only(name, lineup=False):
    """Shows just the piece `name` in the review renders, or with `lineup` all of them in a row
    along x."""
    def setup():
        x = 0.0
        for piece in PIECES:
            ob = bpy.data.objects[piece]
            ob.hide_render = not (lineup or piece == name)
            ob.location = (x, 0, 0) if lineup else (0, 0, 0)
            x += 0.36
    return setup


def review():
    # three's toon materials draw front faces only; show the same, so a face turned the wrong way
    # shows here as a hole rather than first in the office.
    bpy.context.scene.display.shading.show_backface_culling = True
    views = ("tq", "front", "side", "top")
    paths = [ao.sheet("desk_mug", [(only("mug"), v) for v in (*views, "back")], cell=(420, 420), target=(0.02, 0, 0.06), dist=0.55)]
    for name in PIECES[1:]:
        paths.append(ao.sheet(f"desk_{name}", [(only(name), v) for v in (*views, "back")], cell=(420, 420), target=(0, 0, 0.1), dist=0.85))
    paths.append(ao.sheet("desk_lineup", [(only(None, lineup=True), v) for v in ("front", "tq", "back")],
                          cell=(900, 420), target=(0.54, 0, 0.1), dist=1.9))
    # Back as exported: every piece shown, at the origin.
    for piece in PIECES:
        ob = bpy.data.objects[piece]
        ob.location = (0, 0, 0)
        ob.hide_render = False
    return paths


if __name__ == "__main__" and bpy.app.background:
    main()
    if "--shots" in ao.args():
        for path in review():
            print("sheet:", path)
