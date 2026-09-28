import type * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import dogUrl from '../models/dog.glb?url';
import { toon } from './toon';

// The things in the world modelled in Blender rather than built in code. Each .glb is exported by a
// script in blender/scripts/ (blender/README.md has the conventions they keep); add it here by name.
// `preload` ones are loaded before the world is built, for builders that take theirs with model();
// the rest load the first time loadModel() asks for them (a floor's dog is only ever one breed).
const MODELS = {
  dog: { url: dogUrl, preload: false },
} satisfies Record<string, { url: string; preload: boolean }>;

export type ModelName = keyof typeof MODELS;

export interface Model {
  /** This copy's scene: its own nodes and bones, sharing the geometry and materials with every other copy. */
  scene: THREE.Object3D;
  /** Its animations, by name. Shared too: an AnimationMixer only reads them. */
  clips: THREE.AnimationClip[];
}

const loading = new Map<ModelName, Promise<GLTF>>();
const loaded = new Map<ModelName, GLTF>();

/** Each file loads once, the first time something asks for it. */
function fetchModel(name: ModelName): Promise<GLTF> {
  let p = loading.get(name);
  if (!p) {
    p = new GLTFLoader().loadAsync(MODELS[name].url).then((gltf) => {
      loaded.set(name, gltf);
      return gltf;
    });
    loading.set(name, p);
  }
  return p;
}

// A plain clone() would leave a copy's skin bound to the original's bones.
const copy = (gltf: GLTF): Model => ({ scene: clone(gltf.scene), clips: gltf.animations });

/** A copy of a model to pose and dress on its own, once it has loaded. */
export async function loadModel(name: ModelName): Promise<Model> {
  return copy(await fetchModel(name));
}

/**
 * Loads every `preload` model, so the world can be built with them straight away (see model()). One
 * that doesn't load is logged and left out: whatever it was for goes missing, the office still opens.
 */
export async function preloadModels(): Promise<void> {
  const names = (Object.keys(MODELS) as ModelName[]).filter((name) => MODELS[name].preload);
  await Promise.all(names.map((name) => fetchModel(name).catch((err: unknown) => console.error(`${name}.glb didn't load`, err))));
}

/** A copy of a `preload` model (see preloadModels()), or null if it couldn't be loaded. */
export function model(name: ModelName): Model | null {
  const gltf = loaded.get(name);
  return gltf ? copy(gltf) : null;
}

/**
 * Paints a model the office's way: every material it came with is only a name (see blender/README.md),
 * and `paint` gives the material to use for each. Meshes cast and take shadows like mesh()'s do.
 */
export function paintModel(root: THREE.Object3D, paint: (name: string) => THREE.Material, castShadow = true) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.material = paint((m.material as THREE.Material).name);
    m.castShadow = castShadow;
    m.receiveShadow = true;
  });
}

/**
 * The usual `paint`: a toon material of the palette's color for each name. A name the palette has no
 * color for comes out magenta, so a part the script and the code disagree on shows at a glance.
 */
export function palette(colors: Record<string, string>): (name: string) => THREE.Material {
  return (name) => toon(colors[name] ?? '#ff00ff');
}
