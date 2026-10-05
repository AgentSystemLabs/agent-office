"""The detective office's furniture, modelled by this script and exported to
src/client/models/noir.glb for src/client/world/office/noir.ts, which puts it round the office
floor: a banker's lamp, a rotary telephone, a typewriter, a stack of case files, a filing cabinet,
a venetian blind and a desk blotter. The shared helpers are in aokit.py and the conventions in
blender/README.md.

Headless, from the repo root (`-- --shots` also writes a review sheet per piece and one of them all
side by side):

    blender --background --factory-startup --python blender/scripts/build_noir.py [-- --shots]

Each piece is one object and a root of its own, so the office can place any of them by itself.
Every piece stands on the floor (or on a desk) at its origin and faces forward like every model:
-Y here, which the exporter turns into +Z. Nothing in this model moves on its own, so every piece
is a single joined object, one draw call per material.

The object and material names are a contract with world/office/noir.ts and
tests/noir-model.test.ts, so rename them in all three places. Nothing here is textured: the office
paints every material with its own toon one by name (world/models.ts), and the model is exported
without UVs on purpose, so nothing has to survive mergeByMaterial() (which drops them).

Sizes keep out of the office's way: the lamp, phone, typewriter, files and blotter stand on a desk
0.78 m high and 2.2 by 1.1 m (DESK_SIZE) without hiding the laptop anchor or the worker; the
cabinet is a standard 1.32 m four-drawer one that fits against a wall; the blind is cut for the
office's 3 by 2.2 m windows (WINDOWS in shared/layout.ts).
"""
import bpy, bmesh, math, os, sys
from mathutils import Matrix, Vector

# Run headless, Blender doesn't put this folder on the import path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aokit as ao

# Preview colours only: world/office/noir.ts paints every material by name with the same colours.
COLORS = {
    "Brass": "#b08d3f",
    "Shade": "#1f6b4a",
    "Bakelite": "#1b1b1e",
    "Steel": "#3f4a44",
    "WoodWarm": "#5a3a22",
    "Paper": "#e8dfc8",
    "Folder": "#b99b62",
    "Leather": "#4a2f22",
    "Slat": "#cfc4ad",
    "Cord": "#8a7a5c",
    "Ink": "#101418",
}

PIECES = ("desk_lamp", "rotary_phone", "typewriter", "file_stack", "filing_cabinet", "venetian_blind", "desk_blotter")


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
        """Adds a shape: `build(bm, *args, **kw)` is one of aokit's shape functions."""
        bm = self.bm
        start = len(bm.faces)
        build(bm, *args, **kw)
        bm.faces.ensure_lookup_table()
        for f in bm.faces[start:]:
            f.smooth = smooth
            f.material_index = self.slot(mat)

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


# ---- The banker's lamp ----------------------------------------------------------------------------
#
# A 1940s banker's lamp: a weighted brass disc, a stem with a collar, and a half-cylinder green
# glass shade over the top, its open side down. 0.28 m tall, so it stands on the back corner of a
# desk without reaching the worker. Shade faces +Y (forward), the way the office's lamps do.

LAMP_H = 0.28
SHADE_R = 0.072
SHADE_LEN = 0.24


def half_shell(bm, r_out, r_in, length, center, segs=18):
    """A half-cylinder shell open along the bottom, for a lamp shade: an outer and an inner arc
    swept along Y and joined by an annulus at each end, so it is a closed solid with a hollow
    underside. One of the shapes a Shapes.add() takes, so it fills `bm` itself."""
    start = len(bm.verts)
    arcs = []
    for y in (-length / 2, length / 2):
        outer = [bm.verts.new((r_out * math.cos(math.pi * i / segs), y, r_out * math.sin(math.pi * i / segs))) for i in range(segs + 1)]
        inner = [bm.verts.new((r_in * math.cos(math.pi * i / segs), y, r_in * math.sin(math.pi * i / segs))) for i in range(segs + 1)]
        arcs.append((outer, inner))
    (o0, i0), (o1, i1) = arcs
    for k in range(segs):
        bm.faces.new((o0[k], o0[k + 1], o1[k + 1], o1[k]))
        bm.faces.new((i0[k], i0[k + 1], i1[k + 1], i1[k]))
        bm.faces.new((o0[k], o0[k + 1], i0[k + 1], i0[k]))
        bm.faces.new((o1[k], o1[k + 1], i1[k + 1], i1[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.verts.ensure_lookup_table()
    ao._place(bm, bm.verts[start:], center, (0, 0, 0))


def desk_lamp():
    s = Shapes()
    # Weighted base: a shallow brass disc with a stepped rim.
    s.add("Brass", ao.lathe, [(0.0, 0.0), (0.088, 0.0), (0.092, 0.008), (0.086, 0.018), (0.03, 0.022), (0.0, 0.022)],
          center=(0, 0, 0), segs=28)
    # The stem, with a collar where the shade hangs from it.
    s.add("Brass", ao.cylinder, (0, 0, 0.02), (0, 0, LAMP_H - SHADE_R * 0.4), 0.011, segs=14)
    s.add("Brass", ao.lathe, [(0.0, 0.0), (0.026, 0.0), (0.028, 0.012), (0.014, 0.02), (0.0, 0.02)],
          center=(0, 0, LAMP_H - SHADE_R * 0.5), segs=18)
    # The green glass shade: a half cylinder lying along Y over the top of the stem, open side down.
    s.add("Shade", half_shell, SHADE_R, SHADE_R - 0.007, SHADE_LEN, (0, 0, LAMP_H - SHADE_R))
    # A pull chain hanging at the back of the shade.
    s.add("Brass", ao.cylinder, (0, -SHADE_LEN / 2 + 0.02, LAMP_H - SHADE_R - 0.01),
          (0, -SHADE_LEN / 2 + 0.02, LAMP_H - SHADE_R - 0.06), 0.0035, segs=8)
    s.add("Brass", ao.ellipsoid, (0, -SHADE_LEN / 2 + 0.02, LAMP_H - SHADE_R - 0.065), (0.008, 0.008, 0.008), segs=10, rings=7)
    return s.finish("desk_lamp", sharp=0.6)


# ---- The rotary telephone -------------------------------------------------------------------------
#
# A black bakelite desk phone: a wedge body, a fingerwheel in a brass ring set into the front of the
# dial plate, and a handset lying on its cradle across the back. 0.22 wide, 0.17 deep, 0.23 tall.

PHONE_W, PHONE_D, PHONE_H = 0.24, 0.2, 0.24


def rotary_phone():
    s = Shapes()
    # A low bakelite body, wider at the foot, with the dial let into the top of it at the front.
    s.add("Bakelite", ao.box, (0, 0.012, 0.0375), (PHONE_W, PHONE_D, 0.075), bevel=0.016)
    # The dial plate, sloping down toward whoever sits at the desk so the wheel reads from across
    # the room, and set high enough that the whole fingerwheel clears the body.
    plate_y, plate_z, tilt = -0.05, 0.1, math.radians(42)
    up = Vector((0, -math.sin(tilt), math.cos(tilt)))
    plate = Vector((0, plate_y, plate_z))
    s.add("Bakelite", ao.box, tuple(plate), (0.15, 0.078, 0.016), bevel=0.006, rot=(tilt, 0, 0))

    def on_plate(u, v, lift=0.0):
        """A point (u, v) across the dial plate's own face, `lift` along its up."""
        return plate + Vector((u, 0, 0)) + Vector((0, math.cos(tilt), math.sin(tilt))) * v + up * lift

    # The brass fingerwheel ring, and the dark dial let in behind it.
    s.add("Brass", ao.cylinder, on_plate(0, 0, 0.006), on_plate(0, 0, 0.017), 0.05, segs=28)
    s.add("Bakelite", ao.cylinder, on_plate(0, 0, 0.009), on_plate(0, 0, 0.012), 0.042, segs=28)
    # Its ten finger holes, in the plate's own plane so they sit on the wheel.
    for i in range(10):
        a = math.radians(-46 + i * 27.5)
        c = on_plate(0.031 * math.sin(a), 0.031 * math.cos(a), 0.012)
        s.add("Bakelite", ao.cylinder, c, c + up * 0.004, 0.0065, segs=8)
    # The cradle at the back and the handset lying in it: two ear pieces on a curved grip.
    s.add("Bakelite", ao.box, (0, 0.062, 0.09), (0.17, 0.05, 0.03), bevel=0.01)
    for sx in (-1, 1):
        s.add("Bakelite", ao.ellipsoid, (sx * 0.095, 0.062, 0.117), (0.036, 0.03, 0.028), segs=16, rings=11)
    s.add("Bakelite", ao.box, (0, 0.062, 0.141), (0.15, 0.03, 0.024), bevel=0.011)
    # The cord, coiled once at the back and dropping off to the side.
    s.add("Bakelite", ao.torus, (0, 0.096, 0.05), 0.028, 0.007, rot=(math.radians(90), 0, 0), n=18, m=6)
    s.add("Bakelite", ao.cylinder, (0.02, 0.096, 0.05), (0.07, 0.13, 0.012), 0.007, segs=8)
    s.centre()
    return s.finish("rotary_phone", sharp=0.7)


# ---- The typewriter --------------------------------------------------------------------------------
#
# A 1940s portable: a dark body, a bank of brass keys, a carriage with a sheet of paper in it and two
# roller knobs. 0.42 wide, 0.34 deep, 0.3 tall with the paper up.

TYPE_W, TYPE_D = 0.42, 0.34


def typewriter():
    s = Shapes()
    # The body, stepped: the case, then the sloping keybed over it.
    s.add("Bakelite", ao.box, (0, 0.01, 0.055), (TYPE_W, TYPE_D, 0.11), bevel=0.016)
    s.add("Bakelite", ao.box, (0, -0.045, 0.115), (TYPE_W * 0.97, TYPE_D * 0.68, 0.05), bevel=0.012,
          rot=(math.radians(7), 0, 0))
    # Four rows of brass keys on the bed, the front row longest.
    for row, (ry, rz, n, rad) in enumerate((
        (-0.135, 0.128, 10, 0.0085),
        (-0.095, 0.132, 10, 0.0085),
        (-0.055, 0.137, 9, 0.0085),
        (-0.018, 0.143, 8, 0.0085),
    )):
        for i in range(n):
            x = (i - (n - 1) / 2) * 0.036
            s.add("Brass", ao.cylinder, (x, ry, rz), (x, ry, rz + 0.011), rad, segs=10)
    # The space bar, a long brass bar across the front.
    s.add("Brass", ao.cylinder, (-0.15, -0.168, 0.126), (0.15, -0.168, 0.126), 0.008, segs=10)
    # The carriage: a roller across the back with a sheet of paper in it.
    s.add("Steel", ao.cylinder, (-TYPE_W / 2 + 0.02, 0.135, 0.175), (TYPE_W / 2 - 0.02, 0.135, 0.175), 0.019, segs=16)
    for sx in (-1, 1):
        s.add("Steel", ao.cylinder, (sx * (TYPE_W / 2 - 0.006), 0.135, 0.175), (sx * (TYPE_W / 2 + 0.018), 0.135, 0.175), 0.026, segs=14)
    # The sheet, standing up out of the carriage and leaning back a little.
    s.add("Paper", ao.box, (0, 0.148, 0.26), (0.24, 0.006, 0.17), bevel=0.002, rot=(math.radians(-9), 0, 0))
    # The paper bail and its two arms.
    s.add("Steel", ao.cylinder, (-0.11, 0.13, 0.213), (0.11, 0.13, 0.213), 0.004, segs=8)
    for sx in (-1, 1):
        s.add("Steel", ao.cylinder, (sx * 0.115, 0.132, 0.176), (sx * 0.115, 0.132, 0.213), 0.004, segs=8)
    s.centre()
    return s.finish("typewriter", sharp=0.7)


# ---- The stack of case files -----------------------------------------------------------------------
#
# A pile of manila case folders with paper in them, tied with a cotton tag, the way a 1940s detective
# office stacked what it was working on. 0.34 by 0.26 and 0.11 tall, so it stands in a desk's back
# corner clear of the laptop.


def file_stack():
    s = Shapes()
    # Four folders, each a little bigger and lower than the one on it, turned a few degrees out.
    for i in range(4):
        z = 0.012 + i * 0.026
        w, d = 0.34 - i * 0.012, 0.26 - i * 0.01
        s.add("Folder", ao.box, (0, 0, z), (w, d, 0.026), bevel=0.004, rot=(0, 0, math.radians(-6 + i * 4)))
        # The paper edge showing out of the folder's open side.
        s.add("Paper", ao.box, (0.004 * i, 0, z + 0.004), (w - 0.03, d - 0.02, 0.017), bevel=0.002,
              rot=(0, 0, math.radians(-6 + i * 4)))
    # The cotton tag round the middle of the pile, and its little brass eyelet.
    s.add("Cord", ao.box, (0, 0, 0.066), (0.36, 0.055, 0.006), bevel=0.002)
    s.add("Brass", ao.cylinder, (0.05, -0.028, 0.066), (0.05, -0.028, 0.072), 0.009, segs=12)
    s.centre()
    return s.finish("file_stack", sharp=0.6)


# ---- The filing cabinet ----------------------------------------------------------------------------
#
# A four-drawer steel cabinet, the kind every municipal office had: a dark green-grey body, proud
# drawer fronts, brass pulls and label holders. 0.47 wide, 0.62 deep, 1.32 tall, standing on a
# plinth, so it goes against a wall like any other piece of furniture.

CAB_W, CAB_D, CAB_H = 0.47, 0.62, 1.32
DRAWER_H = 0.285


def filing_cabinet():
    s = Shapes()
    # The body and its plinth, so it reads as standing rather than floating.
    s.add("Steel", ao.box, (0, 0, CAB_H / 2 + 0.03), (CAB_W, CAB_D, CAB_H - 0.06), bevel=0.012)
    s.add("Steel", ao.box, (0, 0, 0.03), (CAB_W - 0.04, CAB_D - 0.04, 0.06), bevel=0.006)
    # Four drawer fronts, each proud of the body, with a brass pull and a label holder above it.
    front = -CAB_D / 2
    for i in range(4):
        z = 0.09 + i * DRAWER_H + DRAWER_H / 2
        s.add("Steel", ao.box, (0, front - 0.012, z), (CAB_W - 0.03, 0.024, DRAWER_H - 0.02), bevel=0.006)
        # The pull: a brass bar on two posts.
        s.add("Brass", ao.box, (0, front - 0.042, z - 0.06), (0.11, 0.018, 0.022), bevel=0.006)
        for sx in (-1, 1):
            s.add("Brass", ao.cylinder, (sx * 0.048, front - 0.028, z - 0.06), (sx * 0.048, front - 0.038, z - 0.06), 0.007, segs=10)
        # The label holder, a brass frame with a card in it.
        s.add("Brass", ao.box, (0, front - 0.026, z + 0.062), (0.15, 0.008, 0.05), bevel=0.003)
        s.add("Paper", ao.box, (0, front - 0.031, z + 0.062), (0.126, 0.004, 0.032))
    # Deliberately not centred on its footprint: the office stands this against a wall, so its back
    # (its model's -z, without the brass pulls) is what sits on the wall, at exactly -CAB_D / 2.
    return s.finish("filing_cabinet", sharp=0.7)


# ---- The venetian blind ---------------------------------------------------------------------------
#
# Slats on two cords under a head rail, tilted down a few degrees, with the tilt wand hanging at
# the left. Cut for the office's windows: 3 m wide, 2.2 m down from the rail. The head rail is at
# the top (z = drop) and the slats hang from it, so the office hangs it at a window's head and it
# falls to the sill. The blind is one object, the slats already tilted: nothing animates them.


def venetian_blind():
    s = Shapes()
    w, drop = 3.0, 2.2
    rail_z = drop
    # The head rail and its end caps.
    s.add("WoodWarm", ao.box, (0, 0, rail_z - 0.035), (w, 0.07, 0.07), bevel=0.008)
    for sx in (-1, 1):
        s.add("WoodWarm", ao.box, (sx * (w / 2 - 0.01), 0, rail_z - 0.035), (0.03, 0.075, 0.075), bevel=0.006)
    # The slats, close enough together to read as a blind and covering the whole drop.
    n = 28
    for i in range(n):
        z = rail_z - 0.1 - i * (drop - 0.15) / n
        s.add("Slat", ao.box, (0, 0, z), (w - 0.03, 0.048, 0.007), bevel=0.002, rot=(math.radians(24), 0, 0))
    # The ladder cords down both ends and the lift cords through the middle.
    for sx in (-1, 1):
        s.add("Cord", ao.cylinder, (sx * (w / 2 - 0.02), 0.016, rail_z - 0.06), (sx * (w / 2 - 0.02), 0.016, 0.05), 0.0025, segs=6)
        s.add("Cord", ao.cylinder, (sx * (w / 2 - 0.02), -0.016, rail_z - 0.06), (sx * (w / 2 - 0.02), -0.016, 0.05), 0.0025, segs=6)
    for i in range(4):
        x = (i - 1.5) * (w / 5)
        s.add("Cord", ao.cylinder, (x, 0.022, rail_z - 0.06), (x, 0.022, 0.05), 0.0022, segs=6)
    # The tilt wand hanging at the left, with its cord.
    s.add("WoodWarm", ao.cylinder, (-w / 2 + 0.06, 0.03, rail_z - 0.06), (-w / 2 + 0.06, 0.03, rail_z - 0.46), 0.008, segs=10)
    s.add("Cord", ao.cylinder, (-w / 2 + 0.06, 0.03, rail_z - 0.06), (-w / 2 + 0.055, 0.03, rail_z - 0.09), 0.0022, segs=6)
    # The blind hangs from its rail, so its top is at the origin.
    bmesh.ops.translate(s.bm, vec=(0, 0, -drop), verts=s.bm.verts[:])
    return s.finish("venetian_blind", sharp=0.7)


# ---- The desk blotter -----------------------------------------------------------------------------
#
# A leather blotter with brass corner rules and an inkwell: what makes a desk top read as a
# detective's rather than a work surface. 1.0 by 0.62, so it takes most of a 2.2 by 1.1 m desk top.

BLOT_W, BLOT_D = 1.0, 0.62


def desk_blotter():
    s = Shapes()
    # The pad, thin, with its edge rolled over.
    s.add("Leather", ao.box, (0, 0, 0.007), (BLOT_W, BLOT_D, 0.014), bevel=0.005)
    # Brass corner rules on two corners, the way a blotter is held down.
    for sx, sy in ((-1, -1), (1, -1)):
        s.add("Brass", ao.box, (sx * (BLOT_W / 2 - 0.075), sy * (BLOT_D / 2 - 0.075), 0.016),
              (0.15, 0.028, 0.006), bevel=0.002, rot=(0, 0, math.radians(45 * sx * sy)))
    # The inkwell, a squat glass bottle with a brass collar, at the back left.
    s.add("Ink", ao.lathe, [(0.0, 0.0), (0.038, 0.0), (0.04, 0.05), (0.026, 0.062), (0.026, 0.07), (0.0, 0.07)],
          center=(-BLOT_W / 2 + 0.11, BLOT_D / 2 - 0.1, 0.014), segs=20)
    s.add("Brass", ao.cylinder, (-BLOT_W / 2 + 0.11, BLOT_D / 2 - 0.1, 0.082),
          (-BLOT_W / 2 + 0.11, BLOT_D / 2 - 0.1, 0.09), 0.028, segs=18)
    s.centre()
    return s.finish("desk_blotter", sharp=0.7)


# ---- The build ------------------------------------------------------------------------------------

def build():
    ao.clear()
    made = [desk_lamp(), rotary_phone(), typewriter(), file_stack(), filing_cabinet(), venetian_blind(), desk_blotter()]
    for name, ob in zip(PIECES, made):
        print(f"{name}: {ao.tris(ob)} tris, {len(ob.data.materials)} materials")
    return ao.export("noir")


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
            x += 0.5
    return setup


def review():
    bpy.context.scene.display.shading.show_backface_culling = True
    views = ("tq", "front", "side", "top")
    # How close to look at each piece, and where: the small desk things need to be near.
    framing = {
        "desk_lamp": ((0, 0, 0.17), 0.62),
        "rotary_phone": ((0, 0, 0.11), 0.6),
        "typewriter": ((0, 0, 0.16), 0.95),
        "file_stack": ((0, 0, 0.06), 0.62),
        "filing_cabinet": ((0, 0, 0.66), 2.5),
        "venetian_blind": ((0, 0, -1.1), 3.4),
        "desk_blotter": ((0, 0, 0.03), 1.5),
    }
    paths = []
    for name in PIECES:
        target, dist = framing[name]
        paths.append(ao.sheet(f"noir_{name}", [(only(name), v) for v in (*views, "back")],
                              cell=(420, 420), target=target, dist=dist))
    paths.append(ao.sheet("noir_lineup", [(only(None, lineup=True), v) for v in ("front", "tq", "back")],
                          cell=(900, 420), target=(1.5, 0, 0.3), dist=4.4))
    for piece in PIECES:
        ob = bpy.data.objects[piece]
        ob.location = (0, 0, 0)
        ob.hide_render = False
    return paths


if __name__ == "__main__" and bpy.app.background:
    print("wrote:", build())
    if "--shots" in ao.args():
        for path in review():
            print("sheet:", path)