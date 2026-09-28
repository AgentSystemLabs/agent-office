import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CHECK_JQL, FloorJira, JiraApi, type JiraError, JiraOffice, acceptLanguage, cloudIdOf, jiraSite, redact, ticketOf } from '../src/server/jira.js';
import { adfToMarkdown, childrenJql, jiraKey, ticketColumns, ticketPrompt, type JiraBoardState, type JiraTicket } from '../src/shared/jira.js';

const TOKEN = 'ATATT3xFfGF0-secret-token-value';
const SITE = 'https://example.atlassian.net';
const CLOUD = '95cc224c-ecc1-48d5-a927-a7ca5c35d479';
const GATEWAY = `https://api.atlassian.com/ex/jira/${CLOUD}`;

interface Call {
  method: string;
  url: string;
  auth: string;
  lang: string;
  body?: any;
}

type Answer = unknown | { status: number; body?: unknown; headers?: Record<string, string> };

/**
 * A fake Jira Cloud: the site's public tenant_info, and the REST API behind Atlassian's gateway,
 * routed by "METHOD /path" (a trailing * matches a prefix).
 */
function fakeJira(routes: Record<string, (call: Call) => Answer>) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init?.method ?? 'GET',
      url: url.href,
      auth: String((init?.headers as Record<string, string>)?.authorization ?? ''),
      lang: String((init?.headers as Record<string, string>)?.['accept-language'] ?? ''),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    if (url.origin === SITE && url.pathname === '/_edge/tenant_info') return new Response(JSON.stringify({ cloudId: CLOUD }), { status: 200 });
    if (!url.href.startsWith(GATEWAY)) return new Response('not jira', { status: 404 });
    const p = url.href.slice(GATEWAY.length).split('?')[0];
    const route = Object.entries(routes).find(([k]) => {
      const [m, r] = k.split(' ');
      return m === call.method && (r.endsWith('*') ? p.startsWith(r.slice(0, -1)) : p === r);
    });
    if (!route) return new Response(JSON.stringify({ errorMessages: [`no route for ${call.method} ${p}`] }), { status: 404 });
    const out = route[1](call) as any;
    if (out && typeof out === 'object' && typeof out.status === 'number' && 'body' in out) return new Response(out.body === undefined ? '' : JSON.stringify(out.body), { status: out.status, headers: out.headers });
    return new Response(out === undefined ? '' : JSON.stringify(out), { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
}

const tmp = () => mkdtempSync(path.join(tmpdir(), 'ao-jira-'));

/** What a read-only (read:jira-work) token can do: search, but not ask who it is. */
const READ_ONLY = {
  'POST /rest/api/3/search/jql': () => ({ issues: [], isLast: true }),
  'GET /rest/api/3/myself': () => ({ status: 401, body: { code: 401, message: 'Unauthorized; scope does not match' } }),
};

function ticket(key: string, category: JiraTicket['category'], status = 'x'): JiraTicket {
  return { key, summary: key, type: 'Story', priority: 'Medium', status, category, url: `${SITE}/browse/${key}`, updated: '' };
}

// ---- Keys, sites and redaction -----------------------------------------------------------------

test('reads issue keys', () => {
  assert.equal(jiraKey(' edp-168 '), 'EDP-168');
  assert.equal(jiraKey('EDP-0'), undefined);
  assert.equal(jiraKey('168'), undefined);
  assert.equal(jiraKey('EDP-12; rm -rf'), undefined);
  assert.equal(jiraKey(12), undefined);
});

test('asks Jira for a real language, never any language', () => {
  assert.equal(acceptLanguage('en-US'), 'en-US, en;q=0.9');
  assert.equal(acceptLanguage('en-GB'), 'en-US, en;q=0.9');
  assert.equal(acceptLanguage('de-DE'), 'de-DE, de;q=0.9, en;q=0.5');
  assert.equal(acceptLanguage('fr'), 'fr, en;q=0.5');
  for (const odd of [undefined, '', 'und', '*', 'C', 'en_US.UTF-8']) assert.equal(acceptLanguage(odd), 'en-US, en;q=0.9');
});

test('every Jira request names its language', async () => {
  const jira = fakeJira({ 'GET /rest/api/3/issue/*': () => ({ key: 'EDP-1', fields: {} }) });
  await new JiraApi({ site: SITE, cloudId: CLOUD, email: 'a@b.co', token: TOKEN }, jira.impl).issue('EDP-1', ['summary']);
  assert.equal(jira.calls.length, 1);
  assert.ok(jira.calls[0].lang && !jira.calls[0].lang.includes('*'));
});

test('only takes Jira Cloud sites', () => {
  assert.equal(jiraSite('https://Example.atlassian.net/jira/software'), SITE);
  assert.equal(jiraSite('example.atlassian.net'), SITE);
  assert.equal(jiraSite('example'), SITE);
  assert.equal(jiraSite('https://jira.example.com'), undefined);
  assert.equal(jiraSite('https://atlassian.net.evil.com'), undefined);
  assert.equal(jiraSite(''), undefined);
});

test('redacts the token wherever it shows up', () => {
  assert.equal(redact(`bad token ${TOKEN} here ${TOKEN}`, [TOKEN]), 'bad token [redacted] here [redacted]');
  assert.equal(redact('nothing secret', [TOKEN, '']), 'nothing secret');
});

test("finds a site's cloud id, and says so when it isn't Jira Cloud", async () => {
  assert.equal(await cloudIdOf(SITE, fakeJira({}).impl), CLOUD);
  await assert.rejects(cloudIdOf('https://nope.atlassian.net', fakeJira({}).impl), /doesn't look like a Jira Cloud site/);
  const down = (async () => {
    throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } });
  }) as typeof fetch;
  await assert.rejects(cloudIdOf(SITE, down), /Couldn't reach https:\/\/example\.atlassian\.net \(ENOTFOUND\)/);
});

// ---- The connection ----------------------------------------------------------------------------

test('a read-only token connects: it reads through the gateway, and is stored 0600 and never shown', async () => {
  const dir = tmp();
  const jira = fakeJira(READ_ONLY);
  const office = new JiraOffice(dir, jira.impl);
  assert.equal(await office.connect('example', 'bot@example.com', TOKEN, 'Ada'), undefined);
  const search = jira.calls.find((c) => c.url.endsWith('/rest/api/3/search/jql'));
  assert.equal(search?.url, `${GATEWAY}/rest/api/3/search/jql`);
  assert.equal(search?.auth, `Basic ${Buffer.from(`bot@example.com:${TOKEN}`).toString('base64')}`);
  // It can't say who it is, so the office goes by the email.
  const conn = office.connection();
  assert.deepEqual({ ...conn, at: 0 }, { site: SITE, email: 'bot@example.com', name: 'bot@example.com', by: 'Ada', at: 0 });
  assert.ok(!JSON.stringify(conn).includes(TOKEN));
  const file = path.join(dir, 'jira.json');
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(saved.token, TOKEN);
  assert.equal(saved.cloudId, CLOUD);
  // Back after a restart, and gone when disconnected.
  const again = new JiraOffice(dir, jira.impl);
  assert.equal(again.connection()?.email, 'bot@example.com');
  assert.ok(again.client());
  again.disconnect();
  assert.equal(again.connection(), undefined);
  assert.equal(new JiraOffice(dir, jira.impl).connection(), undefined);
});

test("a token that can say who it is shows the account's name", async () => {
  const office = new JiraOffice(tmp(), fakeJira({ ...READ_ONLY, 'GET /rest/api/3/myself': () => ({ accountId: 'a', displayName: 'Office Bot' }) }).impl);
  assert.equal(await office.connect('example', 'bot@example.com', TOKEN, 'Ada'), undefined);
  assert.equal(office.connection()?.name, 'Office Bot');
});

test('a bad connection says what is wrong, and never repeats the token', async () => {
  const cases: [Parameters<JiraOffice['connect']>, Parameters<typeof fakeJira>[0], RegExp][] = [
    [['https://jira.example.com', 'a@b.co', TOKEN, 'x'], {}, /Jira Cloud address/],
    [['example', 'not-an-email', TOKEN, 'x'], {}, /email/],
    [['example', 'a@b.co', 'short', 'x'], {}, /API token/],
    [['example', 'a@b.co', TOKEN, 'x'], { 'POST /rest/api/3/search/jql': () => ({ status: 401, body: { code: 401, message: 'Unauthorized' } }) }, /didn't accept the email and API token \(401\)\. Check both/],
    [['example', 'a@b.co', TOKEN, 'x'], { 'POST /rest/api/3/search/jql': () => ({ status: 403, body: { errorMessages: [`no access for ${TOKEN}`] } }) }, /no access/],
  ];
  for (const [args, routes, message] of cases) {
    const office = new JiraOffice(tmp(), fakeJira(routes).impl);
    const err = await office.connect(...args);
    assert.match(err ?? '', message, String(args[0]));
    assert.ok(!err?.includes(TOKEN), 'the token is redacted');
    assert.equal(office.connection(), undefined);
  }
});

test('a broken or incomplete jira.json means no connection', () => {
  const dir = tmp();
  writeFileSync(path.join(dir, 'jira.json'), '{not json');
  assert.equal(new JiraOffice(dir).connection(), undefined);
  writeFileSync(path.join(dir, 'jira.json'), JSON.stringify({ site: SITE, email: 'a@b.co', token: TOKEN }));
  assert.equal(new JiraOffice(dir).connection(), undefined, 'no cloud id');
});

test('a 429 carries its Retry-After', async () => {
  const api = new JiraApi({ site: SITE, cloudId: CLOUD, email: 'a@b.co', token: TOKEN }, fakeJira({ 'GET /rest/api/3/issue/*': () => ({ status: 429, body: {}, headers: { 'retry-after': '30' } }) }).impl);
  await assert.rejects(api.issue('EDP-1', ['summary']), (e: JiraError) => e.status === 429 && e.retryAfter === 30);
});

// ---- The epic and its tickets --------------------------------------------------------------------

async function connected(routes: Parameters<typeof fakeJira>[0]) {
  const jira = fakeJira({ ...READ_ONLY, ...routes });
  const office = new JiraOffice(tmp(), jira.impl);
  assert.equal(await office.connect('example', 'bot@example.com', TOKEN, 'Ada'), undefined);
  const boards: (JiraBoardState | null)[] = [];
  const dir = tmp();
  const floor = new FloorJira(dir, office, { state: () => {}, board: (b) => boards.push(b) });
  return { jira, office, floor, boards, dir };
}

const EPIC = { key: 'EDP-168', fields: { summary: 'In-app chat', issuetype: { name: 'Epic', hierarchyLevel: 1 } } };

test('an epic must exist and be an epic', async () => {
  const notFound = await connected({ 'GET /rest/api/3/issue/*': () => ({ status: 404, body: { errorMessages: ['Issue does not exist'] } }) });
  assert.deepEqual(await notFound.floor.setEpic('EDP-999', 'Ada'), { error: "There's no EDP-999 in Jira, or the office's account can't see it" });
  const story = await connected({ 'GET /rest/api/3/issue/*': () => ({ key: 'EDP-12', fields: { issuetype: { name: 'Story', hierarchyLevel: 0 } } }) });
  assert.deepEqual(await story.floor.setEpic('EDP-12', 'Ada'), { error: 'EDP-12 is a Story, not an epic' });
  assert.deepEqual(await story.floor.setEpic('not a key', 'Ada'), { error: 'An epic key looks like EDP-168' });
  const unconnected = new FloorJira(tmp(), new JiraOffice(tmp()), { state: () => {}, board: () => {} });
  assert.deepEqual(await unconnected.setEpic('EDP-168', 'Ada'), { error: 'Connect the office to Jira first' });
});

test('setting the epic shows every one of its tickets, across pages, and is kept for next time', async () => {
  const page = (from: number, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      key: `EDP-${from + i}`,
      fields: { summary: `T${from + i}`, issuetype: { name: 'Story' }, priority: { name: 'Medium' }, status: { name: i % 3 === 0 ? 'Done' : 'To Do', statusCategory: { key: i % 3 === 0 ? 'done' : 'new' } } },
    }));
  const { floor, jira, boards, office, dir } = await connected({
    'GET /rest/api/3/issue/*': () => EPIC,
    'POST /rest/api/3/search/jql': (c) => (c.body.jql === CHECK_JQL ? { issues: [] } : c.body.nextPageToken ? { issues: page(200, 34), isLast: true } : { issues: page(100, 100), nextPageToken: 'p2', isLast: false }),
  });
  const r = await floor.setEpic('edp-168', 'Ada');
  assert.ok('epic' in r);
  assert.deepEqual({ ...r.epic, at: 0 }, { key: 'EDP-168', summary: 'In-app chat', by: 'Ada', at: 0 });
  const searches = jira.calls.filter((c) => c.url.endsWith('/search/jql') && c.body.jql !== CHECK_JQL);
  assert.equal(searches[0].body.jql, 'parent = EDP-168 ORDER BY Rank ASC');
  assert.equal(searches[1].body.nextPageToken, 'p2');
  const board = boards.at(-1)!;
  assert.equal(board.items.length, 134);
  assert.equal(board.error, undefined);
  assert.equal(board.items[0].url, `${SITE}/browse/EDP-100`);
  assert.ok(floor.on);
  // A restart finds the epic again.
  const again = new FloorJira(dir, office, { state: () => {}, board: () => {} });
  assert.equal(again.epic?.key, 'EDP-168');
  again.clearEpic();
  assert.equal(new FloorJira(dir, office, { state: () => {}, board: () => {} }).epic, undefined);
});

test('the board backs off when Jira rate limits it', async () => {
  let limited = false;
  const { floor, boards } = await connected({
    'GET /rest/api/3/issue/*': () => EPIC,
    'POST /rest/api/3/search/jql': () => (limited ? { status: 429, body: {}, headers: { 'retry-after': '120' } } : { issues: [], isLast: true }),
  });
  await floor.setEpic('EDP-168', 'Ada');
  limited = true;
  await floor.refresh(true);
  assert.match(boards.at(-1)?.error ?? '', /rate limiting/);
  const before = boards.length;
  limited = false;
  // A scheduled refresh waits out the back-off...
  await floor.refresh();
  assert.equal(boards.length, before);
  // ...though someone pressing Refresh goes ahead.
  await floor.refresh(true);
  assert.equal(boards.at(-1)?.error, undefined);
});

test("a ticket's window shows its description and comments, only for the epic's tickets", async () => {
  const { floor } = await connected({
    'GET /rest/api/3/issue/EDP-168': () => EPIC,
    'GET /rest/api/3/issue/EDP-12': () => ({
      key: 'EDP-12',
      fields: {
        summary: 'Fix',
        issuetype: { name: 'Story' },
        status: { name: 'In Review', statusCategory: { key: 'indeterminate' } },
        parent: { key: 'EDP-168' },
        description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'It breaks.' }] }] },
        reporter: { displayName: 'Nik' },
        created: '2026-09-01T00:00:00Z',
      },
    }),
    'GET /rest/api/3/issue/EDP-12/comment': () => ({
      comments: [{ id: '1', author: { displayName: 'Ada' }, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'On it' }] }] }, created: '2026-09-02T00:00:00Z' }],
    }),
    'GET /rest/api/3/issue/ETH-1': () => ({ key: 'ETH-1', fields: { parent: { key: 'ETH-9' } } }),
    'POST /rest/api/3/search/jql': () => ({ issues: [], isLast: true }),
  });
  await floor.setEpic('EDP-168', 'Ada');
  const d = await floor.detail('edp-12');
  assert.equal(d.description, 'It breaks.');
  assert.equal(d.category, 'indeterminate');
  assert.equal(d.reporter, 'Nik');
  assert.deepEqual(d.comments, [{ id: '1', author: 'Ada', body: 'On it', created: '2026-09-02T00:00:00Z' }]);
  await assert.rejects(floor.detail('ETH-1'), /ETH-1 isn't one of EDP-168's tickets/);
  await assert.rejects(floor.detail('nope'), /A ticket key looks like/);
});

test('the office only ever reads: every request it makes is a GET or a search', async () => {
  const { floor, jira } = await connected({
    'GET /rest/api/3/issue/EDP-168': () => EPIC,
    'GET /rest/api/3/issue/EDP-12': () => ({ key: 'EDP-12', fields: { parent: { key: 'EDP-168' } } }),
    'GET /rest/api/3/issue/EDP-12/comment': () => ({ comments: [] }),
    'POST /rest/api/3/search/jql': () => ({ issues: [], isLast: true }),
  });
  await floor.setEpic('EDP-168', 'Ada');
  await floor.refresh(true);
  await floor.detail('EDP-12');
  for (const c of jira.calls) assert.ok(c.method === 'GET' || (c.method === 'POST' && c.url.endsWith('/rest/api/3/search/jql')), `${c.method} ${c.url}`);
});

// ---- Columns, ADF and the prompt -----------------------------------------------------------------

test('sorts tickets into To Do, In Progress and Done by status category, in rank order', () => {
  const out = ticketColumns([ticket('A-1', 'new'), ticket('A-2', 'done'), ticket('A-3', 'indeterminate', 'In Review'), ticket('A-4', 'new')]);
  assert.deepEqual(
    out.map((c) => [c.name, c.items.map((t) => t.key)]),
    [
      ['To Do', ['A-1', 'A-4']],
      ['In Progress', ['A-3']],
      ['Done', ['A-2']],
    ],
  );
  assert.equal(childrenJql('EDP-168'), 'parent = EDP-168 ORDER BY Rank ASC');
});

test('a card comes from the search API shape', () => {
  assert.deepEqual(ticketOf(SITE, { key: 'EDP-1', fields: {} }), { key: 'EDP-1', summary: '', type: '', priority: '', assignee: undefined, status: '', category: 'indeterminate', url: `${SITE}/browse/EDP-1`, updated: '' });
});

test('converts Atlassian Document Format to markdown', () => {
  const doc = {
    type: 'doc',
    version: 1,
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'DoD' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'See ' },
          { type: 'text', text: 'the docs', marks: [{ type: 'link', attrs: { href: 'https://x.dev' } }] },
          { type: 'text', text: ' and ' },
          { type: 'text', text: 'run.sh', marks: [{ type: 'code' }] },
          { type: 'hardBreak' },
          { type: 'mention', attrs: { text: '@Nik' } },
          { type: 'text', text: ' is ', marks: [] },
          { type: 'text', text: 'on it', marks: [{ type: 'strong' }] },
        ],
      },
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
              { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'nested' }] }] }] },
            ],
          },
        ],
      },
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const a = 1;' }] },
      { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quoted' }] }] },
      { type: 'rule' },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] },
            ],
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '1|2' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '3' }] }] },
            ],
          },
        ],
      },
      { type: 'mediaSingle', content: [{ type: 'media', attrs: {} }] },
    ],
  };
  assert.equal(
    adfToMarkdown(doc),
    [
      '## DoD',
      'See [the docs](https://x.dev) and `run.sh`  \n@Nik is **on it**',
      '- one\n- two\n  1. nested',
      '```ts\nconst a = 1;\n```',
      '> quoted',
      '---',
      '| A | B |\n| --- | --- |\n| 1\\|2 | 3 |',
      '_(attachment: open the ticket in Jira to see it)_',
    ].join('\n\n'),
  );
  assert.equal(adfToMarkdown(null), '');
  assert.equal(adfToMarkdown('plain'), 'plain');
});

test('a worker handed a ticket gets its key, summary, link and description, and nothing about updating Jira', () => {
  const p = ticketPrompt({ key: 'EDP-12', summary: 'Fix login', description: 'It breaks.', url: `${SITE}/browse/EDP-12` });
  assert.equal(p, `Work on Jira ticket EDP-12: "Fix login".\n\n${SITE}/browse/EDP-12\n\nIt breaks.`);
  assert.equal(ticketPrompt({ key: 'EDP-12', summary: 'x' }), 'Work on Jira ticket EDP-12: "x".\n\n(No description.)');
});
