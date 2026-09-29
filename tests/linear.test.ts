import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LINEAR_DOWN, LinearIssues, NO_CLAUDE } from '../src/server/linear.js';
import type { HeadlessOpts } from '../src/server/headless.js';
import type { GhIssue, GhState } from '../src/shared/protocol.js';

const CFG = { provider: 'linear' as const, teams: ['found', 'PLAT'], mcp: 'claude_ai_Linear' };

/** A Linear board whose Claude answers from a script: each call's options are kept, and `answers` are handed back in turn. */
function board(answers: (unknown | null)[], cfg = CFG, claude: string | null = '/usr/bin/claude') {
  const calls: HeadlessOpts[] = [];
  const states: GhState<GhIssue>[] = [];
  const linear = new LinearIssues(cfg, claude, {}, (s) => states.push(s), async (o) => {
    calls.push(o);
    return answers.length ? answers.shift()! : null;
  });
  return { linear, calls, states };
}

const listed = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'found-2',
  title: 'Dog barks',
  url: 'https://linear.app/cc/issue/FOUND-2',
  body: 'It barks.',
  priority: 2,
  statusType: 'started',
  status: 'In Progress',
  labels: [{ name: 'Bug', color: '#ff0000' }, { name: 'odd', color: 'red' }],
  assignee: 'Greg',
  createdBy: 'Ada',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-20T00:00:00Z',
  branch: 'greg/found-2-dog-barks',
  ...over,
});

test('a refresh asks for every team in one call, allowed only list_issues, and fills the board urgent first', async () => {
  const { linear, calls, states } = board([
    {
      issues: [
        listed(),
        listed({ id: 'PLAT-9', title: 'Low', priority: 4, statusType: 'backlog', updatedAt: '2026-09-25T00:00:00Z', labels: undefined, assignee: undefined, branch: undefined }),
        listed({ id: 'PLAT-1', title: 'Urgent', priority: 1, statusType: 'unstarted', updatedAt: '2026-09-02T00:00:00Z' }),
        listed({ id: 'PLAT-3', title: 'None', priority: 0, statusType: 'triage', updatedAt: '2026-09-26T00:00:00Z' }),
        listed({ id: 'PLAT-4', title: 'Done', statusType: 'completed' }),
        listed({ id: 'nope', title: 'Not an id' }),
      ],
    },
  ]);
  await linear.refreshIssues();
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.deepEqual(call.allowedTools, ['mcp__claude_ai_Linear__list_issues']);
  assert.match(call.prompt, /teams FOUND, PLAT/);
  assert.match(call.prompt, /call list_issues once with team set to that team/);
  assert.doesNotMatch(call.prompt, /keep only the issues that fit/);
  assert.equal(call.isolated, undefined);
  assert.ok(call.disallowedTools?.includes('Bash'));
  assert.ok(call.system?.includes('never call a tool you were not given'));

  assert.deepEqual(states.map((s) => s.loading), [true, false]);
  const st = states[1];
  assert.equal(st.error, undefined);
  assert.deepEqual(st.items.map((i) => i.id), ['PLAT-1', 'FOUND-2', 'PLAT-4', 'PLAT-9', 'PLAT-3']);
  const found = st.items.find((i) => i.id === 'FOUND-2')!;
  assert.equal(found.state, 'OPEN');
  assert.equal(found.status, 'started');
  assert.equal(found.priority, 2);
  assert.equal(found.branch, 'greg/found-2-dog-barks');
  assert.deepEqual(found.assignees, ['Greg']);
  assert.equal(found.author, 'Ada');
  assert.deepEqual(found.labels, [{ name: 'Bug', color: '#ff0000' }, { name: 'odd', color: '#888888' }]);
  assert.equal(st.items.find((i) => i.id === 'PLAT-4')!.state, 'CLOSED');
  assert.equal(linear.issues, st);
});

test('the filter goes into the refresh prompt, and the MCP server name into every tool name', async () => {
  const { linear, calls } = board([{ issues: [] }], { ...CFG, mcp: 'linear', filter: 'assigned to me or unassigned' });
  await linear.refreshIssues();
  assert.match(calls[0].prompt, /keep only the issues that fit this: assigned to me or unassigned/);
  assert.deepEqual(calls[0].allowedTools, ['mcp__linear__list_issues']);
});

test('when Claude gives nothing back the board shows how to fix it, and after three misses it stops asking for a while', async () => {
  const { linear, calls, states } = board([null, null, null, { issues: [listed()] }]);
  await linear.refreshIssues();
  assert.equal(states.at(-1)!.error, LINEAR_DOWN);
  assert.equal(states.at(-1)!.items.length, 0);
  await linear.refreshIssues();
  await linear.refreshIssues();
  assert.equal(calls.length, 3);
  assert.ok(linear.pausedFor > 9 * 60_000);
  // Paused: nothing is asked, and the board keeps what it had.
  await linear.refreshIssues();
  assert.equal(calls.length, 3);
  assert.equal(await linear.claim('FOUND-2'), LINEAR_DOWN);
  assert.equal(calls.length, 3);
});

test('an office with no claude binary says so instead of trying', async () => {
  const { linear, calls, states } = board([], CFG, null);
  await linear.refreshIssues();
  assert.equal(calls.length, 0);
  assert.equal(states.at(-1)!.error, NO_CLAUDE);
  await assert.rejects(linear.issueDetail('FOUND-2'), { message: NO_CLAUDE });
});

test('a tool failure the model reports comes through as the error', async () => {
  const { linear, states } = board([{ issues: [], error: 'Team FOUND not found' }]);
  await linear.refreshIssues();
  assert.equal(states.at(-1)!.error, 'Linear: Team FOUND not found');
});

test('the detail view reads the issue and its comments, and learns who the connector is once', async () => {
  const { linear, calls } = board([
    { id: 'FOUND-2', statusType: 'started', body: 'Full description', comments: [{ id: 'c1', author: 'Ada', body: 'Hi', createdAt: '2026-09-02T00:00:00Z', url: 'u' }], viewer: 'Greg' },
    { id: 'FOUND-2', statusType: 'completed', body: 'x', comments: [] },
  ]);
  const d = await linear.issueDetail('FOUND-2');
  assert.deepEqual(d, { id: 'FOUND-2', state: 'OPEN', body: 'Full description', comments: [{ id: 'c1', author: 'Ada', body: 'Hi', createdAt: '2026-09-02T00:00:00Z', url: 'u' }], viewer: 'Greg' });
  assert.deepEqual(calls[0].allowedTools, ['mcp__claude_ai_Linear__get_issue', 'mcp__claude_ai_Linear__list_comments', 'mcp__claude_ai_Linear__get_user']);
  assert.match(calls[0].prompt, /get_issue with id "FOUND-2"/);
  assert.match(calls[0].prompt, /get_user/);
  const again = await linear.issueDetail('FOUND-2');
  assert.equal(again.state, 'CLOSED');
  assert.equal(again.viewer, 'Greg');
  assert.doesNotMatch(calls[1].prompt, /get_user/);
});

test('a comment goes out as written and comes back saved', async () => {
  const { linear, calls } = board([{ comment: { id: 'c9', author: 'Greg', body: 'Looks done', createdAt: '2026-09-27T00:00:00Z', url: 'u' } }, { error: 'No such issue' }]);
  const r = await linear.comment('issue', 'FOUND-2', 'Looks done');
  assert.deepEqual(r, { comment: { id: 'c9', author: 'Greg', body: 'Looks done', createdAt: '2026-09-27T00:00:00Z', url: 'u' } });
  assert.deepEqual(calls[0].allowedTools, ['mcp__claude_ai_Linear__save_comment']);
  assert.match(calls[0].prompt, /<<<BODY\nLooks done\nBODY>>>/);
  assert.deepEqual(await linear.comment('issue', 'FOUND-9', 'x'), { error: 'Linear: No such issue' });
});

test('closing maps the reason to a state type, shows at once, and asks again', async () => {
  const { linear, calls, states } = board([{ issues: [listed()] }, { ok: true }, { issues: [listed({ statusType: 'canceled' })] }, { ok: false, error: 'Locked' }]);
  await linear.refreshIssues();
  assert.equal(await linear.close('issue', 'FOUND-2', { reason: 'not planned', comment: 'Superseded' }), undefined);
  assert.deepEqual(calls[1].allowedTools, ['mcp__claude_ai_Linear__save_issue', 'mcp__claude_ai_Linear__save_comment']);
  assert.match(calls[1].prompt, /as canceled/);
  assert.match(calls[1].prompt, /save_comment .*<<<BODY\nSuperseded\nBODY>>>/s);
  assert.match(calls[1].prompt, /state "canceled"/);
  // Closed on the board before Linear was asked again.
  assert.equal(states.find((s) => !s.loading && s.items[0]?.state === 'CLOSED' && s.fetchedAt === states[1].fetchedAt)?.items[0].status, 'canceled');
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 3);
  assert.equal(await linear.close('issue', 'FOUND-2', { reason: 'completed' }), 'Linear: Locked');
  assert.match(calls[3].prompt, /as completed/);
  assert.doesNotMatch(calls[3].prompt, /save_comment/);
});

test('claiming assigns to me; labels are listed once a minute and changed with save_issue', async () => {
  // A claim is followed by a refresh of the board, which takes the second answer.
  const { linear, calls } = board([{ ok: true }, { issues: [] }, { labels: [{ name: 'Bug', color: '#ff0000', description: 'Broken' }, { name: 'Odd' }] }, { labels: [{ name: 'Bug', color: '#ff0000' }] }]);
  assert.equal(await linear.claim('FOUND-2'), undefined);
  assert.match(calls[0].prompt, /assignee "me"/);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 2);
  const labels = await linear.repoLabels();
  assert.deepEqual(labels, [{ name: 'Bug', color: '#ff0000', description: 'Broken' }, { name: 'Odd', color: '#888888' }]);
  assert.equal(await linear.repoLabels(), labels);
  assert.deepEqual(calls[2].allowedTools, ['mcp__claude_ai_Linear__list_issue_labels']);
  const set = await linear.setLabels('issue', 'FOUND-2', ['Bug'], ['odd']);
  assert.deepEqual(set, { labels: [{ name: 'Bug', color: '#ff0000' }] });
  assert.match(calls[3].prompt, /addLabels \["Bug"\], removeLabels \["odd"\]/);
});
