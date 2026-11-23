import test from 'node:test';
import assert from 'node:assert/strict';
import { es } from '../src/client/shared/i18n/catalogs/index.js';
import { isLanguage, setLanguage, currentLanguage } from '../src/client/shared/i18n/language.js';
import { patterns } from '../src/client/shared/i18n/patterns.js';
import { t } from '../src/client/shared/i18n/t.js';
import { languageFromRequest, s } from '../src/server/i18n.js';

test('the Spanish catalogue has no empty or self-translations', () => {
  assert.ok(Object.keys(es).length > 1000, `only ${Object.keys(es).length} strings`);
  const bad = Object.entries(es).filter(([key, value]) => !value.trim() || value === key);
  assert.deepEqual(bad, []);
});

test('source strings have a Spanish translation where it matters', () => {
  for (const key of ['Send home', 'Task queue', 'Workspace folder', 'Close (Esc)', 'just now', 'needs input', 'Language']) {
    assert.ok(es[key], `missing ${key}`);
    assert.notEqual(es[key], key);
  }
});

test('t translates, fills placeholders and falls back to the source', () => {
  setLanguage('es');
  assert.equal(t('Send home'), 'Enviar a casa');
  assert.equal(t('Back to {p}', { p: 'the --agent' }), 'Volver a the --agent');
  assert.equal(t('a string we have never seen'), 'a string we have never seen');
  assert.equal(t('{a} and {b}', { a: 'one', b: 2 }), 'one and 2', 'placeholders are filled even in a string without a translation');
});

test('rendered sentences built from names and numbers translate through patterns', () => {
  setLanguage('es');
  assert.equal(t('Byte needs you'), 'Byte te necesita');
  assert.equal(t('🙋 2 need you'), '🙋 2 te necesitan');
  assert.equal(t('✅ 1 done'), '✅ 1 terminado');
  assert.equal(t('+1 more'), '+1 más');
  assert.equal(t('Set by Ann 2h ago.'), 'Establecido por Ann hace 2h.');
  assert.ok(patterns.length > 10);
});

test('notes assembled from several sentences translate piece by piece', () => {
  setLanguage('es');
  const agent =
    `${es['Every worker starts on this: hired at a desk, handed an issue or a pull request from the boards, taken off the queue, the board agents and meetings. Where you start one, ✏️ Edit picks another just for it.']} Set by Ann 2h ago. ` +
    es['Admins can change it.'];
  assert.match(t(agent), /^Todo trabajador empieza con esto:/);
  assert.match(t(agent), /Establecido por Ann hace 2h\./);
  assert.match(t(agent), /Los administradores pueden cambiarlo\.$/);
  const map =
    `${es['The office: desks, a lounge, the boss’s loft upstairs, a floor for every project, and a bar on the roof.']} ` +
    'It’s the same on every floor, for everyone in the building, picked by Ada 2h ago. Maps of your own go in the office’s .agent-office/maps/ folder as JSON (see docs/maps.md).';
  assert.match(t(map), /Es igual para todos en el edificio, elegido por Ada hace 2h\./);
  assert.match(t(map), /Tus propios mapas van en la carpeta/);
  assert.equal(t('🌙 Clear · 23:19 outside'), '🌙 Despejado · 23:19 exterior');
});

test('switching to English gives the original copy back', () => {
  setLanguage('es');
  assert.equal(t('Send home'), 'Enviar a casa');
  setLanguage('en');
  assert.equal(currentLanguage(), 'en');
  assert.equal(t('Send home'), 'Send home');
  setLanguage('es');
  assert.equal(t('Send home'), 'Enviar a casa');
});

test('only the two supported languages are accepted', () => {
  assert.equal(isLanguage('es'), true);
  assert.equal(isLanguage('en'), true);
  assert.equal(isLanguage('de'), false);
  assert.equal(isLanguage(undefined), false);
});

test('the server pages follow the same language cookie, with Spanish by default', () => {
  const req = (cookie?: string) => ({ headers: cookie ? { cookie } : {} }) as unknown as import('node:http').IncomingMessage;
  assert.equal(languageFromRequest(undefined), 'es');
  assert.equal(languageFromRequest(req()), 'es');
  assert.equal(languageFromRequest(req('foo=1; agent-office-language=en')), 'en');
  assert.equal(languageFromRequest(req('agent-office-language=de')), 'es');
  assert.equal(s('es', 'Not answering'), 'No responde');
  assert.equal(s('en', 'Not answering'), 'Not answering');
  assert.equal(s('es', '💤 Not running'), '💤 No en ejecución');
  assert.match(s('es', 'Nothing is serving port {port} right now. The worker may have stopped its server — check the 🌐 Services board in the office, or ask the worker to start it again.', { port: 4600 }), /puerto 4600/);
});
