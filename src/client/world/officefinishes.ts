import * as THREE from 'three';
import { DESK_SIZE, WALL_HEIGHT, type DeskDef } from '../../shared/layout';
import type { DeskView } from './office';
import { mesh, roundedBox, toon } from './toon';
import { buildModernInterior } from './modern';

const COLORS: Record<string, string> = {
  f7f3ea: '#252f42', '3d405b': '#101824', c98b5a: '#32445a', '8a5a3b': '#152333',
  ff8a5b: '#253e54', '5bc0eb': '#28495c', '9bc53d': '#303d56', b388eb: '#253e54',
  ffb400: '#28495c', f7aef8: '#303d56', bde0fe: '#172335', ffd6a5: '#19293b',
  caffbf: '#19293b', ffc6ff: '#172335', e76f51: '#2c3c50', '2b2d42': '#101824',
  '5b8def': '#28495c', c9a27a: '#277dab', e7d3ae: '#172537', '06d6a0': '#28495c',
  ffd166: '#303d56', ef476f: '#28495c', '8ecae6': '#25364a', ffffff: '#172537',
};

/** A desk shell fitting the existing desk collider and keeping all worker anchors in place. */
function workstation(def: DeskDef): THREE.Group {
  const g = new THREE.Group();
  const { width, depth, height } = DESK_SIZE;
  const frame = toon('#101824');
  g.add(mesh(roundedBox(width - 0.06, 0.08, depth - 0.04, 0.08), toon('#252f42'), 0, height - 0.04, 0));
  for (const sx of [-1, 1]) {
    g.add(mesh(new THREE.BoxGeometry(0.09, height - 0.08, depth - 0.16), frame, sx * (width / 2 - 0.16), (height - 0.08) / 2, 0));
    g.add(mesh(roundedBox(0.16, 0.05, depth - 0.08, 0.025), frame, sx * (width / 2 - 0.16), 0.025, 0));
  }
  g.add(mesh(new THREE.BoxGeometry(width - 0.32, 0.12, 0.06), frame, 0, height - 0.24, 0));
  // Keep the divider below the desktop: the existing collider remains accurate.
  g.add(mesh(roundedBox(width - 0.14, 0.3, 0.055, 0.025), toon('#277dab'), 0, height - 0.16, -depth / 2 + 0.06));
  g.add(mesh(new THREE.BoxGeometry(width - 0.14, 0.018, 0.065), toon('#78d8ff', { emissive: '#226da2' }), 0, height - 0.009, -depth / 2 + 0.06, false));
  g.add(mesh(roundedBox(1.1, 0.008, 0.56, 0.04), toon('#121c2a'), 0, height + 0.005, 0.1, false));
  g.name = `futuristic-${def.id}`;
  return g;
}

/** Swap finishes rather than worlds: occupied seats, terminals, doors and animations keep their identity. */
export function officeFinishes(group: THREE.Group, desks: Map<string, DeskView>, pendants: THREE.Group[], preserved: THREE.Material[]): (modern: boolean) => void {
  const paints: { object: THREE.Mesh; original: THREE.Material | THREE.Material[]; modern: THREE.Material | THREE.Material[] }[] = [];
  const cache = new Map<THREE.Material, THREE.Material>();
  const paint = (m: THREE.Material): THREE.Material => {
    if (!(m instanceof THREE.MeshToonMaterial) || m.map || preserved.includes(m)) return m;
    const color = COLORS[m.color.getHexString()];
    if (!color) return m;
    if (!cache.has(m)) {
      const copy = m.clone();
      copy.color.set(color);
      cache.set(m, copy);
    }
    return cache.get(m)!;
  };
  // Capture only static office objects, before workers or decorations are attached.
  group.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const original = obj.material;
    const modern = Array.isArray(original) ? original.map(paint) : paint(original);
    if (Array.isArray(original) ? original.some((m, i) => m !== (modern as THREE.Material[])[i]) : original !== modern) paints.push({ object: obj, original, modern });
  });
  const swaps: { old: THREE.Object3D[]; new: THREE.Object3D }[] = [];
  for (const view of desks.values()) {
    if (view.def.beanbag || view.def.station || view.def.room) continue;
    const old = view.group.children.filter((obj) => obj instanceof THREE.Mesh);
    const finish = workstation(view.def);
    view.group.add(finish);
    swaps.push({ old, new: finish });
  }
  for (const old of pendants) {
    const lamp = new THREE.Group();
    lamp.position.copy(old.position);
    lamp.rotation.copy(old.rotation);
    const height = WALL_HEIGHT - old.position.y;
    for (const x of [-1.6, 1.6]) lamp.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, height, 4), toon('#101824'), x, height / 2, 0, false));
    lamp.add(mesh(roundedBox(4, 0.12, 0.28, 0.06), toon('#101824'), 0, 0, 0, false));
    lamp.add(mesh(roundedBox(3.85, 0.025, 0.21, 0.04), toon('#b9edff', { emissive: '#388ec4' }), 0, -0.073, 0, false));
    group.add(lamp);
    swaps.push({ old: [old], new: lamp });
  }
  const architecture = buildModernInterior();
  group.add(architecture);
  const visibility = new Map(swaps.flatMap((swap) => swap.old.map((obj) => [obj, obj.visible] as const)));
  return (modern) => {
    for (const p of paints) p.object.material = modern ? p.modern : p.original;
    for (const swap of swaps) {
      for (const obj of swap.old) obj.visible = modern ? false : visibility.get(obj)!;
      swap.new.visible = modern;
    }
    architecture.visible = modern;
  };
}
