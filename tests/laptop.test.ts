import test from 'node:test';
import assert from 'node:assert/strict';
import { paintScreen, type ScreenState } from '../src/client/world/laptop.js';

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
