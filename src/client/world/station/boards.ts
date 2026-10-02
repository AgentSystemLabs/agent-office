import * as THREE from 'three';
import { BOARD_KEYS, type BoardKey } from '../../../shared/maps';
import type { Interactable } from '../types';
import { mesh, textPlane } from '../toon';
import { box, type Kit } from './kit';

/** The four boards: big displays on the walls, a line of light round each and its name over it. */
export function buildBoards(kit: Kit): Record<BoardKey, THREE.Mesh> {
  const { mats } = kit;
  const faces = {} as Record<BoardKey, THREE.Mesh>;
  for (const k of BOARD_KEYS) {
    const bd = kit.plan.boards[k];
    const nx = Math.sin(bd.rotY);
    const nz = Math.cos(bd.rotY);
    const g = new THREE.Group();
    g.position.set(bd.x + nx * 0.1, bd.y, bd.z + nz * 0.1);
    g.rotation.y = bd.rotY;
    g.add(mesh(box(bd.width + 0.34, bd.height + 0.34, 0.12), mats.black, 0, 0, 0));
    for (const sy of [-1, 1]) g.add(mesh(box(bd.width + 0.34, 0.04, 0.02), mats.accent, 0, sy * (bd.height / 2 + 0.15), 0.065, false));
    for (const sx of [-1, 1]) g.add(mesh(box(0.04, bd.height + 0.34, 0.02), mats.accent, sx * (bd.width / 2 + 0.15), 0, 0.065, false));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(bd.width, bd.height), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    face.position.z = 0.07;
    g.add(face);
    faces[k] = face;
    const label = textPlane(bd.label, { bg: '#0f1a26', color: '#e6f6ff', size: 64, border: '#3a5a78' });
    label.scale.multiplyScalar(1.1);
    label.position.set(0, bd.height / 2 + 0.55, 0.06);
    g.add(label);
    const it: Interactable = { kind: k, x: bd.x + nx * 1.6, z: bd.z + nz * 1.6, radius: 2.4 };
    kit.interactables.push(it);
    g.userData.interact = it;
    kit.group.add(g);
  }
  return faces;
}
