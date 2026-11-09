import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkerInfo } from '../src/shared/protocol.js';
import { SUBAGENT_STALE_MS, liveSubagents } from '../src/shared/protocol.js';
import { MAX_SUBAGENTS, noteSubagent, subagentMeta } from '../src/server/subagents.js';
import { claude } from '../src/server/providers/claude.js';

function info(): WorkerInfo {
  return { id: 'w1', kind: 'agent', provider: 'claude', deskId: 'desk-1', name: 'Pixel', color: '#fff', status: 'working', acked: true, createdBy: 't', createdAt: 0, cols: 80, rows: 24, viewers: [], viewerIds: [] };
}

/** A session's transcript, with its subagents' meta files beside it as Claude Code keeps them. */
function session(t: test.TestContext): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ao-subagents-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const transcript = path.join(dir, 'sess-1.jsonl');
  writeFileSync(transcript, '');
  const subs = path.join(dir, 'sess-1', 'subagents');
  mkdirSync(path.join(subs, 'workflows', 'wf_1'), { recursive: true });
  writeFileSync(path.join(subs, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Find the login code' }));
  writeFileSync(path.join(subs, 'workflows', 'wf_1', 'agent-b2.meta.json'), JSON.stringify({ agentType: 'workflow-subagent', description: 'verify:licence', workflowPhase: 'Verify' }));
  return transcript;
}

test('a subagent stands by its worker from SubagentStart to SubagentStop, with what it was asked and its latest tool', (t) => {
  const transcript = session(t);
  const w = info();
  assert.equal(noteSubagent(w, 'SubagentStart', { agent_id: 'a1', agent_type: 'Explore' }, { transcript, now: 1000 }), true);
  assert.deepEqual(w.subagents, [{ id: 'a1', type: 'Explore', title: 'Find the login code', phase: undefined, since: 1000, seenAt: 1000 }]);
  // Its own tool calls come in on the worker's hooks, with its agent_id.
  assert.equal(noteSubagent(w, 'PreToolUse', { agent_id: 'a1', tool_name: 'Grep' }, { transcript, activity: 'Grep: login', now: 2000 }), true);
  assert.equal(w.subagents?.[0].activity, 'Grep: login');
  assert.equal(w.subagents?.[0].seenAt, 2000);
  // Nothing new to show: not worth a message.
  assert.equal(noteSubagent(w, 'PostToolUse', { agent_id: 'a1' }, { transcript, now: 2500 }), false);
  // The worker's own events (no agent_id) leave its subagents be.
  assert.equal(noteSubagent(w, 'PreToolUse', { tool_name: 'Bash' }, { transcript, activity: 'Bash: ls', now: 2600 }), false);
  assert.equal(w.subagents?.length, 1);
  assert.equal(noteSubagent(w, 'SubagentStop', { agent_id: 'a1', agent_type: 'Explore' }, { transcript, now: 3000 }), true);
  assert.equal(w.subagents, undefined);
  assert.equal(noteSubagent(w, 'SubagentStop', { agent_id: 'a1' }, { transcript, now: 3100 }), false);
});

test("a workflow's agents are read from its run's folder, and one first heard of mid-run is taken in", (t) => {
  const transcript = session(t);
  const w = info();
  // The office restarted while it ran: its SubagentStart never came, its next tool call does.
  assert.equal(noteSubagent(w, 'PreToolUse', { agent_id: 'b2', agent_type: 'workflow-subagent' }, { transcript, activity: 'Read: LICENSE', now: 10 }), true);
  assert.deepEqual(w.subagents, [{ id: 'b2', type: 'workflow-subagent', title: 'verify:licence', phase: 'Verify', activity: 'Read: LICENSE', since: 10, seenAt: 10 }]);
  assert.equal(subagentMeta(transcript, 'b2')?.workflowPhase, 'Verify');
  // SubagentStop names its transcript, and the meta file next to it is read first.
  const own = path.join(path.dirname(transcript), 'sess-1', 'subagents', 'agent-a1.jsonl');
  assert.equal(subagentMeta(undefined, 'a1', own)?.description, 'Find the login code');
});

test('a new session has none, ones not heard from in a while are gone, ids are never paths, and there is a cap', (t) => {
  const transcript = session(t);
  const w = info();
  noteSubagent(w, 'SubagentStart', { agent_id: 'a1', agent_type: 'Explore' }, { transcript, now: 0 });
  assert.equal(noteSubagent(w, 'SessionStart', { source: 'clear' }, { now: 1 }), true);
  assert.equal(w.subagents, undefined);
  noteSubagent(w, 'SubagentStart', { agent_id: 'a1', agent_type: 'Explore' }, { transcript, now: 0 });
  // Stopped mid-turn (Esc), it never said it was done.
  assert.equal(noteSubagent(w, 'UserPromptSubmit', {}, { now: SUBAGENT_STALE_MS + 1 }), true);
  assert.equal(w.subagents, undefined);
  assert.equal(noteSubagent(w, 'SubagentStart', { agent_id: '../../etc/passwd', agent_type: 'x' }, { transcript, now: 5 }), false);
  assert.equal(w.subagents, undefined);
  for (let i = 0; i < MAX_SUBAGENTS + 5; i++) noteSubagent(w, 'SubagentStart', { agent_id: `x${i}`, agent_type: 'general-purpose' }, { now: 10 + i });
  assert.equal(w.subagents?.length, MAX_SUBAGENTS);
  assert.equal(w.subagents?.[0].title, undefined);
  assert.deepEqual(liveSubagents(w.subagents, 10 + MAX_SUBAGENTS).slice(0, 2).map((s) => s.id), [`x${MAX_SUBAGENTS - 1}`, `x${MAX_SUBAGENTS - 2}`]);
});

test("Claude Code workers are hooked for SubagentStart and SubagentStop, and the worker's card hears about them", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ao-hooks-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const setup = claude.prepare!({ dataDir: dir, dshProfile: 'acp' });
  const hooks = JSON.parse(readFileSync(setup.settings, 'utf8')).hooks;
  for (const event of ['SubagentStart', 'SubagentStop', 'SessionStart', 'PreToolUse', 'Stop']) assert.ok(hooks[event], `${event} is hooked`);
  assert.match(hooks.SubagentStart[0].hooks[0].command, /event=SubagentStart/);

  const w = info();
  let emitted = 0;
  const statuses: string[] = [];
  const h = {
    info: w,
    state: undefined,
    running: true,
    bootBlocked: false,
    leftNeedsInputAt: 0,
    failStreak: 0,
    tracker: { transcript: undefined },
    setStatus: (s: string) => {
      statuses.push(s);
      w.status = s as WorkerInfo['status'];
      emitted++;
    },
    emit: () => void emitted++,
    persist: () => {},
    notePrompt: () => {},
    noteTool: () => {},
    notePr: () => {},
    clearTask: () => {},
    scheduleScan: () => {},
    prompt: () => undefined,
  } as any;
  assert.equal(claude.hook!.handle(h, 'SubagentStart', { session_id: 's1', agent_id: 'a9', agent_type: 'Plan' }), true);
  assert.equal(w.subagents?.[0].type, 'Plan');
  assert.equal(emitted, 1);
  // A subagent's events never end its worker's turn.
  assert.equal(claude.hook!.handle(h, 'SubagentStop', { session_id: 's1', agent_id: 'a9', agent_type: 'Plan' }), true);
  assert.equal(w.subagents, undefined);
  assert.equal(w.status, 'working');
  assert.deepEqual(statuses, []);
  assert.equal(emitted, 2);
});
