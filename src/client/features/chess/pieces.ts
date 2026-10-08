import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvasTexture } from '../../world/texture';

// The chessmen: Staunton pieces turned on a lathe (a profile spun round, as a woodturner makes them), the
// knight's head cut from a flat silhouette and rounded off. Drawn for a board with 0.08 m squares
// (a king 0.12 m tall, a pawn 0.065), and scaled to the board's (see ChessTableView).

/** What a piece looks like, by FEN letter (case ignored). */
export type PieceKind = 'p' | 'r' | 'n' | 'b' | 'q' | 'k';

/** The squares the pieces are drawn for (meters); a board with bigger ones scales them up. */
export const PIECE_SQUARE = 0.08;

type Profile = [number, number][];

/** A quarter-turn-ish arc of a ball: points (radius from the axis, height) round a circle at height `cy`, from angle `a0` to `a1` (degrees, 0 out, 90 up). */
function ball(radius: number, cy: number, a0: number, a1: number, steps = 10, cx = 0): Profile {
  const out: Profile = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((a0 + ((a1 - a0) * i) / steps) * Math.PI) / 180;
    out.push([Math.max(0, cx + radius * Math.cos(a)), cy + radius * Math.sin(a)]);
  }
  return out;
}

/** The same, squashed or stretched: `ry` tall where `rx` is wide. */
const ellipse = (rx: number, ry: number, cy: number, a0: number, a1: number, steps = 12): Profile => ball(1, 0, a0, a1, steps).map(([r, y]) => [r * rx, cy + y * ry]);

/** The part of a profile above `from`, moved up `dy`: a longer stem. */
const lift = (p: Profile, dy: number, from = 0.03): Profile => p.map(([r, y]) => [r, y > from ? y + dy : y]);

/** A flat foot with a rounded rim, `r` wide: the base all of them stand on. */
const foot = (r: number): Profile => [[0, 0], [r, 0], [r, 0.0035], [r - 0.0022, 0.0066], [r - 0.0062, 0.0092]];

/** Turned on a lathe: the profile spun `segments` times round the axis. */
function turn(profile: Profile, segments = 28): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
  return g;
}

const sphere = (r: number, x: number, y: number, z: number) => new THREE.SphereGeometry(r, 12, 8).translate(x, y, z);
const bar = (w: number, h: number, d: number, x: number, y: number, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

/** A rook's battlements: `n` blocks of a ring, `h` tall from `y`, with a gap the width of about half a block between them. */
function crenellations(r0: number, r1: number, y: number, h: number, n = 6): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const span = (Math.PI * 2) / n;
  for (let i = 0; i < n; i++) {
    const a0 = i * span;
    const a1 = a0 + span * 0.62;
    const s = new THREE.Shape();
    s.absarc(0, 0, r0, a0, a1, false);
    s.absarc(0, 0, r1, a1, a0, true);
    s.closePath();
    // Extruded along z, then stood up so z is up.
    parts.push(new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 4 }).rotateX(-Math.PI / 2).translate(0, y, 0));
  }
  return mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
}

/** The knight's head: a horse's, in profile (looking along +x), thickened and rounded, standing on a base of its own. */
function knightHead(): THREE.BufferGeometry {
  const outline: [number, number][] = [
    [-0.0165, 0.0225], [-0.0175, 0.035], [-0.016, 0.05], [-0.0135, 0.062], [-0.01, 0.071], [-0.006, 0.079], [-0.004, 0.084], [-0.0005, 0.083],
    [0.001, 0.077], [0.0045, 0.0765], [0.009, 0.0735], [0.015, 0.0645], [0.0215, 0.0545], [0.0255, 0.0475], [0.0262, 0.043], [0.0225, 0.0405],
    [0.016, 0.0425], [0.011, 0.044], [0.0085, 0.041], [0.0105, 0.033], [0.016, 0.026], [0.015, 0.0222],
  ];
  const curve = new THREE.CatmullRomCurve3(outline.map(([x, y]) => new THREE.Vector3(x, y, 0)), true, 'centripetal');
  const shape = new THREE.Shape(curve.getPoints(90).map((p) => new THREE.Vector2(p.x, p.y)));
  const depth = 0.012;
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.0045, bevelSize: 0.0035, bevelSegments: 3, curveSegments: 1 });
  g.translate(0, 0, -depth / 2);
  // The grain runs up the neck: its texture is laid on by height, across by depth.
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getZ(i) + 0.02) * 12 + pos.getX(i) * 4;
    uv[i * 2 + 1] = pos.getY(i) * 9;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** What a piece is made of: its wood, and the dark bits (a knight's eye, the slit in a bishop's mitre). */
export interface PieceParts {
  wood: THREE.BufferGeometry;
  ink?: THREE.BufferGeometry;
}

const merge = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;

const CACHE = new Map<PieceKind, PieceParts>();

/** The pieces' shapes, made once. Standing on y = 0, round the origin, a knight looking along +x. */
export function pieceParts(kind: PieceKind): PieceParts {
  const hit = CACHE.get(kind);
  if (hit) return hit;
  let parts: PieceParts;
  switch (kind) {
    case 'p':
      parts = {
        wood: turn([...foot(0.0215), [0.012, 0.0115], [0.01, 0.0175], [0.0088, 0.026], [0.0088, 0.031], [0.0125, 0.0325], [0.0125, 0.0355], [0.01, 0.0375], [0.0078, 0.039], ...ball(0.0135, 0.0505, -55, 90)]),
      };
      break;
    case 'r':
      parts = {
        wood: merge([
          turn([...foot(0.0255), [0.015, 0.014], [0.0132, 0.023], [0.0132, 0.032], [0.016, 0.0345], [0.02, 0.04], [0.0205, 0.047], [0.0235, 0.0485], [0.0235, 0.0525], [0.0165, 0.0525], [0, 0.0525]]),
          crenellations(0.0235, 0.0165, 0.0525, 0.0205),
        ]),
      };
      break;
    case 'n':
      parts = {
        wood: merge([turn([...foot(0.0255), [0.015, 0.014], [0.014, 0.019], [0.017, 0.0215], [0.017, 0.0235], [0, 0.0235]]), knightHead()]),
        // An eye on each side of the head.
        ink: merge([sphere(0.0026, 0.0092, 0.0665, 0.0104), sphere(0.0026, 0.0092, 0.0665, -0.0104)]),
      };
      break;
    case 'b':
      parts = {
        wood: merge([
          turn([...foot(0.0245), [0.0125, 0.014], [0.01, 0.024], [0.009, 0.034], [0.014, 0.0355], [0.014, 0.0385], [0.0095, 0.0405], [0.0085, 0.0415], ...ellipse(0.0152, 0.022, 0.06, -60, 72, 14), [0.003, 0.083]]),
          sphere(0.005, 0, 0.0855, 0),
        ]),
        // The slit across the mitre.
        ink: bar(0.036, 0.0032, 0.016, 0, 0.062, 0.003).rotateX(-0.85),
      };
      break;
    case 'q':
      parts = {
        wood: merge([
          turn(lift([...foot(0.0275), [0.014, 0.015], [0.0108, 0.026], [0.0092, 0.04], [0.0088, 0.05], [0.014, 0.0515], [0.014, 0.0545], [0.01, 0.0565], [0.0105, 0.0585], [0.017, 0.068], [0.0235, 0.08], [0.0248, 0.0845], [0.021, 0.0858], [0.0165, 0.0848], [0.0125, 0.0866], [0, 0.0872]], 0.006)),
          // A crown: a ring of beads on the rim, and an orb on top.
          ...Array.from({ length: 9 }, (_, i) => sphere(0.0043, Math.cos((i / 9) * Math.PI * 2) * 0.0228, 0.0928, Math.sin((i / 9) * Math.PI * 2) * 0.0228)),
          sphere(0.0072, 0, 0.0978, 0),
        ]),
      };
      break;
    case 'k':
      parts = {
        wood: merge([
          turn(lift([...foot(0.0285), [0.0145, 0.015], [0.011, 0.026], [0.0094, 0.042], [0.009, 0.054], [0.0145, 0.0555], [0.0145, 0.0585], [0.0102, 0.0605], [0.0108, 0.0625], [0.0168, 0.072], [0.0232, 0.084], [0.024, 0.0885], [0.0195, 0.09], [0.0125, 0.0895], [0, 0.0895]], 0.003)),
          // The cross.
          bar(0.0058, 0.0285, 0.0058, 0, 0.1065),
          bar(0.0195, 0.0058, 0.0058, 0, 0.111),
        ]),
      };
      break;
  }
  CACHE.set(kind, parts);
  return parts;
}

// ---- Wood ------------------------------------------------------------------------------------------

/** Wood grain: streaks running up the texture, drawn over `base` in `streak`. */
function grain(base: string, streak: string, seed: number): THREE.CanvasTexture {
  return canvasTexture(128, 256, (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, 128, 256);
    g.strokeStyle = streak;
    for (let i = 0; i < 46; i++) {
      const x = ((i * 53 + seed * 17) % 128) + 0.5;
      g.globalAlpha = 0.08 + (((i * 7 + seed) % 5) / 5) * 0.16;
      g.lineWidth = 0.6 + ((i * 3 + seed) % 4) * 0.55;
      g.beginPath();
      g.moveTo(x, 0);
      g.bezierCurveTo(x + 5 * Math.sin(i + seed), 80, x - 6 * Math.cos(i * 2 + seed), 170, x + 2 * Math.sin(i), 256);
      g.stroke();
    }
  });
}

/** The two sets' wood, polished: pale maple for White and dark walnut for Black. */
export function woodMaterials(): Record<'w' | 'b', THREE.MeshStandardMaterial> & { ink: THREE.MeshStandardMaterial } {
  const mat = (map: THREE.Texture, roughness: number) => new THREE.MeshStandardMaterial({ map, roughness, metalness: 0 });
  return {
    w: mat(grain('#ecd7a8', '#b88b4a', 1), 0.36),
    b: mat(grain('#5a3722', '#2a150b', 2), 0.34),
    ink: new THREE.MeshStandardMaterial({ color: '#1d1209', roughness: 0.5, metalness: 0 }),
  };
}

export const pieceKind = (letter: string): PieceKind => letter.toLowerCase() as PieceKind;

/** A piece, standing at the group's origin. The knight looks along +x; turn the group to face it. */
export function makePiece(letter: string, mats: ReturnType<typeof woodMaterials>): THREE.Group {
  const parts = pieceParts(pieceKind(letter));
  const g = new THREE.Group();
  const wood = new THREE.Mesh(parts.wood, letter === letter.toUpperCase() ? mats.w : mats.b);
  wood.castShadow = true;
  wood.receiveShadow = true;
  g.add(wood);
  if (parts.ink) {
    const ink = new THREE.Mesh(parts.ink, mats.ink);
    ink.castShadow = false;
    g.add(ink);
  }
  return g;
}
