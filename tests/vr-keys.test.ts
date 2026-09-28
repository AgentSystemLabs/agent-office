import test from 'node:test';
import assert from 'node:assert/strict';
import { captureVrKeys, keyBytes, type KeyLike } from '../src/client/vr/physical-keys.js';
import { PromptBuffer } from '../src/client/vr/prompt.js';

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

test('physical keys type the bytes the VR keyboard sends', () => {
  assert.equal(keyBytes(key('a')), 'a');
  assert.equal(keyBytes(key('A', { shiftKey: true })), 'A');
  assert.equal(keyBytes(key('!', { shiftKey: true })), '!');
  assert.equal(keyBytes(key(' ')), ' ');
  assert.equal(keyBytes(key('Enter')), '\r');
  assert.equal(keyBytes(key('Backspace')), '\x7f');
  assert.equal(keyBytes(key('Escape')), '\x1b');
  assert.equal(keyBytes(key('Tab')), '\t');
  assert.equal(keyBytes(key('ArrowLeft')), '\x1b[D');
  assert.equal(keyBytes(key('ArrowRight')), '\x1b[C');
  assert.equal(keyBytes(key('ArrowUp')), '\x1b[A');
  assert.equal(keyBytes(key('ArrowDown')), '\x1b[B');
  assert.equal(keyBytes(key('c', { ctrlKey: true })), '\x03');
  assert.equal(keyBytes(key(' ', { ctrlKey: true })), '\0');
});

test('physical keys cover the terminal keys the VR board lacks', () => {
  assert.equal(keyBytes(key('Tab', { shiftKey: true })), '\x1b[Z');
  assert.equal(keyBytes(key('Home')), '\x1b[H');
  assert.equal(keyBytes(key('End')), '\x1b[F');
  assert.equal(keyBytes(key('Delete')), '\x1b[3~');
  assert.equal(keyBytes(key('PageUp')), '\x1b[5~');
  assert.equal(keyBytes(key('ArrowLeft', { ctrlKey: true })), '\x1b[1;5D');
  assert.equal(keyBytes(key('ArrowRight', { altKey: true })), '\x1b[1;3C');
  assert.equal(keyBytes(key('b', { altKey: true })), '\x1bb');
  assert.equal(keyBytes(key('Backspace', { altKey: true })), '\x1b\x7f');
  assert.equal(keyBytes(key('[', { ctrlKey: true })), '\x1b');
});

test('physical keys with no bytes type nothing', () => {
  for (const name of ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'F5', 'Dead', 'Unidentified', 'AudioVolumeUp']) {
    assert.equal(keyBytes(key(name)), null, name);
  }
  assert.equal(keyBytes(key('v', { metaKey: true })), null, 'meta chords stay the browser’s');
  assert.equal(keyBytes(key('a', { isComposing: true })), null, 'IME composition');
  assert.equal(keyBytes(key('1', { ctrlKey: true })), null, 'ctrl+1 has no control code');
});

test('AltGr and Option characters type as themselves', () => {
  assert.equal(keyBytes(key('@', { ctrlKey: true, altKey: true, altGraph: true })), '@');
  assert.equal(keyBytes(key('€', { ctrlKey: true, altKey: true })), '€');
  assert.equal(keyBytes(key('é', { altKey: true })), 'é');
});

/** A keyboard-ish event Node can dispatch (it has no KeyboardEvent). */
function keyEvent(type: string, k: string, mods: Partial<KeyLike> = {}): Event {
  return Object.assign(new Event(type, { cancelable: true }), key(k, mods));
}

test('while presenting, keys stop at the boundary and type into VR', () => {
  const target = new EventTarget();
  let presenting = true;
  const typed: string[] = [];
  const desktop: string[] = [];
  captureVrKeys(target, { active: () => presenting, onBytes: (b) => typed.push(b) });
  // Desktop keybinds and walking listen on the same target, after the boundary.
  target.addEventListener('keydown', (e) => desktop.push(`down:${(e as unknown as KeyLike).key}`));
  target.addEventListener('keyup', (e) => desktop.push(`up:${(e as unknown as KeyLike).key}`));

  for (const k of ['e', 'n', 'w', 'a', 's', 'd', 'Tab', 'Enter', '/', 'g', '1']) {
    const ev = keyEvent('keydown', k);
    target.dispatchEvent(ev);
    assert.equal(ev.defaultPrevented, true, `${k} loses its browser default`);
    target.dispatchEvent(keyEvent('keyup', k));
  }
  assert.deepEqual(desktop, [], 'no desktop keybind saw a key');
  assert.deepEqual(typed, ['e', 'n', 'w', 'a', 's', 'd', '\t', '\r', '/', 'g', '1']);

  // Keys with no bytes still never reach a keybind, but keep their browser behavior.
  const f5 = keyEvent('keydown', 'F5');
  target.dispatchEvent(f5);
  assert.equal(f5.defaultPrevented, false);
  const paste = keyEvent('keydown', 'v', { metaKey: true });
  target.dispatchEvent(paste);
  assert.equal(paste.defaultPrevented, false);
  assert.deepEqual(desktop, []);
  assert.equal(typed.length, 11);

  // Out of the headset the boundary is transparent.
  presenting = false;
  const e = keyEvent('keydown', 'e');
  target.dispatchEvent(e);
  target.dispatchEvent(keyEvent('keyup', 'e'));
  assert.deepEqual(desktop, ['down:e', 'up:e']);
  assert.equal(e.defaultPrevented, false);
  assert.equal(typed.length, 11);
});

test('the VR prompt takes physical-keyboard editing keys', () => {
  const b = new PromptBuffer();
  for (const ch of 'hello') b.input(ch);
  assert.equal(b.input('\x1b[H'), 'change');
  assert.equal(b.cursor, 0);
  assert.equal(b.input('\x1b[H'), 'noop');
  assert.equal(b.input('\x1b[3~'), 'change');
  assert.equal(b.text, 'ello');
  assert.equal(b.input('\x1b[F'), 'change');
  assert.equal(b.cursor, 4);
  assert.equal(b.input('\x1b[3~'), 'noop');
});

test('the VR prompt ignores escape sequences it has no use for', () => {
  const b = new PromptBuffer();
  b.input('hi');
  for (const seq of ['\x1b[A', '\x1b[B', '\x1b[1;5D', '\x1b[5~', '\x1b[Z', '\x1bb']) {
    assert.equal(b.input(seq), 'noop', JSON.stringify(seq));
  }
  assert.equal(b.text, 'hi');
  assert.equal(b.input('\t'), 'noop');
  assert.equal(b.input('\x03'), 'noop');
  assert.equal(b.text, 'hi');
});
