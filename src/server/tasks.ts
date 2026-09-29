// Names what each worker is on: a few words and a one-line summary for the card above its head.
// A small model (Claude Haiku, through the `claude` CLI the office already needs) writes them from
// the worker's prompts and recent tool calls, told how by the 'office.namer' prompt (shared/prompts.ts).
// Without it, the card falls back to the prompt itself.

import type { WorkerTask } from '../shared/protocol.js';
import { runHeadless, type HeadlessRunner } from './headless.js';

/** What a worker has been asked and has been doing lately. */
export interface TaskContext {
  prompts: string[];
  tools: string[];
  previous?: WorkerTask;
  /** Bumped when the conversation starts over (/clear), so late answers about the old one are dropped. */
  epoch: number;
}

const NAME_MAX = 40;
const SUMMARY_MAX = 110;
const PROMPT_MAX = 600;
const CONCURRENCY = 2;
const DEBOUNCE_MS = 800;
const TIMEOUT_MS = 45_000;
/** After this many failures in a row (not signed in, no network), stop asking for a while. */
const FAILS_BEFORE_BACKOFF = 3;
const BACKOFF_MS = 10 * 60_000;

const SCHEMA = {
  type: 'object',
  properties: { name: { type: 'string' }, summary: { type: 'string' } },
  required: ['name', 'summary'],
  additionalProperties: false,
};

export class TaskNamer {
  private pending = new Map<string, TaskContext>();
  private timers = new Map<string, NodeJS.Timeout>();
  private running = new Set<string>();
  private queue: string[] = [];
  private fails = 0;
  private pausedUntil = 0;

  /**
   * @param claude the `claude` binary, or null to only ever use the prompt as the label
   * @param env environment for it (the office's own, minus anything that marks a child session)
   * @param system its instructions, as the office has them now (the 'office.namer' prompt)
   * @param run how the CLI is called (a fake in tests)
   */
  constructor(
    private claude: string | null,
    private env: Record<string, string>,
    private system: () => string,
    private done: (workerId: string, task: WorkerTask, ctx: TaskContext) => void,
    private run: HeadlessRunner = runHeadless,
  ) {}

  get enabled(): boolean {
    return this.claude !== null && Date.now() >= this.pausedUntil;
  }

  /** Asks for a fresh label. Calls for the same worker close together collapse into one. */
  request(workerId: string, ctx: TaskContext) {
    if (!this.enabled || !ctx.prompts.length) return;
    this.pending.set(workerId, ctx);
    clearTimeout(this.timers.get(workerId));
    this.timers.set(
      workerId,
      setTimeout(() => {
        this.timers.delete(workerId);
        if (!this.queue.includes(workerId)) this.queue.push(workerId);
        this.pump();
      }, DEBOUNCE_MS),
    );
  }

  forget(workerId: string) {
    clearTimeout(this.timers.get(workerId));
    this.timers.delete(workerId);
    this.pending.delete(workerId);
    this.queue = this.queue.filter((id) => id !== workerId);
  }

  private pump() {
    while (this.running.size < CONCURRENCY) {
      // One call per worker at a time; a newer request waits for it and runs after.
      const i = this.queue.findIndex((id) => !this.running.has(id));
      if (i < 0) return;
      const [id] = this.queue.splice(i, 1);
      const ctx = this.pending.get(id);
      this.pending.delete(id);
      if (!ctx) continue;
      this.running.add(id);
      void this.generate(ctx).then((task) => {
        this.running.delete(id);
        if (task) this.done(id, task, ctx);
        this.pump();
      });
    }
  }

  private async generate(ctx: TaskContext): Promise<WorkerTask | null> {
    if (!this.enabled) return null;
    const out = await this.run({ claude: this.claude!, env: this.env, prompt: describe(ctx), schema: SCHEMA, system: this.system(), isolated: true, timeoutMs: TIMEOUT_MS });
    const task = out === null ? null : parse(out);
    if (task) this.fails = 0;
    else if (++this.fails >= FAILS_BEFORE_BACKOFF) {
      this.fails = 0;
      this.pausedUntil = Date.now() + BACKOFF_MS;
    }
    return task;
  }
}

/** The label to show while the model is still thinking, or when there is no model: the prompt. */
export function fallbackTask(prompt: string): WorkerTask {
  const one = prompt.replace(/\s+/g, ' ').trim();
  const words = one.replace(/^(please|can you|could you|hey|ok|so)\b[\s,]*/i, '').split(' ');
  const name = words.slice(0, 4).join(' ').replace(/[\s,.;:!?-]+$/, '');
  return { name: cap(clip(name, NAME_MAX)), summary: cap(clip(one, SUMMARY_MAX)) };
}

function describe(ctx: TaskContext): string {
  const parts: string[] = [];
  if (ctx.previous) parts.push(`Current label:\nName: ${ctx.previous.name}\nSummary: ${ctx.previous.summary}`);
  parts.push(`What it was asked, oldest first:\n${ctx.prompts.map((p, i) => `${i + 1}. ${clip(p, PROMPT_MAX)}`).join('\n')}`);
  if (ctx.tools.length) parts.push(`What it did most recently, oldest first:\n${ctx.tools.map((t) => `- ${t}`).join('\n')}`);
  return parts.join('\n\n');
}

/** The label out of the model's answer, tidied; null when it isn't one. */
function parse(v: unknown): WorkerTask | null {
  try {
    const name = clip(String((v as { name?: unknown })?.name ?? '').replace(/^["'\s]+|["'.\s]+$/g, ''), NAME_MAX);
    const summary = clip(String((v as { summary?: unknown })?.summary ?? '').replace(/^["'\s]+|["'\s]+$/g, '').replace(/\.$/, ''), SUMMARY_MAX);
    return name && summary ? { name, summary } : null;
  } catch {
    return null;
  }
}

function clip(s: string, n: number) {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1).trimEnd()}…` : one;
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
