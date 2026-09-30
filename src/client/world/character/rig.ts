import * as THREE from 'three';

// The bodies' shared measurements, and the parts of a Person or a Worker that the other files here
// pose, passed to them by the class (see person.ts, worker.ts).

/** The Person's hips above their feet, standing. Sitting puts them on the seat, and your eyes move with them. */
export const HIPS = 0.42;

/** Straight down: the way an arm hangs, turned from here to point it at the hands. */
export const DOWN = new THREE.Vector3(0, -1, 0);

/** A Person's moving parts. Forward is +z, so the character's right arm is armL, the one on -x. */
export interface PersonRig {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
}

/** A Worker's moving parts, and its skin and status light. Forward is +z. */
export interface WorkerRig {
  root: THREE.Group;
  body: THREE.Group;
  skin: THREE.MeshToonMaterial;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  feet: THREE.Mesh[];
  pupils: THREE.Mesh[];
  bulb: THREE.MeshToonMaterial;
  bulbMesh: THREE.Mesh;
  /** What it acts out with: the papers in its hands and the globe beside its laptop (see worker-props.ts). */
  props: THREE.Object3D[];
}
