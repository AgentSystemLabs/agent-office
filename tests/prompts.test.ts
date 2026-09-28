import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PROMPTS, PROMPT_IDS, PROMPT_MAX, fillPrompt, issuePromptVars, mergeCommand, placeholders, promptText, pullPromptVars } from '../src/shared/prompts.js';
import { OfficePrompts, officePrompt, type PromptSource } from '../src/server/prompts.js';
import { stationBrief } from '../src/server/stations.js';
import { TaskQueue, type QueueWorkers } from '../src/server/queue.js';
import type { AgentChoice, AgentProvider, PromptsState, WorkerInfo } from '../src/shared/protocol.js';

const PROVIDERS: { list: AgentProvider[]; configured: AgentProvider } = { list: ['droid', 'claude', 'opencode', 'codex'], configured: 'droid' };

function scratch(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-prompts-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('placeholders are filled in once, unknown ones stay, and a line with nothing to say goes', () => {
  assert.equal(fillPrompt('Fix #{{number}}: {{ title }}', { number: 12, title: 'The dog' }), 'Fix #12: The dog');
  assert.equal(fillPrompt('Keep {{this}} as it is', { number: 1 }), 'Keep {{this}} as it is');
  // What goes in isn't looked at again.
  assert.equal(fillPrompt('"{{title}}" by {{who}}', { title: '{{who}}', who: 'Ada' }), '"{{who}}" by Ada');
  assert.equal(fillPrompt('About:\n{{about}}\n\n{{pr}}\n\n{{issue}}\n\nHow it runs.\n\n{{where}}', { about: 'X', pr: '', issue: 'Issue #3.', where: '' }), 'About:\nX\n\nIssue #3.\n\nHow it runs.');
  // Empty in the middle of a line is just empty.
  assert.equal(fillPrompt("Don't change it.{{before}} List them.", { before: '' }), "Don't change it. List them.");
  assert.deepEqual(placeholders('{{a}} {{ b }} {{a}} {{9x}}'), ['a', 'b']);
});

test('every default only uses placeholders it says it has, and names the ones the office counts on', () => {
  for (const id of PROMPT_IDS) {
    const def = PROMPTS[id];
    for (const name of placeholders(def.text)) assert.ok(name in def.vars, `${id} uses {{${name}}}`);
    for (const name of def.needs ?? []) assert.ok(placeholders(def.text).includes(name), `${id} needs {{${name}}}`);
    assert.ok(def.text.trim().length > 0, id);
  }
});

test('the editor names no prompt with an emoji', () => {
  for (const id of PROMPT_IDS) assert.doesNotMatch(PROMPTS[id].label, /\p{Extended_Pictographic}/u, id);
});

// What the boards sent before their prompts could be rewritten, word for word, on each forge.
const GITHUB_PULL = { number: 5, title: 'Fix "{{title}}" the dog', url: 'https://github.com/o/r/pull/5', headRefName: 'feat/dog', baseRefName: 'main' };
const GITLAB_PULL = { number: 9, title: 'Fix the cat', url: 'https://gitlab.example.com/grp/sub/proj/-/merge_requests/9', headRefName: 'feat/cat', baseRefName: 'develop' };
const GITLAB_PROJECT = 'https://gitlab.example.com/grp/sub/proj';

test('the boards send what they always did on a GitHub floor', () => {
  const issue = issuePromptVars('github', { number: 7, title: 'Dog barks', url: 'https://github.com/o/r/issues/7' });
  assert.equal(
    fillPrompt(PROMPTS['issue.work'].text, issue),
    'Work on GitHub issue #7: "Dog barks".\n\nRead it first with `gh issue view 7 --comments`. Create a new branch, implement the change, verify it, then open a pull request that closes #7.',
  );
  assert.equal(fillPrompt(PROMPTS['issue.ask'].text, issue), 'This is about GitHub issue #7 "Dog barks" (https://github.com/o/r/issues/7). Read it with `gh issue view 7 --comments`.');
  assert.equal(fillPrompt(PROMPTS['issue.meeting'].text, issue), 'GitHub issue #7: “Dog barks”. Read it first with gh issue view 7 --comments.');

  const pull = pullPromptVars('github', GITHUB_PULL, 'o/r', 'o/r');
  assert.equal(
    fillPrompt(PROMPTS['pull.review'].text, pull),
    'Review pull request #5: "Fix "{{title}}" the dog".\n\nUse `gh pr view 5 --comments` and `gh pr diff 5`. Look for bugs, risky changes and missing tests, then give me a short summary with concrete suggestions. Don\'t push any commits.',
  );
  assert.equal(
    fillPrompt(PROMPTS['pull.ask'].text, pull),
    'This is about pull request #5 "Fix "{{title}}" the dog" (https://github.com/o/r/pull/5), branch `feat/dog` into `main`. Read it with `gh pr view 5 --comments` and see its changes with `gh pr diff 5`.',
  );
  assert.equal(fillPrompt(PROMPTS['pull.panel'].text, pull), 'Review pull request #5: “Fix "{{title}}" the dog”.');
  const checkout =
    '1. Get onto its branch: `gh pr checkout 5`. If git says `feat/dog` is already checked out in another worktree, use `git fetch origin feat/dog && git checkout --detach FETCH_HEAD` instead and push with `git push origin HEAD:feat/dog`.';
  assert.equal(
    fillPrompt(PROMPTS['pull.fixMerge'].text, { ...pull, merge: mergeCommand('github', 5, 'squash', true, 'o/r', 'o/r') }),
    [
      'Get pull request #5 "Fix "{{title}}" the dog" (https://github.com/o/r/pull/5) ready and merge it.',
      '',
      checkout,
      '2. Read all the feedback: `gh pr view 5 --comments`, and the comments on lines of code with `gh api repos/o/r/pulls/5/comments`.',
      '3. Address every review comment that is still open: fix it, or if you disagree, reply on the PR saying why. If the branch conflicts with `main`, merge `main` in and resolve the conflicts.',
      '4. Verify your changes the way this project does (build, typecheck, tests), then commit and push.',
      '5. Wait for the checks with `gh pr checks 5 --watch` and fix anything that fails.',
      '6. When the checks pass and no feedback is left, merge it: `gh pr merge 5 --squash --delete-branch --repo o/r`. If something only a person can decide is in the way, stop and tell me instead of merging.',
    ].join('\n'),
  );
  assert.equal(
    fillPrompt(PROMPTS['pull.fixConflicts'].text, { ...pull, merge: mergeCommand('github', 5, 'rebase', false, 'o/r', 'o/r') }),
    [
      'Pull request #5 "Fix "{{title}}" the dog" (https://github.com/o/r/pull/5) has merge conflicts with `main`. Resolve them and merge it.',
      '',
      checkout,
      '2. Bring in the latest `main`: `git fetch origin main && git merge origin/main`.',
      "3. Resolve every conflict so both sides' changes survive. Read the PR (`gh pr view 5`) and the `main` commits that touched the same code to see what each side meant; don't just take one side.",
      '4. Verify the result the way this project does (build, typecheck, tests), then commit the merge and push.',
      '5. Wait for the checks with `gh pr checks 5 --watch` and fix anything that fails.',
      '6. When the checks pass, merge it: `gh pr merge 5 --rebase --repo o/r`. If a conflict needs a decision only a person can make, stop and tell me instead of merging.',
    ].join('\n'),
  );
});

test('the boards send what they always did on a GitLab floor', () => {
  const issue = issuePromptVars('gitlab', { number: 3, title: 'Cat meows', url: 'https://gitlab.example.com/grp/sub/proj/-/issues/3' });
  assert.equal(
    fillPrompt(PROMPTS['issue.work'].text, issue),
    'Work on GitLab issue #3: "Cat meows".\n\nRead it first with `glab issue view 3 --comments`. Create a new branch, implement the change, verify it, then open a merge request with `glab mr create` whose description says "Closes #3".',
  );
  assert.equal(fillPrompt(PROMPTS['issue.ask'].text, issue), 'This is about GitLab issue #3 "Cat meows" (https://gitlab.example.com/grp/sub/proj/-/issues/3). Read it with `glab issue view 3 --comments`.');
  assert.equal(fillPrompt(PROMPTS['issue.meeting'].text, issue), 'GitLab issue #3: “Cat meows”. Read it first with glab issue view 3 --comments.');

  const pull = pullPromptVars('gitlab', GITLAB_PULL, 'grp/sub/proj', GITLAB_PROJECT);
  assert.equal(
    fillPrompt(PROMPTS['pull.review'].text, pull),
    'Review merge request !9: "Fix the cat".\n\nUse `glab mr view 9 --comments` and `glab mr diff 9`. Look for bugs, risky changes and missing tests, then give me a short summary with concrete suggestions. Don\'t push any commits.',
  );
  assert.equal(
    fillPrompt(PROMPTS['pull.ask'].text, pull),
    'This is about merge request !9 "Fix the cat" (https://gitlab.example.com/grp/sub/proj/-/merge_requests/9), branch `feat/cat` into `develop`. Read it with `glab mr view 9 --comments` and see its changes with `glab mr diff 9`.',
  );
  assert.equal(fillPrompt(PROMPTS['pull.panel'].text, pull), 'Review merge request !9: “Fix the cat”.');
  const checkout =
    '1. Get onto its branch: `glab mr checkout 9`. If git says `feat/cat` is already checked out in another worktree, use `git fetch origin feat/cat && git checkout --detach FETCH_HEAD` instead and push with `git push origin HEAD:feat/cat`.';
  assert.equal(
    fillPrompt(PROMPTS['pull.fixMerge'].text, { ...pull, merge: mergeCommand('gitlab', 9, 'squash', true, 'grp/sub/proj', GITLAB_PROJECT) }),
    [
      'Get merge request !9 "Fix the cat" (https://gitlab.example.com/grp/sub/proj/-/merge_requests/9) ready and merge it.',
      '',
      checkout,
      '2. Read all the feedback: `glab mr view 9 --comments`, and the threads on lines of code with `glab mr note list 9 --type diff --state unresolved`.',
      '3. Address every review comment that is still open: fix it, or if you disagree, reply on the MR saying why. If the branch conflicts with `develop`, merge `develop` in and resolve the conflicts.',
      '4. Verify your changes the way this project does (build, typecheck, tests), then commit and push.',
      '5. Wait for the checks with `glab ci status --branch feat/cat --wait` and fix anything that fails.',
      '6. When the checks pass and no feedback is left, merge it: `glab mr merge 9 --squash --remove-source-branch --auto-merge=false --yes --repo https://gitlab.example.com/grp/sub/proj`. If something only a person can decide is in the way, stop and tell me instead of merging.',
    ].join('\n'),
  );
  assert.equal(
    fillPrompt(PROMPTS['pull.fixConflicts'].text, { ...pull, merge: mergeCommand('gitlab', 9, 'merge', false, 'grp/sub/proj', GITLAB_PROJECT) }),
    [
      'Merge request !9 "Fix the cat" (https://gitlab.example.com/grp/sub/proj/-/merge_requests/9) has merge conflicts with `develop`. Resolve them and merge it.',
      '',
      checkout,
      '2. Bring in the latest `develop`: `git fetch origin develop && git merge origin/develop`.',
      "3. Resolve every conflict so both sides' changes survive. Read the MR (`glab mr view 9 --comments`) and the `develop` commits that touched the same code to see what each side meant; don't just take one side.",
      '4. Verify the result the way this project does (build, typecheck, tests), then commit the merge and push.',
      '5. Wait for the checks with `glab ci status --branch feat/cat --wait` and fix anything that fails.',
      '6. When the checks pass, merge it: `glab mr merge 9 --auto-merge=false --yes --repo https://gitlab.example.com/grp/sub/proj`. If a conflict needs a decision only a person can make, stop and tell me instead of merging.',
    ].join('\n'),
  );
});

test('a rewritten board prompt fills in the floor it is sent on', () => {
  const text = 'Merge {{ref}} with `{{merge}}` via {{cli}}';
  const gh = pullPromptVars('github', GITHUB_PULL, 'o/r', 'o/r');
  const gl = pullPromptVars('gitlab', GITLAB_PULL, 'grp/sub/proj', GITLAB_PROJECT);
  assert.equal(fillPrompt(text, { ...gh, merge: mergeCommand('github', 5, 'merge', true, 'o/r', 'o/r') }), 'Merge #5 with `gh pr merge 5 --merge --delete-branch --repo o/r` via gh');
  assert.equal(
    fillPrompt(text, { ...gl, merge: mergeCommand('gitlab', 9, 'merge', true, 'grp/sub/proj', GITLAB_PROJECT) }),
    `Merge !9 with \`glab mr merge 9 --remove-source-branch --auto-merge=false --yes --repo ${GITLAB_PROJECT}\` via glab`,
  );
});

test('the board agents are briefed as they always were on both forges', () => {
  const brief = (kind: 'issues' | 'pulls' | 'queue', forge: 'github' | 'gitlab') => stationBrief(kind, forge);
  for (const forge of ['github', 'gitlab'] as const) {
    const [site, cli, pull] = forge === 'gitlab' ? ['GitLab', 'glab', 'merge request'] : ['GitHub', 'gh', 'pull request'];
    for (const kind of ['issues', 'pulls', 'queue'] as const) {
      const b = brief(kind, forge);
      assert.doesNotMatch(b, /\{\{/, `${forge} ${kind}`);
      assert.match(b, new RegExp(`a task usually ends with a ${pull}\\. Use it`));
      assert.match(b, new RegExp(`each task's id, status, title, worker and ${pull}\\)`));
      assert.match(b, new RegExp(`linked to that ${site} issue, which is assigned`));
      assert.ok(b.endsWith('The request:'));
    }
    assert.match(brief('issues', forge), new RegExp(`${site} issues with the ${cli} CLI`));
  }
  assert.match(brief('pulls', 'gitlab'), /merge requests with the glab CLI: sum them up and review them \(glab mr view --comments, glab mr diff, glab ci status\)/);
  assert.match(brief('queue', 'gitlab'), /to open a merge request with glab mr create\), since/);
  assert.equal(
    brief('issues', 'github').split('\n\n')[1],
    "You look after this repository's GitHub issues with the gh CLI: file new ones (a clear title, what's wrong or wanted, and how to reproduce it when that applies), find and sum them up, triage, label, comment on, close and reopen them. To get an issue worked on, put it on the task queue with its number.",
  );
});

test('a rewritten prompt is kept, used, and put back to the default', (t) => {
  const dir = scratch(t);
  const told: PromptsState[] = [];
  const book = new OfficePrompts(dir, PROVIDERS, (s) => told.push(s));
  assert.equal(book.setPrompt('issue.work', 'Just do #{{number}}\r\n', 'Ada'), undefined);
  assert.equal(book.text('issue.work'), 'Just do #{{number}}');
  assert.equal(book.state().custom['issue.work']?.by, 'Ada');
  assert.equal(told.length, 1);

  // It's there after a restart.
  const again = new OfficePrompts(dir, PROVIDERS, () => {});
  assert.equal(officePrompt(again, 'issue.work', { number: 4 }), 'Just do #4');

  // The default's own text, or null, puts the default back.
  assert.equal(book.setPrompt('issue.work', PROMPTS['issue.work'].text, 'Ada'), undefined);
  assert.equal(book.state().custom['issue.work'], undefined);
  book.setPrompt('pull.review', 'Look at it', 'Ada');
  assert.equal(book.setPrompt('pull.review', null, 'Grace'), undefined);
  assert.equal(book.text('pull.review'), PROMPTS['pull.review'].text);

  // Empty only where empty means "send nothing"; never too long, never an unknown prompt.
  assert.match(book.setPrompt('issue.work', '  ', 'Ada') ?? '', /can’t be empty/);
  assert.equal(book.setPrompt('queue.worktree', '', 'Ada'), undefined);
  assert.equal(book.text('queue.worktree'), '');
  assert.match(book.setPrompt('issue.work', 'x'.repeat(PROMPT_MAX + 1), 'Ada') ?? '', /at most/);
  assert.match(book.setPrompt('nope', 'x', 'Ada') ?? '', /Unknown prompt/);
  assert.match(book.setPrompt('constructor', 'x', 'Ada') ?? '', /Unknown prompt/);
  assert.equal(promptText(book.state().custom, 'office.namer'), PROMPTS['office.namer'].text);
});

test('the default worker is checked before it is kept, Droid included, and one the office can no longer start is forgotten', (t) => {
  const dir = scratch(t);
  const book = new OfficePrompts(dir, PROVIDERS, () => {});
  assert.equal(book.agent(), undefined);
  assert.match(book.setAgent({ provider: 'custom' }, 'Ada') ?? '', /Unknown agent provider/);
  assert.match(book.setAgent({ provider: 'claude', model: 'gpt-9' }, 'Ada') ?? '', /Invalid Claude model/);
  assert.match(book.setAgent({ provider: 'codex', effort: 'high' }, 'Ada') ?? '', /only be selected for Claude Code or Droid/);
  assert.match(book.setAgent({ provider: 'opencode', model: 'no slash' }, 'Ada') ?? '', /Invalid OpenCode model/);
  assert.match(book.setAgent({ provider: 'droid', model: 'has a space' }, 'Ada') ?? '', /Invalid Droid model/);
  assert.equal(book.setAgent({ provider: 'droid', model: 'custom:droidproxy:opus-5-5', effort: 'high' }, 'Ada'), undefined);
  assert.deepEqual(book.agent(), { provider: 'droid', model: 'custom:droidproxy:opus-5-5', effort: 'high' });
  assert.equal(book.state().agent?.by, 'Ada');
  assert.deepEqual(new OfficePrompts(dir, PROVIDERS, () => {}).agent(), { provider: 'droid', model: 'custom:droidproxy:opus-5-5', effort: 'high' });
  assert.equal(book.setAgent({ provider: 'claude', model: 'opus', effort: 'high' }, 'Ada'), undefined);
  assert.deepEqual(book.agent(), { provider: 'claude', model: 'opus', effort: 'high' });
  assert.equal(book.setAgent(null, 'Ada'), undefined);
  assert.equal(book.agent(), undefined);

  // Custom, then the office comes back with another --agent: custom is gone.
  const file = path.join(dir, 'prompts.json');
  writeFileSync(file, JSON.stringify({ custom: {}, agent: { provider: 'custom', by: 'Ada', at: 1 } }));
  assert.deepEqual(new OfficePrompts(dir, { list: [...PROVIDERS.list, 'custom'], configured: 'custom' }, () => {}).agent(), { provider: 'custom' });
  assert.equal(new OfficePrompts(dir, PROVIDERS, () => {}).agent(), undefined);
  // A broken file is the defaults.
  writeFileSync(file, '{nope');
  assert.deepEqual(new OfficePrompts(dir, PROVIDERS, () => {}).state(), { custom: {} });
  assert.ok(readFileSync(file, 'utf8'));
});

test('a board agent is told its rewritten brief, with the floor filled in', () => {
  const source: PromptSource = { text: (id) => (id === 'station.pulls' ? 'You review {{pullName}}s with {{site}}. The request:' : PROMPTS[id].text), agent: () => undefined };
  assert.equal(stationBrief('pulls', 'github', source), 'You review pull requests with GitHub. The request:');
  assert.equal(stationBrief('pulls', 'gitlab', source), 'You review merge requests with GitLab. The request:');
  assert.equal(stationBrief('issues', 'gitlab', source), stationBrief('issues', 'gitlab'));
});

function queueFixture(t: { after(fn: () => void): void }, officeDefault: AgentChoice | undefined, note?: string, useWorktree = true) {
  const dir = scratch(t);
  const workers: WorkerInfo[] = [];
  const manager: QueueWorkers = {
    defaultProvider: 'droid',
    officeDefault,
    list: () => workers,
    deskOccupied: (desk) => workers.some((w) => w.deskId === desk),
    spawn(deskId, by, prompt, _worktree, kind, provider, model, effort) {
      const w: WorkerInfo = {
        id: `w${workers.length}`,
        deskId,
        kind,
        provider,
        model,
        effort,
        prompt,
        name: 'T',
        color: '#fff',
        status: 'working',
        acked: false,
        createdBy: by,
        createdAt: Date.now(),
        cols: 80,
        rows: 24,
        viewers: [],
        viewerIds: [],
      };
      workers.push(w);
      return w;
    },
    kill: async () => ({}),
  };
  const queue = new TaskQueue(dir, manager, useWorktree, {
    update() {},
    toast() {},
    claimIssue: async () => undefined,
    refreshGitHub() {},
    hiringPaused: () => undefined,
    emptied() {},
    ...(note !== undefined ? { worktreeNote: () => note } : {}),
  });
  t.after(() => queue.shutdown());
  return { queue, workers };
}

test('a task nobody picked a worker for runs on the office default, Droid model and effort included; one that did keeps its own', (t) => {
  const { queue, workers } = queueFixture(t, { provider: 'droid', model: 'custom:droidproxy:gpt-6-sol', effort: 'low' });
  assert.equal(queue.add('Fix the dog', 'Queue agent'), undefined);
  assert.deepEqual([workers[0].provider, workers[0].model, workers[0].effort], ['droid', 'custom:droidproxy:gpt-6-sol', 'low']);
  assert.equal(queue.add('Fix the cat', 'Ada', undefined, undefined, 'claude', 'haiku'), undefined);
  assert.deepEqual([workers[1].provider, workers[1].model, workers[1].effort], ['claude', 'haiku', undefined]);
  // Without one set, it's the office's --agent on its own model, as it always was.
  const plain = queueFixture(t, undefined);
  plain.queue.add('Fix it', 'Ada');
  assert.deepEqual([plain.workers[0].provider, plain.workers[0].model, plain.workers[0].effort], ['droid', undefined, undefined]);
});

test('the worktree note the queue adds is the old one by default, and can be rewritten or left off', (t) => {
  const standard = queueFixture(t, undefined);
  standard.queue.add('Fix it', 'Ada');
  assert.equal(standard.workers[0].prompt, "Fix it\n\nYou're in your own git worktree, on a fresh branch made for this task. Commit there, push it, and open the pull request from it.");
  const rewritten = queueFixture(t, undefined, 'Push to your branch.');
  rewritten.queue.add('Fix it', 'Ada');
  assert.equal(rewritten.workers[0].prompt, 'Fix it\n\nPush to your branch.');
  const none = queueFixture(t, undefined, '');
  none.queue.add('Fix it', 'Ada');
  assert.equal(none.workers[0].prompt, 'Fix it');
  const noGit = queueFixture(t, undefined, undefined, false);
  noGit.queue.add('Fix it', 'Ada');
  assert.equal(noGit.workers[0].prompt, 'Fix it');
});
