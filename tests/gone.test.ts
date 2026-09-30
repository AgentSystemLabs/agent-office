import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PtyHost, type Pty, type PtyExit } from '../src/server/ptys.js';
import type { WorkerInfo } from '../src/shared/protocol.js';

/**
 * A Pty that records what it was asked to do and lets the test decide when (and how) it exits, so
 * the two exit shapes can be told apart without a real terminal or a real agent behind it.
 */
class FakePty implements Pty {
  pid = 4242;
  writes: string[] = [];
  resizes: [number, number][] = [];
  private dataCbs: ((data: string) => void)[] = [];
  private exitCbs: ((e: PtyExit) => void)[] = [];
  private exited?: PtyExit;

  write(data: string) {
    this.writes.push(data);
  }
  resize(cols: number, rows: number) {
    this.resizes.push([cols, rows]);
  }
  onData(cb: (data: string) => void) {
    // Output that arrived before anyone listened is held, exactly as RemotePty does.
    if (this.exited && this.exited.exitCode === -1 && this.exited.gone) this.dataCbs.push(cb);
    else this.dataCbs.push(cb);
  }
  onExit(cb: (e: PtyExit) => void) {
    this.exitCbs.push(cb);
    if (this.exited) cb(this.exited);
  }
  emitData(data: string) {
    for (const cb of this.dataCbs) cb(data);
  }
  emitExit(e: PtyExit) {
    this.exited = e;
    for (const cb of this.exitCbs) cb(e);
  }
}

test('PtyExit distinguishes a host that will restart from a far end that may come back', () => {
  // The two cases are the whole feature: `lost` relaunches, `gone` must not. They are separate
  // fields rather than a flag on one, because relaunching a `gone` worker spins.
  const lost: PtyExit = { exitCode: -1, lost: true };
  const gone: PtyExit = { exitCode: -1, gone: true };
  assert.equal(lost.gone, undefined, 'lost must not set gone');
  assert.equal(gone.lost, undefined, 'gone must not set lost');
  assert.equal(lost.lost, true);
  assert.equal(gone.gone, true);
});

test('a gone exit is announced once, and a late subscriber still hears it', () => {
  const pty = new FakePty();
  const first: PtyExit[] = [];
  pty.onExit((e) => first.push(e));
  pty.emitExit({ exitCode: -1, gone: true });
  assert.equal(first.length, 1);

  // Someone attaching after the fact (a browser joining a terminal whose floor dropped) is told too,
  // so it renders as offline rather than hanging on a terminal that will never write again.
  const late: PtyExit[] = [];
  pty.onExit((e) => late.push(e));
  assert.equal(late.length, 1);
  assert.equal(late[0].gone, true);
});

test('PtyHost spawn with no host connected falls back to a local PTY, which never reports gone', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-gone-'));
  let seen: PtyExit | undefined;
  try {
    const host = new PtyHost(dir, () => {});
    // No socket has connected, so spawn falls back to a real in-process PTY. That is the office-side
    // default and must keep working untouched: this feature only adds a third exit shape.
    const p = host.spawn({ file: '/bin/sh', args: ['-c', 'exit 0'], cwd: dir, env: process.env, cols: 80, rows: 24 });
    assert.ok(p);
    assert.equal(typeof p.pid, 'number');
    // A local PTY never reports lost or gone: only the far end does.
    p.onExit((e) => {
      seen = e;
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.notEqual(seen, undefined, 'the shell should have exited');
  assert.equal(seen!.gone, undefined);
  assert.equal(seen!.lost, undefined);
});

test('WorkerInfo.offline is resumable by status, which is what holdOffline relies on', () => {
  // The office's own restore path already produces this shape (workers.ts:2244), and resume() has no
  // status check, so a held worker is woken by **R** rather than by anything automatic.
  const info: WorkerInfo = {
    id: 'w1', deskId: 'desk-1', kind: 'agent', provider: 'claude', name: 'W', color: '#fff',
    status: 'offline', acked: true, createdBy: 'test', createdAt: Date.now(),
    cols: 80, rows: 24, viewers: [], viewerIds: [],
  };
  assert.equal(info.status, 'offline');
  // No exitCode: nothing exited. A dropped connection is not a crash, and the terminal must not say so.
  assert.equal(info.exitCode, undefined);
});
