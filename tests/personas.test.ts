import test from 'node:test';
import assert from 'node:assert/strict';
import { PERSONAS, personaBrief, personaDeck, personaFor, withPersonaPrompt } from '../src/shared/personas.js';
import { DESK_BY_ID } from '../src/shared/layout.js';

test('the same floor and desk always deal the same persona', () => {
  for (const seed of ['C:\\proj\\a', 'C:\\proj\\b', '/home/x/repo']) {
    for (const desk of ['desk-1', 'desk-7', 'beanbag-3']) {
      assert.equal(personaFor(seed, desk)?.id, personaFor(seed, desk)?.id);
    }
  }
});

test("a floor's deck is its own: different seeds deal different casts", () => {
  const a = personaDeck('floor-a').map((p) => p.id).join(',');
  const b = personaDeck('floor-b').map((p) => p.id).join(',');
  assert.notEqual(a, b);
});

test('desks on one floor get different personas while the cast lasts', () => {
  const seed = 'C:\\proj\\nexora';
  const seen = new Set<string>();
  for (let i = 1; i <= 16; i++) {
    const p = personaFor(seed, `desk-${i}`);
    assert.ok(p, `desk-${i} has a persona`);
    assert.ok(!seen.has(p.id), `desk-${i} repeats ${p.id}`);
    seen.add(p.id);
  }
});

test('board kiosks and missing seeds have no persona', () => {
  const kiosk = [...DESK_BY_ID.keys()].find((id) => DESK_BY_ID.get(id)?.station);
  assert.ok(kiosk);
  assert.equal(personaFor('seed', kiosk!), undefined);
  assert.equal(personaFor(undefined, 'desk-1'), undefined);
});

test('the brief carries the guardrails', () => {
  const brief = personaBrief(PERSONAS[0]);
  assert.ok(brief.includes(PERSONAS[0].name));
  assert.ok(brief.includes('never overrides'));
});

test('withPersonaPrompt prepends only when there is a prompt and a persona', () => {
  const dir = 'C:\\proj\\nexora';
  const withPrompt = withPersonaPrompt(dir, 'desk-1', undefined, 'fix the bug');
  assert.ok(withPrompt!.startsWith('Your character in this office:'));
  assert.ok(withPrompt!.endsWith('fix the bug'));
  assert.equal(withPersonaPrompt(dir, 'desk-1', undefined, undefined), undefined);
  const station = [...DESK_BY_ID.keys()].find((id) => DESK_BY_ID.get(id)?.station)!;
  assert.equal(withPersonaPrompt(dir, station, 'queue', 'do it'), 'do it');
});
