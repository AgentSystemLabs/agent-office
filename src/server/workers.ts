import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, accessSync, constants } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import * as pty from '@lydell/node-pty';
import headless from '@xterm/headless';
import serialize from '@xterm/addon-serialize';
import type { Run, WorkerInfo, WorkerStatus } from '../shared/protocol.js';
import { FLAG_BOLD, FLAG_DIM, FLAG_INVERSE, RGB_FLAG } from '../shared/protocol.js';
import { DESK_BY_ID } from '../shared/layout.js';

type HeadlessTerminal = InstanceType<typeof headless.Terminal>;

const NAMES = [
  'Pixel', 'Byte', 'Nibble', 'Sprocket', 'Widget', 'Gizmo', 'Bolt', 'Cosmo', 'Dot', 'Echo',
  'Fizz', 'Glitch', 'Hopper', 'Jinx', 'Kilo', 'Lumen', 'Mochi', 'Noodle', 'Orbit', 'Pip',
  'Quark', 'Rivet', 'Sparky', 'Tofu', 'Uno', 'Volt', 'Waffle', 'Zippy',
];
const COLORS = ['#ff8a5b', '#5bc0eb', '#9bc53d', '#fde74c', '#c3423f', '#b388eb', '#f7aef8', '#72ddf7', '#ffb400', '#00a6a6'];

// Env vars from a parent agent session (e.g. starting the office from inside Claude Code) that
// would make a worker think it is a child session — that silently turns off transcript saving,
// which breaks resume.
const SCRUB_ENV = new Set([
  'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_PID', 'CLAUDE_EFFORT',
  'NO_COLOR', 'FORCE_COLOR', 'VSCODE_INJECTION', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION',
]);
const SCRUB_PREFIXES = ['CLAUDE_CODE_SESSION', 'CLAUDE_CODE_CHILD', 'CLAUDE_CODE_MESSAGING', 'NEBULA_', 'AGENT_OFFICE_'];
const scrubbed = (k: string) => SCRUB_ENV.has(k) || SCRUB_PREFIXES.some((p) => k.startsWith(p));

const SCROLLBACK = 3000;
const SCREEN_INTERVAL_MS = 250;
const LATE_PROMPT_GRACE_MS = 5000;

export interface HookEnv {
  url: string;
  token: string;
}

interface Worker {
  info: WorkerInfo;
  pty?: pty.IPty;
  term?: HeadlessTerminal;
  ser?: InstanceType<typeof serialize.SerializeAddon>;
  viewers: Map<string, string>; // clientId -> name
  screenDirty: boolean;
  lastLines: string[];
  leftNeedsInputAt: number;
  hookToken: string;
}

export interface WorkerEvents {
  update(info: WorkerInfo): void;
  remove(workerId: string): void;
  data(workerId: string, data: string, viewers: string[]): void;
  screen(workerId: string, frame: { cols: number; rows: number; lines: Record<number, Run[]>; full: boolean; cursor: [number, number] }): void;
  toast(text: string, level: 'info' | 'warn' | 'error'): void;
}

export class WorkerManager {
  private workers = new Map<string, Worker>();
  private statePath: string;
  private settingsPath: string;
  private agentPath: string | null = null;
  private screenTimer: NodeJS.Timeout;

  constructor(
    private dir: string,
    private dataDir: string,
    private agentCmd: string,
    private agentArgs: string[],
    private hook: HookEnv,
    private events: WorkerEvents,
  ) {
    this.statePath = path.join(dataDir, 'workers.json');
    this.settingsPath = path.join(dataDir, 'claude-hooks.json');
    this.writeHookSettings();
    this.agentPath = resolveCommand(agentCmd);
    this.restore();
    this.screenTimer = setInterval(() => this.flushScreens(), SCREEN_INTERVAL_MS);
  }

  get resolvedAgent(): string | null {
    return this.agentPath;
  }

  list(): WorkerInfo[] {
    return [...this.workers.values()].map((w) => w.info);
  }

  get(id: string): WorkerInfo | undefined {
    return this.workers.get(id)?.info;
  }

  deskOccupied(deskId: string): boolean {
    for (const w of this.workers.values()) if (w.info.deskId === deskId) return true;
    return false;
  }

  spawn(deskId: string, by: string, prompt?: string): WorkerInfo | string {
    if (!DESK_BY_ID.has(deskId)) return 'Unknown desk';
    if (this.deskOccupied(deskId)) return 'That desk is taken';
    const used = new Set([...this.workers.values()].map((w) => w.info.name));
    const name = NAMES.find((n) => !used.has(n)) ?? `Worker ${this.workers.size + 1}`;
    const id = randomBytes(6).toString('hex');
    const info: WorkerInfo = {
      id,
      deskId,
      name,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      status: 'starting',
      acked: true,
      createdBy: by,
      createdAt: Date.now(),
      prompt: prompt?.trim() || undefined,
      cols: 100,
      rows: 30,
      viewers: [],
      activity: prompt ? truncate(prompt, 80) : undefined,
    };
    const w: Worker = { info, viewers: new Map(), screenDirty: true, lastLines: [], leftNeedsInputAt: 0, hookToken: randomBytes(16).toString('hex') };
    this.workers.set(id, w);
    this.launch(w, info.prompt, undefined);
    this.persist();
    return info;
  }

  resume(id: string): string | undefined {
    const w = this.workers.get(id);
    if (!w) return 'No such worker';
    if (w.pty) return 'Worker is already running';
    w.info.status = 'starting';
    w.info.exitCode = undefined;
    this.launch(w, undefined, w.info.sessionId);
    return undefined;
  }

  kill(id: string) {
    const w = this.workers.get(id);
    if (!w) return;
    this.workers.delete(id);
    try {
      w.pty?.kill();
    } catch {
      // already gone
    }
    w.term?.dispose();
    this.events.remove(id);
    this.persist();
  }

  attach(id: string, clientId: string, name: string): { data: string; cols: number; rows: number } | undefined {
    const w = this.workers.get(id);
    if (!w) return undefined;
    w.viewers.set(clientId, name);
    let changed = this.syncViewers(w);
    if (!w.info.acked && w.info.status !== 'needs_input') {
      w.info.acked = true;
      changed = true;
    }
    if (changed) this.emitUpdate(w);
    const data = w.ser ? w.ser.serialize({ scrollback: SCROLLBACK }) : offlineBanner(w.info);
    return { data, cols: w.info.cols, rows: w.info.rows };
  }

  detach(id: string, clientId: string) {
    const w = this.workers.get(id);
    if (!w) return;
    if (w.viewers.delete(clientId) && this.syncViewers(w)) this.emitUpdate(w);
  }

  detachAll(clientId: string) {
    for (const w of this.workers.values()) {
      if (w.viewers.delete(clientId) && this.syncViewers(w)) this.emitUpdate(w);
    }
  }

  write(id: string, data: string) {
    const w = this.workers.get(id);
    if (!w?.pty) return;
    w.pty.write(data);
    if (w.info.status === 'needs_input' && w.info.acked === false) {
      w.info.acked = true;
      this.emitUpdate(w);
    }
  }

  /** Types a prompt into the agent's input box and submits it. */
  prompt(id: string, text: string): string | undefined {
    const w = this.workers.get(id);
    if (!w) return 'No such worker';
    if (!w.pty) return 'Worker is not running';
    const clean = text.replace(/\r\n?/g, '\n').trim();
    if (!clean) return 'Empty prompt';
    // Bracketed paste keeps multi-line prompts in one message, then Enter submits.
    w.pty.write(`\x1b[200~${clean}\x1b[201~`);
    setTimeout(() => w.pty?.write('\r'), 120);
    w.info.activity = truncate(clean, 80);
    this.emitUpdate(w);
    return undefined;
  }

  resize(id: string, cols: number, rows: number) {
    const w = this.workers.get(id);
    if (!w?.pty || !w.term) return;
    cols = clamp(Math.floor(cols), 20, 400);
    rows = clamp(Math.floor(rows), 5, 200);
    if (cols === w.info.cols && rows === w.info.rows) return;
    w.info.cols = cols;
    w.info.rows = rows;
    try {
      w.pty.resize(cols, rows);
      w.term.resize(cols, rows);
    } catch {
      // pty may have exited between checks
    }
    w.screenDirty = true;
    w.lastLines = [];
    this.emitUpdate(w);
  }

  /** Claude Code hook callback. */
  handleHook(workerId: string, token: string, event: string, payload: any): boolean {
    const w = this.workers.get(workerId);
    if (!w || !safeEq(token, w.hookToken)) return false;
    const now = Date.now();
    if (payload?.session_id && typeof payload.session_id === 'string' && payload.session_id !== w.info.sessionId) {
      w.info.sessionId = payload.session_id;
      this.persist();
    }
    switch (event) {
      case 'SessionStart':
        if (w.info.status === 'starting') this.setStatus(w, 'idle');
        break;
      case 'UserPromptSubmit':
        if (typeof payload?.prompt === 'string') w.info.activity = truncate(payload.prompt, 80);
        this.setStatus(w, 'working');
        break;
      case 'PreToolUse':
        if (payload?.tool_name === 'AskUserQuestion') this.setStatus(w, 'needs_input');
        else {
          w.info.activity = describeTool(payload);
          if (w.info.status !== 'working') this.setStatus(w, 'working');
          else this.emitUpdate(w);
        }
        break;
      case 'PostToolUse':
        if (w.info.status === 'needs_input') {
          w.leftNeedsInputAt = now;
          this.setStatus(w, 'working');
        }
        break;
      case 'PermissionRequest':
        w.info.activity = `Wants permission: ${describeTool(payload)}`;
        this.setStatus(w, 'needs_input');
        break;
      case 'Notification':
        if (payload?.notification_type === 'permission_prompt') {
          if (now - w.leftNeedsInputAt > LATE_PROMPT_GRACE_MS) this.setStatus(w, 'needs_input');
        } else if (payload?.notification_type === 'idle_prompt') {
          if (w.info.status === 'working') this.setStatus(w, 'done');
        }
        break;
      case 'Stop':
        this.setStatus(w, 'done');
        break;
    }
    return true;
  }

  shutdown() {
    clearInterval(this.screenTimer);
    for (const w of this.workers.values()) {
      try {
        w.pty?.kill();
      } catch {
        // ignore
      }
    }
    this.persist();
  }

  // ---------------------------------------------------------------------------

  private launch(w: Worker, prompt: string | undefined, resumeSessionId: string | undefined) {
    const { info } = w;
    const term = new headless.Terminal({ cols: info.cols, rows: info.rows, scrollback: SCROLLBACK, allowProposedApi: true });
    const ser = new serialize.SerializeAddon();
    term.loadAddon(ser as any);
    // OSC 9;4 progress (Claude Code emits it): 0 = idle, anything else = busy. Catches Esc-cancel,
    // which fires no Stop hook.
    term.parser.registerOscHandler(9, (data: string) => {
      const m = /^4;(\d)/.exec(data);
      if (m) this.onProgress(w, m[1] !== '0');
      return true;
    });
    term.onTitleChange((title: string) => {
      const clean = title.replace(/^[^\p{L}\p{N}]+/u, '').trim();
      if (clean && clean !== info.title && !/^claude( code)?$/i.test(clean)) {
        info.title = clean;
        this.emitUpdate(w);
      }
    });
    w.term?.dispose();
    w.term = term;
    w.ser = ser;
    w.lastLines = [];
    w.screenDirty = true;

    const isClaude = /(^|\/)claude$/.test(this.agentCmd);
    const args = [...this.agentArgs];
    if (isClaude) {
      args.unshift('--settings', this.settingsPath);
      if (resumeSessionId) args.push('--resume', resumeSessionId);
      if (prompt) args.push(prompt);
    }
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !scrubbed(k)) env[k] = v;
    Object.assign(env, {
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      AGENT_OFFICE_WORKER_ID: info.id,
      AGENT_OFFICE_HOOK_URL: this.hook.url,
      AGENT_OFFICE_HOOK_TOKEN: w.hookToken,
    });

    let proc: pty.IPty;
    try {
      const bin = this.agentPath ?? this.agentCmd;
      if (this.agentPath) {
        proc = pty.spawn(bin, args, { name: 'xterm-256color', cols: info.cols, rows: info.rows, cwd: this.dir, env });
      } else {
        // Not found on PATH: let a login shell find it (nvm, asdf, ~/.local/bin ...).
        const shell = process.env.SHELL || '/bin/bash';
        const line = ['exec', this.agentCmd, ...args].map((a, i) => (i < 2 ? a : shq(a))).join(' ');
        proc = pty.spawn(shell, ['-l', '-i', '-c', line], { name: 'xterm-256color', cols: info.cols, rows: info.rows, cwd: this.dir, env });
      }
    } catch (err) {
      info.status = 'exited';
      info.exitCode = -1;
      term.write(`\r\n\x1b[31mFailed to start ${this.agentCmd}: ${(err as Error).message}\x1b[0m\r\n`);
      this.events.toast(`Could not start ${this.agentCmd}: ${(err as Error).message}`, 'error');
      this.emitUpdate(w);
      return;
    }
    w.pty = proc;
    if (!isClaude) info.status = 'idle';

    proc.onData((data) => {
      term.write(data);
      w.screenDirty = true;
      if (w.viewers.size) this.events.data(info.id, data, [...w.viewers.keys()]);
    });
    proc.onExit(({ exitCode }) => {
      if (w.pty !== proc) return;
      w.pty = undefined;
      info.exitCode = exitCode;
      info.status = 'exited';
      const msg = `\r\n\x1b[2m[${info.name} exited with code ${exitCode}${info.sessionId ? ' — press R to resume' : ''}]\x1b[0m\r\n`;
      term.write(msg);
      if (w.viewers.size) this.events.data(info.id, msg, [...w.viewers.keys()]);
      w.screenDirty = true;
      this.emitUpdate(w);
      this.persist();
    });
    // If hooks never fire (non-claude agent or old version), don't sit in "starting" forever.
    setTimeout(() => {
      if (info.status === 'starting' && w.pty === proc) this.setStatus(w, 'idle');
    }, 8000);
    this.emitUpdate(w);
  }

  private onProgress(w: Worker, busy: boolean) {
    const s = w.info.status;
    if (busy && (s === 'idle' || s === 'done' || s === 'starting')) this.setStatus(w, 'working');
    else if (!busy && s === 'working') this.setStatus(w, 'done');
  }

  private setStatus(w: Worker, status: WorkerStatus) {
    if (w.info.status === status) return;
    if (w.info.status === 'needs_input') w.leftNeedsInputAt = Date.now();
    w.info.status = status;
    // Nobody is looking at the terminal right now -> raise the flag (the worker jumps).
    if (status === 'done' || status === 'needs_input') w.info.acked = w.viewers.size > 0 && status === 'done';
    else w.info.acked = true;
    this.emitUpdate(w);
  }

  private syncViewers(w: Worker): boolean {
    const names = [...new Set(w.viewers.values())];
    const same = names.length === w.info.viewers.length && names.every((n, i) => n === w.info.viewers[i]);
    if (same) return false;
    w.info.viewers = names;
    return true;
  }

  private emitUpdate(w: Worker) {
    this.events.update({ ...w.info });
  }

  private flushScreens() {
    for (const w of this.workers.values()) {
      if (!w.screenDirty || !w.term) continue;
      w.screenDirty = false;
      const frame = snapshotScreen(w.term, w.lastLines);
      if (frame) this.events.screen(w.info.id, frame);
    }
  }

  private writeHookSettings() {
    const events: [string, string | undefined][] = [
      ['SessionStart', undefined],
      ['UserPromptSubmit', undefined],
      ['Stop', undefined],
      ['Notification', undefined],
      ['PermissionRequest', undefined],
      ['PreToolUse', undefined],
      ['PostToolUse', undefined],
    ];
    const hooks: Record<string, unknown[]> = {};
    for (const [event, matcher] of events) {
      const command =
        `if [ -z "$AGENT_OFFICE_WORKER_ID" ] || [ -z "$AGENT_OFFICE_HOOK_URL" ]; then exit 0; fi; ` +
        `curl -sS -m 3 -X POST -H "Authorization: Bearer $AGENT_OFFICE_HOOK_TOKEN" -H "Content-Type: application/json" ` +
        `--data-binary @- "$AGENT_OFFICE_HOOK_URL/hooks/claude?worker=$AGENT_OFFICE_WORKER_ID&event=${event}" >/dev/null 2>&1 || true`;
      hooks[event] = [{ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command }] }];
    }
    writeFileSync(this.settingsPath, JSON.stringify({ hooks }, null, 2), { mode: 0o600 });
  }

  private persist() {
    const saved = [...this.workers.values()].map(({ info }) => ({
      id: info.id,
      deskId: info.deskId,
      name: info.name,
      color: info.color,
      createdBy: info.createdBy,
      createdAt: info.createdAt,
      prompt: info.prompt,
      title: info.title,
      sessionId: info.sessionId,
      activity: info.activity,
    }));
    try {
      writeFileSync(this.statePath, JSON.stringify(saved, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }

  private restore() {
    if (!existsSync(this.statePath)) return;
    try {
      const saved = JSON.parse(readFileSync(this.statePath, 'utf8')) as Partial<WorkerInfo>[];
      for (const s of saved) {
        if (!s.id || !s.deskId || !DESK_BY_ID.has(s.deskId) || this.deskOccupied(s.deskId)) continue;
        const info: WorkerInfo = {
          id: s.id,
          deskId: s.deskId,
          name: s.name ?? 'Worker',
          color: s.color ?? COLORS[0],
          status: 'offline',
          acked: true,
          createdBy: s.createdBy ?? '?',
          createdAt: s.createdAt ?? Date.now(),
          prompt: s.prompt,
          title: s.title,
          sessionId: s.sessionId,
          activity: s.activity,
          cols: 100,
          rows: 30,
          viewers: [],
        };
        this.workers.set(info.id, { info, viewers: new Map(), screenDirty: false, lastLines: [], leftNeedsInputAt: 0, hookToken: randomBytes(16).toString('hex') });
      }
    } catch {
      // corrupt state file: start fresh
    }
  }
}

// ---------------------------------------------------------------------------

function snapshotScreen(term: HeadlessTerminal, last: string[]) {
  const buf = term.buffer.active;
  const cols = term.cols;
  const rows = term.rows;
  const full = last.length !== rows;
  const lines: Record<number, Run[]> = {};
  let changed = false;
  const cell = buf.getNullCell();
  for (let y = 0; y < rows; y++) {
    const line = buf.getLine(buf.viewportY + y);
    const runs: Run[] = [];
    if (line) {
      let cur: Run | null = null;
      for (let x = 0; x < cols; x++) {
        line.getCell(x, cell);
        const width = cell.getWidth();
        if (width === 0) continue;
        const ch = cell.getChars() || ' ';
        const fg = cell.isFgDefault() ? -1 : cell.isFgRGB() ? RGB_FLAG | cell.getFgColor() : cell.getFgColor();
        const bg = cell.isBgDefault() ? -1 : cell.isBgRGB() ? RGB_FLAG | cell.getBgColor() : cell.getBgColor();
        const flags = (cell.isBold() ? FLAG_BOLD : 0) | (cell.isInverse() ? FLAG_INVERSE : 0) | (cell.isDim() ? FLAG_DIM : 0);
        if (cur && cur[1] === fg && cur[2] === bg && cur[3] === flags) cur[0] += ch;
        else {
          cur = [ch, fg, bg, flags];
          runs.push(cur);
        }
      }
    }
    // Trim trailing default-styled whitespace to keep frames small.
    while (runs.length) {
      const r = runs[runs.length - 1];
      if (r[2] !== -1 || r[3] & FLAG_INVERSE) break;
      const trimmed = r[0].replace(/\s+$/, '');
      if (trimmed) {
        r[0] = trimmed;
        break;
      }
      runs.pop();
    }
    const key = JSON.stringify(runs);
    if (full || last[y] !== key) {
      lines[y] = runs;
      last[y] = key;
      changed = true;
    }
  }
  last.length = rows;
  if (!changed) return null;
  return { cols, rows, lines, full, cursor: [buf.cursorX, buf.cursorY] as [number, number] };
}

function resolveCommand(cmd: string): string | null {
  if (cmd.includes('/')) {
    try {
      accessSync(cmd, constants.X_OK);
      return path.resolve(cmd);
    } catch {
      return null;
    }
  }
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, cmd);
    try {
      accessSync(p, constants.X_OK);
      return p;
    } catch {
      // keep looking
    }
  }
  try {
    const shell = process.env.SHELL || '/bin/bash';
    const found = execFileSync(shell, ['-l', '-i', '-c', `command -v ${shq(cmd)}`], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })
      .trim()
      .split('\n')
      .pop();
    if (found && found.startsWith('/')) return found;
  } catch {
    // fall through
  }
  return null;
}

function describeTool(payload: any): string {
  const name = payload?.tool_name ?? 'tool';
  const input = payload?.tool_input ?? {};
  const detail = input.command ?? input.file_path ?? input.pattern ?? input.url ?? input.description ?? '';
  return truncate(detail ? `${name}: ${detail}` : String(name), 80);
}

function offlineBanner(info: WorkerInfo): string {
  return `\x1b[2m${info.name} is not running.${info.sessionId ? ' Press R to resume the session.' : ''}\x1b[0m\r\n`;
}

function truncate(s: string, n: number) {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function shq(s: string) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function safeEq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
