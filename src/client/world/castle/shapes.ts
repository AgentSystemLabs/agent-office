import * as THREE from 'three';
import { mesh } from '../toon';

// The shapes the hall is cut from: pointed arches (for the arcade, the doorway and the windows),
// boxes and rods.

/**
 * A pointed arch's outline, `span` across at its feet (y 0), made of two arcs of radius `r` (at
 * least span / 2; the bigger, the pointier), grown outward by `grow`.
 */
export function archPath(shape: THREE.Shape | THREE.Path, span: number, r: number, grow: number, reverse = false) {
  const cxL = -span / 2 + r;
  const cxR = span / 2 - r;
  const R = r + grow;
  // Where the left arc (round its center right of the middle) reaches the middle, at the point.
  const apex = Math.acos((span / 2 - r) / R);
  if (!reverse) {
    // Up the left arc from its foot to the point, then down the right one to its foot.
    shape.absarc(cxL, 0, R, Math.PI, apex, true);
    shape.absarc(cxR, 0, R, Math.PI - apex, 0, true);
  } else {
    shape.absarc(cxR, 0, R, 0, Math.PI - apex, false);
    shape.absarc(cxL, 0, R, apex, Math.PI, false);
  }
}

/** The apex height of a pointed arch (see archPath). */
export function archRise(span: number, r: number, grow = 0): number {
  const d = r - span / 2;
  return Math.sqrt(Math.max(0, (r + grow) ** 2 - d * d));
}

/** A band of stone following a pointed arch: `span` wide inside, `band` thick, `depth` deep (along z), feet at y 0. */
export function archBand(span: number, band: number, depth: number, r = span * 0.8): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-span / 2 - band, 0);
  archPath(s, span, r, band);
  s.lineTo(span / 2, 0);
  archPath(s, span, r, 0, true);
  s.lineTo(-span / 2 - band, 0);
  const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 10 });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

/** A slab `width` wide and `height` high with a pointed arch `span` wide cut out of its foot: the stone over a doorway. */
export function archFill(width: number, height: number, span: number, depth: number, r: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-width / 2, 0);
  s.lineTo(-span / 2, 0);
  archPath(s, span, r, 0);
  s.lineTo(width / 2, 0);
  s.lineTo(width / 2, height);
  s.lineTo(-width / 2, height);
  s.lineTo(-width / 2, 0);
  const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 10 });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

/** A flat pointed-arch window pane, `w` wide and `h` high to its point, with UVs over its bounding box. */
export function archPane(w: number, h: number): THREE.ShapeGeometry {
  const r = w * 0.85;
  const rise = archRise(w, r);
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(-w / 2, h - rise);
  // Up the arch, using a shape of its own, then shifted up onto the jambs.
  const top = new THREE.Shape();
  top.moveTo(-w / 2, 0);
  archPath(top, w, r, 0);
  const pts = top.getPoints(10).map((v) => new THREE.Vector2(v.x, v.y + h - rise));
  for (const v of pts.slice(1)) s.lineTo(v.x, v.y);
  s.lineTo(w / 2, 0);
  s.lineTo(-w / 2, 0);
  const geo = new THREE.ShapeGeometry(s, 10);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + w / 2) / w, pos.getY(i) / h);
  return geo;
}

export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/** A thin rod from `a` to `b` (a chain, a pole). */
export function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const along = b.clone().sub(a);
  const m = mesh(new THREE.CylinderGeometry(r, r, along.length(), 5), mat, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, false);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), along.normalize());
  return m;
}
