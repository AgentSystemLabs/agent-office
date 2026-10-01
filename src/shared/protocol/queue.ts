// The floor's task queue.

import type { AgentEffort, AgentProvider } from './agents.js';

export type TaskStatus = 'queued' | 'running' | 'done';

/** A task on the 📋 queue whiteboard: a GitHub issue or free text, seated to a worker by itself. */
export interface QueueTask {
  id: string;
  provider?: AgentProvider;
  /** Model requested for this task, instead of the office's configured default: an OpenCode provider/model id, or a Claude model alias. */
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
  workerName?: string;
  /** The worker's own branch, when it got a worktree. */
  branch?: string;
  startedAt?: number;
  finishedAt?: number;
  /** How it ended: the worker finished its turn, stopped or fell asleep, was sent home, or never started. */
  outcome?: 'done' | 'exited' | 'killed' | 'failed';
  error?: string;
  /** The pull request that closes the issue, or was opened from the worker's branch. */
  pr?: { number: number; url: string; state: string; title: string };
}

export interface QueueState {
  tasks: QueueTask[];
  /** How many workers the queue may keep busy at once; 0 pauses it. */
  maxWorkers: number;
}

/** One floor's queue, for the building-wide view of every floor's tasks. */
export interface FloorQueue {
  floor: string;
  state: QueueState;
}

/**
 * Every queue message works on your own floor's queue, or on another floor's with `floor`: from any
 * floor's queue you can hand tasks to every project in the building and look after them.
 */
export type QueueClientMsg =
  | { t: 'queue.add'; prompt: string; title?: string; issue?: number; provider?: AgentProvider; model?: string; effort?: AgentEffort; floor?: string }
  | { t: 'queue.remove'; taskId: string; floor?: string }
  /** Move a queued task up (-1) or down (+1) the queue. */
  | { t: 'queue.move'; taskId: string; delta: number; floor?: string }
  /** Put a finished task back on the queue. */
  | { t: 'queue.retry'; taskId: string; floor?: string }
  /** Forget the finished tasks. */
  | { t: 'queue.clear'; floor?: string }
  | { t: 'queue.limit'; maxWorkers: number; floor?: string }
  /** Follow every floor's queue (answered with `queues`, then `queue.floor` as each one changes), or stop. */
  | { t: 'queue.watch'; on: boolean };

export type QueueServerMsg =
  | { t: 'queue'; state: QueueState }
  /** Every floor's queue, for whoever just started watching them all. */
  | { t: 'queues'; floors: FloorQueue[] }
  /** One floor's queue changed, for whoever watches them all. */
  | { t: 'queue.floor'; floor: string; state: QueueState };
