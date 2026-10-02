import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioCore } from '../src/client/sound/core';
import { Typing } from '../src/client/sound/typing';

function core(t: { after(fn: () => void): void }) {
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const document = { hidden: false, addEventListener() {} };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener() {} } });
  t.after(() => {
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else Reflect.deleteProperty(globalThis, 'document');
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window');
  });
  return { a: new AudioCore({ start() {}, touched() {} }), document };
}

test('muted, zero-volume and hidden typing do not allocate audio nodes', (t) => {
  const { a, document } = core(t);
  // Scheduling recipes only need the running clock here, rather than an actual audio device.
  Object.defineProperty(a, 'ctx', { value: { state: 'running' }, configurable: true });
  a.applyVolume = () => {};
  let allocated = 0;
  a.panner = () => { allocated++; throw new Error('inaudible panner allocated'); };
  a.play = () => { allocated++; };
  const typing = new Typing(a);
  typing.setTyping('worker', 1, 1, true);
  a.setVolume(0.7, true);
  typing.scheduleTyping(1);
  typing.fidget(1);
  a.setVolume(0, false);
  typing.scheduleTyping(2);
  a.setVolume(0.7, false);
  document.hidden = true;
  typing.scheduleTyping(3);
  assert.equal(allocated, 0);
  document.hidden = false;
  assert.equal(a.ambienceAudible, true);
});

test('muted ambient tickers are suppressed while independent alert/music tickers continue', (t) => {
  const { a } = core(t);
  a.applyVolume = () => {};
  Object.defineProperty(a, 'ctx', { value: { state: 'running', currentTime: 1, listener: { setPosition() {}, setOrientation() {} } }, configurable: true });
  let ambience = 0;
  let independent = 0;
  a.every(() => { ambience++; }, true);
  a.every(() => { independent++; });
  a.setVolume(0.7, true);
  a.update({ x: 0, y: 1, z: 0, fx: 0, fz: -1 });
  assert.equal(ambience, 0);
  assert.equal(independent, 1);
  a.setVolume(0.7, false);
  a.update({ x: 0, y: 1, z: 0, fx: 0, fz: -1 });
  assert.equal(ambience, 1);
  assert.equal(independent, 2);
});
