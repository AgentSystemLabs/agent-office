import * as THREE from 'three';
import { mergeByMaterial } from '../../world/toon';

/** Keep lettering UVs, transparent panes and lights; batch the many static desk/wall pieces. */
export function batchStatic(root: THREE.Group) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const candidates: THREE.Mesh[] = [];
  root.traverse((object) => {
    const m = object as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    const mat = m.material as THREE.MeshToonMaterial;
    if (mat.map || mat.transparent || mat.side !== THREE.FrontSide) return;
    candidates.push(m);
  });
  const into = new THREE.Group();
  for (const m of candidates) {
    const copy = new THREE.Mesh(m.geometry, m.material);
    copy.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, m.matrixWorld));
    copy.castShadow = m.castShadow;
    into.add(copy);
  }
  const merged = mergeByMaterial(into);
  merged.name = 'scranton-static-surfaces';
  root.add(merged);
  const geometries = new Set<THREE.BufferGeometry>();
  for (const m of candidates) { m.removeFromParent(); geometries.add(m.geometry); }
  for (const geometry of geometries) geometry.dispose();
}
