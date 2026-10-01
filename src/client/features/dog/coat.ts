import type * as THREE from 'three';
import { DOG_COATS, DOG_COAT_GLOW } from '../../../shared/dog';

/** Paints the dog's three coat materials (see Dog's coatMats) in coat `n`, the white one glowing a little so it stays white at dusk. */
export function paintCoat(mats: readonly THREE.MeshToonMaterial[], n: number) {
  const coat = n % DOG_COATS.length;
  DOG_COATS[coat].forEach((c, i) => {
    mats[i].color.set(c);
    mats[i].emissive.set(c).multiplyScalar(DOG_COAT_GLOW[coat] ?? 0);
  });
}
