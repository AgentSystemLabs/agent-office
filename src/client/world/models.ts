import type * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import dogUrl from '../models/dog.glb?url';

// The few things in the world modelled in Blender rather than built in code (see blender/scripts/).
// Each file loads once, the first time something asks for it; everyone who asks gets a copy of their own.

export interface Model {
  /** This copy's scene: its own nodes and bones, sharing the geometry and materials with every other copy. */
  scene: THREE.Object3D;
  /** Its animations, by name. Shared too: an AnimationMixer only reads them. */
  clips: THREE.AnimationClip[];
}

let dog: ReturnType<GLTFLoader['loadAsync']> | null = null;

/** A copy of the office dog (dog.glb, exported by blender/scripts/build_dog.py), to pose and dress on its own. */
export async function loadDog(): Promise<Model> {
  const gltf = await (dog ??= new GLTFLoader().loadAsync(dogUrl));
  // A plain clone() would leave the copy's skin bound to the original's bones.
  return { scene: clone(gltf.scene), clips: gltf.animations };
}
