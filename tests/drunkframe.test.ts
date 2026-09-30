import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { DrunkPicture, drunkStyle } from '../src/client/drunkframe.js';

/** Just enough DOM for DrunkPicture: it makes SVG elements, sets attributes and hangs one on the body. */
function dom(t: TestContext) {
  const el = (ns: string) => {
    const attrs: Record<string, string> = {};
    const children: unknown[] = [];
    return {
      ns,
      attrs,
      children,
      style: {
        cssText: '',
        filter: '',
        setProperty(k: string, v: string) { attrs[k] = v; },
        removeProperty(k: string) { delete attrs[k]; },
      },
      setAttribute: (k: string, v: string) => { attrs[k] = v; },
      append: (...kids: unknown[]) => { children.push(...kids); },
      ownerDocument: null as unknown,
    };
  };
  const body = el('html');
  const document = { createElementNS: (ns: string) => el(ns === 'http://www.w3.org/2000/svg' ? 'svg' : 'html'), body };
  const frame = el('html') as unknown as HTMLElement & { attrs: Record<string, string>; style: { attrs: Record<string, string> } };
  frame.style.attrs = frame.attrs;
  frame.ownerDocument = document;
  for (const [name, value] of [['window', new EventTarget()], ['document', document]] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  return { frame, body };
}

test('straight means straight: no filter at all, which is the whole cost of being sober', (t) => {
  const { frame } = dom(t);
  const picture = new DrunkPicture(frame);
  for (const sober of [0, 0.005, -1, NaN]) {
    assert.equal(drunkStyle(sober, 3, true), null, String(sober));
    picture.apply(sober, 3, true);
    assert.equal(frame.style.filter, '');
  }
});

test('one drink puts the filter on the picture, and sobering up takes it off again', (t) => {
  const { frame } = dom(t);
  const picture = new DrunkPicture(frame);
  assert.equal(frame.style.filter, '');
  picture.apply(0.5, 2, true);
  const filter = frame.style.filter;
  assert.match(filter, /^url\(#office-drunk-\d+\)$/);
  // The corners darken with it.
  assert.equal(frame.style.attrs['--drunk'], '0.300');
  // Still on after another frame, and the id doesn't change under it.
  picture.apply(0.6, 2.1, true);
  assert.equal(frame.style.filter, filter);
  assert.equal(frame.style.attrs['--drunk'], '0.360');
  picture.release();
  assert.equal(frame.style.filter, '');
  assert.equal(frame.style.attrs['--drunk'], undefined);
  // And releasing twice is fine: the second one had nothing to take back.
  picture.release();
  assert.equal(frame.style.filter, '');
});

test('the effect grows with the drink, and the drink saturates where the shader says it does', () => {
  const tipsy = drunkStyle(0.3, 0, true)!;
  const drunk = drunkStyle(0.8, 0, true)!;
  assert.ok(drunk.smear > tipsy.smear && drunk.wobble > tipsy.wobble);
  assert.ok(drunk.doubled > tipsy.doubled && drunk.corners > tipsy.corners);
  assert.ok(drunk.fringe > tipsy.fringe);
  assert.notEqual(drunk.grade, tipsy.grade);
  // `k` is the shader's `min(a, 1.0)`: past it, the doubling, the warmth and the dark corners are
  // already as far as they go and only the smear and the ripple keep growing with `a` itself.
  const wasted = drunkStyle(1.2, 0, true)!;
  const past = drunkStyle(1.5, 0, true)!;
  assert.equal(past.doubled, wasted.doubled);
  assert.equal(past.corners, wasted.corners);
  assert.equal(past.fringe, wasted.fringe);
  assert.equal(past.grade, wasted.grade);
  assert.ok(past.smear > wasted.smear && past.wobble > wasted.wobble);
  // And the amount is clamped at the shader's own 1.6, so nothing runs away.
  assert.deepEqual(drunkStyle(9, 0, true), drunkStyle(1.6, 0, true));
});

test('the picture swims rather than sitting still, unless motion is off', () => {
  const here = drunkStyle(0.8, 10, true)!;
  const later = drunkStyle(0.8, 12.5, true)!;
  assert.notEqual(here.dx, later.dx);
  assert.notEqual(here.dy, later.dy);
  // What doesn't move: the smear, the warmth, how dark the corners go.
  assert.equal(here.smear, later.smear);
  assert.equal(here.grade, later.grade);
  assert.equal(here.corners, later.corners);
  // Reduced motion holds the clock at zero, which is what world/drunk.ts does with its own: the
  // picture settles into one pose, whichever time of the clock it's asked for.
  const still = drunkStyle(0.8, 0, false)!;
  assert.deepEqual(still, drunkStyle(0.8, 12.5, false));
  assert.notEqual(still.dx, here.dx);
  assert.notEqual(still.dy, here.dy);
});

test('the second picture is blended back in, not washed over the first', () => {
  // The ghost has to keep its colours and only lose alpha, or `mix` comes out as a flat wash.
  const style = drunkStyle(0.9, 1, true)!;
  const rows = style.grade.split(' ');
  assert.equal(rows.length, 20, 'four rows of five');
  // Saturation about the brightness: the weights of each row sum to 1, so a grey pixel comes out
  // grey. They sum to the warm multiply instead, which is `col *= vec3(1.08, 0.98, 0.9)`.
  const sum = [0, 1, 2].map((row) => Number(rows[row * 5]) + Number(rows[row * 5 + 1]) + Number(rows[row * 5 + 2]));
  for (const [row, warm] of [[0, 1.08], [1, 0.98], [2, 0.9]] as const) {
    assert.ok(Math.abs(sum[row] - warm) < 0.002, `row ${row} sums to ${sum[row]}, wanted ${warm}`);
  }
  // And it's warm: red up, blue down. Each row's own weight is its diagonal, at 0, 6 and 11.
  assert.ok(Number(rows[0]) > Number(rows[6]), 'red over green');
  assert.ok(Number(rows[6]) > Number(rows[11]), 'green over blue');
  // The same luminance weight in two rows differs only by the warmth of that row — which is the
  // whole of the shader's `col *= vec3(1.08, 0.98, 0.9)`, with no saturation mixed in anywhere.
  for (const [a, b, warm] of [
    [2, 7, 1.08 / 0.98], // the blue weight, 0.114, in the red row and the green row
    [5, 10, 0.98 / 0.9], // the red weight, 0.299, in the green row and the blue row
    [1, 11, 1.08 / 0.9], // the green weight, 0.587, in the red row and the blue row
  ] as const) {
    const got = Number(rows[a]) / Number(rows[b]);
    assert.ok(Math.abs(got - warm) < 0.01, `${rows[a]}/${rows[b]} is ${got}, wanted the warmth ${warm}`);
  }
  // Past one drink the two are blended a shade harder than the shader's 0.45, so they read as two
  // on a picture this size; it still has to be a mix rather than the ghost winning outright.
  assert.ok(style.doubled > 0 && style.doubled <= 0.55, `doubled is ${style.doubled}`);
  assert.ok(style.fringe > 0 && style.fringe <= 0.4, `fringe is ${style.fringe}`);
});
