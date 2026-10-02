import test from 'node:test';
import assert from 'node:assert/strict';
import { bannerText, Fresh, Reminders, REMIND_EVERY, waited, waitKey } from '../src/client/features/needsyou/logic.js';
import type { WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';

function worker(id: string, status: WorkerStatus, more: Partial<WorkerInfo> = {}): WorkerInfo {
  return { id, kind: 'agent', deskId: `desk-${id}`, name: id, color: '#fff', status, acked: false, createdBy: 'test', createdAt: 0, cols: 80, rows: 24, viewers: [], ...more };
}

const floor = (...workers: WorkerInfo[]) => new Map(workers.map((w) => [w.id, w]));

test('a worker that starts asking is new; one already asking when the page first saw it is not', () => {
  const fresh = new Fresh();
  // The page comes up with one asking already: the banner shows it, but nothing rings.
  assert.deepEqual(fresh.take(floor(worker('old', 'needs_input'), worker('busy', 'working'))), []);
  assert.deepEqual(fresh.take(floor(worker('old', 'needs_input'), worker('busy', 'needs_input'))).map((w) => w.id), ['busy']);
  // Still asking: it rang already.
  assert.deepEqual(fresh.take(floor(worker('old', 'needs_input'), worker('busy', 'needs_input'))), []);
  // Answered, and asks something else.
  fresh.take(floor(worker('old', 'needs_input'), worker('busy', 'working')));
  assert.deepEqual(fresh.take(floor(worker('old', 'needs_input'), worker('busy', 'needs_input'))).map((w) => w.id), ['busy']);
  // Finishing isn't asking.
  assert.deepEqual(fresh.take(floor(worker('old', 'done'), worker('busy', 'needs_input'))), []);
});

test('workers on a floor you come back to are new to the page again, so arriving rings nothing', () => {
  const fresh = new Fresh();
  fresh.take(floor(worker('a', 'working')));
  // Off to another floor, where b works, and a starts asking meanwhile.
  fresh.take(floor(worker('b', 'working')));
  assert.deepEqual(fresh.take(floor(worker('a', 'needs_input'))), []);
});

test('the banner names whoever has waited longest, what it asks and for how long, and counts the rest', () => {
  const now = 10 * 60_000;
  const a = worker('Byte', 'needs_input', { activity: 'Wants permission: Bash: npm test', waitingSince: now - 4 * 60_000 });
  const b = worker('Pixel', 'needs_input', { activity: 'Which one?', waitingSince: now - 30_000 });
  assert.deepEqual(bannerText([a], now), { id: 'Byte', title: 'Byte needs you', detail: 'Wants permission: Bash: npm test · 4 min', more: '', key: 'Byte|Byte needs you|Wants permission: Bash: npm test · 4 min|' });
  assert.equal(bannerText([a, b], now)?.more, '+1 more');
  // In its first minute there's no time to give, and with nothing known of what it asks, just its name.
  assert.equal(bannerText([b], now)?.detail, 'Which one?');
  assert.equal(bannerText([worker('Nib', 'needs_input')], now)?.detail, '');
  // No activity: what its task says it's on.
  assert.equal(bannerText([worker('Nib', 'needs_input', { task: { name: 'Docs', summary: 'Writing the docs' } })], now)?.detail, 'Writing the docs');
  // A long question is cut short, and its line breaks go.
  const long = bannerText([worker('Nib', 'needs_input', { activity: `Shall I\n${'x'.repeat(200)}` })], now)!;
  assert.equal(long.detail.length, 90);
  assert.match(long.detail, /^Shall I x+…$/);
  assert.equal(bannerText([], now), null);
});

test('how long a worker has waited', () => {
  assert.equal(waited(undefined, 5_000), '');
  assert.equal(waited(0, 59_000), '');
  assert.equal(waited(0, 60_000), '1 min');
  assert.equal(waited(0, 59 * 60_000 + 59_000), '59 min');
  assert.equal(waited(0, 65 * 60_000), '1 h 05 min');
});

test('each wait of a worker has a key of its own, so a banner put away comes back when it asks again', () => {
  assert.notEqual(waitKey(worker('a', 'needs_input', { waitingSince: 100 })), waitKey(worker('a', 'needs_input', { waitingSince: 200 })));
  assert.equal(waitKey(worker('a', 'needs_input', { waitingSince: 100 })), waitKey(worker('a', 'needs_input', { waitingSince: 100, activity: 'other' })));
});

test('the reminder rings every half minute while someone asks with nobody at its terminal', () => {
  const r = new Reminders();
  const asking = [worker('a', 'needs_input')];
  // The alarm rang as it started asking.
  r.rang(1_000);
  assert.equal(r.due(asking, 2_000), false);
  assert.equal(r.due(asking, 1_000 + REMIND_EVERY - 1), false);
  assert.equal(r.due(asking, 1_000 + REMIND_EVERY), true);
  // Once per wait, not on every look after it.
  assert.equal(r.due(asking, 1_000 + REMIND_EVERY + 1_000), false);
  assert.equal(r.due(asking, 1_000 + 2 * REMIND_EVERY), true);
});

test('no reminder while someone has its terminal open, or with nobody asking; the wait starts over after', () => {
  const r = new Reminders();
  r.rang(0);
  const watched = [worker('a', 'needs_input', { viewers: ['you'] })];
  assert.equal(r.due(watched, REMIND_EVERY * 3), false);
  assert.equal(r.due([], REMIND_EVERY * 3), false);
  // They close it without answering: a whole wait from there before it rings.
  const asking = [worker('a', 'needs_input')];
  assert.equal(r.due(asking, REMIND_EVERY * 3 + 1_000), false);
  assert.equal(r.due(asking, REMIND_EVERY * 4), false);
  assert.equal(r.due(asking, REMIND_EVERY * 4 + 1_000), true);
  // One of two is being answered: the other still wants a reminder.
  assert.equal(r.due([...watched, worker('b', 'needs_input')], REMIND_EVERY * 5 + 1_000), true);
});

test('arriving on a floor where someone is asking starts its wait over, however long ago the alarm last rang', () => {
  const r = new Reminders();
  r.rang(0);
  r.quiet();
  const asking = [worker('b', 'needs_input')];
  assert.equal(r.due(asking, REMIND_EVERY * 10), false);
  assert.equal(r.due(asking, REMIND_EVERY * 11 - 1), false);
  assert.equal(r.due(asking, REMIND_EVERY * 11), true);
});

test('a page that comes up with someone asking already waits a whole turn before the first reminder', () => {
  const r = new Reminders();
  const asking = [worker('a', 'needs_input')];
  assert.equal(r.due(asking, 500_000), false);
  assert.equal(r.due(asking, 500_000 + REMIND_EVERY - 1), false);
  assert.equal(r.due(asking, 500_000 + REMIND_EVERY), true);
});
