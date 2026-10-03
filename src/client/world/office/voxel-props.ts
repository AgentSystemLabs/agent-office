import * as THREE from 'three';
import { VoxelFurniture } from './voxel-furniture';

export function finePlant(species: string) {
  const group = new THREE.Group(), pot = new VoxelFurniture(), leaves = new VoxelFurniture();
  const small = species === 'succulent', scale = small ? 0.24 : 1;
  const color = species === 'snake_plant' ? '#8ecae6' : '#ce795b';
  for (let i = 0; i < 8; i++) {
    const w = 0.36 + i * 0.023;
    pot.add(color, w, 0.055, w, 0, 0.028 + i * 0.055, 0, false, 0.025);
  }
  pot.add('#e4c9a1', 0.56, 0.055, 0.56, 0, 0.46, 0, false, 0.025);
  pot.add('#62412d', 0.45, 0.025, 0.45, 0, 0.48, 0, false, 0.025);
  if (species === 'snake_plant') {
    for (let i = 0; i < 9; i++) {
      const a = i * 2.3999, r = 0.06 + (i % 3) * 0.065, h = 0.55 + (i % 4) * 0.16;
      leaves.add(i % 2 ? '#4b9c69' : '#76b97b', 0.12, h, 0.09, Math.cos(a) * r, 0.48 + h / 2, Math.sin(a) * r, true, 0.025);
    }
  } else if (small) {
    for (let i = 0; i < 12; i++) {
      const a = i * 2.3999, r = i < 6 ? 0.14 : 0.06;
      leaves.add(i % 2 ? '#5eaf79' : '#83c18a', 0.25, 0.12, 0.24, Math.cos(a) * r, 0.55 + (i % 3) * 0.08, Math.sin(a) * r, true, 0.025);
    }
  } else {
    leaves.add('#8a6443', 0.045, 0.95, 0.045, 0, 0.95, 0, false, 0.025);
    for (let i = 0; i < 15; i++) {
      const a = i * 2.3999, r = 0.18 + (i % 3) * 0.095, y = 0.7 + i * 0.055;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      for (let j = 1; j <= 5; j++) leaves.add('#8a6443', 0.035, 0.035, 0.035, x * j / 5, y - 0.15 + j * 0.03, z * j / 5, false, 0.025);
      leaves.add(i % 2 ? '#4d9765' : '#7abd7c', species === 'ficus' ? 0.28 : 0.4, 0.1, 0.3, x, y, z, true, 0.025);
    }
  }
  group.add(pot.build());
  const foliage = leaves.build(); foliage.name = `${species}_leaves`; group.add(foliage);
  group.scale.setScalar(scale);
  return group;
}

export function fineMug(color: string) {
  const v = new VoxelFurniture();
  // Four walls leave the rim open around a visible surface of coffee.
  v.add(color, 0.12, 0.02, 0.12, 0, 0.01, 0, false, 0.0125);
  for (const s of [-1, 1]) {
    v.add(color, 0.12, 0.1, 0.015, 0, 0.07, s * 0.0525, false, 0.0125);
    v.add(color, 0.015, 0.1, 0.09, s * 0.0525, 0.07, 0, false, 0.0125);
  }
  v.add('#60402c', 0.09, 0.0125, 0.09, 0, 0.105, 0, false, 0.0125);
  for (const y of [0.04, 0.1]) v.add(color, 0.06, 0.015, 0.025, 0.08, y, 0, false, 0.0125);
  v.add(color, 0.015, 0.075, 0.025, 0.11, 0.07, 0, false, 0.0125);
  return v.build();
}

export function fineBooks(index: number) {
  const v = new VoxelFurniture(), colors = ['#de8066', '#579eb6', '#e3b85f'];
  for (let i = 0; i < 3; i++) {
    if (index % 3 === 2) {
      v.add(colors[i], 0.24, 0.018, 0.17, 0, 0.015 + i * 0.042, 0, false, 0.0125);
      v.add('#f2e9d7', 0.23, 0.025, 0.15, 0, 0.035 + i * 0.042, 0, false, 0.0125);
    } else {
      const x = -0.075 + i * 0.075, h = 0.18 + i * 0.025;
      v.add(colors[i], 0.06, h, 0.16, x, h / 2, 0, false, 0.0125);
      for (const y of [0.05, h - 0.04]) v.add('#eee2c8', 0.045, 0.015, 0.015, x, y, 0.085, false, 0.0125);
    }
  }
  return v.build();
}

export function fineSofa() {
  const v = new VoxelFurniture();
  v.add('#4d9b86', 4.2, 0.22, 1, 0, 0.31, 0);
  v.add('#5caf98', 4.2, 0.65, 0.2, 0, 0.69, -0.4);
  for (const x of [-1.9, 1.9]) v.add('#4d9b86', 0.4, 0.52, 1, x, 0.54, 0);
  for (const x of [-1.2, 0, 1.2]) {
    v.add('#75c4ab', 1.15, 0.11, 0.76, x, 0.415, 0.03);
    v.add('#65b59e', 1.15, 0.45, 0.13, x, 0.705, -0.25);
  }
  for (const x of [-1.85, 1.85]) for (const z of [-0.35, 0.35]) v.add('#885e42', 0.12, 0.2, 0.12, x, 0.1, z);
  for (const [x, color] of [[-0.6, '#e98d71'], [0.6, '#f7e5c9']] as const) v.add(color, 0.38, 0.36, 0.15, x, 0.65, -0.12);
  return v.build();
}
