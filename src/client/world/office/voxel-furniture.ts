import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon } from '../toon';
import { voxelBox, voxelGeometry, voxelMaterial } from '../voxel';

/** Batch static parts by paint; a keyboard or a whole chair takes only a few draw calls. */
export class VoxelFurniture {
  private parts = new Map<string, THREE.BufferGeometry[]>();
  add(color: string, w: number, h: number, d: number, x: number, y: number, z: number, round = false, size = 0.035) {
    const geometry = (round ? voxelGeometry('ellipsoid', w, h, d, size) : voxelBox(w, h, d, size)).translate(x, y, z);
    const parts = this.parts.get(color) ?? []; parts.push(geometry); this.parts.set(color, parts);
    return this;
  }
  build(): THREE.Group {
    const group = new THREE.Group();
    for (const [color, parts] of this.parts) {
      const geometry = mergeGeometries(parts)!;
      for (const p of parts) p.dispose();
      const mesh = new THREE.Mesh(geometry, voxelMaterial(toon(color)));
      mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
    }
    return group;
  }
}

export function fineChair(color: string) {
  const v = new VoxelFurniture(), frame = '#455468';
  v.add(color, 0.62, 0.1, 0.58, 0, 0.5, 0);
  v.add(color, 0.6, 0.55, 0.12, 0, 0.84, 0.27);
  v.add(color, 0.54, 0.05, 0.52, 0, 0.565, -0.015);
  v.add(frame, 0.07, 0.42, 0.07, 0, 0.26, 0);
  for (const sx of [-1, 1]) {
    v.add(frame, 0.04, 0.18, 0.04, sx * 0.3, 0.64, 0.04);
    v.add(frame, 0.075, 0.04, 0.3, sx * 0.3, 0.73, 0.015);
  }
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5;
    for (let r = 0.03; r < 0.28; r += 0.035) v.add(frame, 0.055, 0.04, 0.055, Math.sin(a) * r, 0.075, Math.cos(a) * r);
    v.add('#263344', 0.07, 0.075, 0.07, Math.sin(a) * 0.27, 0.04, Math.cos(a) * 0.27);
  }
  return v.build();
}

/** A small drawer pedestal fits within the desk's existing collision box. */
export function deskDrawers(width: number, depth: number, height: number) {
  const v = new VoxelFurniture(), x = -width / 2 + 0.32;
  v.add('#d1b389', 0.46, height - 0.14, depth - 0.22, x, (height - 0.14) / 2, 0);
  for (const y of [0.14, 0.34, 0.54]) {
    v.add('#ad8458', 0.4, 0.015, 0.025, x, y + 0.08, depth / 2 - 0.1, false, 0.0125);
    v.add('#536478', 0.12, 0.035, 0.045, x, y, depth / 2 - 0.07, false, 0.0125);
  }
  return v.build();
}

/** Individual keycaps, merged into one mesh rather than sixty extra objects per laptop. */
export function laptopKeys() {
  const v = new VoxelFurniture();
  for (let r = 0; r < 4; r++) for (let c = 0; c < 12; c++) v.add('#ece5d8', 0.044, 0.008, 0.035, -0.29 + c * 0.053, 0.044, -0.085 + r * 0.055, false, 0.0125);
  v.add('#ece5d8', 0.25, 0.008, 0.032, 0, 0.044, 0.12, false, 0.0125);
  return v.build();
}
