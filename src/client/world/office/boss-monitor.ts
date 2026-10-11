import * as THREE from 'three';
import { mesh, roundedBox, toon } from '../toon';
import { box } from './materials';
export function bossMonitor(x: number) {
  const group = new THREE.Group(); group.position.x = x;
  group.add(mesh(roundedBox(0.9, 0.55, 0.06, 0.03), toon('#2b2d42'), 0, 1.18, -0.2));
  group.add(mesh(box(0.08, 0.2, 0.08), toon('#2b2d42'), 0, 0.93, -0.2));
  const screen = mesh(new THREE.PlaneGeometry(0.8, 0.45), new THREE.MeshBasicMaterial({ color: '#4cc9f0' }), 0, 1.18, -0.165, false);
  group.add(screen); return { group, screen };
}

