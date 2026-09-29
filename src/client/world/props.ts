/**
 * Loads the generated prop GLBs and hands out clones of them.
 *
 * Each prop is fetched once and kept in a cache, so every laptop in the office shares
 * one geometry and one material set.
 *
 * Props are Draco-compressed, so the decoder is wired up here rather than at each call
 * site. Nothing in this module touches the DOM or WebGL at import time, which keeps it
 * loadable from `tests/`.
 */

import type * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

/** One row of `public/props/manifest.json`, written by tools/props/generate.py. */
export interface PropInfo {
  url: string;
  triangles: number;
  bytes: number;
  materials: number;
  tags: string[];
  width: number;
  height: number;
  depth: number;
}

export type PropManifest = Record<string, PropInfo>;

export interface PropPlace {
  x?: number;
  y?: number;
  z?: number;
  rotY?: number;
  rotX?: number;
  rotZ?: number;
  scale?: number | THREE.Vector3;
}

type Entry = { info: PropInfo; gltf: THREE.Group };

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<Entry>>();

let manifest: PropManifest | null = null;
let loader: GLTFLoader | null = null;

function draco(): DRACOLoader {
  const d = new DRACOLoader();
  // The decoder ships inside three; serving it from here keeps the office offline-first.
  d.setDecoderPath('/props/draco/');
  d.preload();
  return d;
}

function gltfLoader(): GLTFLoader {
  if (!loader) loader = new GLTFLoader().setDRACOLoader(draco());
  return loader;
}

/** The prop catalogue, or an empty object before it has loaded. */
export function propManifest(): PropManifest {
  return manifest ?? {};
}

/** Loads the manifest. Safe to call more than once; callers await the same promise. */
export async function loadPropManifest(): Promise<PropManifest> {
  if (manifest) return manifest;
  const res = await fetch('/props/manifest.json');
  if (!res.ok) throw new Error(`props manifest: ${res.status} ${res.statusText}`);
  manifest = (await res.json()) as PropManifest;
  return manifest;
}

async function load(name: string): Promise<Entry> {
  const cached = cache.get(name);
  if (cached) return cached;
  const pending = inFlight.get(name);
  if (pending) return pending;

  const info = propManifest()[name];
  if (!info) throw new Error(`unknown prop "${name}" - run tools/props/generate.py`);

  const job = new Promise<Entry>((resolve, reject) => {
    gltfLoader().load(
      info.url,
      (gltf) => {
        // The GLB is authored with its base on y=0 and its origin at the footprint
        // centre, so it drops straight onto a floor with no per-prop offset.
        const entry: Entry = { info, gltf: gltf.scene };
        entry.gltf.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.castShadow = true;
          m.receiveShadow = true;
        });
        cache.set(name, entry);
        inFlight.delete(name);
        resolve(entry);
      },
      undefined,
      (err) => {
        inFlight.delete(name);
        reject(err);
      },
    );
  });

  inFlight.set(name, job);
  return job;
}

/** Warms the cache for several props at once, ignoring any that fail. */
export async function preloadProps(names: readonly string[]): Promise<void> {
  await Promise.allSettled(names.map(load));
}

/** True once `name` is in the cache and can be placed without a round trip. */
export function propReady(name: string): boolean {
  return cache.has(name);
}

/**
 * A fresh instance of a prop, already positioned. Returns null until the GLB has
 * loaded, so callers can build the scene immediately and drop props in as they arrive.
 */
export function prop(name: string, place: PropPlace = {}): THREE.Object3D | null {
  const entry = cache.get(name);
  if (!entry) return null;
  const obj = entry.gltf.clone(true);
  obj.position.set(place.x ?? 0, place.y ?? 0, place.z ?? 0);
  obj.rotation.set(place.rotX ?? 0, place.rotY ?? 0, place.rotZ ?? 0);
  const s = place.scale ?? 1;
  obj.scale.set(typeof s === 'number' ? s : s.x, typeof s === 'number' ? s : s.y, typeof s === 'number' ? s : s.z);
  return obj;
}

/** The same as `prop` but synchronous; only valid for props already in the cache. */
export function propOrNull(name: string, place: PropPlace = {}): THREE.Object3D | null {
  return prop(name, place);
}

// A prop that was asked for before its GLB arrived: the group holding the procedural
// stand-in, and the name to swap in once it lands.
interface Pending {
  node: THREE.Object3D;
  name: string;
}

const pending: Pending[] = [];

/**
 * Puts a prop inside `node`, replacing whatever is already in it.
 *
 * Returns true when the GLB is there now. Returns false when it has not arrived yet, in
 * which case the caller should build its procedural version and this is remembered; the
 * next call to `flushPendingProps()` swaps the contents in.
 *
 * Swapping the *contents* rather than the node itself is deliberate. Callers keep
 * references to these groups - `main.ts` turns `desk.chair` to face the desk, and the
 * holiday theme hides the plant's leaves by index - so the node has to keep its identity,
 * transform, and children order.
 */
export function useProp(node: THREE.Object3D, name: string): boolean {
  const entry = cache.get(name);
  if (!entry) {
    pending.push({ node, name });
    return false;
  }
  install(node, entry.gltf);
  return true;
}

function install(node: THREE.Object3D, gltf: THREE.Group): void {
  const model = gltf.clone(true);
  model.position.set(0, 0, 0);
  model.rotation.set(0, 0, 0);
  model.scale.set(1, 1, 1);
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
  });
  node.clear();
  node.add(model);
}

/**
 * Replaces every stand-in that was waiting on a GLB, and reports how many landed.
 * Called once the manifest's props have loaded; anything still missing stays procedural.
 */
export function flushPendingProps(): number {
  let swapped = 0;
  for (const p of pending.splice(0)) {
    const entry = cache.get(p.name);
    if (!entry) continue;
    install(p.node, entry.gltf);
    swapped++;
  }
  return swapped;
}

/** Props still waiting on a GLB, for the perf budget test and the dev overlay. */
export function pendingPropCount(): number {
  return pending.length;
}

/** Loads every prop in the manifest. Used by the dev server and the contact sheet. */
export async function loadAllProps(): Promise<number> {
  const m = await loadPropManifest();
  const names = Object.keys(m);
  await preloadProps(names);
  return cache.size;
}

/** Total triangles currently resident, for the perf budget test. */
export function loadedTriangles(): number {
  let n = 0;
  for (const { info } of cache.values()) n += info.triangles;
  return n;
}
