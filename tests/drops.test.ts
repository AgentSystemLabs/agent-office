import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DropStore, dropName } from '../src/server/drops.js';
import { droppedPaths } from '../src/shared/drops.js';

function dataDir(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-drops-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a dropped file keeps a name that is safe to type into a terminal', () => {
  assert.equal(dropName('Screenshot 2026-09-29 at 10.02.03\u202fAM.png', 'image/png'), 'Screenshot-2026-09-29-at-10.02.03-AM.png');
  assert.equal(dropName('résumé (final).PDF', 'application/pdf'), 'resume-final.pdf');
  assert.equal(dropName('../../etc/passwd', ''), 'passwd');
  assert.equal(dropName('C:\\Users\\sam\\shot.jpeg', 'image/jpeg'), 'shot.jpeg');
  assert.equal(dropName('$(rm -rf ~);.png', 'image/png'), 'rm--rf.png');
});

test('a picture dropped without a name ending gets one, so the agent sees a picture', () => {
  assert.equal(dropName('image', 'image/png'), 'image.png');
  assert.equal(dropName('', 'image/jpeg'), 'file.jpg');
  assert.equal(dropName('.env', 'text/plain'), 'env');
  assert.equal(dropName('notes', 'text/plain'), 'notes');
});

test('dropped paths are typed the way a terminal types a dragged file', () => {
  assert.equal(droppedPaths(['/home/sam/proj/.agent-office/drops/w1/ab-shot.png']), '/home/sam/proj/.agent-office/drops/w1/ab-shot.png');
  assert.equal(droppedPaths(['/Users/sam/my proj/a.png', '/tmp/b.png']), '/Users/sam/my\\ proj/a.png /tmp/b.png');
  assert.equal(droppedPaths(["/Users/sam/it's (new)/café.png"]), "/Users/sam/it\\'s\\ \\(new\\)/café.png");
  assert.equal(droppedPaths(['C:\\Users\\sam\\proj\\a.png']), 'C:\\Users\\sam\\proj\\a.png');
  assert.equal(droppedPaths(['C:\\Users\\sam\\my proj\\a.png']), '"C:\\Users\\sam\\my proj\\a.png"');
});

test("each worker's drops are kept apart and go when the worker does", (t) => {
  const store = new DropStore(dataDir(t));
  const a = store.save('w1', 'shot.png', 'image/png', Buffer.from('one'));
  const b = store.save('w1', 'shot.png', 'image/png', Buffer.from('two'));
  const c = store.save('w2', 'image', 'image/png', Buffer.from('three'));
  assert.ok(a && b && c);
  assert.notEqual(a, b);
  assert.equal(readFileSync(a, 'utf8'), 'one');
  assert.equal(readFileSync(b, 'utf8'), 'two');
  assert.match(path.basename(c), /^[0-9a-f]{8}-image\.png$/);
  assert.equal(store.save('../w1', 'x.png', 'image/png', Buffer.from('x')), undefined);

  store.remove('w1');
  assert.ok(!existsSync(a) && !existsSync(b) && existsSync(c));
  store.prune(new Set(['w3']));
  assert.ok(!existsSync(c));
});
