import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Address } from 'node:net';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { Laptop, paintScreen, type ScreenState } from '../src/client/world/laptop.js';
import { loadPropManifest, preloadProps, propReady } from '../src/client/world/props.js';

// three's FileLoader reports progress with it; Node has none.
if (typeof globalThis.ProgressEvent === 'undefined') {
  (globalThis as unknown as { ProgressEvent: unknown }).ProgressEvent = class ProgressEvent {
    type: string;
    constructor(type: string, init: Record<string, unknown> = {}) {
      this.type = type;
      Object.assign(this, init);
    }
  };
}

type Op = { kind: 'fillRect' | 'fillText'; args: unknown[] };

function canvasSpy() {
  const ops: Op[] = [];
  const ctx = {
    fillStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
    globalAlpha: 1,
    fillRect(...args: unknown[]) {
      ops.push({ kind: 'fillRect', args });
    },
    fillText(...args: unknown[]) {
      ops.push({ kind: 'fillText', args });
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, ops };
}

function screen(cols: number, rows: number, activeRows: number, width = cols, bg = -1): ScreenState {
  const lines: ScreenState['lines'] = [];
  for (let y = 0; y < activeRows; y++) lines[y] = [['x'.repeat(width), -1, bg, 0]];
  return { cols, rows, lines, cursor: [0, 0], version: 1 };
}

function textYs(ops: Op[]) {
  return ops.filter((op) => op.kind === 'fillText').map((op) => Number(op.args[2]));
}

test('fills a sparse wide laptop screen instead of leaving text in its upper half', () => {
  const { ctx, ops } = canvasSpy();
  paintScreen(ctx, 1024, 680, screen(100, 30, 8), undefined, 22);
  const ys = textYs(ops);
  assert.ok(ys.length > 0);
  assert.ok(Math.min(...ys) > 200, `first glyph y=${Math.min(...ys)}`);
  assert.ok(Math.max(...ys) < 480, `last glyph y=${Math.max(...ys)}`);
});

test('keeps very wide sparse output vertically centered within the laptop canvas', () => {
  const { ctx, ops } = canvasSpy();
  paintScreen(ctx, 1024, 680, screen(180, 45, 6), undefined, 22);
  const ys = textYs(ops);
  assert.ok(ys.length > 0);
  assert.ok(Math.min(...ys) > 250, `first glyph y=${Math.min(...ys)}`);
  assert.ok(Math.max(...ys) < 430, `last glyph y=${Math.max(...ys)}`);
});

test('keeps a tall full-screen styled terminal grid centered and complete', () => {
  const { ctx, ops } = canvasSpy();
  paintScreen(ctx, 1024, 680, screen(178, 45, 45, 178, 4), undefined, 22);
  const ys = textYs(ops);
  assert.equal(ys.length, 45);
  assert.ok(Math.min(...ys) > 60, `first glyph y=${Math.min(...ys)}`);
  assert.ok(Math.max(...ys) < 620, `last glyph y=${Math.max(...ys)}`);
  assert.equal(ops.filter((op) => op.kind === 'fillRect').length, 46, 'canvas fill plus one styled row per line');
});

test('preserves the plain narrow screen layout bounds', () => {
  const { ctx, ops } = canvasSpy();
  paintScreen(ctx, 1024, 680, screen(56, 22, 22, 20), undefined, 22);
  const ys = textYs(ops);
  assert.ok(ys.length > 0);
  assert.ok(Math.min(...ys) >= 20);
  assert.ok(Math.max(...ys) <= 660);
});

test('renders an empty screen as background without synthetic terminal text', () => {
  const { ctx, ops } = canvasSpy();
  paintScreen(ctx, 1024, 680, screen(100, 30, 0), undefined, 22);
  assert.deepEqual(textYs(ops), []);
  assert.deepEqual(ops[0], { kind: 'fillRect', args: [0, 0, 1024, 680] });
});

// --- The MacBook swap --------------------------------------------------------------
// The Laptop class builds a procedural stand-in, then swaps it for the MacBook GLBs once
// they are cached. The GLB test runs last: once the prop cache holds the MacBooks, every
// laptop built after it swaps to them.

function stubDocument(t: { after(fn: () => void): void }) {
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: (tag: string) => {
        assert.equal(tag, 'canvas');
        const { ctx } = canvasSpy();
        return { width: 300, height: 150, getContext: () => ctx };
      },
    },
  });
  t.after(() => {
    if (prev) Object.defineProperty(globalThis, 'document', prev);
    else Reflect.deleteProperty(globalThis, 'document');
  });
}

test('a laptop opens its procedural stand-in lid and paints its screen', (t) => {
  stubDocument(t);
  const laptop = new Laptop();
  const inner = laptop as unknown as { baseModel: THREE.Group; lidModel: THREE.Group; lid: THREE.Group };
  assert.equal(inner.baseModel.children.length, 3);
  assert.equal(inner.lidModel.children.length, 3);
  const closed = inner.lid.rotation.x;
  laptop.setPlaceholder('waiting…');
  laptop.update(0.1, screen(80, 24, 5), 3);
  assert.ok(inner.lid.rotation.x < closed, 'the lid opens');
  assert.ok(laptop.shut(10), 'a long fold shuts the lid');
  assert.equal(inner.lid.rotation.x, closed);
  laptop.dispose();
});

test('wireDisplay points a GLB Display node at the live screen, and ignores the stand-in', (t) => {
  stubDocument(t);
  const laptop = new Laptop();
  const inner = laptop as unknown as { wireDisplay(): void; lidModel: THREE.Group; screenMat: THREE.MeshBasicMaterial };
  inner.wireDisplay(); // the stand-in lid has no Display node: a no-op, not a throw
  const display = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
  display.name = 'Display';
  inner.lidModel.add(display);
  inner.wireDisplay();
  assert.equal(display.material, inner.screenMat);
  laptop.dispose();
});

/** A one-triangle GLB with a single named node and no compression, for the swap test. */
function triangleGlb(nodeName: string): Buffer {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = new Uint16Array([0, 1, 2]);
  const payload = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(indices.buffer)]);
  const bin = Buffer.concat([payload, Buffer.alloc((4 - (payload.length % 4)) % 4)]);
  const json = {
    asset: { version: '2.0' },
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: nodeName }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ name: 'Mat', pbrMetallicRoughness: {} }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
      { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
  };
  const raw = Buffer.from(JSON.stringify(json));
  const jsonChunk = Buffer.concat([raw, Buffer.alloc((4 - (raw.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + bin.length, 8);
  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(jsonChunk.length, 0);
  jsonHead.writeUInt32LE(0x4e4f534a, 4);
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(bin.length, 0);
  binHead.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHead, jsonChunk, binHead, bin]);
}

test('a laptop swaps its stand-in for the MacBook GLBs once they are cached', async (t) => {
  stubDocument(t);
  const dracoDir = path.join(import.meta.dirname, '..', 'src', 'client', 'public', 'props', 'draco');
  const glbs: Record<string, Buffer> = {
    '/props/macbook-base.glb': triangleGlb('Body'),
    '/props/macbook-lid.glb': triangleGlb('Display'),
  };
  const row = (url: string) => ({ url, triangles: 1, bytes: 1, materials: 1, tags: ['desk'], width: 1, height: 1, depth: 1 });
  const server = createServer((req, res) => {
    const p = (req.url ?? '').split('?')[0];
    if (p === '/props/manifest.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ 'macbook-base': row('/props/macbook-base.glb'), 'macbook-lid': row('/props/macbook-lid.glb') }));
    } else if (glbs[p]) {
      res.writeHead(200, { 'content-type': 'model/gltf-binary' });
      res.end(glbs[p]);
    } else if (p.startsWith('/props/draco/')) {
      // The loader warms up the decoder on first use; serve the real one so the
      // warmup resolves instead of rejecting where nobody catches it.
      res.writeHead(200).end(readFileSync(path.join(dracoDir, path.basename(p))));
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as Address).port}`;
  // The client fetches site-relative prop URLs; resolve them against the test server the
  // way the browser resolves them against the page. FileLoader wraps its URL in a
  // Request, which also refuses relative URLs without a base.
  const realFetch = globalThis.fetch;
  const realRequest = globalThis.Request;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/')) return realFetch(new URL(input, base), init);
    return realFetch(input as string, init);
  }) as typeof fetch;
  globalThis.Request = class extends realRequest {
    constructor(input: string | URL | Request, init?: RequestInit) {
      if (typeof input === 'string' && input.startsWith('/')) input = new URL(input, base).href;
      super(input as string, init);
    }
  } as unknown as typeof Request;
  t.after(() => {
    globalThis.fetch = realFetch;
    globalThis.Request = realRequest;
  });

  await loadPropManifest();
  await preloadProps(['macbook-base', 'macbook-lid']);
  assert.ok(propReady('macbook-base') && propReady('macbook-lid'), 'the test GLBs preload');
  const laptop = new Laptop();
  laptop.update(0.016, undefined, 0);
  const inner = laptop as unknown as { baseModel: THREE.Group; lidModel: THREE.Group; screenMat: THREE.Material };
  assert.equal(inner.baseModel.children.length, 1, 'the stand-in base is replaced by the GLB');
  const display = inner.lidModel.getObjectByName('Display') as THREE.Mesh | undefined;
  assert.ok(display?.isMesh, 'the lid GLB lands with its Display node');
  assert.equal(display.material, inner.screenMat, 'the live screen paints onto the GLB display');
  laptop.dispose();
});
