"""The kitchen corner: the counter, the espresso machine and the fridge, modelled by
this script and exported to src/client/models/kitchen.glb for
src/client/world/kitchen.ts. The shared helpers are in aokit.py and the conventions
in blender/README.md.

Headless, from the repo root (`-- --shots` also writes review sheets):

    blender --background --factory-startup --python blender/scripts/build_kitchen.py [-- --shots]

Through the Blender MCP bridge (module globals don't survive between calls, so
import it every time):

    import sys, importlib
    sys.path.insert(0, r"<repo>/blender/scripts")
    import aokit, build_kitchen; importlib.reload(aokit); importlib.reload(build_kitchen)
    build_kitchen.main()

It is three objects, three root nodes in the file: `counter`, `coffee_machine` and
`fridge`. kitchen.ts finds the machine by name (E at it pours a coffee, so a look at
the counter or the fridge mustn't), and the object and material names are a contract
with it and tests/kitchen-model.test.ts, so rename them in all three places.

Like every model it faces -Y here (+z in the office). The office stands it against
the south wall turned round to face into the room, which swaps its sides: the
machine is at +X here so that it lands at the old machine's place, the fridge at -X.
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector

# Run headless, Blender doesn't put this folder on the import path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aokit as ao
from aokit import TAU

# Preview colours only; kitchen.ts paints every material by name with the same colours
# (the old code-built kitchen's, and the office's wood for the counter top).
COLORS = {
    "Cabinet": "#8ecae6",
    "Wood": "#c98b5a",
    "Chrome": "#adb5bd",
    "Dark": "#343a40",
    "White": "#ffffff",
    "Glow": "#ef476f",
    "Fridge": "#f8f9fa",
    "Note": "#ffd166",
    "Memo": "#bde0fe",
    "Red": "#ef476f",
}


def material(name):
    return ao.material(name, COLORS[name])


# Where things are (Blender space, metres, the counter's middle on the floor at the origin). The
# counter is the old one's size, its top at the height the office's collider (and the holiday
# pumpkins on it) count on; the machine and the fridge stand where the old ones did.
BODY = (5.0, 1.0, 0.95)
TOP = (5.1, 1.1, 0.08)
TOP_Z = 1.03
MACHINE_AT = (1.2, 0.0, TOP_Z)
FRIDGE_AT = (-3.2, 0.0, 0.0)
FRIDGE = (1.1, 1.0, 2.2)


# ---- Building an object from shapes --------------------------------------------------------------

class Shapes:
    """One object's shapes, a bmesh per material. Boxes are shaded flat, round things smooth."""

    def __init__(self):
        self.parts = {}

    def add(self, mat, build, *args, smooth=False, **kw):
        """Adds a shape: `build(bm, *args, **kw)` is one of aokit's shape functions (or this
        script's). `smooth` is True, False, or a test on each of its faces."""
        bm = self.parts.setdefault(mat, bmesh.new())
        start = len(bm.faces)
        build(bm, *args, **kw)
        bm.faces.ensure_lookup_table()
        bm.normal_update()
        for f in bm.faces[start:]:
            f.smooth = smooth(f) if callable(smooth) else smooth

    def finish(self, name, origin):
        """One object with a material slot per material, its origin at `origin`. Edges sharper
        than 40 degrees stay sharp, so a cylinder's caps are flat and its sides round."""
        obs = []
        for i, (mat, bm) in enumerate(self.parts.items()):
            me = bpy.data.meshes.new(name if i == 0 else f"{name}_{mat}")
            bm.to_mesh(me)
            bm.free()
            me.materials.append(material(mat))
            ob = bpy.data.objects.new(name if i == 0 else f"{name}_{mat}", me)
            bpy.context.scene.collection.objects.link(ob)
            obs.append(ob)
        ob = ao.join(obs[0], obs[1:])
        ob.data.set_sharp_from_angle(angle=math.radians(40))
        ao.set_origin(ob, origin)
        return ob


def offset(at, p):
    return tuple(a + b for a, b in zip(at, p))


def rounded_rect(x0, x1, z0, z1, bottom, top):
    """A rectangle's outline [(x, z), ...] with its bottom corners rounded over `bottom` metres and
    its top ones over `top`."""
    pts = []
    for (cx, cz), r, a0 in (((x1 - bottom, z0 + bottom), bottom, -90), ((x1 - top, z1 - top), top, 0),
                            ((x0 + top, z1 - top), top, 90), ((x0 + bottom, z0 + bottom), bottom, 180)):
        n = max(2, round(r / 0.045))
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    return pts


def slab(bm, points, depth, center, bevel=0.0, segments=2):
    """Like aokit.outline (a flat outline [(x, z), ...] pulled `depth` along Y), but only its sharp
    edges are rounded over, not the gentle ones round a curve, which would only add triangles."""
    part = bmesh.new()
    front = [part.verts.new((x, -depth / 2, z)) for x, z in points]
    back = [part.verts.new((x, depth / 2, z)) for x, z in points]
    part.faces.new(front[::-1])
    part.faces.new(back)
    n = len(points)
    for i in range(n):
        part.faces.new((front[i], front[(i + 1) % n], back[(i + 1) % n], back[i]))
    bmesh.ops.recalc_face_normals(part, faces=part.faces[:])
    if bevel > 0:
        sharp = [e for e in part.edges if e.calc_face_angle(0) > 0.5]
        bmesh.ops.bevel(part, geom=sharp, offset=bevel, segments=segments, profile=0.5, affect='EDGES', clamp_overlap=True)
    bmesh.ops.translate(part, vec=center, verts=part.verts[:])
    ao._merge(bm, part)


def tube(bm, points, r, segs=10):
    """A round pipe along `points`, capped at both ends: a tap's neck, a steam wand. Its rings are
    carried round the bends without twisting."""
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
                      for a in (TAU * k / segs for k in range(segs))])
    faces = [bm.faces.new(rings[0][::-1]), bm.faces.new(rings[-1])]
    for lo, hi in zip(rings, rings[1:]):
        for k in range(segs):
            faces.append(bm.faces.new((lo[k], lo[(k + 1) % segs], hi[(k + 1) % segs], hi[k])))
    bmesh.ops.recalc_face_normals(bm, faces=faces)


def arc(center, r, a0, a1, n=8):
    """Points round an arc in the YZ plane (angles from +Y toward +Z), for tube()."""
    cx, cy, cz = center
    return [(cx, cy + r * math.cos(a), cz + r * math.sin(a)) for a in (a0 + (a1 - a0) * i / n for i in range(n + 1))]


def not_facing_y(f):
    """Smooth round a slab's curved sides, flat on its big front and back."""
    return abs(f.normal.y) < 0.99


# ---- The counter ----------------------------------------------------------------------------------

# Its cupboards: six columns across the front, a drawer over a door in each, except the one under the
# machine, which is three drawers. Doors pair up, their knobs by the middle of the pair.
COLUMNS = [-2.0, -1.2, -0.4, 0.4, 1.2, 2.0]
DRAWER_STACK = 1.2
KNOB_SIDE = {-2.0: 1, -1.2: -1, -0.4: 1, 0.4: -1, 2.0: -1}
FRONT = -BODY[1] / 2


def panel(s, x, z0, z1, drawer):
    """A drawer front or a door on the counter, and its chrome pull (a bar) or knob."""
    s.add("Cabinet", ao.box, (x, FRONT - 0.014, (z0 + z1) / 2), (0.74, 0.028, z1 - z0), bevel=0.012, segments=1)
    y = FRONT - 0.028
    if drawer:
        z = (z0 + z1) / 2
        s.add("Chrome", ao.cylinder, (x - 0.13, y - 0.035, z), (x + 0.13, y - 0.035, z), 0.013, segs=8, smooth=True)
        for sx in (-1, 1):
            s.add("Chrome", ao.cylinder, (x + sx * 0.11, y + 0.005, z), (x + sx * 0.11, y - 0.035, z), 0.009, segs=6, smooth=True)
    else:
        s.add("Chrome", ao.ellipsoid, (x + KNOB_SIDE[x] * 0.29, y - 0.018, z1 - 0.1), (0.026, 0.02, 0.026), segs=10, rings=6, smooth=True)


def counter():
    s = Shapes()
    w, d, h = BODY
    # The cupboards, standing on a dark kick board set back under them.
    s.add("Cabinet", ao.box, (0, 0, (0.08 + h) / 2), (w, d, h - 0.08))
    s.add("Dark", ao.box, (0, 0.03, 0.04), (w - 0.06, d - 0.06, 0.08))
    for x in COLUMNS:
        if x == DRAWER_STACK:
            for z0, z1 in ((0.13, 0.4), (0.44, 0.7), (0.74, 0.9)):
                panel(s, x, z0, z1, True)
        else:
            panel(s, x, 0.74, 0.9, True)
            panel(s, x, 0.13, 0.7, False)
    # The wooden top, a little over the cupboards all round.
    s.add("Wood", ao.box, (0, 0, TOP_Z - TOP[2] / 2), TOP, bevel=0.018, segments=2)
    # A sink between the pumpkins' spots (see holiday.ts), under the window: a chrome rim round a
    # dark basin, and a swan-neck tap at the back.
    sink = (0.0, -0.03)
    s.add("Chrome", ao.box, (sink[0], sink[1], TOP_Z + 0.007), (0.66, 0.5, 0.014), bevel=0.02, segments=2)
    s.add("Dark", ao.box, (sink[0], sink[1], TOP_Z + 0.0145), (0.54, 0.38, 0.004), bevel=0.04, segments=2)
    s.add("Chrome", ao.cylinder, (sink[0], sink[1], TOP_Z + 0.015), (sink[0], sink[1], TOP_Z + 0.018), 0.035, segs=12)
    tap = (sink[0], 0.26)
    s.add("Chrome", ao.cylinder, (tap[0], tap[1], TOP_Z), (tap[0], tap[1], TOP_Z + 0.04), 0.038, segs=12, smooth=True)
    neck = [(tap[0], tap[1], TOP_Z + 0.03), (tap[0], tap[1], TOP_Z + 0.2)]
    neck += arc((tap[0], tap[1] - 0.075, TOP_Z + 0.22), 0.075, 0, math.pi)[1:]
    neck += [(tap[0], tap[1] - 0.15, TOP_Z + 0.15)]
    s.add("Chrome", tube, neck, 0.02, segs=10, smooth=True)
    s.add("Chrome", ao.limb, (tap[0], tap[1], TOP_Z + 0.1), (tap[0] + 0.09, tap[1] + 0.01, TOP_Z + 0.13), 0.014, 0.012,
          segs=8, rings=6, smooth=True)
    return s.finish("counter", (0, 0, 0))


# ---- The espresso machine ------------------------------------------------------------------------
#
# Built round the middle of its feet (x across, its front toward -y, z up from the counter top), then
# set on the counter at MACHINE_AT. Chunky and dark like the old one, with a chrome face: a gauge
# and the little red light on it, the group head and its portafilter over a cup on the drip tray, a
# steam wand down one side and cups warming on the top.

def machine():
    s = Shapes()
    at = lambda *p: offset(MACHINE_AT, p)
    # The base with its drip tray out front, then the body on it.
    s.add("Dark", ao.box, at(0, -0.06, 0.035), (0.56, 0.6, 0.07), bevel=0.025, segments=2)
    s.add("Chrome", ao.box, at(0, -0.265, 0.078), (0.38, 0.17, 0.016), bevel=0.006, segments=2)
    s.add("Dark", ao.box, at(0, 0.04, 0.34), (0.52, 0.4, 0.54), bevel=0.06)
    s.add("Chrome", ao.box, at(0, -0.1675, 0.475), (0.44, 0.015, 0.19), bevel=0.02, segments=2)
    # The gauge (a white face in a dark ring, and its needle), and the light.
    gauge = (0.11, 0.475)
    s.add("Dark", ao.cylinder, at(gauge[0], -0.17, gauge[1]), at(gauge[0], -0.195, gauge[1]), 0.064, segs=16, smooth=True)
    s.add("White", ao.cylinder, at(gauge[0], -0.19, gauge[1]), at(gauge[0], -0.199, gauge[1]), 0.05, segs=16, smooth=True)
    s.add("Dark", ao.box, at(gauge[0] + 0.015, -0.201, gauge[1] + 0.012), (0.01, 0.004, 0.045), rot=(0, 0.9, 0))
    light = (-0.11, 0.475)
    s.add("Dark", ao.cylinder, at(light[0], -0.17, light[1]), at(light[0], -0.19, light[1]), 0.045, segs=14, smooth=True)
    s.add("Glow", ao.ellipsoid, at(light[0], -0.19, light[1]), (0.032, 0.022, 0.032), segs=12, rings=8, smooth=True)
    # The group head, and the portafilter locked into it, its handle out front a little to one side.
    s.add("Chrome", ao.cylinder, at(0, -0.15, 0.31), at(0, -0.25, 0.31), 0.06, segs=14, smooth=True)
    s.add("Chrome", ao.cylinder, at(0, -0.25, 0.25), at(0, -0.25, 0.36), 0.072, segs=16, smooth=True)
    s.add("Chrome", ao.cylinder, at(0, -0.25, 0.205), at(0, -0.25, 0.25), 0.066, rb=0.07, segs=16, smooth=True)
    s.add("Chrome", ao.cylinder, at(0, -0.25, 0.18), at(0, -0.25, 0.205), 0.018, segs=10, smooth=True)
    s.add("Dark", ao.limb, at(0, -0.3, 0.225), at(0.06, -0.47, 0.205), 0.024, 0.03, segs=10, rings=8, smooth=True)
    # A cup of espresso on the drip tray, under the spout.
    cup = at(0, -0.25, 0.086)
    s.add("White", ao.lathe, [(0, 0), (0.034, 0), (0.044, 0.016), (0.048, 0.07), (0.041, 0.07), (0.041, 0.058), (0, 0.058)],
          center=cup, segs=14, smooth=True)
    s.add("Dark", ao.cylinder, offset(cup, (0, 0, 0.058)), offset(cup, (0, 0, 0.061)), 0.041, segs=14)
    s.add("White", ao.torus, offset(cup, (0.054, 0, 0.036)), 0.02, 0.007, rot=(math.pi / 2, 0, 0), n=14, m=6, smooth=True)
    # Knobs on both sides, and the steam wand coming down on the right (its -X side).
    for sx in (-1, 1):
        s.add("Dark", ao.cylinder, at(sx * 0.255, -0.06, 0.5), at(sx * 0.3, -0.06, 0.5), 0.034, segs=12, smooth=True)
    s.add("Chrome", ao.ellipsoid, at(-0.215, -0.18, 0.4), (0.024, 0.024, 0.024), segs=10, rings=6, smooth=True)
    s.add("Chrome", tube, [at(-0.215, -0.18, 0.4), at(-0.26, -0.2, 0.385), at(-0.285, -0.215, 0.34), at(-0.292, -0.225, 0.26),
                           at(-0.295, -0.23, 0.17)], 0.012, segs=8, smooth=True)
    # The cup warmer on top: a chrome rail on four posts, and two cups upside down on it.
    top = 0.61
    corners = [(-0.21, -0.12), (0.21, -0.12), (0.21, 0.2), (-0.21, 0.2)]
    for (x0, y0), (x1, y1) in zip(corners, corners[1:] + corners[:1]):
        s.add("Chrome", ao.cylinder, at(x0, y0, top + 0.055), at(x1, y1, top + 0.055), 0.01, segs=8, smooth=True)
    for x, y in corners:
        s.add("Chrome", ao.cylinder, at(x, y, top - 0.01), at(x, y, top + 0.055), 0.009, segs=8, smooth=True)
        s.add("Chrome", ao.ellipsoid, at(x, y, top + 0.055), (0.014, 0.014, 0.014), segs=8, rings=4, smooth=True)
    for x, y in ((-0.08, 0.0), (0.09, 0.07)):
        s.add("White", ao.cylinder, at(x, y, top - 0.005), at(x, y, top + 0.07), 0.046, rb=0.038, segs=14, smooth=True)
    return s.finish("coffee_machine", MACHINE_AT)


# ---- The fridge -----------------------------------------------------------------------------------
#
# A retro one, all soft corners: a round-shouldered body on chrome legs, a freezer door over the big
# one with chunky chrome handles on the counter's side, a chrome badge, and notes and magnets stuck on.

def fridge():
    s = Shapes()
    at = lambda *p: offset(FRIDGE_AT, p)
    w, d, h = FRIDGE
    for x in (-0.4, 0.4):
        for y in (-0.3, 0.38):
            s.add("Chrome", ao.cylinder, at(x, y, 0), at(x, y, 0.11), 0.034, rb=0.026, segs=10, smooth=True)
    # The body stops short of the front; the doors make up the rest of its depth.
    s.add("Fridge", slab, rounded_rect(-w / 2, w / 2, 0.1, h, 0.06, 0.3), 0.9, at(0, 0.05, 0), bevel=0.03, smooth=not_facing_y)
    s.add("Fridge", slab, rounded_rect(-w / 2 + 0.03, w / 2 - 0.03, 1.65, h - 0.03, 0.04, 0.27), 0.06, at(0, -0.43, 0),
          bevel=0.022, smooth=not_facing_y)
    s.add("Fridge", slab, rounded_rect(-w / 2 + 0.03, w / 2 - 0.03, 0.14, 1.61, 0.05, 0.05), 0.06, at(0, -0.43, 0),
          bevel=0.022, smooth=not_facing_y)
    face = -0.46
    for z0, z1 in ((1.2, 1.55), (1.71, 1.92)):
        s.add("Chrome", ao.limb, at(0.4, face - 0.065, z0), at(0.4, face - 0.065, z1), 0.022, 0.022, segs=10, rings=8, smooth=True)
        for z in (z0 + 0.04, z1 - 0.04):
            s.add("Chrome", ao.cylinder, at(0.4, face + 0.005, z), at(0.4, face - 0.06, z), 0.015, segs=8, smooth=True)
    s.add("Chrome", ao.ellipsoid, at(-0.05, face - 0.004, 1.99), (0.14, 0.012, 0.035), segs=14, rings=6, smooth=True)
    # Notes, each held up by a magnet, and a few more magnets.
    for mat, (x, z), (nw, nh), tilt, magnet in (("Note", (-0.2, 1.27), (0.21, 0.21), 0.14, "Red"),
                                                ("Memo", (0.08, 0.84), (0.25, 0.31), -0.1, "Note")):
        s.add(mat, ao.box, at(x, face - 0.002, z), (nw, 0.01, nh), rot=(0, tilt, 0))
        mx, mz = x + math.sin(tilt) * (nh / 2 - 0.03), z + math.cos(tilt) * (nh / 2 - 0.03)
        s.add(magnet, ao.ellipsoid, at(mx, face - 0.012, mz), (0.036, 0.016, 0.036), segs=10, rings=6, smooth=True)
    for mat, (x, z) in (("Red", (-0.3, 0.52)), ("Memo", (0.3, 0.4)), ("Note", (-0.02, 1.5))):
        s.add(mat, ao.ellipsoid, at(x, face - 0.008, z), (0.04, 0.018, 0.04), segs=10, rings=6, smooth=True)
    return s.finish("fridge", FRIDGE_AT)


def main(write=True):
    ao.clear()
    obs = [counter(), machine(), fridge()]
    for ob in obs:
        print(f"{ob.name}: {ao.tris(ob)} tris, {len(ob.data.materials)} materials")
    if write:
        ao.export("kitchen")
    return obs


def sheet(name, shots, **kw):
    """Review renders side by side: `shots` is [view]."""
    return ao.sheet(name, [(None, view) for view in shots], **kw)


if __name__ == "__main__" and bpy.app.background:
    main()
    if "--shots" in ao.args():
        print("sheet:", sheet("kitchen", ["tq", "front", "side", "top"], target=(-0.7, 0, 0.9), dist=11))
        print("sheet:", sheet("kitchen_machine", ["tq", "front", "side", (-0.9, -1.0, 0.5)], target=offset(MACHINE_AT, (0, -0.1, 0.33)), dist=1.9))
        print("sheet:", sheet("kitchen_fridge", ["tq", "front", (-1.0, 0.0, 0.12), (-0.9, -1.0, 0.3)], target=offset(FRIDGE_AT, (0, 0, 1.15)), dist=4.6))
