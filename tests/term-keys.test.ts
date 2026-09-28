import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { CTRL_ENTER, SHIFT_ENTER, enterKeyAction, modifiedEnter, wantsCsiEnter, type KeyEventLike } from '../src/client/term-keys.js';
import { VrKeyboard } from '../src/client/vr/keyboard.js';
import { VrTerminalPanel, type VrTerminalMsg } from '../src/client/vr/terminal-panel.js';
import type { WorkerInfo } from '../src/shared/protocol.js';

function key(type: string, mods: Partial<KeyEventLike> = {}): KeyEventLike {
  return { type, key: 'Enter', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods };
}

test('only Droid agents get CSI u Enter', () => {
  assert.equal(wantsCsiEnter('agent', 'droid'), true);
  for (const p of ['claude', 'codex', 'opencode', 'custom', undefined] as const) assert.equal(wantsCsiEnter('agent', p), false, String(p));
  assert.equal(wantsCsiEnter('shell', 'droid'), false);
  assert.equal(wantsCsiEnter(undefined, undefined), false);
});

test('Ctrl+Enter and Shift+Enter encode as CSI u; other Enters keep the default', () => {
  assert.equal(modifiedEnter(true, { ctrl: true }), CTRL_ENTER);
  assert.equal(CTRL_ENTER, '\x1b[13;5u');
  assert.equal(modifiedEnter(true, { shift: true }), SHIFT_ENTER);
  assert.equal(SHIFT_ENTER, '\x1b[13;2u');
  assert.equal(modifiedEnter(true, {}), undefined);
  assert.equal(modifiedEnter(true, { alt: true }), undefined);
  assert.equal(modifiedEnter(true, { ctrl: true, alt: true }), undefined);
  assert.equal(modifiedEnter(true, { ctrl: true, meta: true }), undefined);
  assert.equal(modifiedEnter(true, { ctrl: true, shift: true }), undefined);
  assert.equal(modifiedEnter(false, { ctrl: true }), undefined);
  assert.equal(modifiedEnter(false, { shift: true }), undefined);
});

test('the DOM key handler sends on keydown and swallows the matching keypress/keyup', () => {
  assert.deepEqual(enterKeyAction(true, key('keydown', { ctrlKey: true })), { do: 'send', data: CTRL_ENTER });
  assert.deepEqual(enterKeyAction(true, key('keypress', { ctrlKey: true })), { do: 'swallow' });
  assert.deepEqual(enterKeyAction(true, key('keyup', { ctrlKey: true })), { do: 'swallow' });
  assert.deepEqual(enterKeyAction(true, key('keydown', { shiftKey: true })), { do: 'send', data: SHIFT_ENTER });
});

test('the DOM key handler leaves plain, Alt, IME and non-Droid Enter to xterm', () => {
  assert.deepEqual(enterKeyAction(true, key('keydown')), { do: 'default' });
  assert.deepEqual(enterKeyAction(true, key('keydown', { altKey: true })), { do: 'default' });
  assert.deepEqual(enterKeyAction(true, key('keydown', { ctrlKey: true, isComposing: true })), { do: 'default' });
  assert.deepEqual(enterKeyAction(false, key('keydown', { ctrlKey: true })), { do: 'default' });
  assert.deepEqual(enterKeyAction(false, key('keydown', { shiftKey: true })), { do: 'default' });
  assert.deepEqual(enterKeyAction(true, { ...key('keydown', { ctrlKey: true }), key: 'a' }), { do: 'default' });
});

/** Stub canvas + clock so the VR panels construct under node. */
function stubDom(t: TestContext) {
  const ctx = new Proxy({}, { get: (_t, p) => (p === 'measureText' ? () => ({ width: 1 }) : () => {}), set: () => true });
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  const prevDoc = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => canvas } });
  t.after(() => {
    if (prevDoc) Object.defineProperty(globalThis, 'document', prevDoc);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  // A fixed clock well past zero: shift's double-tap window starts from a last tap at 0.
  const prevPerf = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => 10_000 } });
  t.after(() => {
    if (prevPerf) Object.defineProperty(globalThis, 'performance', prevPerf);
  });
}

function vrTerminal(t: TestContext, worker: Partial<WorkerInfo>) {
  stubDom(t);
  const sent: VrTerminalMsg[] = [];
  const w = { id: 'w1', kind: 'agent', cols: 96, rows: 28, ...worker } as WorkerInfo;
  const panel = new VrTerminalPanel({ send: (m) => sent.push(m), subscribe: () => () => {}, getScreen: () => undefined, getWorker: () => w });
  panel.open('w1');
  const keyboard = new VrKeyboard();
  keyboard.setTarget({ sendText: (s) => panel.type(s), sendEnter: (mods) => panel.typeEnter(mods) });
  keyboard.show();
  const inputs = () => sent.flatMap((m) => (m.t === 'term.input' ? [m.data] : []));
  return { keyboard, inputs };
}

test('VR keyboard: latched Ctrl then Enter queues on a Droid worker; one-shot Shift+Enter is a newline', (t) => {
  const { keyboard, inputs } = vrTerminal(t, { provider: 'droid' });
  keyboard.panel.clickButton('fn:ctrl');
  keyboard.panel.clickButton('fn:enter');
  keyboard.panel.clickButton('fn:enter2');
  keyboard.panel.clickButton('fn:ctrl'); // the latch is sticky: tap again to release
  keyboard.panel.clickButton('fn:enter');
  keyboard.panel.clickButton('fn:shift');
  keyboard.panel.clickButton('fn:enter');
  keyboard.panel.clickButton('fn:enter'); // shift was one-shot
  assert.deepEqual(inputs(), [CTRL_ENTER, CTRL_ENTER, '\r', SHIFT_ENTER, '\r']);
});

test('VR keyboard: caps lock does not turn Enter into Shift+Enter', (t) => {
  const { keyboard, inputs } = vrTerminal(t, { provider: 'droid' });
  // Arm, disarm, then a quick tap after a disarm locks.
  keyboard.panel.clickButton('fn:shift');
  keyboard.panel.clickButton('fn:shift');
  keyboard.panel.clickButton('fn:shift');
  assert.equal(keyboard.latched.shift, true);
  keyboard.panel.clickButton('fn:enter');
  assert.deepEqual(inputs(), ['\r']);
});

test('VR keyboard: modified Enter stays a CR on other workers', (t) => {
  const { keyboard, inputs } = vrTerminal(t, { provider: 'claude' });
  keyboard.panel.clickButton('fn:ctrl');
  keyboard.panel.clickButton('fn:enter');
  keyboard.panel.clickButton('fn:shift');
  keyboard.panel.clickButton('fn:enter');
  assert.deepEqual(inputs(), ['\r', '\r']);
});

test('physical keyboard in VR: modified Enter is re-encoded for Droid, other Enters keep their bytes', (t) => {
  stubDom(t);
  const run = (provider: WorkerInfo['provider']) => {
    const sent: VrTerminalMsg[] = [];
    const w = { id: 'w1', kind: 'agent', cols: 96, rows: 28, provider } as WorkerInfo;
    const panel = new VrTerminalPanel({ send: (m) => sent.push(m), subscribe: () => () => {}, getScreen: () => undefined, getWorker: () => w });
    panel.open('w1');
    panel.typeEnter({ ctrl: true }, '\r');
    panel.typeEnter({ shift: true }, '\r');
    panel.typeEnter({ alt: true }, '\x1b\r');
    panel.typeEnter({}, '\r');
    return sent.flatMap((m) => (m.t === 'term.input' ? [m.data] : []));
  };
  assert.deepEqual(run('droid'), [CTRL_ENTER, SHIFT_ENTER, '\x1b\r', '\r']);
  assert.deepEqual(run('claude'), ['\r', '\r', '\x1b\r', '\r']);
});

test('VR keyboard: a target without sendEnter still gets a CR', (t) => {
  stubDom(t);
  const got: string[] = [];
  const keyboard = new VrKeyboard();
  keyboard.setTarget({ sendText: (s) => got.push(s) });
  keyboard.show();
  keyboard.panel.clickButton('fn:ctrl');
  keyboard.panel.clickButton('fn:enter');
  assert.deepEqual(got, ['\r']);
});
