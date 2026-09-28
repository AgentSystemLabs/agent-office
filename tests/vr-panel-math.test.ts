import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canvasSize, clampScroll, followStep, followTarget, gridMetrics, hitTest, isOnPanel, keyRects, panelToPx,
  pointInRect, rectToPx, scrollByDrag, scrollByStick, unionRect, uvToPanel,
} from '../src/client/vr/math.js';
import { base16, fullPalette, pushHistory, runColor, runsEqual, scrolledOffLines } from '../src/client/vr/ansi.js';
import { RGB_FLAG, type Run } from '../src/shared/protocol.js';

const THEME = {
  background: '#0a0a0a', foreground: '#eeeeee',
  black: '#282a36', red: '#ff5c7a', green: '#7cf29a', yellow: '#ffd166',
  blue: '#6cb6ff', magenta: '#d69cff', cyan: '#72ddf7', white: '#e6e6f0',
  brightBlack: '#6c7086', brightRed: '#ff8fa3', brightGreen: '#a6f4b8', brightYellow: '#ffe29a',
  brightBlue: '#9ccfff', brightMagenta: '#e5c1ff', brightCyan: '#a5ecfb', brightWhite: '#ffffff',
};

test('uvToPanel flips the ray UV into top-left panel coordinates', () => {
  assert.deepEqual(uvToPanel(0, 0), { x: 0, y: 1 });
  assert.deepEqual(uvToPanel(1, 1), { x: 1, y: 0 });
  assert.deepEqual(uvToPanel(0.25, 0.75), { x: 0.25, y: 0.25 });
});

test('isOnPanel rejects intersections outside the panel face', () => {
  assert.equal(isOnPanel(0.5, 0.5), true);
  assert.equal(isOnPanel(0, 1), true);
  assert.equal(isOnPanel(-0.01, 0.5), false);
  assert.equal(isOnPanel(0.5, 1.01), false);
});

test('pointInRect counts edges as inside', () => {
  const r = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
  assert.equal(pointInRect({ x: 0.1, y: 0.2 }, r), true);
  assert.equal(pointInRect({ x: 0.4, y: 0.6 }, r), true);
  assert.equal(pointInRect({ x: 0.09, y: 0.3 }, r), false);
  assert.equal(pointInRect({ x: 0.2, y: 0.61 }, r), false);
});

test('hitTest lets the last (topmost) rect win, like overlapping buttons', () => {
  const rects = [
    { id: 'scroll', rect: { x: 0, y: 0, w: 1, h: 1 } },
    { id: 'jump', rect: { x: 0.78, y: 0.895, w: 0.2, h: 0.085 } },
  ];
  assert.equal(hitTest(rects, { x: 0.85, y: 0.93 })?.id, 'jump');
  assert.equal(hitTest(rects, { x: 0.1, y: 0.1 })?.id, 'scroll');
  assert.equal(hitTest([], { x: 0.5, y: 0.5 }), null);
});

test('synthetic ray UVs hit a close button in the panel corner', () => {
  // A ray striking the panel's top-right lands at high u, high v (bottom-left origin).
  const close = { x: 0.93, y: 0.012, w: 0.058, h: 0.086 };
  assert.equal(pointInRect(uvToPanel(0.96, 0.95), close), true);
  assert.equal(pointInRect(uvToPanel(0.5, 0.5), close), false);
});

test('panelToPx and rectToPx scale normalized coords to canvas pixels', () => {
  assert.deepEqual(panelToPx({ x: 0.5, y: 0.25 }, 1000, 800), { x: 500, y: 200 });
  assert.deepEqual(rectToPx({ x: 0.1, y: 0.2, w: 0.5, h: 0.5 }, 1000, 800), { x: 100, y: 160, w: 500, h: 400 });
});

test('unionRect merges dirty regions and tolerates nulls', () => {
  assert.equal(unionRect(null, null), null);
  assert.deepEqual(unionRect(null, { x: 1, y: 1, w: 1, h: 1 }), { x: 1, y: 1, w: 1, h: 1 });
  assert.deepEqual(unionRect({ x: 0, y: 0, w: 1, h: 1 }, { x: 0.5, y: 0.5, w: 1, h: 1 }), { x: 0, y: 0, w: 1.5, h: 1.5 });
});

test('canvasSize scales with devicePixelRatio and caps it at 2', () => {
  assert.deepEqual(canvasSize(1, 0.5, 1, 1000), { w: 1000, h: 500 });
  assert.deepEqual(canvasSize(1, 0.5, 2, 1000), { w: 2000, h: 1000 });
  assert.deepEqual(canvasSize(1, 0.5, 4, 1000), { w: 2000, h: 1000 });
  assert.deepEqual(canvasSize(1, 0.5, 0, 1000), { w: 1000, h: 500 });
});

test('clampScroll pins short content at zero and offsets to the content', () => {
  assert.equal(clampScroll(5, 10, 20), 0);
  assert.equal(clampScroll(-3, 100, 20), 0);
  assert.equal(clampScroll(999, 100, 20), 80);
  assert.equal(clampScroll(40, 100, 20), 40);
  assert.equal(clampScroll(NaN, 100, 20), 0);
});

test('scrollByDrag moves content with the ray', () => {
  assert.equal(scrollByDrag(10, 0.5, 0.6, 20), 8); // drag down looks back up
  assert.equal(scrollByDrag(10, 0.5, 0.4, 20), 12);
});

test('scrollByStick ignores the dead zone and scrolls at a steady rate', () => {
  assert.equal(scrollByStick(10, 0.05, 1, 12), 10);
  assert.equal(scrollByStick(10, 0.5, 1, 12), 16);
  assert.equal(scrollByStick(10, -1, 0.5, 12), 4);
});

test('followStep glides towards the target without overshooting', () => {
  assert.deepEqual(followStep([0, 0, 0], [1, 0, 0], 0.5), [0.5, 0, 0]);
  assert.deepEqual(followStep([0, 0, 0], [1, 2, 3], 0), [0, 0, 0]);
  assert.deepEqual(followStep([0, 0, 0], [1, 2, 3], 1), [1, 2, 3]);
  assert.deepEqual(followStep([0, 0, 0], [1, 2, 3], 99), [1, 2, 3]);
});

test('followTarget sits a fixed distance along the camera ray, dropped a little', () => {
  assert.deepEqual(followTarget([0, 1.6, 0], [0, 0, -1], 1.1, 0.12), [0, 1.48, -1.1]);
});

test('keyRects stretch every row across the panel without overlaps', () => {
  const rows = [
    [{ id: 'a', label: 'a' }, { id: 'space', label: 'space', w: 5 }, { id: 'b', label: 'b' }],
    [{ id: 'c', label: 'c', w: 2 }, { id: 'd', label: 'd', w: 2 }],
  ];
  const keys = keyRects(rows, { gapX: 0.01, gapY: 0.02, padX: 0.02, padY: 0.04 });
  assert.equal(keys.length, 5);
  // Every row spans the field.
  for (const r of [0, 1]) {
    const rowKeys = keys.filter((k) => Math.abs(k.rect.y - (0.04 + r * (keys[0].rect.h + 0.02))) < 1e-9);
    const left = Math.min(...rowKeys.map((k) => k.rect.x));
    const right = Math.max(...rowKeys.map((k) => k.rect.x + k.rect.w));
    assert.ok(Math.abs(left - 0.02) < 1e-9, `row ${r} starts at the padding, got ${left}`);
    assert.ok(Math.abs(right - 0.98) < 1e-9, `row ${r} ends at the padding, got ${right}`);
  }
  // The wide key is five plain keys wide.
  const a = keys.find((k) => k.id === 'a')!.rect;
  const space = keys.find((k) => k.id === 'space')!.rect;
  assert.ok(Math.abs(space.w / a.w - 5) < 1e-9, `space/a = ${space.w / a.w}`);
  // No two keys overlap.
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const r = keys[i].rect;
      const s = keys[j].rect;
      const overlap = r.x < s.x + s.w && s.x < r.x + r.w && r.y < s.y + s.h && s.y < r.y + r.h;
      assert.equal(overlap, false, `${keys[i].id} overlaps ${keys[j].id}`);
    }
  }
});

test('gridMetrics fits the font inside its cells', () => {
  const m = gridMetrics(1000, 500, 100, 25);
  assert.equal(m.cellW * 100 <= 1000 + 1e-9, true);
  assert.equal(m.cellH * 25 <= 500 + 1e-9, true);
  assert.ok(m.fontPx >= 4);
  assert.ok(m.left >= 0 && m.top >= 0);
});

test('base16 follows the theme order (black..white, then brights)', () => {
  const p = base16(THEME);
  assert.equal(p.length, 16);
  assert.equal(p[0], THEME.black);
  assert.equal(p[1], THEME.red);
  assert.equal(p[9], THEME.brightRed);
  assert.equal(p[15], THEME.brightWhite);
});

test('fullPalette extends the base with the 216 cube and the grey ramp', () => {
  const p = fullPalette(THEME);
  assert.equal(p.length, 256);
  assert.equal(p[16], 'rgb(0,0,0)');
  assert.equal(p[231], 'rgb(255,255,255)');
  assert.equal(p[232], 'rgb(8,8,8)');
  assert.equal(p[255], 'rgb(238,238,238)');
});

test('runColor maps defaults, palette entries and true color', () => {
  const p = fullPalette(THEME);
  assert.equal(runColor(-1, 'fg', p), 'fg');
  assert.equal(runColor(1, 'fg', p), THEME.red);
  assert.equal(runColor(9, 'fg', p), THEME.brightRed);
  assert.equal(runColor(999, 'fg', p), 'fg');
  assert.equal(runColor(RGB_FLAG | 0x112233, 'fg', p), 'rgb(17,34,51)');
});

const run = (text: string, fg = -1, bg = -1, flags = 0): Run => [text, fg, bg, flags];

test('runsEqual compares text and style run by run', () => {
  assert.equal(runsEqual(undefined, undefined), true);
  assert.equal(runsEqual([run('a')], [run('a')]), true);
  assert.equal(runsEqual([run('a')], [run('b')]), false);
  assert.equal(runsEqual([run('a', 1)], [run('a', 2)]), false);
  assert.equal(runsEqual([run('a')], [run('a'), run('b')]), false);
});

test('scrolledOffLines collects the lines that left the top', () => {
  const prev = [[run('one')], [run('two')], [run('three')]];
  const next = [[run('two')], [run('three')], [run('four')]];
  const off = scrolledOffLines(prev, next);
  assert.deepEqual(off, [[run('one')]]);
  // A redraw or an alt-screen app yields no history.
  assert.deepEqual(scrolledOffLines(prev, [[run('other')], [run('two')], [run('three')]]), []);
  assert.deepEqual(scrolledOffLines([], next), []);
});

test('pushHistory caps the buffer, oldest first', () => {
  const h: Run[][] = [];
  pushHistory(h, [[run('a')], [run('b')], [run('c')]], 2);
  assert.deepEqual(h, [[run('b')], [run('c')]]);
});
