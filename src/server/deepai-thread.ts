import { readDeepaiCredential, DeepaiMcp } from './deepai-mcp.js';
import { terminalSafe } from './dsh.js';
import type { Usage, WorkerStatus } from '../shared/protocol.js';

type Rec = Record<string, unknown>;
const str = (v: unknown): string | undefined => typeof v === 'string' && v ? v : undefined;
const record = (v: unknown): Rec => v && typeof v === 'object' && !Array.isArray(v) ? v as Rec : {};

export interface ThreadEvents {
  output(text: string): void;
  status(status: WorkerStatus): void;
  usage(usage: Usage): void;
  session(id: string): void;
  exit(code: number | null, error?: string, quiet?: boolean): void;
  prompted(text: string): void;
}

export interface ThreadLaunch {
  dataDir: string;
  cwd: string;
  workspaceRoot: string;
  model?: string;
  effort?: string;
  resumeThreadId?: string;
  firstPrompt?: string;
  title: string;
  runtimeMode?: string;
  mcp?: DeepaiMcp;
}

/** Owns one app-side DeepAI thread and mirrors its transcript into the office terminal. */
export class ThreadSession {
  private threadId?: string;
  private closed = false;
  private polling = false;
  private followAgain = false;
  private line = '';
  private positions = new Set<string>();

  constructor(private readonly launch: ThreadLaunch, private readonly events: ThreadEvents) {}
  get id(): string | undefined { return this.threadId; }
  get running(): boolean { return !this.closed; }

  async start(): Promise<void> {
    this.events.status('starting');
    try {
      const credential = readDeepaiCredential(this.launch.dataDir);
      if (!credential) throw new Error('DeepAI Code is not paired or the pairing expired; pair DeepAI Code first, then press R here');
      const mcp = this.launch.mcp ?? new DeepaiMcp({ url: credential.url, token: credential.token });
      this.launch.mcp = mcp;
      let id = this.launch.resumeThreadId;
      if (!id) {
        let cursor: number | undefined;
        let project: Rec | undefined;
        do {
          const page = await mcp.call<Rec>('deepai_project_list', { limit: 100, cursor });
          const found = Array.isArray(page.projects) ? (page.projects as Rec[]).find((p) => p.workspaceRoot === this.launch.workspaceRoot && !p.deletedAt) : undefined;
          if (found) { project = found; break; }
          cursor = typeof page.nextCursor === 'number' ? page.nextCursor : undefined;
        } while (cursor !== undefined);
        project ??= await mcp.call<Rec>('deepai_project_create', { title: this.launch.title, workspaceRoot: this.launch.workspaceRoot, createWorkspaceRootIfMissing: false });
        const projectId = str(project.id);
        if (!projectId) throw new Error('DeepAI Code did not return a project id');
        const launched = await mcp.call<Rec>('deepai_thread_launch', {
          projectId,
          title: this.launch.title,
          workspaceStrategy: { type: 'existing_worktree', worktreePath: this.launch.cwd },
          modelSelection: {
            provider: 'deepai',
            model: (this.launch.model || 'deepai/glm-5.3-flash').startsWith('deepai/') ? (this.launch.model || 'deepai/glm-5.3-flash') : `deepai/${this.launch.model}`,
            ...(this.launch.effort ? { options: { thinking: this.launch.effort } } : {}),
          },
          runtimeMode: this.launch.runtimeMode ?? 'auto',
          message: this.launch.firstPrompt ?? '',
        });
        id = str(launched.threadId);
        if (!id) throw new Error('DeepAI Code did not return a thread id');
      }
      this.threadId = id;
      this.events.session(id);
      this.events.status(this.launch.firstPrompt ? 'working' : 'idle');
      void this.follow(mcp, id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.events.output(`\r\n\x1b[31m[DeepAI Code: ${message.replace(/[\r\n]/g, ' ')}]\x1b[0m\r\n`);
      this.events.exit(-1, message, false);
    }
  }

  prompt(text: string): void {
    const clean = text.trim();
    if (!clean || !this.threadId || this.closed) return;
    this.events.prompted(clean);
    this.events.output(`\r\n> ${terminalSafe(clean).replace(/\n/g, '\r\n  ')}\r\n`);
    this.events.status('working');
    const mcp = this.launch.mcp;
    if (!mcp) return;
    void mcp.call('deepai_thread_send', { threadId: this.threadId, message: clean })
      .then(() => this.follow(mcp, this.threadId!))
      .catch((err: unknown) => this.fail(err));
  }

  writeInput(data: string): void {
    if (this.closed) return;
    if (data === '\x1b' || data === '\x03') {
      this.line = '';
      if (this.threadId && this.launch.mcp) {
        const mcp = this.launch.mcp;
        void mcp.call('deepai_thread_interrupt', { threadId: this.threadId }).then(() => this.follow(mcp, this.threadId!)).catch((err: unknown) => this.fail(err));
      }
      return;
    }
    for (const ch of data.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')) {
      if (ch === '\r' || ch === '\n') { const text = this.line.trim(); this.line = ''; if (text) this.prompt(text); }
      else if (ch === '\x7f' || ch === '\b') this.line = [...this.line].slice(0, -1).join('');
      else if (ch >= ' ' && this.line.length < 20_000) this.line += ch;
    }
  }

  close(): void { this.closed = true; }

  private async follow(mcp: DeepaiMcp, id: string): Promise<void> {
    if (this.polling) { this.followAgain = true; return; }
    this.polling = true;
    try {
      while (!this.closed) {
        const read = await mcp.call<Rec>('deepai_thread_read', { threadId: id, limit: 100 });
        const items = Array.isArray(read.items) ? read.items as Rec[] : [];
        for (const item of items) {
          const itemId = str(item.itemId);
          if (!itemId || this.positions.has(itemId)) continue;
          this.positions.add(itemId);
          const type = String(item.type ?? '');
          const detail = type === 'tool_call' ? [str(item.name) ?? str(item.title), str(item.text) ?? (item.input ? JSON.stringify(item.input) : undefined)].filter(Boolean).join(' · ') : undefined;
          const text = str(item.text) ?? str(item.summary) ?? detail;
          if (text && /assistant_message|assistant_reasoning|tool_call|tool_result/.test(type)) this.events.output(`${terminalSafe(text).replace(/\n/g, '\r\n')}\r\n`);
          const usage = record(item.usage);
          if (Object.keys(usage).length) this.events.usage({ input: number(usage.input), output: number(usage.output), reasoning: number(usage.reasoning), cacheWrite: number(usage.cacheWrite), cacheRead: number(usage.cacheRead), cost: number(usage.cost), calls: number(usage.calls), costKnown: typeof usage.cost === 'number', callsKnown: typeof usage.calls === 'number' });
        }
        const status = str(record(read.thread).status) ?? str(read.status);
        if (status === 'running' || status === 'starting' || status === 'preparing' || status === 'queued') {
          this.events.status('working');
          const waited = await mcp.call<Rec>('deepai_thread_wait', { threadId: id, timeoutMs: 1500 });
          if (waited.timedOut) continue;
          continue;
        }
        if (status === 'waiting') this.events.status('needs_input');
        else if (status === 'completed') this.events.status('done');
        else if (status === 'idle') this.events.status('idle');
        else if (status === 'failed' || status === 'cancelled' || status === 'interrupted') this.events.status('done');
        return;
      }
    } catch (err) { this.fail(err); }
    finally {
      this.polling = false;
      if (this.followAgain && !this.closed) {
        this.followAgain = false;
        void this.follow(mcp, id);
      }
    }
  }

  private fail(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.events.output(`\r\n\x1b[31m[DeepAI Code: ${message.replace(/[\r\n]/g, ' ')}]\x1b[0m\r\n`);
    this.events.status('idle');
  }
}

function number(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0; }
