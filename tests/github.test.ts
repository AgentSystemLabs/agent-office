import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GitHub, type GhRunner } from '../src/server/github.js';
import { MAX_ISSUE_REPOSITORIES } from '../src/shared/issue-repositories.js';

type Fixture = {
  current?: string;
  issues?: Record<string, { open?: any[]; closed?: any[] }>;
  failRepositories?: Set<string>;
  calls: string[][];
  runner: GhRunner;
};

function issue(number: number, repository: string, state = 'OPEN') {
  return {
    number,
    title: `${repository} issue ${number}`,
    state,
    url: `https://github.com/${repository}/issues/${number}`,
    author: { login: 'tester' },
    labels: [],
    assignees: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    body: 'body',
    comments: [],
  };
}

function fixture(options: Omit<Fixture, 'calls' | 'runner'> = {}): Fixture {
  const out = { current: 'acme/main', issues: {}, failRepositories: new Set<string>(), calls: [] as string[][] } as Fixture;
  Object.assign(out, options);
  out.runner = async (args) => {
    out.calls.push(args);
    if (args[0] === 'repo' && args[1] === 'view') {
      if (!out.current) throw new Error('not a git repository');
      return JSON.stringify({ nameWithOwner: out.current, squashMergeAllowed: true, mergeCommitAllowed: true, rebaseMergeAllowed: true });
    }
    if (args[0] === 'pr' && args[1] === 'list') return '[]';
    if (args[0] === 'issue' && args[1] === 'view') return JSON.stringify({ number: Number(args[2]), body: 'detail', comments: [] });
    if (args[0] === 'issue' && args[1] === 'list') {
      const repository = args[args.indexOf('--repo') + 1];
      if (out.failRepositories?.has(repository.toLowerCase())) throw new Error(`failed ${repository}`);
      const values = out.issues?.[repository.toLowerCase()] ?? {};
      return JSON.stringify(args[args.indexOf('--state') + 1] === 'open' ? values.open ?? [] : values.closed ?? []);
    }
    return '[]';
  };
  return out;
}

async function waitForIdle(github: GitHub) {
  for (let i = 0; i < 100 && github.issues.loading; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(github.issues.loading, false);
}

function tempData() {
  return mkdtempSync(path.join(tmpdir(), 'agent-office-github-'));
}

test('keeps identical issue numbers distinct across repositories and routes detail explicitly', async () => {
  const data = tempData();
  try {
    writeFileSync(path.join(data, 'issue-repositories.json'), '["other/project"]');
    const f = fixture({ issues: {
      'acme/main': { open: [issue(7, 'acme/main')] },
      'other/project': { open: [issue(7, 'other/project')] },
    } });
    const github = new GitHub('/tmp/project', () => {}, () => {}, data, f.runner);
    await (github as any).refreshIssues();
    assert.deepEqual(github.issues.items.map((i) => [i.repository, i.number]), [['acme/main', 7], ['other/project', 7]]);
    await github.issueDetail(7, 'OTHER/PROJECT');
    const detail = f.calls.find((args) => args[0] === 'issue' && args[1] === 'view');
    assert.deepEqual(detail?.slice(0, 5), ['issue', 'view', '7', '--repo', 'other/project']);
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});

test('keeps good repositories and last known issues when one repository fails', async () => {
  const data = tempData();
  try {
    writeFileSync(path.join(data, 'issue-repositories.json'), '["other/project"]');
    const f = fixture({ issues: {
      'acme/main': { open: [issue(1, 'acme/main')] },
      'other/project': { open: [issue(2, 'other/project')] },
    } });
    const github = new GitHub('/tmp/project', () => {}, () => {}, data, f.runner);
    await (github as any).refreshIssues();
    f.failRepositories?.add('other/project');
    await (github as any).refreshIssues();
    assert.deepEqual(github.issues.items.map((i) => i.number), [1, 2]);
    assert.match(github.issues.repositories?.find((r) => r.name === 'other/project')?.error ?? '', /failed/);
    assert.equal(github.issues.repositories?.find((r) => r.name === 'acme/main')?.error, undefined);
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});

test('persists, deduplicates, bounds, and protects the current repository configuration', async () => {
  const data = tempData();
  try {
    writeFileSync(path.join(data, 'issue-repositories.json'), '["Acme/main", "other/project", "OTHER/PROJECT"]');
    const f = fixture();
    const github = new GitHub('/tmp/project', () => {}, () => {}, data, f.runner);
    await (github as any).refreshIssues();
    assert.equal(github.issues.repositories?.filter((r) => r.name.toLowerCase() === 'other/project').length, 1);
    assert.match(github.removeIssueRepository('ACME/MAIN') ?? '', /current repository/i);
    assert.match(github.addIssueRepository('OTHER/PROJECT') ?? '', /already configured/i);
    assert.equal(github.addIssueRepository('new/repo'), undefined);
    await waitForIdle(github);
    const persisted = JSON.parse(readFileSync(path.join(data, 'issue-repositories.json'), 'utf8')) as string[];
    assert.deepEqual(persisted, ['other/project', 'new/repo']);
    const reloaded = new GitHub('/tmp/project', () => {}, () => {}, data, f.runner);
    await (reloaded as any).refreshIssues();
    assert.deepEqual(reloaded.issues.repositories?.map((r) => r.name), ['acme/main', 'other/project', 'new/repo']);
    assert.equal(github.removeIssueRepository('NEW/REPO'), undefined);
    await waitForIdle(github);
    assert.equal(JSON.parse(readFileSync(path.join(data, 'issue-repositories.json'), 'utf8')).includes('new/repo'), false);
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});

test('rejects invalid repositories without invoking gh and enforces the ten-repository bound', async () => {
  const data = tempData();
  try {
    const f = fixture();
    const github = new GitHub('/tmp/project', () => {}, () => {}, data, f.runner);
    assert.match(github.addIssueRepository('https://github.com/other/project') ?? '', /owner\/repo/);
    assert.match(github.removeIssueRepository('../project') ?? '', /owner\/repo/);
    assert.equal(f.calls.length, 0);

    await (github as any).refreshIssues();
    for (let i = 0; i < MAX_ISSUE_REPOSITORIES; i++) assert.equal(github.addIssueRepository(`other/repo-${i}`), undefined);
    assert.match(github.addIssueRepository('other/overflow') ?? '', /At most 10/);
    await waitForIdle(github);
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});

test('does not change in-memory or persisted configuration when saving fails', async () => {
  const data = tempData();
  try {
    const file = path.join(data, 'issue-repositories.json');
    writeFileSync(file, '["other/project"]');
    // The atomic writer cannot replace this directory with its temporary file.
    const temporary = `${file}.tmp`;
    mkdirSync(temporary);
    const f = fixture();
    const github = new GitHub('/tmp/project', () => {}, () => {}, data, f.runner);
    await (github as any).refreshIssues();
    const before = JSON.parse(readFileSync(file, 'utf8'));
    assert.match(github.addIssueRepository('new/repo') ?? '', /Could not save/);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), before);
    assert.equal((github as any).issueRepositories.includes('new/repo'), false);
    assert.equal(github.issues.repositories?.some((r) => r.name === 'new/repo'), false);
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});

test('does not apply an in-flight response from a removed repository', async () => {
  const data = tempData();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  try {
    writeFileSync(path.join(data, 'issue-repositories.json'), '["old/repo"]');
    const f = fixture({ issues: { 'old/repo': { open: [issue(9, 'old/repo')] }, 'new/repo': { open: [issue(10, 'new/repo')] } } });
    const base = f.runner;
    f.runner = async (args, cwd, timeout) => {
      if (args.includes('--repo') && args[args.indexOf('--repo') + 1] === 'old/repo') await blocked;
      return base(args, cwd, timeout);
    };
    const github = new GitHub('/tmp/project', () => {}, () => {}, data, f.runner);
    const pending = (github as any).refreshIssues();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(github.removeIssueRepository('old/repo'), undefined);
    assert.equal(github.addIssueRepository('new/repo'), undefined);
    release();
    await pending;
    await waitForIdle(github);
    assert.deepEqual(github.issues.items.map((i) => i.repository), ['new/repo']);
    assert.equal(github.issues.repositories?.some((r) => r.name === 'old/repo'), false);
  } finally {
    release?.();
    rmSync(data, { recursive: true, force: true });
  }
});

test('refreshes configured extras when the checkout has no GitHub repository', async () => {
  const data = tempData();
  try {
    writeFileSync(path.join(data, 'issue-repositories.json'), '["other/project"]');
    const f = fixture({ current: undefined, issues: { 'other/project': { open: [issue(3, 'other/project')] } } });
    const github = new GitHub('/tmp/project', () => {}, () => {}, data, f.runner);
    await (github as any).refreshIssues();
    assert.equal(github.issues.currentRepository, undefined);
    assert.deepEqual(github.issues.items.map((i) => i.repository), ['other/project']);
    assert.equal(github.issues.repositories?.[0].current, false);
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});

test('reports corrupt configuration without overwriting it', () => {
  const data = tempData();
  try {
    const file = path.join(data, 'issue-repositories.json');
    writeFileSync(file, '{not-json');
    const github = new GitHub('/tmp/project', () => {}, () => {}, data, fixture().runner);
    assert.match(github.issues.configurationError ?? '', /Could not load/);
    assert.match(readFileSync(file, 'utf8'), /not-json/);
    assert.match(github.addIssueRepository('other/project') ?? '', /Could not load/);
    assert.match(readFileSync(file, 'utf8'), /not-json/);
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});

test('routes issue claims through the explicitly tracked repository', async () => {
  const data = tempData();
  try {
    writeFileSync(path.join(data, 'issue-repositories.json'), '["other/project"]');
    const f = fixture();
    const github = new GitHub('/tmp/project', () => {}, () => {}, data, f.runner);
    assert.equal(await github.trackedRepository('OTHER/PROJECT'), 'other/project');
    assert.equal(await github.claim(7, 'other/project'), undefined);
    const claim = f.calls.find((args) => args[0] === 'issue' && args[1] === 'edit');
    assert.deepEqual(claim?.slice(0, 7), ['issue', 'edit', '7', '--add-assignee', '@me', '--repo', 'other/project']);
    assert.match((await github.claim(8, 'unknown/project')) ?? '', /not configured/i);
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});
