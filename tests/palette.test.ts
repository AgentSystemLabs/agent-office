import test from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE_MAX, isPaletteKey, matchItem, matchText, rankItems, type PaletteItem } from '../src/shared/palette.js';

const titles = (q: string, items: PaletteItem[]) => rankItems(q, items).map((m) => m.item.title);

test('"login" finds the worker whose task card is "Fix Login Redirect"', () => {
  const workers: PaletteItem[] = [
    { title: 'Ada', detail: 'Write the release notes · Desk 2' },
    { title: 'Bo', detail: 'Fix Login Redirect · Desk 7' },
    { title: 'Cy', detail: 'Tidy the CSS · Desk 3' },
  ];
  const found = rankItems('login', workers);
  assert.equal(found[0].item.title, 'Bo');
  assert.equal(found[0].field, 'detail');
  // The letters it found are "Login" in the card.
  assert.equal(found[0].hits.map((i) => workers[1].detail![i]).join(''), 'Login');
  assert.equal(found.length, 1);
});

test('the whole text beats its start, which beats a word start, which beats the middle of a word', () => {
  const a = matchText('login', 'Login')!.score;
  const b = matchText('login', 'Login page')!.score;
  const c = matchText('login', 'Fix login')!.score;
  const d = matchText('login', 'Relogin')!.score;
  assert.ok(a > b && b > c && c > d, `${a} > ${b} > ${c} > ${d}`);
});

test('an exact or prefix match beats a scattered one', () => {
  const items: PaletteItem[] = [{ title: 'Look over git integration' }, { title: 'Log in' }, { title: 'Login' }, { title: 'Login redirect' }];
  assert.deepEqual(titles('login', items), ['Login', 'Login redirect', 'Log in', 'Look over git integration']);
  assert.ok(matchText('lg', 'Log')!.score < matchText('lo', 'Log')!.score);
});

test('scattered letters match in order, and prefer the starts of words', () => {
  assert.equal(matchText('xyz', 'Fix Login Redirect'), null);
  assert.equal(matchText('dx', 'Fix Redirect'), null, 'out of order');
  const m = matchText('flr', 'Fix Login Redirect')!;
  assert.deepEqual(m.hits, [0, 4, 10]);
  assert.ok(matchText('flr', 'Fix Login Redirect')!.score > matchText('flr', 'aflxxxxxr')!.score);
});

test('several words match anywhere in the text, in any order', () => {
  const m = matchText('redirect fix', 'Fix Login Redirect')!;
  assert.ok(m);
  assert.deepEqual(m.hits, [0, 1, 2, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.ok(m.score < matchText('fix login', 'Fix Login Redirect')!.score, 'the words together beat the words apart');
});

test('any case and extra spaces; an empty query lists everything in order', () => {
  assert.ok(matchText('  LOGIN ', 'fix login')!.score >= 800);
  const items: PaletteItem[] = [{ title: 'b' }, { title: 'a' }, { title: 'c' }];
  assert.deepEqual(titles('', items), ['b', 'a', 'c']);
});

test('a title beats the same match in the detail line or a keyword', () => {
  const items: PaletteItem[] = [
    { title: 'Settings', keywords: ['queue it'] },
    { title: 'Issue #4', detail: 'queue it' },
    { title: 'Queue it' },
  ];
  assert.deepEqual(titles('queue', items), ['Queue it', 'Issue #4', 'Settings']);
  assert.equal(matchItem('qu', { title: 'x', keywords: [undefined, 'queue'] })?.field, 'keyword');
});

test('numbers find issues and pull requests, and desks by label', () => {
  const items: PaletteItem[] = [{ title: '#131 Dark mode' }, { title: '#31 Fix the build' }, { title: 'Eve', detail: 'Desk 7' }];
  assert.equal(titles('31', items)[0], '#31 Fix the build');
  assert.equal(titles('#31', items)[0], '#31 Fix the build');
  assert.deepEqual(titles('desk 7', items), ['Eve']);
});

test('ties keep their order, and the list stops at the most it shows', () => {
  const items = Array.from({ length: PALETTE_MAX + 20 }, (_, i) => ({ title: `Worker ${i}` }));
  const found = rankItems('worker', items);
  assert.equal(found.length, PALETTE_MAX);
  assert.equal(found[0].item.title, 'Worker 0');
  assert.equal(found[1].item.title, 'Worker 1');
});

test('Ctrl+K opens the palette, ⌘K on a Mac, and no other combination does', () => {
  const key = (k: Partial<Parameters<typeof isPaletteKey>[0]>) => ({ key: 'k', code: 'KeyK', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...k });
  assert.ok(isPaletteKey(key({ ctrlKey: true }), false));
  assert.ok(isPaletteKey(key({ ctrlKey: true, key: 'K' }), false), 'with caps lock');
  assert.ok(!isPaletteKey(key({ metaKey: true }), false));
  assert.ok(isPaletteKey(key({ metaKey: true }), true));
  assert.ok(!isPaletteKey(key({ ctrlKey: true }), true), 'Ctrl+K on a Mac is left to the text box');
  assert.ok(!isPaletteKey(key({ ctrlKey: true, shiftKey: true }), false));
  assert.ok(!isPaletteKey(key({ ctrlKey: true, altKey: true }), false));
  assert.ok(!isPaletteKey(key({}), false), 'plain K walks nowhere');
  assert.ok(!isPaletteKey(key({ ctrlKey: true, key: 'j', code: 'KeyJ' }), false));
  // A Russian layout: the K key types л.
  assert.ok(isPaletteKey(key({ ctrlKey: true, key: 'л' }), false));
  // Dvorak: the key in K's place types t, which isn't K.
  assert.ok(!isPaletteKey(key({ ctrlKey: true, key: 't' }), false));
});
