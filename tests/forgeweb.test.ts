import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forgeNote, originOf, repoOf, webOf } from '../src/shared/forgeweb.js';
import { stationBrief } from '../src/server/stations.js';

// Every link the office builds out of an issue or pull request's URL used to be a GitHub one, so on
// a Bitbucket floor a #12 or a relative path in a description led off to github.com, or nowhere.

const GH = 'https://github.com/owner/repo';
const BB = 'https://bitbucket.org/owner/repo';

test('a pull request’s URL goes back to its repository on either forge', () => {
  assert.equal(repoOf(`${GH}/pull/12`), GH);
  assert.equal(repoOf(`${GH}/issues/12`), GH);
  // The window is showing a page of the conversation, not just the top of it.
  assert.equal(repoOf(`${GH}/pull/12/files`), GH);
  assert.equal(repoOf(`${GH}/pull/12#issuecomment-1`), GH);
  // Bitbucket spells it pull-requests, which a /pull/ pattern alone never matched.
  assert.equal(repoOf(`${BB}/pull-requests/12`), BB);
  assert.equal(repoOf(`${BB}/pull-requests/12/overview`), BB);
});

test('the forge is worked out from the host in the URL, with GitHub as the fallback', () => {
  assert.equal(webOf(`${GH}/pull/12`).kind, 'github');
  assert.equal(webOf(`${BB}/pull-requests/12`).kind, 'bitbucket');
  assert.equal(webOf('https://git.example.com/owner/repo/pull/12').kind, 'github');
});

test('a person in a comment goes to their page on the forge the item is on', () => {
  assert.equal(webOf(`${GH}/pull/12`).person('ada'), 'https://github.com/ada');
  assert.equal(webOf(`${BB}/pull-requests/12`).person('ada'), 'https://bitbucket.org/ada');
});

test('a #12 links on GitHub and is left as written on Bitbucket, which has no repository issues', () => {
  assert.equal(webOf(`${GH}/pull/12`).issues(GH), `${GH}/issues`);
  assert.equal(webOf(`${BB}/pull-requests/12`).issues(BB), undefined);
});

test('a relative path goes where the forge keeps files: /blob on GitHub, /src on Bitbucket', () => {
  assert.equal(webOf(`${GH}/pull/12`).file(GH, 'docs/guide.md'), `${GH}/blob/HEAD/docs/guide.md`);
  assert.equal(webOf(`${GH}/pull/12`).file(GH, 'docs/guide.md', 'install'), `${GH}/blob/HEAD/docs/guide.md#install`);
  assert.equal(webOf(`${BB}/pull-requests/12`).file(BB, 'docs/guide.md'), `${BB}/src/HEAD/docs/guide.md`);
  assert.equal(webOf(`${BB}/pull-requests/12`).file(BB, 'docs/guide.md', 'install'), `${BB}/src/HEAD/docs/guide.md#install`);
});

test('a link that starts at the root stays on the host the repository is on', () => {
  assert.equal(originOf(GH), 'https://github.com');
  assert.equal(originOf(BB), 'https://bitbucket.org');
});

test('the merge command in a worker’s prompt is the forge’s own CLI', () => {
  const gh = webOf(`${GH}/pull/12`);
  assert.equal(gh.merge(12, 'squash', true, 'owner/repo'), 'gh pr merge 12 --squash --delete-branch --repo owner/repo');
  // bb names a strategy rather than taking a flag, and reads the repository from the checkout.
  const bb = webOf(`${BB}/pull-requests/12`);
  assert.equal(bb.merge(12, 'squash', true, 'owner/repo'), 'bb pr merge 12 --strategy squash --close-source-branch');
  assert.equal(bb.merge(12, 'merge', false, 'owner/repo'), 'bb pr merge 12 --strategy merge_commit');
  assert.equal(bb.merge(12, 'rebase', false, 'owner/repo'), 'bb pr merge 12 --strategy rebase_fast_forward');
});

test('a prompt for a Bitbucket floor is told to use bb; on GitHub nothing is added', () => {
  const note = forgeNote('bitbucket', 'the steps below');
  assert.match(note, /^This project is on Bitbucket, not GitHub/);
  assert.match(note, /use the bb CLI wherever the steps below says `gh`/);
  assert.equal(forgeNote('github', 'the steps below'), '', 'a GitHub floor gets the prompt as written');
});

test('the board agents’ brief and the PR window’s prompts are given the same note', () => {
  const brief = stationBrief('pulls', undefined, 'bitbucket');
  assert.ok(brief.startsWith(forgeNote('bitbucket', 'this brief')), 'same wording, only the noun differs');
  assert.match(brief, /wherever this brief says `gh`/);
  assert.ok(brief.endsWith(stationBrief('pulls')), 'and the brief itself is left exactly as written');
});
