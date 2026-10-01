// The office-wide Codex plan meter, read through Codex's local app-server RPC. The CLI owns
// authentication; this reader never opens or forwards its credential files.
import { spawn } from 'node:child_process';
import os from 'node:os';
import type { CodexPlanLimits, PlanWindow } from '../shared/protocol.js';

const POLL_MS = 2 * 60_000;
const NO_PLAN_MS = 20 * 60_000;
const MIN_GAP_MS = 20_000;
const TIMEOUT_MS = 30_000;
const MAX_OUTPUT = 1024 * 1024;

export class CodexPlanLimitsReader {
  private limits: CodexPlanLimits = { windows: [], at: 0, checkedAt: 0, status: 'checking' };
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private lastRead = 0;
  private failures = 0;
  private closed = false;

  constructor(
    private codex: string | null,
    private env: Record<string, string>,
    private wanted: () => boolean,
    private onChange: (limits: CodexPlanLimits) => void,
  ) {
    if (!codex) {
      this.limits = {
        ...this.limits,
        status: 'unavailable',
        checkedAt: Date.now(),
        message: 'Codex CLI is not installed or could not be found on the office host.',
      };
    }
    this.schedule(0);
  }

  get state(): CodexPlanLimits {
    return this.limits;
  }

  refresh() {
    if (this.running || Date.now() - this.lastRead < MIN_GAP_MS) return;
    this.schedule(0);
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
  }

  private schedule(ms: number) {
    if (this.closed || !this.codex) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.read(), ms);
    this.timer.unref();
  }

  private async read() {
    if (this.closed) return;
    if (!this.wanted()) return this.schedule(POLL_MS);
    this.running = true;
    const answer = await askAppServer(this.codex!, this.env);
    this.running = false;
    this.lastRead = Date.now();
    if (this.closed) return;
    if (answer) {
      this.failures = 0;
      this.limits = codexPlanLimits(answer);
      this.onChange(this.limits);
      this.schedule(this.limits.status === 'ready' ? POLL_MS : NO_PLAN_MS);
      return;
    }
    this.failures++;
    this.limits = {
      ...this.limits,
      status: 'unavailable',
      message: 'Codex usage could not be refreshed. Check that Codex is installed and signed in on this computer.',
      checkedAt: this.lastRead,
    };
    this.onChange(this.limits);
    this.schedule(this.failures >= 3 ? NO_PLAN_MS : POLL_MS);
    if (this.failures >= 3) this.failures = 0;
  }
}

/** Convert the Codex app-server response to bounded, display-only percentages. */
export function codexPlanLimits(answer: unknown, now = Date.now()): CodexPlanLimits {
  const payload = answer && typeof answer === 'object' ? answer as Record<string, any> : {};
  const rateLimits = payload.rateLimitsByLimitId?.codex ?? payload.rateLimits;
  if (!rateLimits || typeof rateLimits !== 'object') {
    const plan = typeof payload.planType === 'string' ? payload.planType.slice(0, 24) : undefined;
    return {
      ...(plan ? { plan } : {}),
      windows: [],
      at: 0,
      checkedAt: now,
      status: 'unavailable',
      message: 'No Codex plan usage is available for this sign-in.',
    };
  }
  const windows = [
    toWindow('Current window', rateLimits.primary),
    toWindow('Longer window', rateLimits.secondary),
  ].filter((window): window is PlanWindow => window !== null);
  const plan = typeof (rateLimits.planType ?? payload.planType) === 'string' ? (rateLimits.planType ?? payload.planType).slice(0, 24) : undefined;
  return {
    ...(plan ? { plan } : {}),
    windows,
    at: now,
    checkedAt: now,
    status: windows.length ? 'ready' : 'unavailable',
    ...(windows.length ? {} : { message: 'No Codex usage windows are available for this sign-in.' }),
  };
}

function toWindow(fallbackLabel: string, window: any): PlanWindow | null {
  if (typeof window?.usedPercent !== 'number' || !Number.isFinite(window.usedPercent)) return null;
  const minutes = typeof window.windowDurationMins === 'number' ? window.windowDurationMins : undefined;
  const label = minutes === 300 ? '5-hour' : minutes === 10_080 ? 'Weekly' : minutes ? `${minutes}m` : fallbackLabel;
  const reset = typeof window.resetsAt === 'number' && Number.isFinite(window.resetsAt) ? window.resetsAt * 1000 : undefined;
  return { label, pct: Math.max(0, Math.min(100, window.usedPercent)), ...(reset ? { resetsAt: reset } : {}) };
}

/** Use Codex's own signed-in app server, rather than reading or copying its stored OAuth token. */
function askAppServer(codex: string, env: Record<string, string>): Promise<Record<string, any> | null> {
  return new Promise((resolve) => {
    let settled = false;
    let buffer = '';
    let total = 0;
    let initialized = false;
    const child = spawn(codex, ['app-server', '--listen', 'stdio://'], {
      cwd: os.tmpdir(),
      env,
      shell: process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(codex),
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const finish = (result: Record<string, any> | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
      child.stdin.end();
      const kill = setTimeout(() => child.kill(), 1000);
      kill.unref();
      child.once('close', () => clearTimeout(kill));
    };
    const timeout = setTimeout(() => finish(null), TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      total += Buffer.byteLength(chunk);
      if (total > MAX_OUTPUT) return finish(null);
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message: any;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === 1) {
          if (message.error || initialized) return finish(null);
          initialized = true;
          child.stdin.write('{"method":"initialized","params":{}}\n');
          child.stdin.write('{"method":"account/rateLimits/read","id":2}\n');
        } else if (message.id === 2) {
          finish(message.error ? null : message.result ?? null);
        }
      }
    });
    child.once('error', () => finish(null));
    child.once('close', () => finish(null));
    child.stdin.on('error', () => {});
    child.stdin.write(`${JSON.stringify({
      method: 'initialize',
      id: 1,
      params: { clientInfo: { name: 'agent-office', title: 'Agent Office', version: '0.1.0' } },
    })}\n`);
  });
}
