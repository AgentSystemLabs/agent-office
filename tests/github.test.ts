import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { originRepo, repoArgs, workRepo } from '../src/server/forge.js';

// A floor works on the repository its origin points at, so a fork's boards and pull requests are its
// own. The gong, which both forges share, is tested in tests/bitbucket.test.ts.

test('a forked checkout is worked on as the fork, not the repository it was forked from', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'office-github-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '-b', 'main', 'fork');
  const fork = path.join(root, 'fork');
  const checkout = (...args: string[]) => execFileSync('git', args, { cwd: fork, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  checkout('remote', 'add', 'origin', 'git@github.com:sagardhande2942/agent-office-sd.git');
  // What forking looks like: origin is yours, upstream is where it came from. gh, asked about this
  // checkout, would answer for upstream, which is what the boards used to fill themselves with.
  checkout('remote', 'add', 'upstream', 'https://github.com/AgentSystemLabs/agent-office.git');
  delete process.env.GH_REPO;
  assert.equal(workRepo(fork), 'sagardhande2942/agent-office-sd', 'the boards and pull requests are on the repository origin points at');
  // A checkout with no origin on GitHub is left to gh, to answer or to say why it can't.
  assert.equal(workRepo(root), undefined);
  checkout('remote', 'set-url', 'origin', 'https://gitlab.com/o/r.git');
  assert.equal(originRepo(fork), undefined, 'a remote off GitHub names no repository');
  // Started with GH_REPO, the office works on the repository that names.
  process.env.GH_REPO = 'github.com/AgentSystemLabs/agent-office';
  try {
    assert.equal(workRepo(fork), 'AgentSystemLabs/agent-office');
  } finally {
    delete process.env.GH_REPO;
  }
});

test('every gh call is told which repository it is about', () => {
  const list = ['pr', 'list', '--state', 'open'];
  assert.deepEqual(repoArgs(list, 'o/r'), ['pr', 'list', '--state', 'open', '--repo', 'o/r']);
  assert.deepEqual(repoArgs(list, undefined), list, 'with no repository, gh is left to answer as it would');
  // gh api has no --repo: the name goes in the path, and the flags around it are left alone.
  assert.deepEqual(repoArgs(['api', '--method', 'POST', 'repos/{owner}/{repo}/issues/5/comments', '-f', 'body=hi', '--jq', '.id'], 'o/r'), [
    'api',
    '--method',
    'POST',
    'repos/o/r/issues/5/comments',
    '-f',
    'body=hi',
    '--jq',
    '.id',
  ]);
  assert.deepEqual(repoArgs(['api', 'user', '--jq', '.login'], 'o/r'), ['api', 'user', '--jq', '.login'], 'about who we are, not about a repository');
  // gh repo view takes the repository as an argument, and this checkout's already named when asked.
  assert.deepEqual(repoArgs(['repo', 'view', '--json', 'nameWithOwner'], 'o/r'), ['repo', 'view', 'o/r', '--json', 'nameWithOwner']);
  assert.deepEqual(repoArgs(['repo', 'view', 'o/other', '--json', 'nameWithOwner'], 'o/r'), ['repo', 'view', 'o/other', '--json', 'nameWithOwner']);
});
