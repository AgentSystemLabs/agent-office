"""The office's potted plants: a monstera, a snake plant and a bushy ficus that stand on the floor,
and a little succulent for the desks. Modelled by this script and exported to
src/client/models/plants.glb for src/client/world/office.ts, which clones a species wherever a
plant stands. The shared helpers are in aokit.py and the conventions in blender/README.md.

Headless, from the repo root (`-- --shots` also writes a review sheet per species and one of all
four side by side):

    blender --background --factory-startup --python blender/scripts/build_plants.py [-- --shots]

Through the Blender MCP bridge (module globals don't survive between calls, so import it every
time):

    import sys, importlib
    sys.path.insert(0, r"<repo>/blender/scripts")
    import aokit, build_plants; importlib.reload(aokit); importlib.reload(build_plants)
    build_plants.main()

Each species is two objects. The pot with its soil is a root of its own, named after the species
(`monstera`, `snake_plant`, `ficus`, `succulent`), standing on the floor at the origin and facing
forward. Everything that grows out of it (leaves, stems, a trunk) is one object parented under
the pot, `<species>_leaves`, its origin there too. office.ts clones the pot, which brings its
leaves along; at Christmas world/holiday.ts hides every object whose name ends in `_leaves` and
stands a little tree in the pot instead. The object and material names are a contract with
office.ts and tests/plants-model.test.ts, so rename them in all three places.

The floor pots keep the old code-built pot's size (0.28 m round at the top, 0.22 at the base, 0.5
tall) with their soil at 0.45, where the Christmas tree stands, so the plants' colliders and the
tree fit as before. The desk pot is that pot at the old desk plant's 0.35 scale.
"""
import bpy, bmesh, math, os, sys
from mathutils import Matrix, Quaternion, Vector

# Run headless, Blender doesn't put this folder on the import path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aokit as ao
from aokit import TAU

# Preview colours only: office.ts paints every material by name with the same colours (the old
# code-built plants' pot and greens, the Christmas tree's trunk brown for the soil, the street trees'
# trunk brown for the ficus's, and the kitchen cupboards' blue for the snake plant's glazed pot).
COLORS = {
    "Pot": "#e76f51",
    "Glaze": "#8ecae6",
    "Soil": "#6b4226",
    "Bark": "#8a5a3b",
    "Leaf": "#5fb760",
    "LeafDark": "#3f8f45",
}

SPECIES = ("monstera", "snake_plant", "ficus", "succulent")

# How high a floor pot's soil is: holiday.ts stands the Christmas tree on it.
SOIL_Z = 0.45
# The desk pot is the floor pot at this scale, the old desk plant's.
DESK = 0.35


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
        script's). `smooth` is True, False, or a test on each of its faces."""
        bm = self.bm
        start = len(bm.faces)
        build(bm, *args, **kw)
        bm.faces.ensure_lookup_table()
        bm.normal_update()
        for f in bm.faces[start:]:
            f.smooth = smooth(f) if callable(smooth) else smooth
            f.material_index = self.slot(mat)

    def add_part(self, mats, part, at=Matrix.Identity(4)):
        """Adds a finished bmesh `part` (from solid() or the like, and frees it), placed by the
        matrix `at`. Its faces keep their own shading; their material_index picks from `mats`."""
        bmesh.ops.transform(part, matrix=at, verts=part.verts[:])
        slots = [self.slot(m) for m in mats]
        for f in part.faces:
            f.material_index = slots[min(f.material_index, len(slots) - 1)]
        ao._merge(self.bm, part)

    def finish(self, name, parent=None, sharp=None):
        """The object, its origin at the scene's origin, hung from `parent` if given. With `sharp`
        (radians), edges sharper than that stay sharp, so a pot's rim is crisp and its sides round."""
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
        if parent is not None:
            ob.parent = parent
            ob.matrix_parent_inverse = Matrix.Identity(4)
        return ob


# ---- Leaves ---------------------------------------------------------------------------------------
#
# A leaf is built flat in its own space (u across it, v along it from its base to its tip, w out
# of its top), then placed by a frame(). Leaves are thin slabs, not paper: a slab has a rim for the
# office's outline to follow, where a single sheet would lose its outline edge-on. Their faces are
# flat and their rims rounded, which shades cleaner than a domed leaf.

def solid(points, faces, loop, depth, fold=0.0, bevel=0.0, mats=None):
    """A slab `depth` thick from a flat shape: `points` are [(u, v)], `faces` index lists that tile
    it (counter-clockwise seen from its top, +w), `loop` its outline (counter-clockwise too). Its
    two halves either side of u = 0 rise by |u| * `fold`, so it folds along its midrib; `bevel`
    rounds over its rim. `mats` gives each face's material index (0 or 1); the rim takes the
    index of the face it borders. Returns the bmesh, in leaf space."""
    part = bmesh.new()
    top = [part.verts.new((u, v, depth / 2 + abs(u) * fold)) for u, v in points]
    bot = [part.verts.new((u, v, -depth / 2 + abs(u) * fold)) for u, v in points]
    for k, f in enumerate(faces):
        m = mats[k] if mats else 0
        part.faces.new([top[i] for i in f]).material_index = m
        part.faces.new([bot[i] for i in reversed(f)]).material_index = m
    rim = []
    n = len(loop)
    for j in range(n):
        a, b = loop[j], loop[(j + 1) % n]
        edge = part.edges.get((top[a], top[b]))
        wall = part.faces.new((bot[a], bot[b], top[b], top[a]))
        wall.material_index = edge.link_faces[0].material_index
        rim += [edge, part.edges.get((bot[a], bot[b]))]
    bmesh.ops.recalc_face_normals(part, faces=part.faces[:])
    if bevel > 0:
        bmesh.ops.bevel(part, geom=rim, offset=bevel, segments=1, profile=0.5, affect='EDGES', clamp_overlap=True)
    part.normal_update()
    # Flat faces on top and underneath, round all along the rim.
    for f in part.faces:
        f.smooth = abs(f.normal.z) < 0.8
    return part


def frame(at, azimuth, pitch, roll=0.0):
    """Where a leaf goes: its base at `at`, pointing out toward `azimuth` (radians round from +X
    toward +Y; the front, -Y, is -pi/2) and up by `pitch`, its top facing up, then turned about
    its own length by `roll`. A matrix from leaf space to the scene."""
    d = Vector((math.cos(azimuth) * math.cos(pitch), math.sin(azimuth) * math.cos(pitch), math.sin(pitch)))
    s = Vector((math.sin(azimuth), -math.cos(azimuth), 0.0))
    n = s.cross(d)
    q = Quaternion(d, roll)
    return axes(at, q @ s, d, q @ n)


def axes(at, u, v, w):
    """The matrix taking leaf space's u, v and w to the scene's `u`, `v` and `w`, its origin at `at`."""
    m = Matrix.Identity(4)
    for i, c in enumerate((u, v, w)):
        m[0][i], m[1][i], m[2][i] = c
    m[0][3], m[1][3], m[2][3] = at
    return m


def smooth_curve(pts, steps=2):
    """A Catmull-Rom curve through `pts` [(x, y)], `steps` points per span (the ends kept)."""
    out = []
    p = [pts[0]] + list(pts) + [pts[-1]]
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = (Vector(p[j]) for j in (i - 1, i, i + 1, i + 2))
        for k in range(steps):
            t = k / steps
            out.append(tuple(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                                    + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t)))
    out.append(tuple(pts[-1]))
    return out


def along(line, s):
    """The point `s` of the way along a polyline, by length, and the index of the vertex after it."""
    lens = [(Vector(b) - Vector(a)).length for a, b in zip(line, line[1:])]
    goal = s * sum(lens)
    for i, l in enumerate(lens):
        if goal <= l or i == len(lens) - 1:
            t = min(1.0, goal / l) if l else 0.0
            return tuple(Vector(line[i]).lerp(Vector(line[i + 1]), t)), i + 1
        goal -= l


def split(edge, slits):
    """Cuts slits into a leaf's edge (a polyline [(u, v)] from its base to its tip, u > 0): each
    (s, depth, gap) in `slits` goes in at `s` of the way along the edge, `gap` wide there, and
    `depth` of the way to the midrib, slanting toward the tip and narrowing to a blunt end."""
    total = sum((Vector(b) - Vector(a)).length for a, b in zip(edge, edge[1:]))
    out = list(edge)
    # From the tip back, so each slit spliced in leaves the edge before it where it was.
    for s, depth, gap in sorted(slits, reverse=True):
        a, ia = along(edge, s - gap / 2 / total)
        b, ib = along(edge, s + gap / 2 / total)
        p = Vector(along(edge, s)[0])
        aim = Vector((0.0, min(p.y + 0.22, 0.92)))
        q = p.lerp(aim, depth)
        across = (aim - p).normalized()
        across = Vector((across.y, -across.x))
        if (Vector(a) - p).dot(across) < 0:
            across = -across
        # Wide enough at its end for the rim's rounding not to run into itself.
        inner = gap * 0.5
        qa, qb = q + across * inner / 2, q - across * inner / 2
        out = out[:ia] + [a, tuple(qa), tuple(qb), b] + out[ib:]
    return out


def blade(right, left, rib, depth, fold=0.0, bevel=0.0):
    """A leaf from its two edges, each a polyline [(u, v)] from its base (on the midrib, u = 0) to
    its tip (on the midrib too): `right` has u > 0, `left` u < 0. `rib` are the heights of the
    points along the midrib between them, where the leaf folds (see solid())."""
    base, tip = right[0], right[-1]
    points = [base] + right[1:-1] + [tip] + left[1:-1] + [(0.0, v) for v in rib]
    nr, nl = len(right) - 2, len(left) - 2
    r_idx = list(range(1, 1 + nr))
    t_idx = 1 + nr
    l_idx = list(range(t_idx + 1, t_idx + 1 + nl))
    m_idx = list(range(t_idx + 1 + nl, len(points)))
    faces = [[0] + r_idx + [t_idx] + m_idx[::-1], [0] + m_idx + [t_idx] + l_idx[::-1]]
    loop = [0] + r_idx + [t_idx] + l_idx[::-1]
    return solid(points, faces, loop, depth, fold=fold, bevel=bevel)


# A monstera leaf's right edge, from the notch its stalk joins it at, round the lobe and up to the
# tip, as fractions of its length.
MONSTERA_EDGE = smooth_curve([(0.0, 0.0), (0.12, -0.12), (0.3, -0.14), (0.45, -0.04), (0.51, 0.16), (0.47, 0.4),
                              (0.36, 0.64), (0.2, 0.84), (0.0, 1.0)], 2)


def monstera_leaf(length, slits_r, slits_l):
    """A monstera leaf, `length` from where its stalk joins it (the notch between its two round
    lobes, at the origin) to its tip and nearly as wide, split in from both edges by `slits_r`
    and `slits_l` (see split())."""
    right = [(u * length, v * length) for u, v in split(MONSTERA_EDGE, slits_r)]
    left = [(-u * length, v * length) for u, v in split(MONSTERA_EDGE, slits_l)]
    rib = [length * t for t in (0.2, 0.45, 0.7)]
    return blade(right, left, rib, 0.014, fold=math.tan(math.radians(12)), bevel=0.003)


def strap_leaf(length, widths, bands=(), chevron=0.0, depth=0.016, fold=0.3, bevel=0.0):
    """A long leaf from rows across it: `widths` [(t, half width)] up it (t from 0 at its base to 1
    at its pointed tip), each row's middle `chevron` further up than its edges. `bands` lists the
    gaps between rows (0 is base to first row) that take the second material."""
    points = [(0.0, 0.0)]
    for t, hw in widths:
        v = t * length
        points += [(-hw, v), (0.0, v + chevron), (hw, v)]
    points.append((0.0, length))
    rows = len(widths)
    L = lambda k: 1 + 3 * k
    M = lambda k: 2 + 3 * k
    R = lambda k: 3 + 3 * k
    tip = len(points) - 1
    faces, mats = [[0, R(0), M(0)], [0, M(0), L(0)]], [0 in bands] * 2
    for k in range(rows - 1):
        faces += [[M(k), R(k), R(k + 1), M(k + 1)], [L(k), M(k), M(k + 1), L(k + 1)]]
        mats += [(k + 1) in bands] * 2
    faces += [[M(rows - 1), R(rows - 1), tip], [L(rows - 1), M(rows - 1), tip]]
    mats += [rows in bands] * 2
    loop = [0] + [R(k) for k in range(rows)] + [tip] + [L(k) for k in reversed(range(rows))]
    return solid(points, faces, loop, depth, fold=fold, bevel=bevel, mats=[int(m) for m in mats])


def oval_leaf(length, width, depth=0.012):
    """A pointed oval leaf, its stalk end at the origin, folded a little along its midrib."""
    edge = [(0.0, 0.0), (0.32, 0.12), (0.5, 0.36), (0.44, 0.62), (0.24, 0.86), (0.0, 1.0)]
    right = [(u * width, v * length) for u, v in edge]
    left = [(-u * width, v * length) for u, v in edge]
    return blade(right, left, [length * 0.45], depth, fold=0.2)


def stalk(bm, points, r0, r1, segs=7):
    """A round stalk along `points`, `r0` thick at its start tapering to `r1`, capped at both ends.
    Its rings are carried round the bends without twisting."""
    pts = [Vector(p) for p in points]
    n = len(pts)
    tangents = [(pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized() for i in range(n)]
    normal = tangents[0].orthogonal().normalized()
    rings = []
    for i, (p, t) in enumerate(zip(pts, tangents)):
        if i:
            normal = tangents[i - 1].rotation_difference(t) @ normal
        side = t.cross(normal)
        r = r0 + (r1 - r0) * i / (n - 1)
        rings.append([bm.verts.new(p + r * (math.cos(a) * normal + math.sin(a) * side))
                      for a in (TAU * k / segs for k in range(segs))])
    faces = [bm.faces.new(rings[0][::-1]), bm.faces.new(rings[-1])]
    for lo, hi in zip(rings, rings[1:]):
        for k in range(segs):
            faces.append(bm.faces.new((lo[k], lo[(k + 1) % segs], hi[(k + 1) % segs], hi[k])))
    bmesh.ops.recalc_face_normals(bm, faces=faces)


def bezier(a, b, c, n=6):
    """n + 1 points along the quadratic curve from `a` to `c`, pulled toward `b`."""
    a, b, c = Vector(a), Vector(b), Vector(c)
    return [tuple((1 - t) ** 2 * a + 2 * (1 - t) * t * b + t * t * c) for t in (i / n for i in range(n + 1))]


# ---- Pots -----------------------------------------------------------------------------------------

def terracotta(s, scale=1.0, segs=20, soil_z=SOIL_Z):
    """A flowerpot with a band round its rim, and the soil in it up to `soil_z`, all `scale` times
    the floor pot."""
    k = scale
    profile = [(0.0, 0.0), (0.2, 0.0), (0.222, 0.02), (0.252, 0.39), (0.28, 0.4), (0.28, 0.492), (0.272, 0.5),
               (0.252, 0.5), (0.244, 0.43)]
    s.add("Pot", ao.lathe, [(r * k, z * k) for r, z in profile], segs=segs, smooth=True)
    soil(s, 0.247 * k, soil_z * k, segs)


def glazed(s, segs=20):
    """A glazed planter, straight-sided and round-lipped, and the soil in it."""
    profile = [(0.0, 0.0), (0.195, 0.0), (0.216, 0.012), (0.222, 0.03), (0.27, 0.46), (0.28, 0.485), (0.27, 0.5),
               (0.252, 0.498), (0.246, 0.43)]
    s.add("Glaze", ao.lathe, profile, segs=segs, smooth=True)
    soil(s, 0.249, SOIL_Z, segs)


def soil(s, r, z, segs):
    """Earth filling a pot to `z`, `r` round (a little into the pot's wall), heaped a touch."""
    s.add("Soil", ao.lathe, [(r, z - 0.006 * r / 0.25), (r * 0.6, z), (0.0, z + 0.004 * r / 0.25)], segs=segs)


# ---- The monstera ---------------------------------------------------------------------------------
#
# Big split leaves on arching stalks, fanned out round the pot: the older ones low, big and drooping
# in the dark green, the younger ones higher, smaller and lighter. Its leaves reach about 0.52 m out,
# so in a corner at 1.4 times this size (0.73 m) it stays off the walls 0.8 m away.

# Where each leaf's slits go in along its edges: (s, depth, gap), see split().
SLITS = {
    "a": [(0.36, 0.6, 0.085), (0.55, 0.62, 0.085), (0.73, 0.55, 0.08)],
    "b": [(0.33, 0.58, 0.085), (0.52, 0.62, 0.085), (0.7, 0.58, 0.08)],
    "c": [(0.42, 0.55, 0.085), (0.64, 0.55, 0.08)],
}
# (azimuth in degrees, the leaf's base out from the middle and its height, pitch, roll, length, dark?,
#  slits on its right and left)
MONSTERA = [
    (-90, 0.13, 0.84, -28, 0, 0.44, True, "a", "b"),
    (-18, 0.14, 0.9, -22, 18, 0.42, True, "b", "a"),
    (-162, 0.14, 0.88, -24, -18, 0.42, True, "a", "b"),
    (58, 0.12, 0.95, -18, 10, 0.4, True, "b", "a"),
    (122, 0.12, 0.98, -15, -10, 0.4, True, "a", "b"),
    (-52, 0.07, 1.12, -2, 20, 0.37, False, "b", "c"),
    (-128, 0.07, 1.15, 4, -20, 0.36, False, "c", "b"),
    (88, 0.05, 1.2, 14, 0, 0.34, False, "c", "c"),
]


def monstera():
    pot = Shapes()
    terracotta(pot)
    root = pot.finish("monstera", sharp=math.radians(40))
    s = Shapes()
    for az, out, h, pitch, roll, length, dark, sr, sl in MONSTERA:
        a = math.radians(az)
        base = Vector((math.cos(a) * out, math.sin(a) * out, h))
        # Each stalk comes up out of the soil and arches over to its leaf.
        foot = Vector((math.cos(a) * 0.04, math.sin(a) * 0.04, SOIL_Z - 0.03))
        bend = Vector((foot.x, foot.y, h + 0.03)).lerp(base, 0.3)
        s.add("Leaf", stalk, bezier(foot, bend, base, n=5), 0.014, 0.009, segs=6, smooth=True)
        leaf = monstera_leaf(length, SLITS[sr], SLITS[sl])
        s.add_part(("LeafDark" if dark else "Leaf",), leaf, frame(base, a, math.radians(pitch), math.radians(roll)))
    s.finish("monstera_leaves", parent=root)
    return root


# ---- The snake plant ------------------------------------------------------------------------------
#
# Stiff upright sword leaves, dark green with pale chevron bands, leaning a little out of a glazed
# planter.

SNAKE_WIDTHS = [(0.04, 0.024), (0.12, 0.038), (0.2, 0.047), (0.29, 0.052), (0.38, 0.055), (0.47, 0.055),
                (0.56, 0.053), (0.64, 0.049), (0.72, 0.044), (0.79, 0.037), (0.86, 0.028), (0.92, 0.016)]
# (azimuth, foot out from the middle, lean from upright, roll, length, which gaps between rows are pale)
SNAKE = [
    (-90, 0.08, 15, 20, 0.84, (2, 5, 8, 10)),
    (-25, 0.09, 18, -25, 0.72, (1, 4, 7, 10)),
    (45, 0.08, 16, 30, 0.88, (2, 5, 7, 10)),
    (120, 0.09, 19, -15, 0.7, (1, 3, 6, 9)),
    (-150, 0.08, 17, 25, 0.78, (2, 4, 7, 9)),
    (175, 0.03, 6, 70, 0.96, (1, 4, 6, 9)),
    (-50, 0.03, 7, -60, 0.92, (2, 5, 8, 10)),
    (85, 0.1, 21, 0, 0.6, (2, 5, 8)),
    (5, 0.04, 9, 50, 0.8, (1, 3, 6, 9)),
]


def snake_plant():
    pot = Shapes()
    glazed(pot)
    root = pot.finish("snake_plant", sharp=math.radians(40))
    s = Shapes()
    for az, out, lean, roll, length, bands in SNAKE:
        a = math.radians(az)
        foot = (math.cos(a) * out, math.sin(a) * out, SOIL_Z - 0.04)
        leaf = strap_leaf(length, SNAKE_WIDTHS, bands=bands, chevron=0.022, depth=0.018, fold=0.35, bevel=0.004)
        s.add_part(("LeafDark", "Leaf"), leaf, frame(foot, a, math.radians(90 - lean), math.radians(roll)))
    s.finish("snake_plant_leaves", parent=root)
    return root


# ---- The ficus ------------------------------------------------------------------------------------
#
# A little tree: a bent trunk up to a round crown, a dark mass inside with big leaves shingled all
# over it, each hanging down the crown's side over the ones below.

# The crown, which the leaves sit on: (centre, radii).
CROWN = ((0.0, 0.0, 1.07), (0.3, 0.3, 0.26))
# The dark mass inside it, seen between the leaves: (centre, radii).
MASS = [
    ((0.0, 0.0, 1.07), (0.26, 0.26, 0.22)),
    ((0.1, -0.08, 0.99), (0.17, 0.17, 0.15)),
    ((-0.11, 0.08, 1.0), (0.17, 0.17, 0.15)),
]


def fib(n):
    """`n` directions spread evenly over a sphere."""
    out = []
    g = math.pi * (3 - math.sqrt(5))
    for i in range(n):
        z = 1 - 2 * (i + 0.5) / n
        r = math.sqrt(1 - z * z)
        out.append(Vector((math.cos(g * i) * r, math.sin(g * i) * r, z)))
    return out


def ficus():
    pot = Shapes()
    terracotta(pot)
    root = pot.finish("ficus", sharp=math.radians(40))
    s = Shapes()
    trunk = bezier((0.0, 0.0, SOIL_Z - 0.03), (0.07, -0.03, 0.66), (0.0, 0.0, 0.95), n=6)
    s.add("Bark", stalk, trunk, 0.034, 0.02, segs=8, smooth=True)
    for c, r in MASS:
        s.add("LeafDark", ao.ellipsoid, c, r, segs=14, rings=9, smooth=True)
    c, r = CROWN
    for k, d in enumerate(fib(50)):
        if d.z < -0.55:
            continue
        p = Vector(c) + Vector((d.x * r[0], d.y * r[1], d.z * r[2]))
        normal = Vector((d.x / r[0], d.y / r[1], d.z / r[2])).normalized()
        # Down the crown's side from where it sits (any way round on top), a little out from it,
        # and turned a bit this way or that so the rows don't line up.
        down = Vector((0, 0, -1)) + normal * normal.z
        if down.length < 0.3:
            down = Vector((math.cos(k * 2.4), math.sin(k * 2.4), 0))
            down -= normal * normal.dot(down)
        twist = Quaternion(normal, math.radians((k * 37) % 60 - 30))
        # Those on top lie flat on it rather than rising off it.
        v = twist @ (down.normalized() * 0.94 + normal * (0.3 - 0.36 * max(0.0, normal.z))).normalized()
        w = (normal - v * normal.dot(v)).normalized()
        leaf = oval_leaf(0.25, 0.15, depth=0.014)
        s.add_part(("LeafDark" if k % 3 == 2 else "Leaf",), leaf, axes(p - normal * 0.04, v.cross(w), v, w))
    # A ring of leaves lying over the top, which the ones round the sides leave bare.
    top = Vector((0.0, 0.0, c[2] + r[2] - 0.01))
    for i in range(5):
        a = TAU * i / 5 + 0.4
        s.add_part(("Leaf",), oval_leaf(0.24, 0.15, depth=0.014), frame(top, a, math.radians(-14), math.radians(8)))
    s.finish("ficus_leaves", parent=root)
    return root


# ---- The succulent --------------------------------------------------------------------------------
#
# An echeveria for a desk: a rosette of plump spoon-shaped leaves sitting up on the rim of a little
# terracotta pot, the outer ring spread wide and darker, the inner ones smaller, paler and standing
# up. The pot is filled nearly to the brim, so the rosette sits on its soil.

# How high the desk pot's soil is, measured as on the floor pot (it's scaled with the pot).
DESK_SOIL = 0.47
# The rings of leaves: (how many, length, width, thickness, pitch up from flat, out from the middle,
#  up from the soil)
ROSETTE = [
    (6, 0.092, 0.054, 0.022, 15, 0.014, 0.003),
    (5, 0.074, 0.046, 0.02, 36, 0.012, 0.009),
    (4, 0.056, 0.038, 0.018, 58, 0.008, 0.014),
    (3, 0.036, 0.026, 0.016, 78, 0.004, 0.018),
]


def plump(bm, length, width, thick):
    """A fleshy leaf along +Y from the origin: narrow where it grows, widest past its middle and
    pointed at its tip, flat on top and round underneath."""
    verts = bmesh.ops.create_uvsphere(bm, u_segments=6, v_segments=4, radius=1.0)["verts"]
    for v in verts:
        x, y, z = v.co
        # Turn the sphere's poles to point along the leaf, then shape it.
        y, z = z, -y
        t = (y + 1) / 2
        spoon = 0.55 + 0.85 * t
        v.co = Vector((x * width / 2 * spoon, t * length, (z * 0.4 if z > 0 else z) * thick / 2 * (1.15 - 0.5 * t)))
    return verts


def succulent():
    pot = Shapes()
    terracotta(pot, DESK, segs=16, soil_z=DESK_SOIL)
    root = pot.finish("succulent", sharp=math.radians(40))
    s = Shapes()
    z = DESK_SOIL * DESK
    for ring, (n, length, width, thick, pitch, out, up) in enumerate(ROSETTE):
        for i in range(n):
            a = TAU * (i + 0.5 * ring) / n + ring * 0.35
            at = Vector((math.cos(a) * out, math.sin(a) * out, z + up))
            part = bmesh.new()
            plump(part, length, width, thick)
            for f in part.faces:
                f.smooth = True
            s.add_part(("LeafDark" if ring == 0 else "Leaf",), part, frame(at, a, math.radians(pitch)))
    s.finish("succulent_leaves", parent=root)
    return root


MAKERS = {"monstera": monstera, "snake_plant": snake_plant, "ficus": ficus, "succulent": succulent}


def main(write=True):
    ao.clear()
    roots = [MAKERS[name]() for name in SPECIES]
    for root in roots:
        leaves = root.children[0]
        print(f"{root.name}: pot {ao.tris(root)} tris, leaves {ao.tris(leaves)} tris, "
              f"{len(root.data.materials) + len(leaves.data.materials)} materials")
    if write:
        ao.export("plants")
    return roots


# ---- Review renders -------------------------------------------------------------------------------

def only(name, lineup=False):
    """Shows just the species `name` (pot and leaves) in the review renders, or with `lineup` all of
    them in a row along x. Only the roots move; their leaves go with them."""
    def setup():
        x = 0.0
        for species in SPECIES:
            root = bpy.data.objects[species]
            show = lineup or species == name
            for ob in (root, *root.children):
                ob.hide_render = not show
            root.location = (x, 0, 0) if lineup else (0, 0, 0)
            if lineup:
                x += 0.5 if species == "ficus" else 1.2
    return setup


def review():
    # three's toon materials draw front faces only; show the same, so a face turned the wrong way
    # shows here as a hole rather than first in the office.
    bpy.context.scene.display.shading.show_backface_culling = True
    views = ("tq", "front", "side", "top")
    paths = []
    for name in SPECIES[:3]:
        paths.append(ao.sheet(f"plants_{name}", [(only(name), v) for v in views], cell=(420, 480), target=(0, 0, 0.72), dist=3.2))
    paths.append(ao.sheet("plants_succulent", [(only("succulent"), v) for v in views], cell=(420, 480), target=(0, 0, 0.14), dist=0.95))
    paths.append(ao.sheet("plants_lineup", [(only(None, lineup=True), v) for v in ("front", "tq")],
                          cell=(900, 520), target=(1.5, 0, 0.7), dist=6.2))
    # Back as exported: every species shown, at the origin.
    for species in SPECIES:
        root = bpy.data.objects[species]
        root.location = (0, 0, 0)
        for ob in (root, *root.children):
            ob.hide_render = False
    return paths


if __name__ == "__main__" and bpy.app.background:
    main()
    if "--shots" in ao.args():
        for path in review():
            print("sheet:", path)
