import * as THREE from 'three';
import type { Theme } from '../../../shared/protocol';
import { GRIME, beardColor, elfBoot, elfHat, elfWorker, zombieWorker, type Beard, type PeasantGarb } from '../costumes';
import type { WorkerRig } from './rig';

// Dressing a worker up: for a holiday, and for how worn out it's getting.

/** What a zombie worker's skin is mixed toward. */
const ZOMBIE = new THREE.Color('#7fa36b');

/**
 * Dresses a worker up for a holiday (a zombie for Halloween, an elf for Christmas), or in just its own
 * skin, `color` (null). What it puts on goes in `outfit`, for taking off again.
 */
export function dressUp(rig: WorkerRig, theme: Theme | null, color: string, outfit: THREE.Object3D[]) {
  const wear = (parent: THREE.Object3D, o: THREE.Object3D) => {
    o.traverse((m) => ((m as THREE.Mesh).castShadow = true));
    parent.add(o);
    outfit.push(o);
  };
  rig.skin.color.set(color);
  if (theme === 'halloween') {
    rig.skin.color.lerp(ZOMBIE, 0.6).multiplyScalar(0.85);
    wear(rig.body, zombieWorker(rig.skin));
  } else if (theme === 'christmas') {
    wear(rig.body, elfHat());
    wear(rig.body, elfWorker(rig.skin));
    for (const f of rig.feet) wear(f, elfBoot());
  }
}

/** Its beard, `age` (0 to 1) of the way grown out: longer and greyer, with a mustache, brows and bags. */
export function growBeard(w: Beard, age: number) {
  w.group.visible = age > 0.02;
  beardColor(age, w.hair.color);
  w.chin.scale.set(1.2 * (0.45 + 0.55 * Math.min(1, age * 3)), 0.75 * (0.45 + 0.55 * Math.min(1, age * 3)), 0.45);
  w.hang.visible = age > 0.08;
  // It grows from a short beard under the chin down to the floor; the smock bulges, so it leans out a little as it grows.
  w.hang.scale.set(0.7 + 0.3 * Math.min(1, age * 2), 0.08 + 0.5 * age, 1);
  w.hang.rotation.x = 0.06 - 0.12 * age;
  w.mustache.visible = age > 0.05;
  w.brows.visible = age > 0.45;
  w.bags.visible = age > 0.6;
}

/** Its peasant's clothes, `age` of the way worn out: grubbier, and patched. */
export function wearGarb(garb: PeasantGarb, age: number) {
  garb.cloth.color.copy(garb.clean).lerp(GRIME, 0.5 * age);
  for (const p of garb.patches) p.part.visible = age >= p.at;
}
