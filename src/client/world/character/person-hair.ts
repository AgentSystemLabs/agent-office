import * as THREE from 'three';
import { HAIR_STYLES } from '../../../shared/avatar';
import { mesh } from '../toon';
import { hairShapes } from './person-model';

/** Hair is voxel blocks on the head (whose center is 0,0,0; the face looks down +z), in `style` (of HAIR_STYLES). */
export function styleHair(hair: THREE.Group, m: THREE.MeshStandardMaterial, style: number) {
  hair.clear();
  const geo = hairShapes(HAIR_STYLES[style]);
  if (geo) hair.add(mesh(geo, m));
}
