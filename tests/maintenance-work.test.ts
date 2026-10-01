import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { MaintenanceImages, MaintenanceWork, MAINTENANCE_IMAGE_MAX } from '../src/server/maintenance-work.js';
import { MaintenanceChatArchive, transcriptMessage } from '../src/server/maintenance-chat.js';
import type { WorkerInfo } from '../src/shared/protocol.js';

const screenshot = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aIl8AAAAASUVORK5CYII=', 'base64');
const fixture = (t: { after(fn: () => void): void }) => { const dir = mkdtempSync(path.join(tmpdir(), 'maintenance-work-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };
const worker = (status: WorkerInfo['status'] = 'working') => ({ id: 'worker', status, createdAt: 1 } as WorkerInfo);
const issue = (number = 1) => ({ number, title: `Issue ${number}`, url: `https://github.com/fork/office/issues/${number}` });

test('screenshots persist independently of workers, reject nonimages and stay scoped to opaque IDs', t => {
  const dir = fixture(t), images = new MaintenanceImages(dir);
  const image = images.save('../../screen.js', 'image/png', screenshot);
  const restored = new MaintenanceImages(dir).get(image.id);
  assert.ok(restored.path.endsWith('.png'));
  assert.deepEqual(readFileSync(restored.path), screenshot);
  assert.equal(restored.name, 'screen.js');
  assert.throws(() => images.save('script.svg', 'image/svg+xml', Buffer.from('<svg/>')), /Use a PNG/);
  assert.throws(() => images.save('not.png', 'image/png', Buffer.from('not an image')), /Use a PNG/);
  assert.throws(() => images.save('huge.png', 'image/png', Buffer.concat([screenshot, Buffer.alloc(MAINTENANCE_IMAGE_MAX)])), /10 MB/);
  assert.throws(() => images.get('../../../../etc/passwd'), /Bad image/);
  assert.throws(() => images.resolve(Array(5).fill(image.id)), /four images/);
  assert.equal(images.resolve([image.id, image.id]).length, 1);
  assert.match(images.prompt('Inspect this', [image]), /Open these local image files/);
  assert.ok(images.prompt('Inspect this', [image]).includes(restored.path));
});

test('image metadata reconciles with transcript requests without duplicates and survives archive reload', t => {
  const dir = fixture(t), archive = new MaintenanceChatArchive(dir), images = new MaintenanceImages(dir);
  const image = images.save('screen.png', 'image/png', screenshot);
  const sent = images.prompt('Inspect this', [image]);
  archive.capture(worker(), [{ id: 'initial', role: 'user', content: sent, at: 1, pending: true }]);
  archive.capture(worker(), [{ id: 'evidence', role: 'user', content: 'Inspect this', at: 2, pending: true, attachments: [image] }]);
  assert.equal(archive.page('worker')?.messages.length, 1);
  const publicMessage = transcriptMessage({ type: 'response_item', payload: { role: 'user', content: [{ type: 'input_text', text: sent }] } })!;
  assert.equal(publicMessage.content, 'Inspect this');
  archive.capture(worker(), [{ id: 'transcript', ...publicMessage, at: 3 }]);
  const restored = new MaintenanceChatArchive(dir).page('worker')!;
  assert.equal(restored.messages.length, 1);
  assert.deepEqual(restored.messages[0].attachments, [image]);
  assert.ok(!JSON.stringify(restored).includes(images.get(image.id).path));
});

test('issue queue is durable, serial, fork scoped, and links only commits added during that task', t => {
  const dir = fixture(t), work = new MaintenanceWork(dir);
  work.queue('fork/office', issue(), 'Alex'); work.queue('fork/office', issue(), 'Alex');
  work.queue('other/office', issue(), 'Other');
  assert.equal(work.list('fork/office').length, 1);
  const restored = new MaintenanceWork(dir);
  restored.start('fork/office', 1, worker(), ['abc']);
  assert.throws(() => restored.remove('fork/office', 1), /Finish or end/);
  restored.queue('fork/office', issue(2), 'Sam');
  assert.throws(() => restored.start('fork/office', 2, worker(), []), /Another maintenance issue/);
  restored.reconcile(worker('needs_input'), [{ sha: 'abc', subject: 'Earlier work' }, { sha: 'def', subject: 'Fix issue 1' }]);
  assert.equal(restored.get('fork/office', 1)?.status, 'running');
  assert.deepEqual(restored.get('fork/office', 1)?.commits, [{ sha: 'def', subject: 'Fix issue 1' }]);
  restored.reconcile(worker('done'), [{ sha: 'abc', subject: 'Earlier work' }, { sha: 'def', subject: 'Fix issue 1' }]);
  assert.equal(restored.get('fork/office', 1)?.status, 'review');
  restored.reconcile(worker('working'), [{ sha: 'abc', subject: 'Earlier work' }, { sha: 'def', subject: 'Fix issue 1' }, { sha: 'ghi', subject: 'Follow-up' }]);
  assert.equal(restored.get('fork/office', 1)?.status, 'running');
  assert.equal(restored.get('fork/office', 1)?.commits.length, 2);
  restored.reconcile(worker('done'), []);
  restored.reviewed('fork/office', 1);
  assert.equal(new MaintenanceWork(dir).get('fork/office', 1)?.status, 'done');
  restored.start('fork/office', 2, worker(), ['abc', 'def']);
  restored.reconcile(undefined, []);
  assert.equal(restored.get('fork/office', 2)?.status, 'paused');
  restored.queue('fork/office', issue(2), 'Alex');
  assert.equal(restored.get('fork/office', 2)?.status, 'queued');
  assert.equal(restored.get('other/office', 1)?.status, 'queued');
});
