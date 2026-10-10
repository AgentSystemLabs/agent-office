// The floor's task queue.

import type { AgentEffort, AgentProvider } from './agents.js';

export type TaskStatus = 'queued' | 'running' | 'waiting' | 'done';

/** A task on the 📋 queue whiteboard: a GitHub issue or free text, seated to a worker by itself. */
export interface QueueTask {
  id: string;
  provider?: AgentProvider;
  /** Model requested for this task, instead of the office's configured default: an id its provider takes (see WorkerInfo.model). */
  model?: string;
  /** Reasoning effort requested for this task, when one was chosen (Claude only). */
  effort?: AgentEffort;
  /** The GitHub issue it came from, when it did. */
  issue?: number;
  title: string;
  prompt: string;
  addedBy: string;
  /** The account that queued it: its worker runs on that account's own sign-ins. None: the office's own. */
  owner?: string;
  addedAt: number;
  status: TaskStatus;
  /** The worker seated for it (it may have gone home since). */
  workerId?: string;
  /** Assigned into an existing session; old PRs on its branch are not this task. */
  reusedWorker?: boolean;
  workerName?: string;
  /** The worker's own branch, when it got a worktree. */
  branch?: string;
  startedAt?: number;
  finishedAt?: number;
  /** Unfinished turn, question, missing delivery or stopped process. Never auto-requeued. */
  waitingReason?: string;
  /** Explicit completion confirmation by a person, for results that need no PR. */
  confirmedBy?: { name: string; at: number };
  /** How it ended: the worker finished its turn, stopped or fell asleep, was sent home, or never started. */
  outcome?: 'done' | 'exited' | 'killed' | 'failed';
  error?: string;
  /** The pull request that closes the issue, or was opened from the worker's branch. */
  pr?: { number: number; url: string; state: string; title: string; coversTask?: boolean; checks?: 'pass' | 'fail' | 'pending' | 'none' };
}

export interface QueueState {
  tasks: QueueTask[];
  /** How many workers the queue may keep busy at once; 0 pauses it. */
  maxWorkers: number;
  /** Reuse manually seated workers without hiring or retiring anyone. */
  existingOnly?: boolean;
}

export type QueueClientMsg =
  | { t: 'queue.add'; prompt: string; title?: string; issue?: number; provider?: AgentProvider; model?: string; effort?: AgentEffort }
  | { t: 'queue.remove'; taskId: string }
  /** Move a queued task up (-1) or down (+1) the queue. */
  | { t: 'queue.move'; taskId: string; delta: number }
  /** Put a finished task back on the queue. */
  | { t: 'queue.retry'; taskId: string }
  /** Forget the finished tasks. */
  | { t: 'queue.clear' }
  | { t: 'queue.continue'; taskId: string }
  | { t: 'queue.confirm'; taskId: string }
  | { t: 'queue.limit'; maxWorkers: number }
  | { t: 'queue.staffing'; existingOnly: boolean };

export type QueueServerMsg =
  | { t: 'queue'; state: QueueState };
