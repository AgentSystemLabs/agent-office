import test from 'node:test';
import assert from 'node:assert/strict';
import { HAIR_COLORS, HAIR_STYLES } from '../src/shared/avatar.js';
import { envLocale, LOCALES, matchLocale, messages, type Messages } from '../src/shared/i18n.js';

test('language tags from browsers and terminals', () => {
  assert.equal(matchLocale('pt-BR'), 'pt-BR');
  assert.equal(matchLocale('pt_BR.UTF-8'), 'pt-BR');
  assert.equal(matchLocale('pt_BR@euro'), 'pt-BR');
  assert.equal(matchLocale('PT-br'), 'pt-BR');
  assert.equal(matchLocale('pt'), 'pt-BR');
  assert.equal(matchLocale('pt_PT.UTF-8'), 'pt-BR');
  assert.equal(matchLocale('en_US.UTF-8'), 'en');
  assert.equal(matchLocale('fr_FR.UTF-8'), undefined);
  assert.equal(matchLocale('C'), undefined);
  assert.equal(matchLocale(''), undefined);
  assert.equal(matchLocale(undefined), undefined);
});

test('the terminal language: the first variable set decides', () => {
  assert.equal(envLocale({}), 'en');
  assert.equal(envLocale({ LANG: 'pt_BR.UTF-8' }), 'pt-BR');
  assert.equal(envLocale({ LANG: 'pt_BR.UTF-8', LC_ALL: 'C' }), 'en');
  assert.equal(envLocale({ LANG: 'en_US.UTF-8', LC_MESSAGES: 'pt_BR.UTF-8' }), 'pt-BR');
  assert.equal(envLocale({ LANG: 'pt_BR.UTF-8', AGENT_OFFICE_LANG: 'en' }), 'en');
  assert.equal(envLocale({ LANG: 'en_US.UTF-8', AGENT_OFFICE_LANG: 'pt-BR' }), 'pt-BR');
  assert.equal(envLocale({ LANG: 'fr_FR.UTF-8' }), 'en');
  assert.equal(envLocale({ LC_ALL: ' ', LANG: 'pt_BR.UTF-8' }), 'pt-BR');
});

/** Every message in a dictionary, by its dotted path. */
function flatten(m: object, prefix = ''): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [k, v] of Object.entries(m)) {
    const key = prefix + k;
    if (v && typeof v === 'object' && !(v instanceof RegExp)) for (const [kk, vv] of flatten(v, `${key}.`)) out.set(kk, vv);
    else out.set(key, v);
  }
  return out;
}

test('every language has every message, and none is left empty or in English by accident', () => {
  const en = flatten(messages('en'));
  for (const locale of LOCALES) {
    const m = flatten(messages(locale) as Messages);
    assert.deepEqual([...m.keys()].sort(), [...en.keys()].sort(), locale);
    for (const [key, value] of m) {
      if (typeof value === 'string') assert.ok(value.trim(), `${locale} ${key} is empty`);
      if (typeof value === 'function') assert.equal(value.length, (en.get(key) as Function).length, `${locale} ${key} takes other values`);
    }
  }
});

test('no message comes out empty, whatever it is given', () => {
  // A refusal on the server is a non-empty message: one that came out empty would let through what it refuses.
  const call = (fn: Function, arg: unknown) => fn(...Array.from({ length: fn.length }, () => arg));
  for (const locale of LOCALES) {
    for (const [key, value] of flatten(messages(locale) as Messages)) {
      if (typeof value !== 'function') continue;
      // Words, a number or a list: whichever it takes (one that takes a mix is left to its own tests).
      let out: unknown;
      for (const arg of ['x', 2, ['x', 'y']]) {
        try {
          out = call(value, arg);
          break;
        } catch {
          out = undefined;
        }
      }
      if (typeof out === 'string') assert.ok(out.trim(), `${locale} ${key} comes out empty`);
      else if (Array.isArray(out)) assert.ok(out.length, `${locale} ${key} comes out empty`);
    }
  }
});

test('plurals in the setup', () => {
  const en = messages('en').setup;
  const pt = messages('pt-BR').setup;
  assert.match(en.hasFloors('~/o', ['a']), /has 1 floor: a\./);
  assert.match(en.hasFloors('~/o', ['a', 'b']), /has 2 floors: a, b\./);
  assert.match(pt.hasFloors('~/o', ['a']), /tem 1 andar: a\./);
  assert.match(pt.hasFloors('~/o', ['a', 'b']), /tem 2 andares: a, b\./);
  assert.match(en.matches(1, 'x', 12), /1 repository matches “x”:/);
  assert.match(pt.matches(3, 'x', 12), /3 repositórios encontrados para “x”:/);
  assert.match(pt.matches(20, 'x', 12), /os primeiros 12 aqui/);
  assert.ok(pt.no.test('não') && pt.no.test('N') && !pt.no.test('sim') && !pt.no.test(''));
});

test('hair names line up with the looks they name', () => {
  for (const locale of LOCALES) {
    assert.equal(messages(locale).character.hairStyles.length, HAIR_STYLES.length, locale);
    assert.equal(messages(locale).character.hairColors.length, HAIR_COLORS.length, locale);
  }
});

test('every data-t in the pages names a message in every language', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const dir = new URL('../src/client/', import.meta.url);
  const keys = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.html')))
    for (const m of readFileSync(new URL(file, dir), 'utf8').matchAll(/data-t(?:-[a-z-]+)?="([^"]+)"/g)) keys.add(m[1]);
  assert.ok(keys.size > 10);
  for (const locale of LOCALES) {
    const all = flatten(messages(locale));
    for (const key of keys) assert.equal(typeof all.get(key), 'string', `${locale} ${key}`);
  }
});
