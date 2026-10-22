import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROMPTS, fillPrompt } from '../src/shared/prompts.js';
import { officePrompt } from '../src/server/prompts.js';
import { WhipCooldowns, whipRefusal, whipVars } from '../src/server/whip.js';
import { whipHandlers } from '../src/server/ws/handlers/whip.js';
import { handlers } from '../src/server/ws/handlers/index.js';
import { WHIP_COOLDOWN_MS, type ServerMsg, type WorkerInfo, type WorkerStatus } from '../src/shared/protocol.js';

function worker(id: string, status: WorkerStatus = 'working', more: Partial<WorkerInfo> = {}): WorkerInfo {
  return {
    id, kind: 'agent', deskId: 'desk-1', name: id, color: '#fff', status, acked: false, createdBy: 'test', createdAt: 0, cols: 80, rows: 24, viewers: [], viewerIds: [],
    worktree: { path: `.agent-office/worktrees/${id}`, branch: `office/${id}`, base: '0123456789abcdef0123', from: 'main' },
    ...more,
  };
}

const whip = (info: WorkerInfo, project = { branch: 'main', remote: 'git@github.com:o/r.git' }) => officePrompt(undefined, 'worker.whip', whipVars(info, 'Ada', project));

test("the whip's prompt names the branch, what to diff it against and the task, and drops the lines it has nothing for", () => {
  const text = whip(worker('Rex', 'working', { task: { name: 'Fix Login Redirect', summary: 'Tracing why sessions expire' } }));
  assert.match(text, /^\*Crack!\* Ada just cracked the whip at you, Rex\./);
  assert.match(text, /Your task: Fix Login Redirect: Tracing why sessions expire\n/);
  assert.match(text, /You're on `office\/Rex`, and your work is what it changed since `origin\/main`\./);
  assert.match(text, /`git diff origin\/main\.\.\.HEAD`/);
  assert.match(text, /`git diff HEAD`/);
  assert.match(text, /Don't change what it's meant to do/);
  assert.doesNotMatch(text, /\{\{|pull request #|several repositories/);
  // The empty PR and repositories lines go, and the paragraphs around them stay apart.
  assert.match(text, /since `origin\/main`\.\n\nIf you're in the middle of a step/);
  assert.match(text, /what you deliberately left alone\.$/);
});

test('with a pull request and other repositories, it says to push there and to do each one', () => {
  const text = whip(worker('Rex', 'done', {
    pr: { number: 42, url: 'https://github.com/o/r/pull/42' },
    repos: [{ floor: 'f2', name: 'api', dir: '/x/api', path: 'p', branch: 'office/Rex', base: 'abc' }],
  }));
  assert.match(text, /\.\n\nIt has pull request #42 \(https:\/\/github\.com\/o\/r\/pull\/42\): push your commit there\.\n\nYou work across several repositories \(api too\)/);
});

test('the branch is the one it is on now, diffed against what its pull request goes into', () => {
  // Switched to a branch of its own: that's the one, not the office's.
  const own = whipVars(worker('Rex', 'working', { worktree: { path: 'p', branch: 'fix-login', base: 'abc', from: 'dev', made: 'office/Rex' } }), 'Ada', { remote: 'u' });
  assert.equal(own.branch, 'fix-login');
  assert.equal(own.base, 'origin/dev');
  // No origin: the local branch. No branch it was cut from: the commit.
  assert.equal(whipVars(worker('Rex'), 'Ada', {}).base, 'main');
  assert.equal(whipVars(worker('Rex', 'working', { worktree: { path: 'p', branch: 'b', base: '0123456789abcdef0123' } }), 'Ada').base, '0123456789ab');
  // In the floor's own checkout: its branch, against origin's default.
  const checkout = whipVars(worker('Rex', 'working', { worktree: undefined }), 'Ada', { branch: 'feature/x', remote: 'u' });
  assert.equal(checkout.branch, 'feature/x');
  assert.equal(checkout.base, 'origin/HEAD');
  assert.equal(whipVars(worker('Rex', 'working', { worktree: undefined }), 'Ada', { branch: 'HEAD' }).branch, 'the current branch');
  // The task: its sign, else the start of its first prompt, else a stand-in.
  assert.equal(whipVars(worker('Rex', 'working', { prompt: '  Make the\n dog bark  ' }), 'Ada').task, 'Make the dog bark');
  assert.equal(String(whipVars(worker('Rex', 'working', { prompt: 'x'.repeat(5000) }), 'Ada').task).length, 400);
  assert.equal(whipVars(worker('Rex'), 'Ada').task, 'the task you were given');
});

test('only an agent that is up and not asking anything can be whipped', () => {
  assert.equal(whipRefusal(worker('Rex', 'working')), undefined);
  assert.equal(whipRefusal(worker('Rex', 'done')), undefined);
  assert.equal(whipRefusal(worker('Rex', 'idle')), undefined);
  assert.match(whipRefusal(worker('Rex', 'needs_input')) ?? '', /waiting on an answer: answer it first/);
  assert.match(whipRefusal(worker('Rex', 'exited')) ?? '', /asleep/);
  assert.match(whipRefusal(worker('Rex', 'offline')) ?? '', /asleep/);
  assert.match(whipRefusal(worker('Rex', 'starting')) ?? '', /sitting down/);
  assert.match(whipRefusal(worker('Rex', 'working', { kind: 'shell' })) ?? '', /shell/);
  assert.match(whipRefusal(worker('Rex', 'working', { meeting: 'm1' })) ?? '', /meeting/);
  assert.match(whipRefusal(worker('Issues agent', 'working', { deskId: 'station-issues' })) ?? '', /looks after its board/);
  assert.match(whipRefusal(worker('Rex'), 12_300) ?? '', /^Rex is still smarting — give it 13s$/);
});

test('a worker smarts for the cooldown, each on its own, and worn-off lashes are forgotten', () => {
  const c = new WhipCooldowns(1000);
  assert.equal(c.left('a', 0), 0);
  c.mark('a', 0);
  assert.equal(c.left('a', 400), 600);
  assert.equal(c.left('b', 400), 0);
  c.mark('b', 500);
  assert.equal(c.left('a', 1000), 0);
  assert.equal(c.left('b', 1000), 500);
  c.mark('c', 1200);
  assert.equal((c as unknown as { at: Map<string, number> }).at.has('a'), false);
  assert.equal(new WhipCooldowns().left('x', 0), 0);
  assert.equal(WHIP_COOLDOWN_MS, 20_000);
});

test('the prompt is in the editor under its own heading', () => {
  assert.equal(PROMPTS['worker.whip'].group, 'whip');
  assert.ok(PROMPTS['worker.whip'].needs?.includes('base'));
  assert.equal(handlers['worker.whip'], whipHandlers['worker.whip']);
  // A rewrite that leaves the PR out still reads.
  assert.equal(fillPrompt('Go over {{branch}}.\n\n{{pr}}\n\nThanks.', whipVars(worker('Rex'), 'Ada')), 'Go over office/Rex.\n\nThanks.');
});

/** Just enough of the office for the handler: one floor, its workers, and what it sends. */
function office(info: WorkerInfo, promptErr?: string) {
  const sent: { to: string; msg: ServerMsg }[] = [];
  const prompts: { id: string; text: string; by?: string }[] = [];
  const floor = {
    id: 'f1',
    project: { branch: 'main', remote: 'u' },
    workers: {
      get: (id: string) => (id === info.id ? info : undefined),
      prompt: (id: string, text: string, by?: string) => {
        if (promptErr) return promptErr;
        prompts.push({ id, text, by });
        return undefined;
      },
    },
  };
  const other = { id: 'f2' };
  const ctx = {
    prompts: undefined,
    floorOf: (c: { floor: string }) => (c.floor === 'f1' ? floor : c.floor === 'f2' ? other : undefined),
    workerFloor: (id: string) => (id === info.id ? floor : undefined),
    warn: (c: { id: string }, text?: string) => text && sent.push({ to: c.id, msg: { t: 'toast', text, level: 'warn' } }),
    toFloor: (_f: unknown, msg: ServerMsg) => sent.push({ to: 'floor', msg }),
    toastFloor: (_f: unknown, text: string) => sent.push({ to: 'floor', msg: { t: 'toast', text, level: 'info' } }),
  };
  const client = (floorId: string) => ({ id: 'c1', floor: floorId, peer: { id: 'p1', name: 'Ada' } });
  const crack = (floorId = 'f1') => whipHandlers['worker.whip'](ctx as never, client(floorId) as never, { t: 'worker.whip', workerId: info.id });
  return { sent, prompts, crack };
}

test('cracking the whip prompts the worker, makes it flinch for the floor and then makes you wait', () => {
  const o = office(worker('Whippy1'));
  o.crack();
  assert.equal(o.prompts.length, 1);
  assert.equal(o.prompts[0].by, 'Ada');
  assert.match(o.prompts[0].text, /optimization pass/);
  assert.deepEqual(o.sent[0], { to: 'floor', msg: { t: 'worker.whipped', workerId: 'Whippy1', by: 'p1', name: 'Ada' } });
  assert.deepEqual(o.sent[1], { to: 'floor', msg: { t: 'toast', text: '🪢 Ada cracked the whip at Whippy1: optimization pass', level: 'info' } });
  // Again straight away: still smarting, and nothing is sent to it.
  o.crack();
  assert.equal(o.prompts.length, 1);
  assert.match((o.sent[2].msg as { text: string }).text, /still smarting/);
  assert.equal(o.sent[2].to, 'c1');
});

test('a worker on another floor, one asking a question, or one the prompt fails for is left alone', () => {
  const away = office(worker('Whippy2'));
  away.crack('f2');
  assert.equal(away.prompts.length, 0);
  assert.deepEqual(away.sent.map((s) => s.to), ['c1']);

  const asking = office(worker('Whippy3', 'needs_input'));
  asking.crack();
  assert.equal(asking.prompts.length, 0);
  assert.match((asking.sent[0].msg as { text: string }).text, /answer it first/);

  // When the prompt can't be typed in, nobody sees a lash, and it can be tried again at once.
  const gone = office(worker('Whippy4'), 'Worker is not running');
  gone.crack();
  gone.crack();
  assert.deepEqual(gone.sent.map((s) => (s.msg as { text: string }).text), ['Worker is not running', 'Worker is not running']);
});
