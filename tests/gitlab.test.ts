import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { forgeOf, forgeWords, gitlabParts, normalizeRepo, repoPath, repoWebUrl } from '../src/shared/floors.js';
import { closesOf, mergeState, splitDiscussions } from '../src/server/gitlab.js';
import { insideCheckout } from '../src/server/building.js';
import { stationBrief } from '../src/server/stations.js';

test('GitHub repositories stay owner/repo, however they are typed', () => {
  assert.equal(normalizeRepo('nikships/droidproxy'), 'nikships/droidproxy');
  assert.equal(normalizeRepo('https://github.com/nikships/droidproxy.git'), 'nikships/droidproxy');
  assert.equal(normalizeRepo('git@github.com:nikships/droidproxy.git'), 'nikships/droidproxy');
  assert.equal(normalizeRepo('https://github.com/nikships/droidproxy/issues/12'), 'nikships/droidproxy');
  assert.equal(forgeOf('nikships/droidproxy'), 'github');
});

test('GitLab projects carry their host and every group they are nested in', () => {
  assert.equal(normalizeRepo('https://gitlab.com/EdmundsGovTech/core/mcsj'), 'gitlab.com/EdmundsGovTech/core/mcsj');
  assert.equal(normalizeRepo('https://gitlab.com/EdmundsGovTech/core/mcsj.git'), 'gitlab.com/EdmundsGovTech/core/mcsj');
  assert.equal(normalizeRepo('git@gitlab.com:EdmundsGovTech/core/mcsj.git'), 'gitlab.com/EdmundsGovTech/core/mcsj');
  assert.equal(normalizeRepo('ssh://git@gitlab.example.org:2222/team/app.git'), 'gitlab.example.org/team/app');
  assert.equal(normalizeRepo('https://gitlab.com/EdmundsGovTech/core/mcsj/-/merge_requests/18675'), 'gitlab.com/EdmundsGovTech/core/mcsj');
  assert.equal(normalizeRepo('https://gitlab.com/g/p/-/issues/3#note_1'), 'gitlab.com/g/p');
  // A bare path with a subgroup can only be GitLab's.
  assert.equal(normalizeRepo('EdmundsGovTech/sabre/mcs-ng'), 'gitlab.com/EdmundsGovTech/sabre/mcs-ng');
  assert.equal(normalizeRepo('gitlab.com/team/app'), 'gitlab.com/team/app');
  const repo = 'gitlab.com/EdmundsGovTech/core/mcsj';
  assert.equal(forgeOf(repo), 'gitlab');
  assert.deepEqual(gitlabParts(repo), { host: 'gitlab.com', path: 'EdmundsGovTech/core/mcsj' });
  assert.equal(repoPath(repo), 'EdmundsGovTech/core/mcsj');
  assert.equal(repoWebUrl(repo), 'https://gitlab.com/EdmundsGovTech/core/mcsj');
});

test('nothing that could become an option, a path out or a strange host gets through', () => {
  for (const bad of ['', 'one', '--upload-pack=x/y', '../../etc/passwd', 'gitlab.com/../x', 'gitlab.com/g/..', 'file:///etc/passwd', 'https://gitlab.com/only', 'a/b/c/'.repeat(30), 'x@y/z']) {
    assert.equal(normalizeRepo(bad), undefined, bad);
  }
});

test('GitLab speaks of merge requests, !numbers and glab', () => {
  const w = forgeWords('gitlab');
  assert.equal(w.site, 'GitLab');
  assert.equal(w.cli, 'glab');
  assert.equal(w.pr, 'MR');
  assert.equal(w.ref(12), '!12');
  assert.equal(forgeWords(undefined).ref(12), '#12');
});

test('the issues a merge request closes come from its description, as GitLab reads it', () => {
  const url = 'https://gitlab.com/g/p';
  assert.deepEqual(closesOf('Closes #12', url), [12]);
  assert.deepEqual(closesOf('This fixes #3 and #4, resolves https://gitlab.com/g/p/-/issues/9', url), [3, 4, 9]);
  assert.deepEqual(closesOf('Closes https://gitlab.com/other/p/-/issues/9', url), [], "another project's issue");
  assert.deepEqual(closesOf('See #5 for context', url), []);
});

test("GitLab's merge checks become the PR window's words", () => {
  assert.deepEqual(mergeState('MERGEABLE', false), { mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' });
  assert.equal(mergeState('MERGEABLE', true).mergeStateStatus, 'DIRTY');
  assert.equal(mergeState('CONFLICT', false).mergeable, 'CONFLICTING');
  assert.equal(mergeState('NEED_REBASE', false).mergeStateStatus, 'BEHIND');
  assert.equal(mergeState('NOT_APPROVED', false).mergeStateStatus, 'BLOCKED');
  assert.match(mergeState('DISCUSSIONS_NOT_RESOLVED', false).blocked ?? '', /thread/);
  assert.equal(mergeState('CHECKING', false).mergeable, 'UNKNOWN');
});

test('discussions split into comments, approvals and threads on lines of code', () => {
  const url = 'https://gitlab.com/g/p/-/merge_requests/7';
  const at = '2026-09-28T10:00:00Z';
  const d = splitDiscussions(
    [
      { notes: [{ id: 1, body: 'Looks good', author: { username: 'ada' }, created_at: at }] },
      { notes: [{ id: 2, body: 'approved this merge request', system: true, author: { username: 'grace' }, created_at: at }] },
      { notes: [{ id: 3, body: 'changed the description', system: true, author: { username: 'grace' }, created_at: at }] },
      {
        notes: [
          { id: 4, body: 'Off by one?', author: { username: 'ada' }, created_at: at, position: { new_path: 'src/a.ts', old_path: 'src/a.ts', new_line: 10, old_line: null } },
          { id: 5, body: 'Fixed', author: { username: 'nik' }, created_at: at, position: { new_path: 'src/a.ts', old_path: 'src/a.ts', new_line: 10, old_line: null } },
        ],
      },
      { notes: [{ id: 6, body: 'Removed?', author: { username: 'ada' }, created_at: at, position: { new_path: 'b.ts', old_path: 'b.ts', new_line: null, old_line: 4 } }] },
    ],
    url,
  );
  assert.deepEqual(
    d.comments.map((c) => [c.id, c.author, c.url]),
    [['1', 'ada', `${url}#note_1`]],
  );
  assert.deepEqual(
    d.reviews.map((r) => [r.author, r.state]),
    [['grace', 'APPROVED']],
  );
  assert.deepEqual(
    d.reviewComments.map((c) => [c.id, c.replyTo, c.path, c.line, c.side]),
    [
      [4, undefined, 'src/a.ts', 10, 'RIGHT'],
      [5, 4, 'src/a.ts', 10, 'RIGHT'],
      [6, undefined, 'b.ts', 4, 'LEFT'],
    ],
  );
});

test('a projects folder inside a git checkout is refused, so clones never land in a project', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-office-nest-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'checkout', '.git'), { recursive: true });
  assert.match(insideCheckout(path.join(root, 'checkout', 'nikships')) ?? '', /inside the git checkout/);
  assert.equal(insideCheckout(path.join(root, 'elsewhere', 'projects')), undefined);
});

test('board agents on a GitLab floor are briefed for glab and merge requests', () => {
  const pulls = stationBrief('pulls', 'gitlab');
  assert.match(pulls, /merge requests with the glab CLI/);
  assert.match(pulls, /glab mr diff/);
  assert.doesNotMatch(pulls, /\bgh pr\b/);
  assert.match(stationBrief('issues', 'gitlab'), /GitLab issues with the glab CLI/);
  assert.match(stationBrief('queue', 'gitlab'), /linked to that GitLab issue/);
  // GitHub floors are briefed as before.
  assert.match(stationBrief('pulls'), /gh pr diff/);
});
