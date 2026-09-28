import * as THREE from 'three';
import type { Interactable } from './office';

/** A small contact volume in an animated object's local space, not its desktop walk-up radius. */
export interface TouchVolume {
  object: THREE.Object3D;
  containsPoint(point: THREE.Vector3): boolean;
}

const local = new THREE.Vector3();

/** Only explicitly touchable, visible objects on the current floor participate. */
export function pickTouchTarget(point: THREE.Vector3, lists: readonly (readonly Interactable[])[]): Interactable | null {
  for (const list of lists) {
    for (const it of list) {
      if (it.off) continue;
      for (const volume of it.touch ?? []) {
        let shown = true;
        for (let o: THREE.Object3D | null = volume.object; o; o = o.parent) {
          if (!o.visible) {
            shown = false;
            break;
          }
        }
        if (shown && volume.containsPoint(volume.object.worldToLocal(local.copy(point)))) return it;
      }
    }
  }
  return null;
}
