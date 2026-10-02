import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OfficeLanguage } from '../src/server/language.js';
import { L, setLocale } from '../src/server/i18n.js';

test('an admin picks the language the office speaks: it takes at once and keeps across restarts', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-lang-'));
  const told: string[] = [];
  const lang = new OfficeLanguage(dir, (s) => told.push(s.lang));
  assert.equal(lang.state().lang, 'en');
  assert.equal(L.srv.noSuchFloor, 'No such floor');
  lang.set('pt-BR', 'Ada');
  assert.deepEqual(told, ['pt-BR']);
  assert.equal(L.srv.noSuchFloor, 'Esse andar não existe');
  setLocale('en');
  // The next office in that folder speaks what was picked from the start.
  const again = new OfficeLanguage(dir, () => {});
  assert.equal(again.state().lang, 'pt-BR');
  assert.equal(again.state().by, 'Ada');
  assert.equal(L.srv.noSuchFloor, 'Esse andar não existe');
  setLocale('en');
});
