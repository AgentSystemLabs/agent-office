// Names what each worker is on: a few words and a one-line summary for the card above its head.
// A small model (Claude Haiku, through the `claude` CLI the office already needs) writes them from
// the worker's prompts and recent tool calls, told how by the 'office.namer' prompt (shared/prompts.ts).
// Without it, the card falls back to the prompt itself.

import { spawn } from 'node:child_process';
import os from 'node:os';
import type { WorkerTask } from '../shared/protocol.js';

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

const SCHEMA = JSON.stringify({
  type: 'object',
  properties: { name: { type: 'string' }, summary: { type: 'string' } },
  required: ['name', 'summary'],
  additionalProperties: false,
});

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
   */
  constructor(
    private claude: string | null,
    private env: Record<string, string>,
    private system: () => string,
    private done: (workerId: string, task: WorkerTask, ctx: TaskContext) => void,
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
    const out = await run(this.claude!, this.env, this.system(), describe(ctx));
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

function run(claude: string, env: Record<string, string>, system: string, input: string): Promise<string | null> {
  const args = [
    '-p',
    '--model', 'haiku',
    '--output-format', 'json',
    '--json-schema', SCHEMA,
    '--system-prompt', system,
    '--tools', '',
    // Not the user's or the project's settings: no hooks, no MCP servers, no plugins, no transcript.
    '--setting-sources', '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
  ];
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const finish = (v: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    const child = spawn(claude, args, {
      // A neutral directory, so it doesn't pick up the project's CLAUDE.md.
      cwd: os.tmpdir(),
      env: { ...env, MAX_THINKING_TOKENS: '0' },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(null);
    }, TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d: string) => (out += d));
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code === 0 ? out : null));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

function parse(out: string): WorkerTask | null {
  try {
    const res = JSON.parse(out);
    if (res?.is_error) return null;
    let v = res?.structured_output;
    if (!v && typeof res?.result === 'string') v = JSON.parse(res.result.replace(/^```(json)?|```$/g, ''));
    const name = clip(String(v?.name ?? '').replace(/^["'\s]+|["'.\s]+$/g, ''), NAME_MAX);
    const summary = clip(String(v?.summary ?? '').replace(/^["'\s]+|["'\s]+$/g, '').replace(/\.$/, ''), SUMMARY_MAX);
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
