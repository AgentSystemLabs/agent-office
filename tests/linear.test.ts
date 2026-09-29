import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BAD_KEY, LinearIssues, NO_KEY, RATE_LIMITED, checkLinearKey, linearQuery } from '../src/server/linear.js';
import type { GhIssue, GhState } from '../src/shared/protocol.js';

const CFG = { provider: 'linear' as const, teams: ['FOUND', 'PLAT'] };

interface Call {
  op: string;
  variables: Record<string, unknown>;
  auth: string | undefined;
}
type Answer = { status?: number; body: unknown } | ((call: Call) => { status?: number; body: unknown });

/** Linear, as a script of answers; every call's operation name, variables and auth header are kept. */
function linear(answers: Answer[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
    const op = /(?:query|mutation)\s+(\w+)/.exec(body.query)?.[1] ?? (/viewer/.test(body.query) ? 'viewer' : '?');
    const call = { op, variables: body.variables, auth: (init?.headers as Record<string, string> | undefined)?.authorization };
    calls.push(call);
    const next = answers.shift();
    const a = typeof next === 'function' ? next(call) : (next ?? { status: 200, body: { errors: [{ message: `no answer scripted for ${op}` }] } });
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

/** A board with the office's key (null: no key yet). */
function board(answers: Answer[], key: string | null = 'lin_api_k', cfg = CFG) {
  const { calls, fetchImpl } = linear(answers);
  const failed: string[] = [];
  const states: GhState<GhIssue>[] = [];
  const issues = new LinearIssues(cfg, { key: () => key ?? undefined, viewerId: () => 'me-1', failed: (w) => failed.push(w) }, (s) => states.push(s), fetchImpl);
  return { issues, calls, states, failed };
}

const raw = (over: Record<string, unknown> = {}) => ({
  id: 'uuid-found-2',
  identifier: 'FOUND-2',
  title: 'Dog barks',
  description: 'It barks.',
  url: 'https://linear.app/cc/issue/FOUND-2',
  priority: 2,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-20T00:00:00Z',
  branchName: 'greg/found-2-dog-barks',
  state: { name: 'In Progress', type: 'started' },
  labels: { nodes: [{ id: 'l1', name: 'Bug', color: '#ff0000' }, { id: 'l2', name: 'odd', color: 'red' }] },
  assignee: { displayName: 'Greg' },
  creator: { displayName: 'Ada' },
  ...over,
});
const page = (nodes: unknown[], more = false) => ({ nodes, pageInfo: { hasNextPage: more, endCursor: more ? 'c2' : null } });
/** A refresh of two teams that finds nothing: the four answers it takes. */
const empty = () => [{ body: { data: { issues: page([]) } } }, { body: { data: { issues: page([]) } } }, { body: { data: { issues: page([]) } } }, { body: { data: { issues: page([]) } } }];
const tick = () => new Promise((r) => setTimeout(r, 5));

test('a refresh pages each team’s open issues, adds its latest closed ones, and sorts urgent first', async () => {
  const { issues, calls, states } = board([
    { body: { data: { issues: page([raw()], true) } } },
    { body: { data: { issues: page([raw({ id: 'u3', identifier: 'found-3', title: 'None', priority: 0, state: { type: 'triage' }, updatedAt: '2026-09-26T00:00:00Z', labels: null, assignee: null, branchName: null })]) } } },
    { body: { data: { issues: page([raw({ id: 'u4', identifier: 'FOUND-4', title: 'Done', state: { type: 'completed' } })]) } } },
    { body: { data: { issues: page([raw({ id: 'u9', identifier: 'PLAT-9', title: 'Low', priority: 4, state: { type: 'backlog' }, updatedAt: '2026-09-25T00:00:00Z' }), raw({ id: 'u1', identifier: 'PLAT-1', title: 'Urgent', priority: 1, state: { type: 'unstarted' }, updatedAt: '2026-09-02T00:00:00Z' })]) } } },
    { body: { data: { issues: page([]) } } },
  ]);
  await issues.refreshIssues();
  assert.deepEqual(
    calls.map((c) => [c.op, c.variables.team, c.variables.after ?? null]),
    [
      ['Open', 'FOUND', null],
      ['Open', 'FOUND', 'c2'],
      ['Closed', 'FOUND', null],
      ['Open', 'PLAT', null],
      ['Closed', 'PLAT', null],
    ],
  );
  assert.ok(calls.every((c) => c.auth === 'lin_api_k'), 'a personal key goes as it is');
  assert.deepEqual(calls[0].variables.types, ['triage', 'backlog', 'unstarted', 'started']);
  assert.deepEqual(calls[2].variables.types, ['completed', 'canceled']);
  assert.deepEqual(states.map((s) => s.loading), [true, false]);
  const st = states[1];
  assert.equal(st.error, undefined);
  assert.deepEqual(st.items.map((i) => i.id), ['PLAT-1', 'FOUND-2', 'FOUND-4', 'PLAT-9', 'FOUND-3']);
  const found = st.items.find((i) => i.id === 'FOUND-2')!;
  assert.equal(found.state, 'OPEN');
  assert.equal(found.status, 'started');
  assert.equal(found.priority, 2);
  assert.equal(found.branch, 'greg/found-2-dog-barks');
  assert.equal(found.body, 'It barks.');
  assert.deepEqual(found.assignees, ['Greg']);
  assert.equal(found.author, 'Ada');
  assert.deepEqual(found.labels, [{ name: 'Bug', color: '#ff0000' }, { name: 'odd', color: '#888888' }]);
  assert.equal(st.items.find((i) => i.id === 'FOUND-4')!.state, 'CLOSED');
  assert.deepEqual(st.items.find((i) => i.id === 'FOUND-3')!.labels, []);
  assert.equal(issues.issues, st);
});

test('with no key the board says so and asks Linear nothing', async () => {
  const { issues, calls, states } = board([], null);
  await issues.refreshIssues();
  assert.equal(calls.length, 0);
  assert.equal(states.at(-1)!.error, NO_KEY);
  assert.equal(await issues.claim('FOUND-2'), NO_KEY);
});

test('a refused key is reported to whoever keeps it, and the board says to paste a new one', async () => {
  const { issues, states, failed } = board([{ status: 401, body: { errors: [{ message: 'Authentication required' }] } }, { body: { errors: [{ message: 'Not authenticated', extensions: { code: 'AUTHENTICATION_ERROR' } }] } }]);
  await issues.refreshIssues();
  assert.equal(states.at(-1)!.error, BAD_KEY);
  assert.deepEqual(failed, [BAD_KEY]);
  assert.deepEqual(await issues.comment('issue', 'FOUND-2', 'hi'), { error: BAD_KEY });
  assert.equal(failed.length, 2);
});

test('rate limiting pauses the board for a while, and other errors come through in Linear’s words', async () => {
  const { issues, calls, states } = board([{ status: 429, body: {} }]);
  await issues.refreshIssues();
  assert.equal(states.at(-1)!.error, RATE_LIMITED);
  assert.ok(issues.pausedFor > 60_000);
  await issues.refreshIssues();
  assert.equal(calls.length, 1, 'paused: nothing asked');
  assert.equal(await issues.claim('FOUND-2'), RATE_LIMITED);
  const other = board([{ body: { errors: [{ message: 'Field "nope" is not defined' }] } }]);
  await other.issues.refreshIssues();
  assert.equal(other.states.at(-1)!.error, 'Linear: Field "nope" is not defined');
});

test('the detail view reads the body and comments (oldest first) and who the key is', async () => {
  const { issues, calls } = board([
    {
      body: {
        data: {
          issue: {
            id: 'uuid-found-2',
            identifier: 'FOUND-2',
            description: 'Full description',
            state: { type: 'started' },
            comments: {
              nodes: [
                { id: 'c2', body: 'Later', createdAt: '2026-09-03T00:00:00Z', url: 'u2', user: null, botActor: { name: 'Linear bot' } },
                { id: 'c1', body: 'Hi', createdAt: '2026-09-02T00:00:00Z', url: 'u1', user: { displayName: 'Ada' } },
              ],
            },
          },
          viewer: { displayName: 'Greg' },
        },
      },
    },
  ]);
  const d = await issues.issueDetail('FOUND-2');
  assert.equal(calls[0].op, 'Detail');
  assert.deepEqual(calls[0].variables, { id: 'FOUND-2' });
  assert.deepEqual(d, {
    id: 'FOUND-2',
    state: 'OPEN',
    body: 'Full description',
    comments: [
      { id: 'c1', author: 'Ada', body: 'Hi', createdAt: '2026-09-02T00:00:00Z', url: 'u1' },
      { id: 'c2', author: 'Linear bot', body: 'Later', createdAt: '2026-09-03T00:00:00Z', url: 'u2' },
    ],
    viewer: 'Greg',
  });
});

test('a comment goes to Linear’s own id for the issue, learned from the board or asked for', async () => {
  const { issues, calls } = board([
    { body: { data: { issues: page([raw()]) } } },
    ...empty().slice(1),
    { body: { data: { commentCreate: { success: true, comment: { id: 'c9', body: 'Looks done', createdAt: '2026-09-27T00:00:00Z', url: 'u', user: { displayName: 'Greg' } } } } } },
    { body: { data: { issue: { id: 'uuid-plat-5' } } } },
    { body: { data: { commentCreate: { success: false } } } },
  ]);
  await issues.refreshIssues();
  const r = await issues.comment('issue', 'FOUND-2', 'Looks done');
  assert.deepEqual(r, { comment: { id: 'c9', author: 'Greg', body: 'Looks done', createdAt: '2026-09-27T00:00:00Z', url: 'u' } });
  assert.equal(calls[4].op, 'Comment');
  assert.deepEqual(calls[4].variables, { issueId: 'uuid-found-2', body: 'Looks done' });
  // An issue the board hasn't listed: its id is asked for first.
  assert.deepEqual(await issues.comment('issue', 'PLAT-5', 'x'), { error: 'Linear did not take the comment' });
  assert.deepEqual([calls[5].op, calls[5].variables], ['Id', { id: 'PLAT-5' }]);
  assert.equal(calls[6].variables.issueId, 'uuid-plat-5');
});

test('closing finds the team’s state of the right type once, comments first when asked, and shows at once', async () => {
  const states = { nodes: [{ id: 's-todo', type: 'unstarted', name: 'Todo' }, { id: 's-done', type: 'completed', name: 'Done' }, { id: 's-dup', type: 'canceled', name: 'Duplicate' }, { id: 's-can', type: 'canceled', name: 'Canceled' }] };
  const { issues, calls, states: seen } = board([
    { body: { data: { issues: page([raw()]) } } },
    ...empty().slice(1),
    { body: { data: { issue: { team: { states } } } } },
    { body: { data: { commentCreate: { success: true, comment: { id: 'c1', body: 'Superseded', createdAt: 'now' } } } } },
    { body: { data: { issueUpdate: { success: true } } } },
    // The refresh that follows.
    { body: { data: { issues: page([raw({ state: { type: 'canceled' } })]) } } },
    ...empty().slice(1),
    { body: { data: { issueUpdate: { success: true } } } },
  ]);
  await issues.refreshIssues();
  assert.equal(await issues.close('issue', 'FOUND-2', { reason: 'not planned', comment: 'Superseded' }), undefined);
  assert.deepEqual(calls.slice(4, 7).map((c) => c.op), ['States', 'Comment', 'Close']);
  assert.deepEqual(calls[6].variables, { id: 'uuid-found-2', stateId: 's-dup' });
  const local = seen.find((s) => !s.loading && s.items[0]?.state === 'CLOSED')!;
  assert.equal(local.items[0].status, 'canceled');
  await tick();
  // Done for the same team needs no second look at its states.
  assert.equal(await issues.close('issue', 'FOUND-2', { reason: 'completed' }), undefined);
  const closes = calls.filter((c) => c.op === 'Close');
  assert.equal(closes.length, 2);
  assert.deepEqual(closes[1].variables, { id: 'uuid-found-2', stateId: 's-done' });
  assert.equal(calls.filter((c) => c.op === 'States').length, 1);
});

test('claiming assigns the key’s user; labels are listed once a minute and changed by name', async () => {
  const { issues, calls } = board([
    { body: { data: { issue: { id: 'uuid-plat-7' } } } },
    { body: { data: { issueUpdate: { success: true } } } },
    // The refresh after the claim.
    ...empty(),
    { body: { data: { issueLabels: { nodes: [{ id: 'l1', name: 'Bug', color: '#ff0000', description: 'Broken' }, { id: 'l1b', name: 'bug', color: '#ff0000' }, { id: 'l2', name: 'Odd' }] } } } },
    { body: { data: { issue: { labels: { nodes: [{ id: 'l2', name: 'Odd' }, { id: 'l3', name: 'Keep' }] } } } } },
    { body: { data: { issueUpdate: { success: true, issue: { labels: { nodes: [{ id: 'l3', name: 'Keep' }, { id: 'l1', name: 'Bug', color: '#ff0000' }] } } } } } },
    // The refresh after the relabel, then the look at the issue's labels for the next change.
    ...empty(),
    { body: { data: { issue: { labels: { nodes: [] } } } } },
  ]);
  assert.equal(await issues.claim('PLAT-7'), undefined);
  assert.deepEqual([calls[0].op, calls[1].op], ['Id', 'Claim']);
  assert.deepEqual(calls[1].variables, { id: 'uuid-plat-7', assigneeId: 'me-1' });
  await tick();
  const labels = await issues.repoLabels();
  assert.deepEqual(labels, [{ name: 'Bug', color: '#ff0000', description: 'Broken' }, { name: 'Odd', color: '#888888' }]);
  assert.equal(await issues.repoLabels(), labels, 'cached');
  assert.deepEqual(calls.at(-1)!.variables, { teams: ['FOUND', 'PLAT'] });
  const set = await issues.setLabels('issue', 'PLAT-7', ['Bug'], ['Odd']);
  assert.deepEqual(set, { labels: [{ name: 'Keep', color: '#888888' }, { name: 'Bug', color: '#ff0000' }] });
  const relabel = calls.find((c) => c.op === 'Relabel')!;
  assert.deepEqual(relabel.variables, { id: 'uuid-plat-7', labelIds: ['l3', 'l1'] });
  await tick();
  assert.match((await issues.setLabels('issue', 'PLAT-7', ['Nope'], [])).error ?? '', /no label “Nope”/);
});

test('linearQuery sends an OAuth token as a bearer token; checkLinearKey says who the key is', async () => {
  const { calls, fetchImpl } = linear([{ body: { data: { viewer: { id: 'u1', displayName: 'Greg Brinker', organization: { name: 'CompanyCam' } } } } }, { body: { data: { ok: 1 } } }]);
  assert.deepEqual(await checkLinearKey('lin_oauth_tok', fetchImpl), { viewerId: 'u1', viewer: 'Greg Brinker', workspace: 'CompanyCam' });
  assert.equal(calls[0].auth, 'Bearer lin_oauth_tok');
  assert.deepEqual(await linearQuery('lin_api_k', 'query X { ok }', {}, fetchImpl), { ok: 1 });
  assert.equal(calls[1].auth, 'lin_api_k');
});
