import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readPresentation, presentationBrief } from '../src/server/presentations.js';

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
