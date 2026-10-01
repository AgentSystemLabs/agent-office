import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Approvals, approvalArgs, easyApprovals } from '../src/server/approvals.js';
import type { ApprovalsState } from '../src/shared/protocol.js';

test("with the lever up, Claude Code and Codex start in their own automatic modes, and nothing else changes", () => {
  assert.deepEqual(approvalArgs('claude', true), ['--permission-mode', 'auto']);
  assert.deepEqual(approvalArgs('codex', true), ['-c', 'approvals_reviewer=auto_review']);
  for (const provider of ['claude', 'codex', 'opencode', 'grok', 'muse', 'dsh', 'custom', undefined] as const) assert.deepEqual(approvalArgs(provider, false), [], `${provider} with the lever down`);
  for (const provider of ['opencode', 'grok', 'muse', 'dsh', 'custom', undefined] as const) assert.deepEqual(approvalArgs(provider, true), [], `${provider} has no such mode`);
});

test("a mode someone already picked with --agent-args is left alone", () => {
  assert.deepEqual(approvalArgs('claude', true, ['--permission-mode', 'plan']), []);
  assert.deepEqual(approvalArgs('claude', true, ['--permission-mode=acceptEdits']), []);
  assert.deepEqual(approvalArgs('claude', true, ['--dangerously-skip-permissions']), []);
  assert.deepEqual(approvalArgs('claude', true, ['--model', 'opus']), ['--permission-mode', 'auto']);
  assert.deepEqual(approvalArgs('codex', true, ['-c', 'approvals_reviewer=user']), []);
  assert.deepEqual(approvalArgs('codex', true, ['--full-auto']), []);
  assert.deepEqual(approvalArgs('codex', true, ['-m', 'gpt-6-luna']), ['-c', 'approvals_reviewer=auto_review']);
});

test('the lever starts down, remembers where it was put across restarts, and tells everyone', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-approvals-'));
  const seen: ApprovalsState[] = [];
  const a = new Approvals(dir, (s) => seen.push(s));
  assert.equal(a.on, false);
  assert.equal(easyApprovals.on, false);
  a.set(true, 'Alex');
  assert.equal(easyApprovals.on, true, 'what workers read when they start');
  assert.deepEqual(seen.map((s) => [s.easy, s.by]), [[true, 'Alex']]);
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'approvals.json'), 'utf8')).easy, true);
  a.set(true, 'Alex');
  assert.equal(seen.length, 1, 'no news when nothing moved');

  assert.equal(new Approvals(dir, () => {}).on, true, 'it stays up across a restart');
  const back = new Approvals(dir, () => {});
  back.set(false, 'Sam');
  assert.equal(easyApprovals.on, false);
  assert.equal(new Approvals(dir, () => {}).on, false);
  assert.equal(new Approvals(path.join(dir, 'nothing-here'), () => {}).on, false, 'with no file it is down');
});
