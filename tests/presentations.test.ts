import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readPresentation, presentationBrief, PresentationArchive, presentationLinks } from '../src/server/presentations.js';

test('completion publishes valid fresh artifacts, rejects stale, malformed and oversized files', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'office-tv-'));
  const dir = path.join(cwd, '.agent-office/presentations');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'worker.json');
  try {
    assert.equal(readPresentation(cwd, 'worker', 0), undefined);
    writeFileSync(file, JSON.stringify({ title: 'Demo', summary: 'Tested result', html: '<button>Compare</button>' }));
    assert.equal(readPresentation(cwd, 'worker', 0)?.title, 'Demo');
    assert.equal(readPresentation(cwd, 'worker', Date.now() + 1000), undefined);
    writeFileSync(file, '{broken');
    assert.equal(readPresentation(cwd, 'worker', 0), undefined);
    writeFileSync(file, JSON.stringify({ title: 'Demo', summary: '', html: '' }));
    assert.equal(readPresentation(cwd, 'worker', 0), undefined);
    writeFileSync(file, 'x'.repeat(100_001));
    assert.equal(readPresentation(cwd, 'worker', 0), undefined);
    assert.match(presentationBrief('worker'), /presentations\/worker.json/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('archive retains versions after restart and validates source links', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'office-archive-'));
  try {
    const archive = new PresentationArchive(cwd);
    const worker = { id: 'a', name: 'Builder', presentation: { title: 'First', summary: '', html: '<p>One</p>', at: 10 } } as import('../src/shared/protocol.js').WorkerInfo;
    assert.equal(archive.capture(worker, [{ label: 'PR #1', url: 'https://github.com/a/b/pull/1' }]), true);
    assert.equal(archive.capture(worker), false);
    assert.equal(archive.capture(worker, [{ label: 'Issue #2', url: 'https://github.com/a/b/issues/2' }]), true);
    assert.equal(archive.items.length, 1);
    assert.equal(archive.capture(worker, [{ label: 'Issue #2', url: 'https://github.com/a/b/issues/2' }]), false);
    worker.presentation = { ...worker.presentation!, title: 'Second', at: 20 };
    assert.equal(archive.capture(worker), true);
    const restored = new PresentationArchive(cwd);
    assert.deepEqual(restored.items.map(i => i.presentation.title), ['Second', 'First']);
    assert.equal(restored.items[1].presentation.links?.[0].label, 'PR #1');
    assert.deepEqual(presentationLinks([{ label: 'Bad', url: 'javascript:alert(1)' }, { label: 'Local', url: 'file:///etc/passwd' }]), []);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
