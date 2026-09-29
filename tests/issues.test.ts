import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ISSUE_ID_RE, hashIssue, isGithubIssueId, issueLabel, parseIssueId } from '../src/shared/issues.js';

test('a GitHub number is written with a #, another tracker’s id as it is', () => {
  assert.equal(issueLabel('12'), '#12');
  assert.equal(issueLabel('FOUND-2'), 'FOUND-2');
  assert.equal(isGithubIssueId('12'), true);
  assert.equal(isGithubIssueId('FOUND-2'), false);
});

test('parseIssueId takes numbers, "#12" and team ids, and turns everything else away', () => {
  assert.equal(parseIssueId(12), '12');
  assert.equal(parseIssueId('12'), '12');
  assert.equal(parseIssueId(' #12 '), '12');
  assert.equal(parseIssueId('007'), '7');
  assert.equal(parseIssueId('FOUND-2'), 'FOUND-2');
  assert.equal(parseIssueId('found-2'), 'FOUND-2');
  assert.equal(parseIssueId('P1-931'), 'P1-931');
  for (const bad of [0, -1, 1.5, '0', '', 'twelve', '12a', '-2', 'FOUND-', 'FOUND-2-3', 'a b-1', null, undefined, {}]) {
    assert.equal(parseIssueId(bad), undefined, `accepted ${JSON.stringify(bad)}`);
  }
  assert.ok(ISSUE_ID_RE.test('12') && ISSUE_ID_RE.test('FOUND-2') && !ISSUE_ID_RE.test('#12'));
});

test('hashIssue is the number itself for GitHub and a stable non-negative integer otherwise', () => {
  assert.equal(hashIssue('42'), 42);
  assert.equal(hashIssue('FOUND-2'), hashIssue('FOUND-2'));
  assert.notEqual(hashIssue('FOUND-2'), hashIssue('FOUND-3'));
  assert.ok(Number.isInteger(hashIssue('PLAT-931')) && hashIssue('PLAT-931') >= 0);
});
