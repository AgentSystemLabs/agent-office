import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ClientMsg, WorkerInfo } from '../src/shared/protocol';
import type { PromptOptions } from '../src/client/ui/prompt';
import { createWorkerPolicy, releaseWorkerCopy, workerKeyAllowed, workerPolicyHint, workerPromptOptions } from '../src/client/features/workers/policy';
import { pocketWorkerActions } from '../src/client/shared/pocket/controls';
import { interactionAvailable } from '../src/client/interaction';
import { registerInteractionPolicy } from '../src/client/shared/interaction-policy';

const worker: WorkerInfo = { id: 'child-1', kind: 'agent', name: 'Child', deskId: 'desk-1', color: '#ffffff', status: 'working',
  acked: true, createdBy: 'User', createdAt: 0, cols: 80, rows: 24, viewers: [], viewerIds: [] };

function harness(current?: WorkerInfo) {
  const sends: ClientMsg[] = [];
  const prompts: PromptOptions[] = [];
  const confirmations: { title: string; body: string; submit: string; yes(): void }[] = [];
  const opened: string[] = [];
  const notifications: string[] = [];
  const hires: [string, string][] = [];
  let capacity = true;
  const deps = {
    workerAtDesk: () => current,
    worker: () => current,
    desk: (id: string) => ({ label: id === 'desk-1' ? 'Desk 1' : 'Issues kiosk', station: id === 'station-issues' ? 'issues' : undefined }),
    canHire: () => capacity,
    hire: (id: string, task: string) => { hires.push([id, task]); },
    send: (message: ClientMsg) => { sends.push(message); },
    openConversation: (id: string) => { opened.push(id); },
    prompt: (options: PromptOptions) => { prompts.push(options); },
    confirm: (title: string, body: string, submit: string, yes: () => void) => { confirmations.push({ title, body, submit, yes }); },
    notify: (message: string) => { notifications.push(message); },
  };
  return { sends, prompts, confirmations, opened, notifications, hires, deps, policy: createWorkerPolicy(pocketWorkerActions(true), deps),
    full: () => { capacity = false; } };
}
const submitOptions = { worktree: false, repos: [] };

test('empty desk E and P use the original task dialog contract and require a real initial task', () => {
  const h = harness();
  for (const code of ['E', 'P'] as const) {
    assert.equal(h.policy.desk('desk-1', code), true);
    const form = h.prompts.at(-1)!;
    assert.match(form.title, /New task at Desk 1/);
    assert.equal(form.allowEmpty, false);
    assert.equal(form.providerOption, false);
    assert.equal(form.worktreeOption, false);
    assert.equal(form.repoOptions, undefined);
    assert.match(form.subtitle!, /inherits this floor/);
    assert.match(form.placeholder!, /Required/);
    form.onSubmit('   ', submitOptions);
    assert.equal(h.hires.length, code === 'E' ? 0 : 1);
    assert.equal(h.sends.length, 0);
    form.onSubmit('  Implement the requested change  ', submitOptions);
    assert.deepEqual(h.hires.at(-1), ['desk-1', 'Implement the requested change']);
  }
  assert.equal(h.policy.allowHire('desk-1'), false);
  assert.equal(h.sends.length, 0, 'opening a required prompt cannot start work');
  h.full();
  const count = h.prompts.length;
  h.policy.desk('desk-1', 'E');
  assert.equal(h.prompts.length, count);
});

test('occupied desk E opens its conversation; follow-up P reviews an unsent draft even while busy or lost', () => {
  const h = harness({ ...worker, lost: { branch: 'gone' } } as WorkerInfo);
  assert.equal(h.policy.desk('desk-1', 'E'), true);
  assert.deepEqual(h.opened, ['child-1']);
  assert.deepEqual(h.sends, []);
  assert.equal(h.policy.desk('desk-1', 'P'), true);
  const form = h.prompts[0];
  assert.match(form.title, /Review.*draft/i);
  assert.equal(form.submitLabel, 'Review draft in worker conversation');
  assert.equal(form.enterLabel, 'Enter to review draft');
  assert.match(form.subtitle!, /Nothing is sent or queued automatically/);
  assert.equal(form.allowEmpty, false);
  assert.equal(h.sends.length, 0);
  form.onSubmit('   ', submitOptions);
  assert.equal(h.sends.length, 0);
  form.onSubmit('Please review this follow-up', submitOptions);
  assert.deepEqual(h.sends, [{ t: 'worker.prompt', workerId: 'child-1', prompt: 'Please review this follow-up' }]);
});

test('X truthfully releases a desk without stopping, cleaning, or deleting its model session', () => {
  const h = harness(worker);
  assert.equal(h.policy.desk('desk-1', 'X'), true);
  assert.equal(h.sends.length, 0);
  const confirmation = h.confirmations[0];
  assert.equal(confirmation.submit, 'Release desk');
  assert.match(confirmation.title, /Release/);
  assert.match(confirmation.body, /conversation and any model work continue/);
  assert.match(confirmation.body, /Use Stop in the native conversation/);
  confirmation.yes();
  assert.deepEqual(h.sends, [{ t: 'worker.kill', workerId: 'child-1' }]);
  assert.equal('cleanup' in h.sends[0], false);
  assert.equal(releaseWorkerCopy('Child', 'Desk 1').submitLabel, 'Release desk');
});

test('unavailable desk and board-agent keys cannot emit network calls or advertise unsupported controls', () => {
  const policy = pocketWorkerActions(true);
  for (const current of [undefined, worker]) {
    const h = harness(current);
    for (const code of ['B', 'C', 'L', 'O'] as const) {
      assert.equal(workerKeyAllowed(policy, code), false);
      assert.equal(h.policy.desk('desk-1', code), true);
    }
    assert.equal(h.policy.blockBoard(), true);
    assert.equal(h.policy.desk('station-issues', 'E'), true);
    assert.match(h.notifications.at(-1)!, /GitHub boards and board agents are not connected/);
    assert.deepEqual(h.sends, []);
    assert.deepEqual(h.hires, []);
    assert.deepEqual(h.prompts, []);
    const hint = workerPolicyHint(policy, current, 'Desk 1', 'working')!;
    assert.equal(hint.keys.some(([key]) => ['B', 'C', 'L', 'O', 'R'].includes(key)), false);
    if (current) assert.deepEqual(hint.keys, [['E', 'Open worker conversation'], ['P', 'Review follow-up draft'], ['X', 'Release desk']]);
    else assert.match(hint.keys[0][1], /required task/);
  }
});

test('availability stops disabled keys before the pointer can send an avatar reach event', () => {
  const policy = pocketWorkerActions(true);
  const desk = { kind: 'desk' as const, deskId: 'desk-1', x: 0, z: 0, radius: 1 };
  const station = { ...desk, kind: 'station' as const };
  const state = { worker, room: false, note: null, carrying: false };
  const offDesk = registerInteractionPolicy('desk', (_it, key) => workerKeyAllowed(policy, key));
  const offStation = registerInteractionPolicy('station', () => policy.boardAgents !== false);
  try {
    for (const key of ['B', 'C', 'O', 'L'] as const) assert.equal(interactionAvailable(desk, key, state), false);
    for (const key of ['E', 'P', 'O', 'X'] as const) assert.equal(interactionAvailable(station, key, state), false);
    for (const key of ['E', 'P', 'X'] as const) assert.equal(interactionAvailable(desk, key, state), true);
    const pointer = readFileSync(new URL('../src/client/input/pointer.ts', import.meta.url), 'utf8');
    assert.ok(pointer.indexOf('if (!interactionAvailable(it, key,') < pointer.indexOf('    reach();'));
  } finally { offDesk(); offStation(); }
  assert.equal(interactionAvailable(desk, 'C', state), true, 'standalone availability is restored');
  assert.equal(interactionAvailable(station, 'E', state), true);
});

test('source inheritance cannot be replaced by direct programmatic hire settings or repository actions', () => {
  const h = harness();
  assert.equal(h.policy.allowHire('desk-1', 'Task'), true);
  for (const args of [
    ['desk-1', 'Task', true], ['desk-1', 'Task', false, 'pi'], ['desk-1', 'Task', false, undefined, 'other/model'],
    ['desk-1', 'Task', false, undefined, undefined, 'high'],
    ['desk-1', 'Task', false, undefined, undefined, undefined, undefined, ['other-repo']],
    ['station-issues', 'Task'], ['desk-1', 'Task', false, undefined, undefined, undefined, 12],
  ]) assert.equal(h.policy.allowHire(...args as Parameters<typeof h.policy.allowHire>), false);
  assert.equal(h.sends.length, 0);
  assert.equal(h.prompts.length, 0);
});

test('standalone keeps its optional prompt, provider choices, shell, worktrees, and original action paths', () => {
  const h = harness(worker);
  const standalone = pocketWorkerActions(false);
  assert.deepEqual(standalone, {});
  const policy = createWorkerPolicy(standalone, h.deps);
  for (const code of ['E', 'P', 'B', 'C', 'O', 'L', 'R', 'X'] as const) assert.equal(policy.desk('desk-1', code), false);
  assert.equal(policy.release('child-1'), false);
  assert.equal(policy.blockBoard(), false);
  assert.equal(policy.allowHire('desk-1'), true);
  assert.equal(policy.allowHire('desk-1', 'Task', true, 'claude', 'model', 'high', 1, ['repo']), true);
  assert.equal(workerPolicyHint(standalone, worker, 'Desk 1', 'working'), null);
  const options: PromptOptions = { title: 'Hire', allowEmpty: true, providerOption: true, worktreeOption: true,
    repoOptions: [{ id: 'repo', name: 'Repo' }], onSubmit() {} };
  assert.deepEqual(workerPromptOptions(standalone, options, true), options);
  assert.deepEqual(h.sends, []);
  assert.deepEqual(h.notifications, []);
});

test('the real worker feature uses the policy before original actions and keeps the original dialog implementation', () => {
  const actions = readFileSync(new URL('../src/client/features/workers/actions.ts', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/client/main.ts', import.meta.url), 'utf8');
  assert.match(actions, /policy: WorkerActionPolicy = \{\}/);
  assert.match(actions, /prompt: openPrompt, confirm: confirmDialog/);
  assert.match(actions, /if \(!it\.deskId \|\| policyActions\.desk\(it\.deskId, key\)\) return;/);
  assert.match(actions, /if \(!policyActions\.allowHire\(/);
  assert.match(actions, /if \(policyActions\.release\(id\)\) return;/);
  assert.match(actions, /policy\.conversationLabel \? net\.openPocketSession\(id\)/);
  assert.match(actions, /if \(!it\.deskId \|\| policyActions\.blockBoard\(\)\) return;/);
  assert.match(main, /installWorkerActions\(ctx, core, parts, pocketWorkerActions\(\)\)/);
  const prompt = readFileSync(new URL('../src/client/ui/prompt.ts', import.meta.url), 'utf8');
  assert.match(prompt, /opts\.enterLabel \?\? 'Enter to send'/);
});
