import * as THREE from 'three';
import type { PropConfig } from '../../../shared/maps';
import { PROP_SIZE, type PropKind } from '../../../shared/maps/props';
import { buildGong } from '../../features/gong/world';
import type { Interactable } from '../types';
import { canvasTexture } from '../texture';
import { mesh, roundedBox, textPlane, toon, toonUnique } from '../toon';
import { fireLight, flame } from './fire';
import { TABLE_TOP, collide, type Kit } from './kit';
import { archBand, archPane, archRise, box, rod } from './shapes';
import { paintBanner, roseGlass, stainedGlass } from './textures';

// The props a castle-style map places (see shared/maps/props.ts): pillars and the arcade between
// them, torches, braziers and chandeliers, banners, windows, statues, armor, the hearth, the ale casks
// and the rest, each put up by its entry in PROPS.

/** Puts a group at a prop's spot, turned its way: `y` up, or on whatever's underfoot there (the dais). */
function placed(p: PropConfig, y = p.y ?? 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(p.x, y, p.z);
  g.rotation.y = p.rotY ?? 0;
  return g;
}

function pillar(kit: Kit, p: PropConfig) {
  const s = p.scale ?? 1;
  const w = PROP_SIZE.pillar * s;
  const H = kit.height;
  const g = placed(p, 0);
  const { stone, stoneDark } = kit.mats;
  g.add(mesh(box(w, 0.7, w), stoneDark, 0, 0.35, 0));
  g.add(mesh(box(w * 0.86, 0.18, w * 0.86), stoneDark, 0, 0.79, 0));
  // Four shafts clustered round a core, the way a Gothic pier is.
  g.add(mesh(box(w * 0.62, H - 1.9, w * 0.62), stone, 0, 0.7 + (H - 1.9) / 2, 0));
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    g.add(mesh(new THREE.CylinderGeometry(w * 0.17, w * 0.17, H - 1.9, 10), stone, dx * w * 0.31, 0.7 + (H - 1.9) / 2, dz * w * 0.31));
  }
  g.add(mesh(box(w * 1.05, 0.5, w * 1.05), stoneDark, 0, H - 1.0, 0));
  g.add(mesh(box(w * 0.8, 0.5, w * 0.8), stoneDark, 0, H - 0.5, 0));
  kit.still.add(g);
  collide(kit, p.x, p.z, w, w, p.rotY ?? 0, 99);
}

/** Pointed arches between neighbouring pillars along each side (the arcade). */
export function arcade(kit: Kit, pillars: PropConfig[]) {
  const rows = new Map<number, PropConfig[]>();
  for (const p of pillars) {
    const k = Math.round(p.x * 10);
    rows.set(k, [...(rows.get(k) ?? []), p]);
  }
  const H = kit.height;
  for (const row of rows.values()) {
    row.sort((a, b) => a.z - b.z);
    for (let i = 1; i < row.length; i++) {
      const a = row[i - 1];
      const b = row[i];
      const gap = b.z - a.z;
      const w = PROP_SIZE.pillar * Math.max(a.scale ?? 1, b.scale ?? 1);
      if (gap > 9 || gap < w + 1) continue;
      const span = gap - w * 0.9;
      const rise = archRise(span, span * 0.8, 0.45);
      const spring = Math.max(2.5, H - 1.25 - rise);
      const arch = mesh(archBand(span, 0.45, w * 0.55), kit.mats.stone, 0, 0, 0);
      arch.position.set(a.x, spring, (a.z + b.z) / 2);
      arch.rotation.y = Math.PI / 2;
      kit.still.add(arch);
      // The wall over the arch, up to the beam the roof trusses sit on.
      kit.still.add(mesh(box(w * 0.5, 0.5, gap), kit.mats.stoneDark, a.x, H - 0.25, (a.z + b.z) / 2));
    }
  }
}

export function torch(kit: Kit, p: PropConfig) {
  const y = p.y ?? 2.7;
  const g = placed(p, y);
  const { iron, woodDark } = kit.mats;
  // An iron bracket on the wall, the torch leaning out of its cup.
  g.add(mesh(box(0.22, 0.34, 0.06), iron, 0, 0, 0.03));
  const arm = mesh(box(0.05, 0.05, 0.36), iron, 0, -0.08, 0.2);
  g.add(arm);
  g.add(mesh(new THREE.CylinderGeometry(0.1, 0.06, 0.16, 8), iron, 0, 0.02, 0.36));
  const stick = mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.62, 6), woodDark, 0, 0.26, 0.4);
  stick.rotation.x = 0.25;
  g.add(stick);
  kit.group.add(g);
  flame(kit, g, 0, 0.56, 0.48, 0.34);
  g.updateMatrixWorld(true);
  if (p.light) {
    const at = g.localToWorld(new THREE.Vector3(0, 0.8, 0.7));
    fireLight(kit, kit.group, at.x, at.y, at.z, 16);
  }
}

function brazier(kit: Kit, p: PropConfig) {
  const s = p.scale ?? 1;
  const g = placed(p, kit.floorAt(p.x, p.z));
  g.scale.setScalar(s);
  const { iron } = kit.mats;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.05, 6), iron, Math.sin(a) * 0.26, 0.5, Math.cos(a) * 0.26);
    leg.rotation.set(Math.cos(a) * 0.22, 0, -Math.sin(a) * 0.22);
    g.add(leg);
  }
  const bowl = new THREE.LatheGeometry(
    [
      [0.05, 0],
      [0.38, 0.08],
      [0.55, 0.3],
      [0.58, 0.34],
    ].map(([r, y]) => new THREE.Vector2(r, y)),
    16,
  );
  g.add(mesh(bowl, iron, 0, 0.95, 0));
  g.add(mesh(new THREE.TorusGeometry(0.57, 0.035, 6, 20).rotateX(Math.PI / 2), kit.mats.gold, 0, 1.28, 0, false));
  g.add(mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.08, 14), toon('#3a1f14', { emissive: '#7a2a0a' }), 0, 1.2, 0, false));
  kit.group.add(g);
  flame(kit, g, 0, 1.2, 0, 0.62);
  flame(kit, g, 0.2, 1.2, 0.12, 0.38);
  flame(kit, g, -0.18, 1.2, -0.1, 0.42);
  if (p.light) fireLight(kit, kit.group, p.x, g.position.y + 2.3 * s, p.z, 30);
  kit.colliders.push({ minX: p.x - 0.5 * s, maxX: p.x + 0.5 * s, minZ: p.z - 0.5 * s, maxZ: p.z + 0.5 * s, top: g.position.y + 1.3 * s, fence: true });
}

function chandelier(kit: Kit, p: PropConfig) {
  const y = p.y ?? kit.height - 4;
  const g = placed(p, y);
  const { iron, candle } = kit.mats;
  const R = 1.35 * (p.scale ?? 1);
  g.add(mesh(new THREE.TorusGeometry(R, 0.06, 6, 28).rotateX(Math.PI / 2), iron, 0, 0, 0));
  g.add(mesh(new THREE.TorusGeometry(R * 0.45, 0.04, 6, 20).rotateX(Math.PI / 2), iron, 0, -0.35, 0));
  // Three chains up to a ring, and one from there up to the roof.
  const up = kit.height + 1 - y;
  const hub = new THREE.Vector3(0, 1.4, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    g.add(rod(new THREE.Vector3(Math.sin(a) * R, 0, Math.cos(a) * R), hub, 0.018, iron));
  }
  g.add(rod(hub, new THREE.Vector3(0, up, 0), 0.03, iron));
  kit.group.add(g);
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.sin(a) * R;
    const z = Math.cos(a) * R;
    g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6), candle, x, 0.18, z, false));
    flame(kit, g, x, 0.34, z, 0.11);
  }
}

function banner(kit: Kit, p: PropConfig, color: string) {
  const w = p.width ?? 1.2;
  const h = p.height ?? 4;
  const g = placed(p, p.y ?? kit.height - 2);
  const great = w >= 3;
  const pw = 256;
  const ph = Math.min(2048, Math.max(64, Math.round((256 * h) / w)));
  const tex = canvasTexture(pw, ph, (c) => paintBanner(c, pw, ph, color));
  kit.banners.push({ tex, w: pw, h: ph, great });
  // Cut to a swallowtail at the foot.
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, -h);
  s.lineTo(0, -h + w * 0.45);
  s.lineTo(-w / 2, -h);
  s.closePath();
  const geo = new THREE.ShapeGeometry(s);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + w / 2) / w, 1 + pos.getY(i) / h);
  const cloth = new THREE.MeshToonMaterial({ map: tex, side: THREE.DoubleSide, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });
  g.add(mesh(geo, cloth, 0, 0, 0.08, false));
  // The pole it hangs from, with a gold knob either end.
  g.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, w + 0.4, 8).rotateZ(Math.PI / 2), kit.mats.woodDark, 0, 0.05, 0.1, false));
  for (const sx of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.08, 8, 6), kit.mats.gold, sx * (w / 2 + 0.22), 0.05, 0.1, false));
  kit.group.add(g);
}

function glassWindow(kit: Kit, p: PropConfig, seed: number) {
  const w = p.width ?? 2.2;
  const h = p.height ?? 5;
  const g = placed(p, p.y ?? 6);
  // The picture's as tall as the window is for its width, within reason.
  const th = Math.min(1024, Math.max(64, Math.round((256 * h) / w)));
  const tex = canvasTexture(256, th, stainedGlass(seed, 256, th));
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  mat.userData.outlineParameters = { visible: false };
  kit.glass.push(mat);
  g.add(mesh(archPane(w, h), mat, 0, 0, 0.02, false));
  // A stone frame round it: the jambs, the sill, and the arch over it.
  const r = w * 0.85;
  const rise = archRise(w, r);
  const { stoneDark } = kit.mats;
  for (const sx of [-1, 1]) g.add(mesh(box(0.28, h - rise, 0.3), stoneDark, sx * (w / 2 + 0.14), (h - rise) / 2, 0.05));
  g.add(mesh(box(w + 0.7, 0.25, 0.45), stoneDark, 0, -0.12, 0.12));
  g.add(mesh(archBand(w, 0.28, 0.3, r), stoneDark, 0, h - rise, 0.05));
  // A mullion down the middle.
  g.add(mesh(box(0.09, h - rise * 0.6, 0.12), stoneDark, 0, (h - rise * 0.6) / 2, 0.06, false));
  // Not merged with the stonework: the glass keeps its picture's coordinates that way.
  kit.group.add(g);
}

function rose(kit: Kit, p: PropConfig) {
  const d = p.width ?? 4.5;
  const g = placed(p, p.y ?? kit.height - 3);
  const mat = new THREE.MeshBasicMaterial({ map: canvasTexture(512, 512, roseGlass), toneMapped: false });
  mat.userData.outlineParameters = { visible: false };
  kit.glass.push(mat);
  g.add(mesh(new THREE.CircleGeometry(d / 2, 40), mat, 0, 0, 0.03, false));
  g.add(mesh(new THREE.TorusGeometry(d / 2 + 0.1, 0.22, 8, 40), kit.mats.stoneDark, 0, 0, 0.08));
  for (let i = 0; i < 8; i++) {
    const spoke = mesh(box(0.1, d - 0.2, 0.1), kit.mats.stoneDark, 0, 0, 0.07, false);
    spoke.rotation.z = (i / 8) * Math.PI;
    g.add(spoke);
  }
  kit.group.add(g);
}

function carpet(kit: Kit, p: PropConfig) {
  const w = p.width ?? 3;
  const l = p.length ?? 10;
  const g = placed(p, kit.floorAt(p.x, p.z));
  g.add(mesh(box(w, 0.025, l), kit.mats.carpet, 0, 0.013, 0, false));
  for (const sx of [-1, 1]) g.add(mesh(box(0.14, 0.03, l), kit.mats.gold, sx * (w / 2 - 0.2), 0.016, 0, false));
  kit.still.add(g);
}

/** A knight in pale stone on a plinth, leaning on a sword. */
function statue(kit: Kit, p: PropConfig) {
  const s = p.scale ?? 1;
  const g = placed(p, kit.floorAt(p.x, p.z));
  g.scale.setScalar(s);
  const pale = toon('#c9c2b4');
  const plinth = kit.mats.stoneDark;
  g.add(mesh(box(1.3, 1.0, 1.3), plinth, 0, 0.5, 0));
  g.add(mesh(box(1.45, 0.15, 1.45), plinth, 0, 1.07, 0));
  for (const sx of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.95, 8), pale, sx * 0.16, 1.62, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.34, 0.26, 0.95, 10), pale, 0, 2.55, 0));
  for (const sx of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.17, 10, 8), pale, sx * 0.36, 2.95, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.4, 12), pale, 0, 3.28, 0));
  g.add(mesh(new THREE.SphereGeometry(0.21, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), pale, 0, 3.45, 0));
  g.add(mesh(box(0.28, 0.035, 0.05), toon('#6e675c'), 0, 3.3, 0.2, false));
  // Both hands on the pommel of a sword stood point down in front of it.
  g.add(mesh(box(0.1, 1.15, 0.03), pale, 0, 1.75, 0.36));
  g.add(mesh(box(0.5, 0.07, 0.07), pale, 0, 2.35, 0.36));
  g.add(mesh(new THREE.SphereGeometry(0.08, 8, 6), pale, 0, 2.55, 0.36));
  for (const sx of [-1, 1]) {
    const arm = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 6), pale, sx * 0.22, 2.55, 0.2);
    arm.rotation.set(0.7, 0, -sx * 0.5);
    g.add(arm);
  }
  kit.still.add(g);
  collide(kit, p.x, p.z, PROP_SIZE.statue * s, PROP_SIZE.statue * s, p.rotY ?? 0, 99);
}

function armor(kit: Kit, p: PropConfig) {
  const g = placed(p, kit.floorAt(p.x, p.z));
  const { steel, iron, woodDark } = kit.mats;
  g.add(mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.08, 12), woodDark, 0, 0.04, 0));
  for (const sx of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.9, 8), steel, sx * 0.13, 0.53, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.3, 0.24, 0.8, 10), steel, 0, 1.38, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.12, 10), iron, 0, 1.0, 0));
  for (const sx of [-1, 1]) {
    g.add(mesh(new THREE.SphereGeometry(0.17, 10, 8), steel, sx * 0.36, 1.72, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.62, 6), steel, sx * 0.4, 1.35, 0));
  }
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.21, 0.36, 12), steel, 0, 2.02, 0));
  g.add(mesh(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), steel, 0, 2.18, 0));
  g.add(mesh(box(0.26, 0.035, 0.05), iron, 0, 2.06, 0.19, false));
  g.add(mesh(new THREE.ConeGeometry(0.05, 0.3, 6), toon('#9b1c1c'), 0, 2.45, 0, false));
  // A halberd at its side.
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.7, 6), woodDark, 0.52, 1.35, 0.1));
  g.add(mesh(box(0.05, 0.4, 0.28), steel, 0.52, 2.55, 0.2));
  kit.still.add(g);
  const r = PROP_SIZE.armor;
  kit.colliders.push({ minX: p.x - r, maxX: p.x + r, minZ: p.z - r, maxZ: p.z + r, top: 99 });
}

function shield(kit: Kit, p: PropConfig) {
  const g = placed(p, p.y ?? 3.5);
  const s = new THREE.Shape();
  s.moveTo(-0.5, 0.5);
  s.lineTo(0.5, 0.5);
  s.quadraticCurveTo(0.5, -0.3, 0, -0.75);
  s.quadraticCurveTo(-0.5, -0.3, -0.5, 0.5);
  const field = toonUnique('#9b1c1c');
  kit.shields.push(field);
  g.add(mesh(new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: false }), field, 0, 0, 0.12));
  g.add(mesh(box(0.16, 1.05, 0.02), kit.mats.gold, 0, -0.1, 0.19, false));
  g.add(mesh(box(0.8, 0.16, 0.02), kit.mats.gold, 0, 0.15, 0.19, false));
  // Two swords crossed behind it.
  for (const sx of [-1, 1]) {
    const sword = new THREE.Group();
    sword.add(mesh(box(0.08, 1.6, 0.02), kit.mats.steel, 0, 0.1, 0, false));
    sword.add(mesh(box(0.34, 0.06, 0.05), kit.mats.gold, 0, -0.7, 0, false));
    sword.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.25, 6), kit.mats.woodDark, 0, -0.85, 0, false));
    sword.position.set(0, -0.1, 0.06);
    sword.rotation.z = sx * 0.75;
    g.add(sword);
  }
  kit.group.add(g);
}

function hearth(kit: Kit, p: PropConfig) {
  const s = p.scale ?? 1;
  const w = (p.width ?? PROP_SIZE.hearth.width) * s;
  const d = PROP_SIZE.hearth.depth * s;
  const at = placed(p, 0);
  // Built from its back (against the wall) out; its spot is its middle.
  const g = new THREE.Group();
  g.position.z = -d / 2;
  at.add(g);
  const { stoneDark, stone, woodDark } = kit.mats;
  g.add(mesh(box(w, 2.6, 0.25), toon('#2a211c'), 0, 1.3, 0.12));
  for (const sx of [-1, 1]) g.add(mesh(box(0.5, 2.3, d), stoneDark, sx * (w / 2 - 0.25), 1.15, d / 2));
  g.add(mesh(box(w + 0.3, 0.35, d + 0.2), stoneDark, 0, 2.45, d / 2 + 0.05));
  g.add(mesh(box(w + 0.1, 0.15, d + 0.1), woodDark, 0, 2.7, d / 2 + 0.05));
  // The hood, tapering up to the roof.
  const hood = mesh(new THREE.CylinderGeometry(w * 0.32, w * 0.55, kit.height - 2.8, 4, 1), stone, 0, 2.8 + (kit.height - 2.8) / 2, d * 0.3);
  hood.rotation.y = Math.PI / 4;
  hood.scale.z = 0.45;
  g.add(hood);
  g.add(mesh(box(w - 0.8, 0.1, d - 0.2), toon('#3a1f14', { emissive: '#5a1a05' }), 0, 0.05, d / 2, false));
  for (const [x, rz] of [
    [-0.3, 0.2],
    [0.25, -0.25],
    [0, 0],
  ]) {
    const log = mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.1, 8), woodDark, x, 0.18, d / 2);
    log.rotation.set(0, rz, Math.PI / 2);
    g.add(log);
  }
  kit.group.add(at);
  flame(kit, g, 0, 0.2, d / 2, 0.75);
  flame(kit, g, -0.35, 0.2, d / 2 + 0.1, 0.5);
  flame(kit, g, 0.35, 0.2, d / 2 - 0.05, 0.55);
  at.updateMatrixWorld(true);
  if (p.light) {
    const lit = g.localToWorld(new THREE.Vector3(0, 1.1, d + 0.6));
    fireLight(kit, kit.group, lit.x, lit.y, lit.z, 34);
  }
  collide(kit, p.x, p.z, w, d, p.rotY ?? 0, 99);
}

function cask(kit: Kit, p: PropConfig): Interactable {
  const s = p.scale ?? 1;
  const g = placed(p, kit.floorAt(p.x, p.z));
  g.scale.setScalar(s);
  const { woodDark, iron, wood } = kit.mats;
  g.add(mesh(box(1.7, 0.12, 0.9), woodDark, 0, 0.3, 0));
  for (const sx of [-0.6, 0.6]) g.add(mesh(box(0.12, 0.3, 0.9), woodDark, sx, 0.15, 0));
  for (const [x, y, r] of [
    [-0.42, 0.72, 0.36],
    [0.42, 0.72, 0.36],
    [0, 1.33, 0.32],
  ]) {
    const barrel = new THREE.Group();
    barrel.add(mesh(new THREE.CylinderGeometry(r, r, 0.85, 14).rotateX(Math.PI / 2), wood, 0, 0, 0));
    for (const bz of [-0.3, 0, 0.3]) barrel.add(mesh(new THREE.TorusGeometry(r + 0.01, 0.022, 5, 18), iron, 0, 0, bz, false));
    barrel.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 6).rotateX(Math.PI / 2), iron, 0, -r * 0.4, 0.46, false));
    barrel.position.set(x, y, 0);
    g.add(barrel);
  }
  // Tankards on the rack.
  for (const x of [-0.72, 0.72]) g.add(mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.18, 10), toon('#8d939c'), x, 1.0, 0.25, false));
  const sign = textPlane('🍺 Ale', { bg: '#efe3c2', size: 48 });
  sign.scale.multiplyScalar(0.55);
  sign.position.set(0, 1.85, 0.2);
  g.add(sign);
  kit.group.add(g);
  const r = p.rotY ?? 0;
  collide(kit, p.x, p.z, PROP_SIZE.cask.width * s, PROP_SIZE.cask.depth * s, r, g.position.y + 1.6 * s);
  const it: Interactable = { kind: 'coffee', label: '🍺 Ale casks', x: p.x + Math.sin(r) * 1.1, y: g.position.y, z: p.z + Math.cos(r) * 1.1, radius: 1.5 };
  g.userData.interact = it;
  return it;
}

function plainTable(kit: Kit, p: PropConfig) {
  const w = p.width ?? 1.4;
  const l = p.length ?? 3;
  const g = placed(p, kit.floorAt(p.x, p.z));
  g.add(mesh(roundedBox(w, 0.1, l, 0.05), kit.mats.wood, 0, TABLE_TOP - 0.05, 0));
  for (const sz of [-1, 1]) g.add(mesh(box(w - 0.2, TABLE_TOP - 0.1, 0.12), kit.mats.woodDark, 0, (TABLE_TOP - 0.1) / 2, sz * (l / 2 - 0.3)));
  kit.still.add(g);
  collide(kit, p.x, p.z, w, l, p.rotY ?? 0, g.position.y + TABLE_TOP);
}

function candles(kit: Kit, p: PropConfig) {
  const g = placed(p, kit.floorAt(p.x, p.z));
  const { iron, candle } = kit.mats;
  g.add(mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.06, 10), iron, 0, 0.03, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 6), iron, 0, 0.83, 0));
  g.add(mesh(box(0.7, 0.04, 0.04), iron, 0, 1.6, 0, false));
  kit.group.add(g);
  for (const x of [-0.33, 0, 0.33]) {
    const y = x ? 1.62 : 1.66;
    g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.26, 6), candle, x, y + 0.13, 0, false));
    flame(kit, g, x, y + 0.27, 0, 0.1);
  }
  kit.colliders.push({ minX: p.x - 0.25, maxX: p.x + 0.25, minZ: p.z - 0.25, maxZ: p.z + 0.25, top: 99 });
}

/** Each kind of prop, put up (every kind there is has one: see PROP_KINDS). */
export const PROPS: Record<PropKind, (kit: Kit, p: PropConfig) => void> = {
  pillar,
  torch,
  brazier,
  chandelier,
  banner: (kit, p) => banner(kit, p, '#9b1c1c'),
  window: (kit, p) => glassWindow(kit, p, kit.windows++),
  rose,
  carpet,
  statue,
  armor,
  shield,
  hearth,
  gong: (kit, p) => {
    const gong = buildGong({ x: p.x, y: kit.floorAt(p.x, p.z), z: p.z, rotY: p.rotY ?? 0 });
    kit.group.add(gong.group);
    kit.colliders.push(...gong.colliders);
    kit.interactables.push(gong.interactable);
    kit.gong = gong;
  },
  cask: (kit, p) => kit.interactables.push(cask(kit, p)),
  table: plainTable,
  candles,
};
