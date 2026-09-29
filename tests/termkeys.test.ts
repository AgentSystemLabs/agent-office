import test from 'node:test';
import assert from 'node:assert/strict';
import { naturalKey, type TermKey } from '../src/client/ui/termkeys.js';

const key = (k: string, mods: Partial<Omit<TermKey, 'key'>> = {}): TermKey => ({ key: k, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

test('Shift+Enter types a new line (Ctrl+J) instead of sending the prompt', () => {
  for (const mac of [true, false]) {
    assert.equal(naturalKey(key('Enter', { shiftKey: true }), mac), '\n');
    assert.equal(naturalKey(key('Enter'), mac), undefined, 'plain Enter still sends');
    assert.equal(naturalKey(key('Enter', { altKey: true }), mac), undefined, 'Option+Enter keeps its Esc Enter');
    assert.equal(naturalKey(key('Enter', { shiftKey: true, ctrlKey: true }), mac), undefined);
  }
});

test('Ctrl+Backspace deletes a word everywhere; ⌘⌫ deletes the line on a Mac', () => {
  assert.equal(naturalKey(key('Backspace', { ctrlKey: true }), true), '\x17');
  assert.equal(naturalKey(key('Backspace', { ctrlKey: true }), false), '\x17');
  assert.equal(naturalKey(key('Backspace', { metaKey: true }), true), '\x15');
  assert.equal(naturalKey(key('Backspace', { metaKey: true }), false), undefined, 'the Windows key is not ⌘');
  assert.equal(naturalKey(key('Backspace'), true), undefined);
  assert.equal(naturalKey(key('Backspace', { altKey: true }), true), undefined, '⌥⌫ already deletes a word as Esc ⌫');
});

test('⌘⌦ and ⌘← / ⌘→ edit and move by line on a Mac only', () => {
  assert.equal(naturalKey(key('Delete', { metaKey: true }), true), '\x0b');
  assert.equal(naturalKey(key('ArrowLeft', { metaKey: true }), true), '\x01');
  assert.equal(naturalKey(key('ArrowRight', { metaKey: true }), true), '\x05');
  for (const k of ['Delete', 'ArrowLeft', 'ArrowRight']) {
    assert.equal(naturalKey(key(k, { metaKey: true }), false), undefined);
    assert.equal(naturalKey(key(k, { metaKey: true, shiftKey: true }), true), undefined);
    assert.equal(naturalKey(key(k), true), undefined);
  }
});

test('ordinary keys are left to xterm', () => {
  for (const k of ['a', 'Tab', 'Escape', 'ArrowUp', 'Home']) {
    assert.equal(naturalKey(key(k), true), undefined);
    assert.equal(naturalKey(key(k, { metaKey: true }), true), undefined);
    assert.equal(naturalKey(key(k, { ctrlKey: true }), false), undefined);
  }
});
