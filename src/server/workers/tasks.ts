// What each worker is working on (WorkerInfo.task): named from its latest prompts and tool calls,
// by Claude for the providers the office names tasks for (see TaskNamer and ProviderAdapter.namesTasks).
import { officePrompt } from '../prompts.js';
import { providerAdapter } from '../providers/index.js';
import { TaskNamer, fallbackTask } from '../tasks.js';
import type { Worker, WorkerContext } from './types.js';

/** How many of a worker's latest prompts and tool calls the task namer sees. */
const TASK_PROMPTS = 5;
const TASK_TOOLS = 10;
/** While a worker works, refresh its task summary after this many tool calls, at most this often. */
const TASK_REFRESH_TOOLS = 8;
const TASK_REFRESH_MS = 90_000;

/**
 * What a worker whose terminal didn't make it through a restart (the machine rebooted, the terminal
 * host was replaced or died) is resumed with when it was in the middle of something, so it carries on
 * by itself instead of waiting at every desk for someone to type "continue".
 */
export const CARRY_ON_PROMPT = 'continue — the office restarted and interrupted you. Pick up where you left off; if you were waiting on an answer or a permission, ask again.';

export class WorkerTasks {
  private namer: TaskNamer;

  /** `claude` is the Claude Code the namer runs, when there is one. */
  constructor(
    private ctx: WorkerContext,
    claude: string | null,
    env: Record<string, string>,
  ) {
    this.namer = new TaskNamer(claude, env, () => officePrompt(ctx.prompts, 'office.namer'), (id, task, named) => {
      const w = ctx.workers.get(id);
      if (!w || w.taskEpoch !== named.epoch) return;
      w.info.task = task;
      ctx.emit(w);
      ctx.persist();
    });
  }

  /** A new message for the worker: show it right away, and have its task (re)named. */
  notePrompt(w: Worker, prompt: string) {
    if (w.info.kind !== 'agent') return;
    const clean = prompt.replace(/\s+/g, ' ').trim();
    // Bare slash commands (/model, /compact), repeats and the office's own carry-on aren't new work.
    if (!clean || /^\/\S+$/.test(clean) || w.prompts.at(-1) === clean || clean === CARRY_ON_PROMPT) return;
    w.prompts = [...w.prompts, clean].slice(-TASK_PROMPTS);
    const hadTask = !!w.info.task;
    if (!hadTask) w.info.task = fallbackTask(clean);
    if (!providerAdapter(w.info.provider)?.namesTasks) return;
    // "yes", "go ahead", "2": a reply within the same task, not worth a new name.
    if (hadTask && clean.length < 16) return;
    this.name(w);
  }

  noteTool(w: Worker, tool: string) {
    if (!providerAdapter(w.info.provider)?.namesTasks) return;
    w.tools = [...w.tools, tool].slice(-TASK_TOOLS);
    w.toolsSinceNamed++;
    if (w.info.task && w.toolsSinceNamed >= TASK_REFRESH_TOOLS && Date.now() - w.namedAt > TASK_REFRESH_MS) this.name(w);
  }

  /** A new conversation (/clear, another session): a new task. */
  clear(w: Worker) {
    w.taskEpoch++;
    w.prompts = [];
    w.tools = [];
    w.toolsSinceNamed = 0;
    this.namer.forget(w.info.id);
    if (!w.info.task) return;
    w.info.task = undefined;
    this.ctx.emit(w);
    this.ctx.persist();
  }

  /** It's gone: a naming still on its way is dropped. */
  forget(id: string) {
    this.namer.forget(id);
  }

  private name(w: Worker) {
    if (!providerAdapter(w.info.provider)?.namesTasks) return;
    w.toolsSinceNamed = 0;
    w.namedAt = Date.now();
    const previous = w.info.task && w.prompts.length > 1 ? w.info.task : undefined;
    this.namer.request(w.info.id, { prompts: w.prompts, tools: w.tools, previous, epoch: w.taskEpoch });
  }
}
