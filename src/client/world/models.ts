import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import carsUrl from '../models/cars.glb?url';
import deskPropsUrl from '../models/desk_props.glb?url';
import dogCorgiUrl from '../models/dog-corgi.glb?url';
import dogDachshundUrl from '../models/dog-dachshund.glb?url';
import dogPugUrl from '../models/dog-pug.glb?url';
import dogPupUrl from '../models/dog-pup.glb?url';
import dogPomeranianUrl from '../models/dog-pomeranian.glb?url';
import dogShibaUrl from '../models/dog-shiba.glb?url';
import kitchenUrl from '../models/kitchen.glb?url';
import loungeUrl from '../models/lounge.glb?url';
import plantsUrl from '../models/plants.glb?url';
import { toon } from './toon';

// The things in the world modelled in Blender rather than built in code. Each .glb is exported by a
// script in blender/scripts/ (blender/README.md has the conventions they keep); add it here by name.
// `preload` ones are loaded before the world is built, for builders that take theirs with model();
// the rest load the first time loadModel() asks for them (a floor's dog is only ever one breed).
const MODELS = {
  'dog-pup': { url: dogPupUrl, preload: false },
  'dog-corgi': { url: dogCorgiUrl, preload: false },
  'dog-dachshund': { url: dogDachshundUrl, preload: false },
  'dog-pug': { url: dogPugUrl, preload: false },
  'dog-shiba': { url: dogShibaUrl, preload: false },
  'dog-pomeranian': { url: dogPomeranianUrl, preload: false },
  cars: { url: carsUrl, preload: true },
  desk_props: { url: deskPropsUrl, preload: true },
  kitchen: { url: kitchenUrl, preload: true },
  lounge: { url: loungeUrl, preload: true },
  plants: { url: plantsUrl, preload: true },
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

/**
 * How far the model files have got: how many have been asked for so far, and how many of those are done
 * (loaded, or given up on). Counted by file rather than by byte, since a file's size is only known when the
 * response says it.
 */
export interface ModelsProgress {
  asked: number;
  done: number;
}

const progress: ModelsProgress = { asked: 0, done: 0 };
const watchers = new Set<(p: ModelsProgress) => void>();

/**
 * Calls `fn` with the files' progress now, and again each time a file is asked for, gets more of itself in,
 * or is done (see ModelsProgress). The loading screen fills its bar with it, and while the calls keep coming
 * it knows a slow download is still going. Returns a function that stops the calls.
 */
export function onModelsProgress(fn: (p: ModelsProgress) => void): () => void {
  watchers.add(fn);
  fn({ ...progress });
  return () => watchers.delete(fn);
}

function tell() {
  for (const fn of watchers) fn({ ...progress });
}

/** Each file loads once, the first time something asks for it. */
function fetchModel(name: ModelName): Promise<GLTF> {
  let p = loading.get(name);
  if (!p) {
    // Each chunk that comes in tells the watchers too, though the counts are still by file.
    p = new GLTFLoader().loadAsync(MODELS[name].url, () => tell()).then((gltf) => {
      loaded.set(name, gltf);
      return gltf;
    });
    loading.set(name, p);
    progress.asked++;
    tell();
    // Done either way: one that failed still rejects for whoever asked for it.
    const done = () => {
      progress.done++;
      tell();
    };
    void p.then(done, done);
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
 * A painted copy of one piece of a `preload` model, the object called `part` in it, for a model that holds
 * several things placed each on their own (a plant of each species, the lounge's sofa and its table).
 * `paint` gives the material for each name, as for paintModel(). If the model didn't load, or has no such
 * piece, an empty group: the office opens without it.
 */
export function piece(name: ModelName, part: string, paint: (name: string) => THREE.Material, castShadow = true): THREE.Object3D {
  const copy = loaded.get(name)?.scene.getObjectByName(part)?.clone();
  if (!copy) return new THREE.Group();
  paintModel(copy, paint, castShadow);
  return copy;
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
