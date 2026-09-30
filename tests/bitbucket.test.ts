import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Bitbucket } from '../src/server/bitbucket.js';
import { bb, forgeOf, forgeOfDir, MergeWatch, openPull, prRef, WRONG_BB } from '../src/server/forge.js';
import type { GhIssue, GhPull, GhState } from '../src/shared/protocol.js';

// A floor on Bitbucket: the same boards, pull request window and merge dialog the office has for
// GitHub, filled in from the Bitbucket CLI's own JSON. A fake bb on PATH answers the calls the
// office makes, so what matters here is the reading of Bitbucket's shapes, not the real service.

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A checkout whose origin is on Bitbucket, with a fake bb beside it. */
function fixture(t: { after(fn: () => void): void }) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'agent-office-bitbucket-')));
  const bin = path.join(root, 'bin');
  const dir = path.join(root, 'project');
  mkdirSync(bin, { recursive: true });
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  writeFileSync(path.join(dir, 'README.md'), '# web\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'first');
  git(dir, 'remote', 'add', 'origin', 'https://bitbucket.org/acme/web.git');

  const state = path.join(root, 'bb.json');
  const saved = { PATH: process.env.PATH, BB_STATE: process.env.BB_STATE };
  process.env.PATH = `${bin}${path.delimiter}${saved.PATH ?? ''}`;
  process.env.BB_STATE = state;
  writeFileSync(path.join(bin, 'bb'), FAKE_BB, { mode: 0o755 });
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });
  return { dir, state };
}

/** Pull requests kept in $BB_STATE, in the shapes `bb pr list`, `view`, `checks` and `diff` return. */
const FAKE_BB = `#!/usr/bin/env node
const fs = require('node:fs');
const file = process.env.BB_STATE;
const st = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
st.prs ??= []; st.comments ??= [];
const a = process.argv.slice(2);
const opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
const slug = () => 'acme/web';
const done = (out, code = 0, save = false) => { if (save) fs.writeFileSync(file, JSON.stringify(st)); process.stdout.write(typeof out === 'string' ? out : JSON.stringify(out)); process.exit(code); };
const html = (id) => 'https://bitbucket.org/' + slug() + '/pull-requests/' + id;
const view = (id) => {
  const p = st.prs.find((p) => p.id === id);
  if (!p) return done(JSON.stringify({ name: 'BBError', code: 6001, message: 'Repository not found' }), 1);
  return { type: 'pullrequest', id: p.id, title: p.title, state: p.state, draft: !!p.draft, description: p.description ?? '',
    author: { nickname: p.author, display_name: p.author }, source: { branch: { name: p.source }, commit: { hash: p.hash } },
    destination: { branch: { name: p.destination } }, participants: p.participants ?? [], links: { html: { href: html(p.id) } } };
};
if (a[0] === 'auth' && a[1] === 'status') done({ authenticated: true, user: { username: 'office-bot' } });
if (a[0] === 'repo' && a[1] === 'view') done({ full_name: slug(), mainbranch: { name: 'main' } });
if (a[0] === 'pr' && a[1] === 'list') done({ workspace: 'acme', repoSlug: 'web', state: opt('--state'), count: 1, pullRequests: st.prs.filter((p) => p.state === opt('--state')).map((p) => view(p.id)) });
if (a[0] === 'pr' && a[1] === 'view') done(view(Number(a[2])));
if (a[0] === 'pr' && a[1] === 'checks') done({ pullRequestId: Number(a[2]), workspace: 'acme', repoSlug: 'web', summary: { successful: 1, failed: 0, pending: 0 }, statuses: st.statuses ?? [] });
if (a[0] === 'pr' && a[1] === 'diff') done({ workspace: 'acme', repoSlug: 'web', pullRequestId: Number(a[2]), mode: 'diff', diff: 'diff --git a/a.txt b/a.txt\\n--- a/a.txt\\n+++ b/a.txt\\n@@ -0,0 +1 @@\\n+hi\\n' });
if (a[0] === 'pr' && a[1] === 'activity') done({ workspace: 'acme', repoSlug: 'web', count: (st.activity ?? []).length, activities: st.activity ?? [] });
if (a[0] === 'pr' && a[1] === 'create') {
  const id = st.prs.length + 1;
  st.prs.push({ id, title: opt('--title'), state: 'OPEN', author: 'office-bot', source: opt('--source'), destination: opt('--destination') || 'main', description: opt('--body') });
  done(view(id), 0, true);
}
if (a[0] === 'pr' && a[1] === 'edit') { const p = st.prs.find((p) => p.id === Number(a[2])); if (p) p.description = opt('--body'); done(view(Number(a[2])), 0, true); }
if (a[0] === 'pr' && a[1] === 'merge') { const p = st.prs.find((p) => p.id === Number(a[2])); if (p) { p.state = 'MERGED'; p.strategy = opt('--strategy'); p.closed = a.includes('--close-source-branch'); } done({ success: true, pullRequestId: Number(a[2]) }, 0, true); }
if (a[0] === 'pr' && a[1] === 'decline') { const p = st.prs.find((p) => p.id === Number(a[2])); if (p) p.state = 'DECLINED'; done({ success: true, pullRequestId: Number(a[2]) }, 0, true); }
if (a[0] === 'pr' && a[1] === 'comments' && a[2] === 'add') { const id = Number(a[3]); st.comments.push({ pr: id, body: a[4] }); done({ success: true, pullRequestId: id }, 0, true); }
if (a[0] === 'repo' && a[1] === 'clone') done({ success: true, repository: a[2], path: opt('--directory') });
done('', 1);
`;

function board(f: ReturnType<typeof fixture>, state: unknown) {
  writeFileSync(f.state, JSON.stringify(state));
  const seen: { issues: GhState<GhIssue>[]; pulls: GhState<GhPull>[] } = { issues: [], pulls: [] };
  const forge = new Bitbucket(f.dir, (s) => seen.issues.push(s), (s) => seen.pulls.push(s));
  return { forge, seen };
}

const PRS = {
  comments: [],
  prs: [
    { id: 7, title: 'Add the login page', state: 'OPEN', author: 'alice', source: 'feat/login', destination: 'main', description: 'Fixes the login.', hash: 'abc123' },
    { id: 6, title: 'Old change', state: 'MERGED', author: 'bob', source: 'feat/old', destination: 'main' },
    { id: 5, title: 'Stale idea', state: 'DECLINED', author: 'carol', source: 'idea', destination: 'main' },
  ],
  statuses: [{ key: 'build', name: 'build', state: 'SUCCESSFUL', url: 'https://bitbucket.org/acme/web/addon/pipelines/home#!/results/1' }],
  activity: [
    { user: { nickname: 'alice' }, created_on: '2026-01-15T10:00:00Z', pull_request_activity: { comment: { id: 100, content: { raw: 'Looks good to me' }, created_on: '2026-01-15T11:00:00Z' } } },
    { user: { nickname: 'bob' }, created_on: '2026-01-15T12:00:00Z', pull_request_activity: { comment: { id: 101, content: { raw: 'One nit' }, inline: { path: 'src/a.ts', to: 4 } } } },
    { user: { nickname: 'carol' }, created_on: '2026-01-15T13:00:00Z', pull_request_activity: { approval: { id: 102, approved: true } } },
    { user: { nickname: 'alice' }, created_on: '2026-01-15T14:00:00Z', pull_request_activity: { commit: { hash: 'abc123' } } },
  ],
};

// --- Which forge a checkout is on ------------------------------------------------------------------

test('a checkout is on Bitbucket when its origin is, and on GitHub for anything else', () => {
  assert.equal(forgeOf('https://bitbucket.org/acme/web.git'), 'bitbucket');
  assert.equal(forgeOf('git@bitbucket.org:acme/web.git'), 'bitbucket');
  assert.equal(forgeOf('https://github.com/acme/web.git'), 'github');
  assert.equal(forgeOf('git@github.mycompany.com:acme/web.git'), 'github', 'GitHub Enterprise is still GitHub');
  assert.equal(forgeOf(undefined), 'github', 'no remote at all: gh works out the rest');
});

test('a floor asks Bitbucket what kind of floor it is on', (t) => {
  const f = fixture(t);
  assert.equal(forgeOfDir(f.dir), 'bitbucket');
});

// --- The pull requests board ----------------------------------------------------------------------

test('the pull requests board lists open, merged and declined pull requests as OPEN, MERGED and CLOSED', async (t) => {
  const f = fixture(t);
  const { forge, seen } = board(f, PRS);
  await forge.pulls.refresh();
  const list = seen.pulls.at(-1)!.items;
  assert.deepEqual(
    list.map((p) => [p.number, p.state, p.headRefName, p.baseRefName, p.author]),
    [
      [7, 'OPEN', 'feat/login', 'main', 'alice'],
      [6, 'MERGED', 'feat/old', 'main', 'bob'],
      [5, 'CLOSED', 'idea', 'main', 'carol'],
    ],
    'DECLINED is a closed pull request as far as the board is concerned',
  );
  assert.equal(seen.pulls.at(-1)!.forge, 'bitbucket', 'the board says which forge it read');
  assert.equal(seen.pulls.at(-1)!.error, undefined);
});

test('Bitbucket has no repository issues, so the issues board is empty rather than broken', async (t) => {
  const f = fixture(t);
  const { forge, seen } = board(f, PRS);
  await forge.issues.refresh();
  assert.deepEqual(seen.issues.at(-1)!.items, []);
  assert.equal(seen.issues.at(-1)!.error, undefined);
  await assert.rejects(() => forge.issueDetail(1), /Bitbucket Cloud issues belong to a whole workspace/);
});

// --- The pull request window ----------------------------------------------------------------------

test('the pull request window reads a pull request, its conversation, its line comments and its checks', async (t) => {
  const f = fixture(t);
  const { forge } = board(f, PRS);
  const d = await forge.pullDetail(7);
  assert.equal(d.number, 7);
  assert.equal(d.body, 'Fixes the login.');
  assert.equal(d.headRefName, 'feat/login');
  assert.equal(d.baseRefName, 'main');
  assert.equal(d.forge, 'bitbucket');
  assert.equal(d.repo.nameWithOwner, 'acme/web');
  assert.equal(d.repo.forge, 'bitbucket');
  assert.deepEqual(d.repo.methods, ['squash', 'merge', 'rebase'], 'Bitbucket lets all three be picked');
  assert.equal(d.viewer, 'office-bot');
  assert.deepEqual(d.comments.map((c) => [c.author, c.body]), [['alice', 'Looks good to me']]);
  assert.deepEqual(d.reviewComments.map((c) => [c.author, c.path, c.line, c.side]), [['bob', 'src/a.ts', 4, 'RIGHT']]);
  assert.deepEqual(d.reviews.map((c) => [c.author, c.state]), [['carol', 'APPROVED']]);
  assert.equal(d.commits, 1);
  assert.deepEqual(d.checks.map((c) => [c.name, c.state]), [['build', 'pass']]);
});

test('the pull request window shows the diff as git prints it', async (t) => {
  const f = fixture(t);
  const { forge } = board(f, PRS);
  assert.match(await forge.pullDiff(7), /^diff --git a\/a\.txt/);
});

// --- Commenting, merging and closing -------------------------------------------------------------

test('a comment goes out as a conversation comment, and comes back as it was sent', async (t) => {
  const f = fixture(t);
  const { forge } = board(f, PRS);
  const r = await forge.comment('pull', 7, 'Merged from the office 👋');
  assert.equal(r.error, undefined);
  assert.equal(r.comment?.body, 'Merged from the office 👋');
  assert.equal(JSON.parse(readFileSync(f.state, 'utf8')).comments.at(-1).body, 'Merged from the office 👋');
});

test('Bitbucket has no issues to comment on, and says so', async (t) => {
  const f = fixture(t);
  const { forge } = board(f, PRS);
  assert.match((await forge.comment('issue', 3, 'hi')).error ?? '', /Bitbucket Cloud issues/);
  // close() and claim() answer with the reason itself, not wrapped: the office shows it as the error.
  assert.match((await forge.close('issue', 3, {})) ?? '', /Bitbucket Cloud issues/);
  assert.match((await forge.claim(3)) ?? '', /Bitbucket Cloud issues/);
});

test('merging uses the strategy picked, and deleting the branch is a flag Bitbucket understands', async (t) => {
  const f = fixture(t);
  const { forge } = board(f, PRS);
  assert.equal(await forge.merge(7, 'squash', true, false), undefined);
  const [merged] = JSON.parse(readFileSync(f.state, 'utf8')).prs;
  assert.equal(merged.state, 'MERGED');
  assert.equal(merged.strategy, 'squash');
  assert.equal(merged.closed, true);
});

test('the three merge strategies map onto the three Bitbucket ones', async (t) => {
  const f = fixture(t);
  const { forge } = board(f, PRS);
  const want = { squash: 'squash', merge: 'merge_commit', rebase: 'rebase_fast_forward' };
  for (const [method, strategy] of Object.entries(want)) {
    await forge.merge(7, method as 'squash' | 'merge' | 'rebase', false, false);
    assert.equal(JSON.parse(readFileSync(f.state, 'utf8')).prs[0].strategy, strategy, method);
  }
});

test('Bitbucket cannot merge a pull request later, so "merge when ready" is refused rather than merged now', async (t) => {
  const f = fixture(t);
  const { forge } = board(f, PRS);
  assert.match((await forge.merge(7, 'squash', false, true)) ?? '', /can’t merge a pull request later/);
  assert.equal(JSON.parse(readFileSync(f.state, 'utf8')).prs[0].state, 'OPEN', 'nothing was merged behind their back');
});

test('closing a pull request declines it, after saying why when asked to', async (t) => {
  const f = fixture(t);
  const { forge } = board(f, PRS);
  assert.equal(await forge.close('pull', 7, { comment: 'Not this quarter', deleteBranch: true }), undefined);
  const st = JSON.parse(readFileSync(f.state, 'utf8'));
  assert.equal(st.prs[0].state, 'DECLINED');
  assert.equal(st.comments.at(-1).body, 'Not this quarter');
});

test('the meeting room review panel posts the note as a comment and answers with the pull request', async (t) => {
  const f = fixture(t);
  const { forge } = board(f, PRS);
  const file = path.join(f.dir, 'review.md');
  writeFileSync(file, 'Looks right, one nit on line 4.\n');
  assert.equal(await forge.review(7, file), 'acme/web#7');
  assert.equal(JSON.parse(readFileSync(f.state, 'utf8')).comments.at(-1).body, 'Looks right, one nit on line 4.\n');
});

// --- Labels ---------------------------------------------------------------------------------------

test('Bitbucket has no labels, so the picker offers none and says why rather than pretending', async (t) => {
  const f = fixture(t);
  const { forge } = board(f, PRS);
  assert.deepEqual(await forge.repoLabels(), []);
  assert.match((await forge.setLabels('pull', 7, ['bug'], [])).error ?? '', /no labels/);
});

// --- Opening a pull request for a worker's branch -------------------------------------------------

test("a worker's branch is pushed and opened with bb, and the number comes off the pull request", async (t) => {
  const f = fixture(t);
  const pr = await openPull('feat/login', 'main', 'Add the login page', 'Fixes the login.', f.dir, 'bitbucket');
  assert.deepEqual(pr, { number: 1, url: 'https://bitbucket.org/acme/web/pull-requests/1' });
  const [saved] = JSON.parse(readFileSync(f.state, 'utf8')).prs;
  assert.equal(saved.title, 'Add the login page');
  assert.equal(saved.source, 'feat/login');
  assert.equal(saved.destination, 'main');
});

test('a pull request is named the same way on either forge, so a description reads the same', () => {
  assert.equal(prRef('https://github.com/acme/web/pull/12'), 'acme/web#12');
  assert.equal(prRef('https://bitbucket.org/acme/web/pull-requests/12'), 'acme/web#12');
  assert.equal(prRef('https://example.com/other/12'), 'https://example.com/other/12', 'an unrecognised URL is left alone');
});

// --- The wrong bb ----------------------------------------------------------------------------------

/** Atlassian's own Bitbucket CLI, which answers to `bb` and shares no subcommand with ours. */
const OTHER_BB = `#!/usr/bin/env node
const a = process.argv.slice(2);
const die = (m) => { process.stderr.write('Error: ' + m + '\\nRun \\'bb --help\\' for usage.\\n'); process.exit(1); };
if (a[0] === 'auth') die('unknown command "auth" for "bb"');
if (a[0] === 'status') die('unknown command "status" for "bb"');
if (a.includes('--json')) die('unknown flag: --json');
if (a[0] === 'pr' && a[1] === 'list') die('invalid argument "' + a[3] + '" for "--state" flag: Flag value "' + a[3] + '" is invalid. Expected values are all, declined, merged, open, superseded');
process.exit(0);
`;

test('a bb that is not the CLI the office reads is named as such, not passed on as an error', async (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.dir, '..', 'bin', 'bb'), OTHER_BB, { mode: 0o755 });
  const { forge, seen } = board(f, PRS);
  await forge.refresh();
  // What the board says, rather than "unknown flag: --json" or a lower-case state complaint.
  assert.equal(seen.pulls.at(-1)?.error, WRONG_BB);
});

test('the wrong bb is caught whichever way the office asks it something', async (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.dir, '..', 'bin', 'bb'), OTHER_BB, { mode: 0o755 });
  // Each of these is one a real machine produced, and each is turned into the same sentence.
  for (const [args, what] of [
    [['auth', 'status', '--json'], 'auth status'],
    [['pr', 'list', '--state', 'OPEN', '--json'], 'the board'],
    [['repo', 'view', '--json'], 'the repository'],
  ] as const) {
    const err = await bb(args, f.dir).then(() => undefined, (e: Error) => e.message);
    assert.equal(err, WRONG_BB, what);
  }
});

// --- Answering with more than a pipe can hold -------------------------------------------------------

/**
 * bb loses whatever it hasn't written by the time it exits when stdout is a pipe, so the office
 * gives it a file instead. This one writes well over a pipe buffer, which is what reaches a board
 * as `Unterminated string in JSON` when it is read through one.
 */
const VOLUMINOUS_BB = `#!/usr/bin/env node
const prs = Array.from({ length: 30 }, (_, i) => ({
  type: 'pullrequest', id: 100 + i, title: 'A pull request with a title long enough to add up',
  state: 'MERGED', draft: false, description: 'x'.repeat(4000), summary: { raw: 'x'.repeat(4000) },
  author: { nickname: 'someone', display_name: 'Someone' },
  source: { branch: { name: 'feature/' + i }, commit: { hash: 'a'.repeat(40) } },
  destination: { branch: { name: 'main' } }, participants: [],
  links: { html: { href: 'https://bitbucket.org/acme/web/pull-requests/' + (100 + i) } },
}));
process.stdout.write(JSON.stringify({ workspace: 'acme', repoSlug: 'web', count: prs.length, pullRequests: prs }));
process.exit(0);
`;

/** Puts `script` in as this floor's bb. The fixture is thrown away whole afterwards, so there's
 * nothing to put back. */
function asBb(dir: string, script: string) {
  writeFileSync(path.join(dir, '..', 'bin', 'bb'), script, { mode: 0o755 });
}

test('a bb answer larger than a pipe buffer is read whole, and the board fills', async (t) => {
  const f = fixture(t);
  asBb(f.dir, VOLUMINOUS_BB);
  // Over 250 kB of JSON, several times a pipe buffer.
  const answer = await bb(['pr', 'list', '--state', 'MERGED', '--limit', '30', '--json'], f.dir, 30_000);
  assert.doesNotMatch(answer, /Unterminated string/, 'the whole answer arrives, not a pipe buffer of it');
  assert.equal((JSON.parse(answer) as { pullRequests: unknown[] }).pullRequests.length, 30);

  const { forge, seen } = board(f, PRS);
  await forge.refresh();
  const last = seen.pulls.at(-1)!;
  assert.equal(last.error, undefined, `the board reads it whole: ${last.error}`);
  assert.equal(last.items.length, 30, 'and shows every pull request in it');
  assert.equal(last.items[0].number, 100, 'the first card is the first one bb listed');
});

test('bb that is not installed, and a bb that is not the CLI, are each named as themselves', async (t) => {
  const f = fixture(t);
  asBb(f.dir, OTHER_BB);
  const wrong = await bb(['pr', 'list', '--state', 'OPEN', '--json'], f.dir, 5_000).then(() => undefined, (e: Error) => e.message);
  assert.equal(wrong, WRONG_BB);

  // bb not on the path at all: there is nothing to read Bitbucket with.
  const empty = mkdtempSync(path.join(tmpdir(), 'agent-office-nobb-'));
  const savedPath = process.env.PATH;
  process.env.PATH = empty;
  t.after(() => {
    process.env.PATH = savedPath;
    rmSync(empty, { recursive: true, force: true });
  });
  const missing = await bb(['pr', 'list'], f.dir, 5_000).then(() => undefined, (e: Error) => e.message);
  assert.equal(missing, 'Bitbucket CLI (bb) is not installed on the server');
});

test('a repository bb cannot see is reported as that, not as a sign-in that stopped working', async (t) => {
  const f = fixture(t);
  // bb's real answer, which ends "…make sure you are authenticated" and so reads as a sign-in
  // problem unless the code and the hint beside the message are looked at too.
  asBb(
    f.dir,
    `#!/usr/bin/env node
// bb writes its error envelope to stderr, as the real one does.
process.stderr.write(JSON.stringify({ name: 'APIError', code: 2002, message: 'Repository acme/missing not found.',
  context: { statusCode: 404 }, statusCode: 404,
  response: { error: { message: 'You may not have access to this repository or it no longer exists in this workspace. If you think this repository exists and you have access, make sure you are authenticated.' } } }));
process.exit(1);
`,
  );
  const err = await bb(['repo', 'view', 'acme/missing', '--json'], f.dir, 5_000).then(() => undefined, (e: Error) => e.message);
  assert.match(err ?? '', /can't find this repository on Bitbucket/);
  assert.doesNotMatch(err ?? '', /isn't signed in/, 'and not as a sign-in that needs doing again');
});

test('a bb that takes too long is said to have taken too long', async (t) => {
  const f = fixture(t);
  asBb(f.dir, `#!/usr/bin/env node\nsetTimeout(() => process.exit(0), 30000);\n`);
  const err = await bb(['pr', 'list', '--json'], f.dir, 1_200).then(() => undefined, (e: Error) => e.message);
  assert.match(err ?? '', /bb didn't answer within 1s/);
});

test('an error bb writes to stdout is read, since that is where it may have put it', async (t) => {
  const f = fixture(t);
  asBb(
    f.dir,
    `#!/usr/bin/env node
process.stdout.write('Error: this bb explains itself on stdout\\n');
process.exit(1);
`,
  );
  const err = await bb(['pr', 'list', '--json'], f.dir, 5_000).then(() => undefined, (e: Error) => e.message);
  assert.match(err ?? '', /explains itself on stdout/, 'and not left as an unexplained exit code');
});

// --- The gong -------------------------------------------------------------------------------------

test('a pull request that was open at the last look and is merged now rings once, on any forge', () => {
  const w = new MergeWatch();
  const pull = (number: number, state: string): GhPull => ({
    number, title: `PR ${number}`, state, isDraft: false, url: '', author: '', labels: [], reviewDecision: '',
    headRefName: `b${number}`, baseRefName: 'main', createdAt: '', updatedAt: '', additions: 0, deletions: 0,
    checks: 'none', body: '', closes: [],
  });
  assert.deepEqual(w.look([pull(1, 'OPEN'), pull(2, 'MERGED'), pull(3, 'OPEN')]), [], 'nothing rings on the first look');
  assert.deepEqual(w.look([pull(1, 'MERGED'), pull(2, 'MERGED')]).map((p) => p.number), [1]);
  // A merge from the PR window rings at once, and not again when Bitbucket catches up.
  const g = new MergeWatch();
  g.look([pull(5, 'OPEN')]);
  assert.equal(g.ring(5), true);
  assert.equal(g.ring(5), false);
  assert.deepEqual(g.look([pull(5, 'MERGED')]), []);
});
