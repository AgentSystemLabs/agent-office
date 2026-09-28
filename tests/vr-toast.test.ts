import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { VrToast } from '../src/client/vr/toast.js';

/** A toast on stub DOM + a controllable clock, with painted lines captured. */
function rig(t: TestContext) {
  const lines: string[] = [];
  const ctx = {
    fillStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
    beginPath() {},
    roundRect() {},
    rect() {},
    clip() {},
    clearRect() {},
    fill() {},
    save() {},
    restore() {},
    fillText(text: string) {
      lines.push(String(text));
    },
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  const doc = { createElement: () => canvas };
  const prevDoc = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  t.after(() => {
    if (prevDoc) Object.defineProperty(globalThis, 'document', prevDoc);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  let now = 1000;
  const prevPerf = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
  t.after(() => {
    if (prevPerf) Object.defineProperty(globalThis, 'performance', prevPerf);
  });
  const toast = new VrToast();
  const painted = () => {
    lines.length = 0;
    toast.panel.repaintNow();
    return lines[lines.length - 1] ?? '';
  };
  return { toast, painted, advance: (ms: number) => (now += ms) };
}

test('a fresh toast talks over the sticky line, which returns once it expires', (t) => {
  const { toast, painted, advance } = rig(t);
  toast.setSticky('✋ Carrying #12 — E at a desk');
  assert.equal(painted(), '✋ Carrying #12 — E at a desk');
  toast.show('💥 The build broke', 'error');
  assert.equal(painted(), '💥 The build broke');
  advance(3999);
  assert.equal(painted(), '💥 The build broke');
  advance(2);
  assert.equal(painted(), '✋ Carrying #12 — E at a desk');
  assert.equal(toast.visible, true);
});

test('clearing the sticky line with nothing fresh hides the strip', (t) => {
  const { toast, advance } = rig(t);
  toast.setSticky('✋ Carrying #12 — E at a desk');
  toast.show('hi', 'info');
  advance(5000);
  toast.setSticky(null);
  toast.update(1 / 60);
  assert.equal(toast.visible, false);
});
