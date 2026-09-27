import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GhIssue, GhIssuesState } from '../src/shared/protocol.js';
import { issueIdentityKey, issueRepositoryLabel, projectRepository, taskForIssueMatches, visibleIssues, workerForPull } from '../src/client/state.js';

const issue = (repository: string, number: number): GhIssue => ({
  repository,
  number,
  title: `Issue ${number}`,
  state: 'OPEN',
  url: `https://github.com/${repository}/issues/${number}`,
  author: 'octocat', labels: [], assignees: [],
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  body: '', comments: 0,
});

test('issue identity includes the repository', () => {
  assert.notEqual(issueIdentityKey(issue('acme/one', 1)), issueIdentityKey(issue('acme/two', 1)));
  assert.equal(issueIdentityKey(issue('acme/one', 1)), 'acme/one#1');
});

test('issue repository labels and filters keep same-number issues distinct', () => {
  const items = [issue('acme/one', 1), issue('acme/two', 1)];
  assert.equal(issueRepositoryLabel(items[0]), 'acme/one');
  assert.deepEqual(visibleIssues(items, 'acme/two'), [items[1]]);
  assert.deepEqual(visibleIssues(items, 'all'), items);
});

test('external issue task matching does not reuse a current-repository task', () => {
  assert.equal(taskForIssueMatches({ issue: 1, issueRepository: 'acme/two' }, 1, 'acme/one', 'acme/one'), false);
  assert.equal(taskForIssueMatches({ issue: 1, issueRepository: 'acme/two' }, 1, 'acme/two', 'acme/one'), true);
  assert.equal(taskForIssueMatches({ issue: 1, issueRepository: 'ACME/ONE' }, 1, 'acme/one', 'acme/one'), true);
  assert.equal(taskForIssueMatches({ issue: 1 }, 1, 'acme/one', 'acme/one'), true);
  assert.equal(taskForIssueMatches({ issue: 1 }, 1, 'acme/two', 'acme/one'), false);
  assert.equal(taskForIssueMatches({ issue: 1 }, 1, undefined, 'acme/one'), true);
});

test('project repository is derived from its remote without exposing a path', () => {
  assert.equal(projectRepository({
    name: 'one', dir: '/tmp/one', remote: 'git@github.com:acme/one.git',
    agentCmd: 'claude', defaultProvider: 'claude', agentProviders: ['claude'],
  }), 'acme/one');
});

test('PR desk links stay scoped to the pull request repository', () => {
  const foreign = { id: 'foreign', project: { repository: 'acme/other', dir: '/tmp/other' }, pr: { number: 7, url: 'https://github.com/acme/other/pull/7' }, worktree: { path: '.agent-office/worktrees/a', branch: 'office/a', base: 'main' } } as any;
  const current = { id: 'current', pr: { number: 7, url: 'https://github.com/acme/main/pull/7' }, worktree: { path: '.agent-office/worktrees/b', branch: 'office/b', base: 'main' } } as any;
  assert.equal(workerForPull([foreign, current], { number: 7, headRefName: 'office/b', url: 'https://github.com/acme/main/pull/7' }, 'acme/main')?.id, 'current');
  assert.equal(workerForPull([foreign], { number: 7, headRefName: 'office/a', url: 'https://github.com/acme/main/pull/7' }, 'acme/main'), undefined);
});
