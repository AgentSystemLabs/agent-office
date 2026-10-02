import test from 'node:test';
import assert from 'node:assert/strict';
import { paintScreen } from '../src/client/features/workers/laptop.js';
import type { ScreenState } from '../src/client/state/store.js';

type Op = { kind: 'fillRect' | 'fillText'; args: unknown[] };

function canvasSpy() {
  const ops: Op[] = [];
  const ctx = {
    fillStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
    globalAlpha: 1,
    fillRect(...args: unknown[]) { ops.push({ kind: 'fillRect', args }); },
    fillText(...args: unknown[]) { ops.push({ kind: 'fillText', args }); },
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

async function laptopFixture(t: { after(fn: () => void): void }, style: 'laptop' | 'tome' = 'laptop') {
  const THREE = await import('three');
  const { Laptop } = await import('../src/client/features/workers/laptop.js');
  const { toon } = await import('../src/client/world/toon.js');
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const oldNow = Object.getOwnPropertyDescriptor(performance, 'now');
  const { ctx, ops } = canvasSpy();
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => canvas } });
  let clock = 0;
  Object.defineProperty(performance, 'now', { configurable: true, value: () => clock });
  const laptop = new Laptop(style, { laptopWidth: 512, laptopRefreshMs: 500 });
  t.after(() => {
    laptop.dispose();
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else Reflect.deleteProperty(globalThis, 'document');
    if (oldNow) Object.defineProperty(performance, 'now', oldNow); else Reflect.deleteProperty(performance, 'now');
  });
  return { THREE, laptop, toon, canvas, ops, clock: (now: number) => { clock = now; } };
}

test('laptop refresh follows live width/cadence and catches up once visible', async (t) => {
  const { laptop, canvas, ops, clock } = await laptopFixture(t);
  const first = screen(56, 22, 1);
  ops.length = 0;
  laptop.update(0.1, first);
  assert.equal(canvas.width, 512);
  assert.ok(ops.length > 0);
  ops.length = 0;
  clock(100);
  laptop.update(0.1, { ...first, version: 2 });
  assert.equal(ops.length, 0);
  clock(1000);
  laptop.update(0.1, { ...first, version: 3 }, 0, false);
  assert.equal(ops.length, 0, 'offscreen work stays dirty');
  laptop.update(0.1, { ...first, version: 3 });
  assert.ok(ops.length > 0, 'latest screen catches up on visibility');
  ops.length = 0;
  laptop.configure({ laptopWidth: 256, laptopRefreshMs: 1000 });
  laptop.update(0.1, { ...first, version: 3 });
  assert.equal(canvas.width, 256);
  assert.equal(canvas.height, 170);
  assert.ok(ops.length > 0, 'resolution change repaints same screen');
  ops.length = 0;
  clock(1500);
  laptop.update(0.1, { ...first, version: 4 });
  assert.equal(ops.length, 0);
  clock(2001);
  laptop.update(0.1, { ...first, version: 4 });
  assert.ok(ops.length > 0);
});

for (const style of ['laptop', 'tome'] as const) test(`${style} disposes owned GPU resources once and preserves shared toon materials`, async (t) => {
  const { THREE, laptop, toon } = await laptopFixture(t, style);
  const geometries = new Set<import('three').BufferGeometry>();
  const uniqueMaterials = new Set<import('three').Material>();
  const textures = new Set<import('three').Texture>();
  let freedGeometry = 0;
  let freedMaterial = 0;
  let freedTexture = 0;
  let sharedDisposals = 0;
  laptop.root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    geometries.add(node.geometry);
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) if (material instanceof THREE.MeshBasicMaterial) {
      uniqueMaterials.add(material);
      if (material.map) textures.add(material.map);
    }
  });
  for (const geometry of geometries) geometry.addEventListener('dispose', () => { freedGeometry++; });
  for (const material of uniqueMaterials) material.addEventListener('dispose', () => { freedMaterial++; });
  for (const texture of textures) texture.addEventListener('dispose', () => { freedTexture++; });
  const shared = toon(style === 'tome' ? '#5a2a17' : '#c9ced6');
  shared.addEventListener('dispose', () => { sharedDisposals++; });
  laptop.dispose();
  laptop.dispose();
  assert.ok(geometries.size > 4);
  assert.equal(freedGeometry, geometries.size);
  assert.equal(freedMaterial, style === 'tome' ? 2 : 1);
  assert.equal(freedTexture, 1);
  assert.equal(sharedDisposals, 0);
});
