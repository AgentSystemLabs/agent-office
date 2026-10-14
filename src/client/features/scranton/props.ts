import * as THREE from 'three';
import { mesh, roundedBox, textPlane, toon } from '../../world/toon';
import { chair } from '../../world/office/seats';
import { point, type Furnishing, type Workstation } from '../../../shared/scranton';

const wood = () => toon('#ad8860');
const metal = () => toon('#555f62');
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

export function plaque(text: string, width: number): THREE.Mesh {
  const label = textPlane(text, { bg: '#f4f0df', color: '#35484c', border: '#a6a99c', size: 42 });
  const factor = width / label.scale.x;
  label.scale.multiplyScalar(factor);
  return label;
}

/** Ordinary mid-2000s desk equipment, with no agent laptop, terminal or hiring marker. */
export function desktop(): THREE.Group {
  const g = new THREE.Group();
  const casing = toon('#dbd8c9');
  g.add(mesh(box(0.48, 0.42, 0.36), casing, 0, 1.03, -0.23));
  g.add(mesh(box(0.43, 0.33, 0.025), toon('#233b3b'), 0, 1.04, -0.025));
  const screen = textPlane('DUNDER MIFFLIN', { color: '#a8c6b7', bg: '#233b3b', size: 32 });
  screen.scale.set(0.4, 0.07, 1);
  screen.position.set(0, 1.02, -0.01);
  g.add(screen);
  g.add(mesh(box(0.36, 0.035, 0.22), casing, 0, 0.79, 0.22));
  for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) g.add(mesh(box(0.03, 0.009, 0.04), toon('#7f837b'), -0.14 + c * 0.04, 0.811, 0.15 + r * 0.065));
  // A desk phone and a small stack of paper.
  g.add(mesh(box(0.23, 0.05, 0.22), toon('#3a4142'), -0.65, 0.81, 0.22));
  g.add(mesh(roundedBox(0.25, 0.06, 0.07, 0.03), toon('#3a4142'), -0.65, 0.86, 0.2));
  g.add(mesh(box(0.25, 0.05, 0.33), toon('#f6f2e4'), 0.65, 0.81, -0.1));
  return g;
}

export function workstation(s: Workstation): THREE.Group {
  const g = new THREE.Group();
  g.name = `scranton-desk-${s.id}`;
  g.position.set(s.desk[0], 0, s.desk[1]);
  g.rotation.y = s.facing - Math.PI;
  g.add(mesh(roundedBox(2.05, 0.08, 1.05, 0.035), wood(), 0, 0.74, 0));
  g.add(mesh(box(0.4, 0.66, 0.86), toon('#a69d8c'), -0.72, 0.35, 0));
  for (const x of [-0.78, 0.78]) g.add(mesh(box(0.055, 0.7, 0.8), metal(), x, 0.35, 0));
  g.add(desktop());
  const tag = plaque(s.id === 'michael' ? 'MICHAEL SCOTT · REGIONAL MANAGER' : s.id.toUpperCase(), 0.7);
  tag.position.set(0.55, 0.89, 0.39);
  g.add(tag);
  if (s.id === 'michael') {
    g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.13, 12), toon('#fafafa'), 0.75, 0.85, 0.24));
    const boss = plaque('WORLD’S BEST BOSS', 0.18);
    boss.position.set(0.75, 0.86, 0.312);
    g.add(boss);
  }
  if (s.id === 'dwight') {
    g.add(mesh(new THREE.SphereGeometry(0.06, 10, 8), toon('#e3b791'), 0.7, 1.0, 0.26));
    g.add(mesh(box(0.07, 0.13, 0.06), toon('#c4a25b'), 0.7, 0.89, 0.26));
  }
  if (s.id === 'angela') {
    const cats = plaque('CATS', 0.25);
    cats.position.set(0.65, 0.96, -0.1);
    g.add(cats);
  }
  const seat = chair('#535d61');
  seat.position.z = 1.15;
  g.add(seat);
  return g;
}

export function furnishing(f: Furnishing): THREE.Group {
  const g = new THREE.Group();
  g.position.set(f.at[0], 0, f.at[1]);
  if (f.kind === 'table') {
    const round = f.width === 1;
    g.add(mesh(round ? new THREE.CylinderGeometry(0.5, 0.5, 0.06, 24) : box(f.width, 0.06, f.depth), wood(), 0, f.height - 0.03, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.07, 0.13, f.height - 0.06, 10), metal(), 0, (f.height - 0.06) / 2, 0));
    for (const dx of [-0.8, 0.8]) {
      const seat = chair('#8c8874');
      seat.position.x = dx;
      seat.rotation.y = dx < 0 ? -Math.PI / 2 : Math.PI / 2;
      g.add(seat);
    }
  } else if (f.kind === 'vending') {
    g.add(mesh(box(f.width, f.height, f.depth), toon('#343e43'), 0, f.height / 2, 0));
    g.add(mesh(box(0.025, 1.1, 0.95), toon('#284f59'), -f.width / 2 - 0.01, 1.1, 0));
    for (let i = 0; i < 4; i++) for (let row = 0; row < 3; row++) g.add(mesh(box(0.035, 0.18, 0.15), toon(['#ce8b57', '#d9bd5a', '#b65850', '#658f68'][i]), -f.width / 2 - 0.035, 0.7 + row * 0.31, -0.36 + i * 0.24));
  } else if (f.kind === 'sofa') {
    g.add(mesh(roundedBox(f.width, 0.4, f.depth, 0.08), toon('#888979'), 0, 0.35, 0));
    g.add(mesh(box(0.15, 0.7, f.depth), toon('#7f816f'), -f.width / 2 + 0.07, 0.58, 0));
  } else {
    g.add(mesh(box(f.width, f.height, f.depth), f.kind === 'counter' ? wood() : toon(f.kind === 'copier' ? '#d9d8cd' : '#bcb8a9'), 0, f.height / 2, 0));
    if (f.kind === 'counter') g.add(mesh(box(f.width + 0.03, 0.045, f.depth + 0.03), toon('#e1ddcf'), 0, f.height + 0.02, 0));
    if (f.kind === 'copier') g.add(mesh(box(0.64, 0.06, 0.7), toon('#454f52'), 0, f.height + 0.03, 0));
    if (f.kind === 'cabinet') for (let y = 0.35; y < f.height; y += 0.35) g.add(mesh(box(f.width * 0.4, 0.02, 0.03), metal(), 0, y, f.depth / 2 + 0.02));
    if (f.kind === 'fridge') g.add(mesh(box(0.035, 0.5, 0.035), metal(), -0.26, 0.95, f.depth / 2 + 0.02));
  }
  return g;
}

export function reception(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'scranton-reception';
  const at = point(2, 6);
  g.position.set(at[0], 0, at[1]);
  const shape = new THREE.Shape();
  shape.absarc(0, 0, 1.65, 0, Math.PI, false);
  shape.absarc(0, 0, 1.14, Math.PI, 0, true);
  shape.closePath();
  const top = new THREE.ExtrudeGeometry(shape, { depth: 0.09, bevelEnabled: false, curveSegments: 24 });
  top.rotateX(Math.PI / 2);
  g.add(mesh(top, wood(), 0, 1.13, 0));
  const front = new THREE.CylinderGeometry(1.58, 1.58, 1.03, 32, 1, true, -Math.PI / 2, Math.PI);
  const finish = toon('#b29972').clone();
  finish.side = THREE.DoubleSide;
  g.add(mesh(front, finish, 0, 0.52, 0));
  const equipment = desktop();
  equipment.position.set(0.1, 0, -0.6);
  g.add(equipment);
  const seat = chair('#596362');
  seat.position.set(0.25, 0, -0.25);
  g.add(seat);
  const sign = plaque('DUNDER MIFFLIN', 2.4);
  sign.position.set(0, 1.4, 1.48);
  g.add(sign);
  return g;
}
