import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Playtests } from '../src/server/playtests.js';
import { inferModes, testModes } from '../src/shared/playtest-categories.js';
import { classifyPlaytestIssue, type TriageIssue } from '../src/shared/playtest-triage.js';
import { previewIssue, transferIssue } from '../src/server/playtest-triage.js';

const issue = (body: string, title = '[Rift] Co-op-Neuerungen auf zwei Headsets testen'): TriageIssue => ({ number: 68, title, body, url: 'https://github.com/example/game/issues/68', updatedAt: '2026-10-10T12:00:00Z', state: 'OPEN' });
const input = { title: 'RIFT Sound hören', category: 'Audio', steps: 'Starten und hören', expected: 'Musik hörbar', source: '' };
function fixture(t: test.TestContext) {
  const dir = mkdtempSync(path.join(tmpdir(), 'playtest-workflow-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('legacy checkmarks retain identity and get modes without invented builds or results', t => {
  const dir = fixture(t), store = new Playtests(dir);
  const item = store.add(input, 'Worker');
  const original = { ...item, modes: undefined, outcome: undefined, done: true, notes: 'Heard it', checkedAt: '2026-10-10', checkedBy: 'Kajo' };
  writeFileSync(path.join(dir, 'playtests.json'), JSON.stringify({ items: [original] }));
  const restored = new Playtests(dir).state().items[0];
  assert.deepEqual(restored.modes, ['Allgemein', 'RIFT']);
  assert.equal(restored.id, item.id); assert.equal(restored.done, true);
  assert.equal(restored.notes, 'Heard it'); assert.equal(restored.outcome, 'passed');
  assert.equal(restored.build, undefined); assert.equal(restored.results, undefined);
  assert.deepEqual(inferModes('VR tracking'), ['Rooftop', 'Safe Zone', 'Gas Station']);
  assert.deepEqual(testModes({ ...input, modes: ['RB'] }), ['RB']);
});

test('results require a real build entry, keep history and persist one test across multiple modes', t => {
  const dir = fixture(t), store = new Playtests(dir);
  const item = store.add({ ...input, modes: ['RIFT', 'RB'], playStyles: ['online-coop'] }, 'Worker');
  assert.throws(() => store.update({ id: item.id, revision: 1, outcome: 'passed' }, 'Kajo'));
  assert.equal(store.state().items[0].revision, 1);
  store.update({ id: item.id, revision: 1, outcome: 'failed', build: '42', notes: 'Sound missing' }, 'Kajo');
  store.update({ id: item.id, revision: 2, outcome: 'passed', build: '43' }, 'Kajo');
  const state = new Playtests(dir).state();
  assert.equal(state.items.length, 1);
  assert.deepEqual(state.items[0].results?.map(r => [r.outcome, r.build]), [['failed', '42'], ['passed', '43']]);
  assert.equal(state.items[0].notes, 'Sound missing');
  const copy = store.state(); copy.items[0].modes!.push('Gas Station');
  assert.deepEqual(store.state().items[0].modes, ['RIFT', 'RB']);
});

test('triage separates manual, documentation and automation, avoiding device-word false positives', () => {
  const mixed = classifyPlaytestIssue(issue('- [ ] Beide Spieler sehen dieselbe Portal-Welt\n- [ ] M7 in Docs/RIFT_DESIGN.md ist aktualisiert\n- [ ] EditMode-Test prüft die Pose'))!;
  assert.deepEqual(mixed.checks.map(c => c.kind), ['manual', 'development', 'development']);
  assert.equal(mixed.close, false);
  assert.equal(classifyPlaytestIssue(issue('- [ ] Screenshots auf dem Headset erstellen', '[Store] Screenshots und Trailer erstellen')), null);
  const uncertain = classifyPlaytestIssue(issue('- [ ] Portal testen\n  und fehlende Übergänge ergänzen'))!;
  assert.equal(uncertain.close, false); assert.equal(uncertain.checks[0].kind, 'unclear');
  assert.equal(classifyPlaytestIssue(issue('- [ ] Beide Spieler sehen dieselbe Welt\nBitte den Ton implementieren.'))!.close, false);
  assert.equal(classifyPlaytestIssue(issue('```\n- [ ] Falsches Beispiel\n```\n- [x] Bereits erledigt'))!.checks.length, 0);
});

test('transfer saves open tests before closing GitHub and retries an ambiguous success without duplicates', async t => {
  const dir = fixture(t), store = new Playtests(dir);
  let remote = issue('- [ ] Beide Spieler sehen dieselbe Welt'), patches = 0;
  const fingerprint = previewIssue(remote)!.fingerprint!;
  const github = { read: async () => remote, patch: async (_: number, body: string, close: boolean) => {
    patches++;
    const disk = JSON.parse(readFileSync(path.join(dir, 'playtests.json'), 'utf8'));
    assert.equal(disk.items.length, 1); assert.equal(disk.items[0].done, false);
    remote = { ...remote, body, state: close ? 'CLOSED' : 'OPEN' };
    throw new Error('connection lost after GitHub accepted patch');
  } };
  await assert.rejects(transferIssue(dir, 68, fingerprint, store, github, 'Kajo'));
  const receipt = await transferIssue(dir, 68, fingerprint, store, github, 'Kajo');
  assert.equal(receipt.state, 'done'); assert.equal(patches, 1);
  assert.equal(store.state().items.length, 1); assert.equal(store.state().items[0].outcome, 'open');
  assert.match(remote.body, /nicht als bestanden/);
});

test('mixed transfer retains code criteria and failed remote writes can be retried safely', async t => {
  const dir = fixture(t), store = new Playtests(dir);
  let remote = issue('- [ ] Beide Spieler sehen dieselbe Welt\n- [ ] Doku aktualisieren');
  const fp = previewIssue(remote)!.fingerprint!;
  const github = { read: async () => remote, patch: async (_: number, body: string, close: boolean) => {
    assert.equal(close, false); remote = { ...remote, body };
  } };
  await assert.rejects(transferIssue(dir, 68, fp, store, { ...github, patch: async () => { throw Error('offline'); } }, 'Kajo'));
  await transferIssue(dir, 68, fp, store, github, 'Kajo');
  assert.equal(store.state().items.length, 1); assert.equal(remote.state, 'OPEN');
  assert.match(remote.body, /- \[ \] Doku aktualisieren/);
});

test('changed issues and failed local saves never close or overwrite GitHub', async t => {
  const dir = fixture(t), store = new Playtests(dir), original = issue('- [ ] Beide Spieler sehen dieselbe Welt');
  const fp = previewIssue(original)!.fingerprint!;
  let patches = 0;
  await assert.rejects(transferIssue(dir, 68, fp, store, { read: async () => ({ ...original, body: 'changed' }), patch: async () => { patches++; } }, 'Kajo'));
  assert.equal(store.state().items.length, 0);
  const failStore = { add() { throw Error('disk full'); } } as unknown as Playtests;
  await assert.rejects(transferIssue(dir, 68, fp, failStore, { read: async () => original, patch: async () => { patches++; } }, 'Kajo'));
  assert.equal(patches, 0);
});
