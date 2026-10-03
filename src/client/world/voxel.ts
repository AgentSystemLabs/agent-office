import * as THREE from 'three';

type Form = 'box' | 'ellipsoid' | 'capsule' | 'cap' | 'curtain';
const cache = new Map<string, THREE.BufferGeometry>();
const directions = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** Fine solid voxels, with only exposed faces emitted. Bounds stay inside the original silhouette. */
export function voxelGeometry(form: Form, width: number, height: number, depth: number, size = 0.025): THREE.BufferGeometry {
  if ([width, height, depth, size].some((n) => !Number.isFinite(n) || n <= 0)) throw new Error('Voxel dimensions must be positive and finite');
  const key = `${form}:${width}:${height}:${depth}:${size}`;
  const hit = cache.get(key);
  // Each caller owns its copy: hair changes and prop disposal must not invalidate another character.
  if (hit) return hit.clone();
  const nx = Math.max(1, Math.ceil(width / size)), ny = Math.max(1, Math.ceil(height / size)), nz = Math.max(1, Math.ceil(depth / size));
  const dx = width / nx, dy = height / ny, dz = depth / nz;
  const cells = new Uint8Array(nx * ny * nz);
  const at = (i: number, j: number, k: number) => (i * ny + j) * nz + k;
  const has = (i: number, j: number, k: number) => i >= 0 && i < nx && j >= 0 && j < ny && k >= 0 && k < nz && !!cells[at(i, j, k)];
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
    const x = ((i + 0.5) / nx - 0.5) * 2, y = ((j + 0.5) / ny - 0.5) * height, z = ((k + 0.5) / nz - 0.5) * 2;
    const r = Math.min(width, depth) / 2;
    const cy = form === 'capsule' ? Math.max(0, Math.abs(y) - Math.max(0, height / 2 - r)) / r : y * 2 / height;
    if (form === 'box' || (x * x + cy * cy + z * z <= 1 && (form !== 'cap' || y >= 0) && (form !== 'curtain' || z < 0.45))) cells[at(i, j, k)] = 1;
  }
  const positions: number[] = [], normals: number[] = [], colors: number[] = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
    if (!has(i, j, k)) continue;
    const shade = 0.92 + ((i * 13 + j * 7 + k * 19) % 13) * 0.011;
    for (const n of directions) {
      if (has(i + n[0], j + n[1], k + n[2])) continue;
      const u = n[0] ? [0, 1, 0] : n[1] ? [0, 0, 1] : [1, 0, 0];
      const v = n[0] ? [0, 0, 1] : n[1] ? [1, 0, 0] : [0, 1, 0];
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      const order = n[0] + n[1] + n[2] > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
      for (const c of order) {
        const [a, b] = corners[c];
        positions.push((i + 0.5 + (n[0] + a * u[0] + b * v[0]) / 2) * dx - width / 2,
          (j + 0.5 + (n[1] + a * u[1] + b * v[1]) / 2) * dy - height / 2,
          (k + 0.5 + (n[2] + a * u[2] + b * v[2]) / 2) * dz - depth / 2);
        normals.push(...n);
        const side = has(i + n[0] + a * u[0], j + n[1] + a * u[1], k + n[2] + a * u[2]);
        const other = has(i + n[0] + b * v[0], j + n[1] + b * v[1], k + n[2] + b * v[2]);
        const ao = shade * (side && other ? 0.55 : side || other ? 0.8 : 1);
        colors.push(ao, ao, ao);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  cache.set(key, geometry);
  return geometry.clone();
}

export const voxelBox = (w: number, h: number, d: number, s = 0.025) => voxelGeometry('box', w, h, d, s);
export const voxelBall = (r: number, s = 0.025) => voxelGeometry('ellipsoid', r * 2, r * 2, r * 2, s);
export const voxelCapsule = (r: number, length: number, s = 0.025) => voxelGeometry('capsule', r * 2, length + r * 2, r * 2, s);

/** Keep the material reference intact: worker colors and status bulbs animate this very material. */
export function voxelMaterial<T extends THREE.Material>(material: T): T {
  if ('vertexColors' in material) { material.vertexColors = true; material.needsUpdate = true; }
  return material;
}

const solids = new Map<string, THREE.MeshStandardMaterial>();

/** A flat-coloured voxel material of its own, shared only between voxel meshes (the toon cache's are for meshes without vertex colours). */
export function voxelSolid(color: string): THREE.MeshStandardMaterial {
  let m = solids.get(color);
  if (!m) solids.set(color, (m = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, vertexColors: true })));
  return m;
}
