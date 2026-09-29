// Loads every prop GLB through the real three.js GLTFLoader+DRACOLoader stack in Node,
// to prove the Draco payload decodes and the materials survive. No WebGL needed.
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Worker as NodeWorker } from 'node:worker_threads';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { webcrypto } from 'node:crypto';

// three's loaders reach for a couple of browser globals. `self`, `crypto` and
// `ProgressEvent` are shimmed; the Worker below is backed by a real worker thread.
globalThis.self = globalThis;
if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (typeof globalThis.ProgressEvent === 'undefined') {
  globalThis.ProgressEvent = class ProgressEvent {
    constructor(type, init = {}) {
      this.type = type;
      Object.assign(this, init);
    }
  };
}
// DRACOLoader always decodes in a Web Worker, which Node lacks. Run its worker body in
// a worker thread instead: capture the generated source three hands to the Worker
// constructor, prepend a bootstrap mapping the worker globals onto parentPort, and run
// that as a Classic worker script. Messages posted before the thread is up are queued.
const workerSources = new Map();
const createObjectURL = URL.createObjectURL.bind(URL);
URL.createObjectURL = (blob) => {
  const url = createObjectURL(blob);
  workerSources.set(url, blob);
  return url;
};
const WORKER_BOOTSTRAP = `
const { parentPort } = require('node:worker_threads');
globalThis.self = globalThis;
globalThis.location = { href: 'file:///draco-worker.cjs' };
Object.defineProperty(globalThis, 'onmessage', {
  configurable: true,
  get() { return globalThis.__dracoOnMessage ?? null; },
  set(fn) { globalThis.__dracoOnMessage = fn; },
});
parentPort.on('message', (data) => {
  try { globalThis.__dracoOnMessage?.({ data }); }
  catch (error) { parentPort.postMessage({ type: 'error', id: data?.id ?? -1, error: String(error?.stack ?? error) }); }
});
globalThis.postMessage = (data, transfer) => parentPort.postMessage(data, Array.isArray(transfer) ? transfer : []);
`;
let workerSerial = 0;
globalThis.Worker = class NodeDracoWorker {
  constructor(url) {
    this._queue = [];
    this._real = null;
    this._file = null;
    this.onmessage = null;
    this.onerror = null;
    const listeners = { message: [], error: [] };
    this.addEventListener = (type, fn) => (listeners[type] ??= []).push(fn);
    const blob = workerSources.get(url);
    if (!blob) throw new Error(`verify: unknown worker source ${url}`);
    this._ready = blob.text().then((body) => {
      this._file = path.join(tmpdir(), `draco-worker-${process.pid}-${workerSerial++}.cjs`);
      writeFileSync(this._file, WORKER_BOOTSTRAP + body);
      const real = new NodeWorker(this._file);
      this._real = real;
      real.on('message', (data) => {
        const ev = { data };
        for (const fn of listeners.message) fn(ev);
        this.onmessage?.(ev);
      });
      // DRACOLoader never listens for worker errors, so a crash would hang the run
      // silently; report it loudly instead.
      real.on('error', (err) => {
        console.error(`verify: draco worker failed: ${err?.stack ?? err}`);
        for (const fn of listeners.error) fn(err);
        this.onerror?.(err);
      });
      for (const [data, transfer] of this._queue.splice(0)) real.postMessage(data, transfer);
    });
  }
  postMessage(data, transfer) {
    const list = Array.isArray(transfer) ? transfer : [];
    if (this._real) this._real.postMessage(data, list);
    else this._queue.push([data, list]);
  }
  terminate() {
    return this._ready.then(() => this._real.terminate());
  }
};

const ROOT = new URL('../../src/client/public/', import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(`${ROOT}/props/manifest.json`, 'utf8'));
const names = Object.keys(manifest);

const server = createServer((req, res) => {
  const p = req.url.split('?')[0];
  try {
    const buf = readFileSync(`${ROOT}${p}`);
    const type = p.endsWith('.glb') ? 'model/gltf-binary' : p.endsWith('.wasm') ? 'application/wasm' : 'application/javascript';
    res.writeHead(200, { 'content-type': type });
    res.end(buf);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const draco = new DRACOLoader();
draco.setDecoderPath(`${base}/props/draco/`);
const loader = new GLTFLoader().setDRACOLoader(draco);

const fetchGlb = (url) =>
  new Promise((resolve, reject) => {
    loader.load(base + url, (g) => resolve(g), undefined, reject);
  });

let bad = 0,
  totalTris = 0,
  totalMats = 0;
for (const name of names) {
  const info = manifest[name];
  try {
    const gltf = await fetchGlb(info.url);
    let tris = 0,
      meshes = 0,
      mats = new Set(),
      hasColor = 0;
    const box = new THREE.Box3();
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      const g = o.geometry;
      const count = g.index ? g.index.count : g.attributes.position.count;
      tris += Math.floor(count / 3);
      box.expandByObject(o);
      for (const m of [].concat(o.material)) {
        mats.add(m);
        if (m.color) hasColor++;
      }
    });
    totalTris += tris;
    totalMats += mats.size;
    const size = box.getSize(new THREE.Vector3());
    const ok = tris === info.triangles && tris <= 8000;
    if (!ok) bad++;
    console.log(
      `${ok ? 'OK ' : 'BAD'} ${name.padEnd(18)} tris=${String(tris).padStart(5)} (manifest ${info.triangles})`,
      `meshes=${meshes} mats=${mats.size} colored=${hasColor}`,
      `size=${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)}`,
    );
  } catch (e) {
    bad++;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}
console.log(`\n${names.length} props, ${totalTris} tris, ${totalMats} material slots, failures: ${bad}`);
draco.dispose();
server.close();
process.exit(bad ? 1 : 0);
