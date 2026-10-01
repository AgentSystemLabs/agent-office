// "Easy approvals": the lever in the maintenance closet. Down (the default), workers ask about whatever
// their agent asks about. Up, workers are started in their agent's own automatic mode, where a reviewer
// model answers the permission requests that are low risk and only what it won't wave through reaches a
// person, in the worker's terminal like any other question (the worker shows as needing input).
//
// Claude Code has it as `--permission-mode auto`, Codex as `approvals_reviewer=auto_review`. The office
// doesn't judge commands itself: it only starts workers in that mode. A mode is chosen when an agent
// starts, so the lever applies to workers hired or resumed from then on.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AgentProvider, ApprovalsState } from '../shared/protocol.js';

/** What the lever is at now, for Workers to read when it starts an agent. */
export const easyApprovals = { on: false };

/** The options that put `provider`'s agent in its automatic mode, or none: with the lever down, for an agent that has no such mode, or when `configured` (--agent-args) already picks one. */
export function approvalArgs(provider: AgentProvider | undefined, easy: boolean, configured: readonly string[] = []): string[] {
  if (!easy) return [];
  if (provider === 'claude') {
    return configured.some((a) => a === '--permission-mode' || a.startsWith('--permission-mode=') || a === '--dangerously-skip-permissions' || a === '--allow-dangerously-skip-permissions') ? [] : ['--permission-mode', 'auto'];
  }
  if (provider === 'codex') {
    return configured.some((a) => a.startsWith('approvals_reviewer') || a === '--dangerously-bypass-approvals-and-sandbox' || a === '--full-auto') ? [] : ['-c', 'approvals_reviewer=auto_review'];
  }
  return [];
}

/** The state of the lever, kept in <data>/approvals.json so it stays where it was left. */
export class Approvals {
  private by?: string;
  private at?: number;
  private readonly file: string;

  constructor(
    dataDir: string,
    private emit: (state: ApprovalsState) => void,
  ) {
    this.file = path.join(dataDir, 'approvals.json');
    try {
      const s = JSON.parse(readFileSync(this.file, 'utf8')) as { easy?: unknown; by?: unknown; at?: unknown };
      easyApprovals.on = s.easy === true;
      this.by = typeof s.by === 'string' ? s.by : undefined;
      this.at = typeof s.at === 'number' ? s.at : undefined;
    } catch {
      easyApprovals.on = false;
    }
  }

  get on(): boolean {
    return easyApprovals.on;
  }

  state(): ApprovalsState {
    return { easy: easyApprovals.on, by: this.by, at: this.at };
  }

  set(easy: boolean, by: string) {
    if (easy === easyApprovals.on) return;
    easyApprovals.on = easy;
    this.by = by;
    this.at = Date.now();
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify({ easy, by, at: this.at }), { mode: 0o600 });
    } catch (err) {
      console.error(`agent-office: couldn't save the easy approvals lever: ${(err as Error).message}`);
    }
    this.emit(this.state());
  }
}
