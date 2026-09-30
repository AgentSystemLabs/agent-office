import * as THREE from 'three';
import { BOARD_KEYS, type BoardKey, type MapPlan } from '../../../shared/maps';
import type { Interactable } from '../types';
import { mesh, textPlane } from '../toon';
import type { Kit } from './kit';
import { box } from './shapes';

/** The four boards, framed in wood and iron on the walls, with a painted sign over each. */
export function buildBoards(kit: Kit, plan: MapPlan): Record<BoardKey, THREE.Mesh> {
  const { mats } = kit;
  const faces = {} as Record<BoardKey, THREE.Mesh>;
  for (const k of BOARD_KEYS) {
    const bd = plan.boards[k];
    const nx = Math.sin(bd.rotY);
    const nz = Math.cos(bd.rotY);
    const g = new THREE.Group();
    g.position.set(bd.x + nx * 0.1, bd.y, bd.z + nz * 0.1);
    g.rotation.y = bd.rotY;
    g.add(mesh(box(bd.width + 0.36, bd.height + 0.36, 0.12), mats.woodDark, 0, 0, 0));
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) g.add(mesh(box(0.3, 0.3, 0.05), mats.iron, sx * (bd.width / 2 + 0.05), sy * (bd.height / 2 + 0.05), 0.08, false));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(bd.width, bd.height), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    face.position.z = 0.07;
    g.add(face);
    faces[k] = face;
    const label = textPlane(bd.label, { bg: '#efe3c2', color: '#3b2618', size: 64, border: '#6b4526' });
    label.scale.multiplyScalar(1.15);
    label.position.set(0, bd.height / 2 + 0.55, 0.06);
    g.add(label);
    const it: Interactable = { kind: k, x: bd.x + nx * 1.6, z: bd.z + nz * 1.6, radius: 2.4 };
    kit.interactables.push(it);
    g.userData.interact = it;
    kit.group.add(g);
  }
  return faces;
}
