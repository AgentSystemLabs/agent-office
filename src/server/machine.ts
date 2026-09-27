import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { MachineState } from '../shared/protocol.js';

/** How often the CPU and memory are read. */
const SAMPLE_MS = 5_000;
/** How many readings the wall monitor graphs: the last five minutes. */
const HISTORY = 60;
/** Memory this full, or the CPU this busy over the last CPU_WINDOW readings (30 s), is a machine under pressure. */
const MEM_PRESSURE = 90;
const CPU_PRESSURE = 90;
const CPU_WINDOW = 6;
/** The highest worker limit there is: past this it isn't a limit. */
export const MAX_WORKER_LIMIT = 500;

/** What hiring asks of the office's machine: whether it can take one more worker. */
export interface Capacity {
  /** Why the office can't take another worker (it's at its worker limit), if it can't. */
  full(): string | undefined;
  /** How many more workers it has room for: Infinity with no limit, below 0 once it's over. */
  room(): number;
}

interface Saved {
  limit: number;
  by: string;
  at: number;
}

/** A worker limit as given: a whole number from 1 to MAX_WORKER_LIMIT, or undefined when it isn't one. */
export function parseWorkerLimit(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v.trim()) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_WORKER_LIMIT ? n : undefined;
}

/** Every core's busy and idle time so far; two of these a few seconds apart give how busy it was. */
function cpuTimes(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.irq + c.times.idle;
  }
  return { idle, total };
}

/**
 * Memory the machine can still hand out, in bytes. On Linux os.freemem() is MemAvailable and on
 * Windows the available physical memory, but on macOS it counts only pages that were never used: a
 * few hundred MB on a Mac with half its memory to spare. There the kernel's own "memory free" level
 * (what `memory_pressure` prints) is the honest figure.
 */
function availableMemory(): Promise<number> {
  if (process.platform !== 'darwin') return Promise.resolve(os.freemem());
  return new Promise((resolve) => {
    execFile('sysctl', ['-n', 'kern.memorystatus_level'], { timeout: 2000 }, (err, out) => {
      const level = Number(String(out).trim());
      resolve(!err && Number.isFinite(level) && level >= 0 && level <= 100 ? (os.totalmem() * level) / 100 : os.freemem());
    });
  });
}

/**
 * The machine the office runs on: how busy its CPU and memory are (for the monitor on the wall, and
 * a warning before hiring while it's under pressure), and the most workers the office runs at once,
 * across every floor. That limit comes from --max-workers, or from ⚙️ Settings (kept in
 * .agent-office/machine.json), which can lower it but never raise it past --max-workers.
 */
export class Machine implements Capacity {
  private saved?: Saved;
  private path: string;
  private timer?: NodeJS.Timeout;
  private last = cpuTimes();
  private cpu = 0;
  private memUsed = 0;
  private history: [number, number][] = [];
  /** The worker count everyone was last told. */
  private told = -1;

  constructor(
    dataDir: string,
    /** --max-workers. */
    private ceiling: number | undefined,
    /** How many workers the office has now, on every floor. */
    private count: () => number,
    private onState: (state: MachineState) => void,
  ) {
    this.path = path.join(dataDir, 'machine.json');
    this.restore();
    this.memUsed = os.totalmem() - os.freemem();
  }

  start() {
    // The memory now; the CPU takes two readings a while apart.
    this.last = cpuTimes();
    void this.sample(false);
    this.timer = setInterval(() => void this.sample(), SAMPLE_MS);
    this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
  }

  /** The most workers the office takes, or undefined for no limit. */
  get limit(): number | undefined {
    const set = this.saved?.limit;
    if (set === undefined) return this.ceiling;
    return this.ceiling === undefined ? set : Math.min(set, this.ceiling);
  }

  room(): number {
    const limit = this.limit;
    return limit === undefined ? Infinity : limit - this.count();
  }

  full(): string | undefined {
    const limit = this.limit;
    if (limit === undefined || this.count() < limit) return undefined;
    return `The office is at its limit of ${limit} worker${limit === 1 ? '' : 's'} on this machine — send one home before hiring another`;
  }

  state(): MachineState {
    const memTotal = os.totalmem();
    return {
      cpu: this.cpu,
      cores: os.cpus().length,
      memUsed: this.memUsed,
      memTotal,
      history: this.history.slice(),
      pressure: this.pressure(memTotal),
      workers: this.count(),
      limit: this.limit,
      ceiling: this.ceiling,
      set: this.saved && { ...this.saved },
    };
  }

  /** Sets the limit from ⚙️ Settings (undefined takes it off). Returns why it can't, if it can't. */
  setLimit(limit: number | undefined, by: string): string | undefined {
    if (limit !== undefined && this.ceiling !== undefined && limit > this.ceiling) {
      return `The office was started with --max-workers ${this.ceiling}, so the limit can't go above ${this.ceiling}`;
    }
    this.saved = limit === undefined ? undefined : { limit, by, at: Date.now() };
    this.persist();
    this.emit();
    return undefined;
  }

  /** A worker came, went or changed: when that moved the count, everyone hears the new one. */
  workersChanged() {
    if (this.count() !== this.told) this.emit();
  }

  private pressure(memTotal: number): string | undefined {
    const why: string[] = [];
    const mem = memTotal ? Math.round((this.memUsed / memTotal) * 100) : 0;
    if (mem >= MEM_PRESSURE) why.push(`memory is ${mem}% used`);
    // Busy for a while, not a single build step.
    const recent = this.history.slice(-CPU_WINDOW);
    if (recent.length === CPU_WINDOW) {
      const cpu = Math.round(recent.reduce((n, [c]) => n + c, 0) / recent.length);
      if (cpu >= CPU_PRESSURE) why.push(`the CPU has been ${cpu}% busy for the last ${(CPU_WINDOW * SAMPLE_MS) / 1000} seconds`);
    }
    return why.length ? why.join(' and ') : undefined;
  }

  private async sample(cpu = true) {
    if (cpu) {
      const now = cpuTimes();
      const total = now.total - this.last.total;
      if (total > 0) this.cpu = Math.max(0, Math.min(100, Math.round((1 - (now.idle - this.last.idle) / total) * 100)));
      this.last = now;
    }
    const memTotal = os.totalmem();
    this.memUsed = Math.max(0, memTotal - (await availableMemory()));
    if (cpu) {
      this.history.push([this.cpu, memTotal ? Math.round((this.memUsed / memTotal) * 100) : 0]);
      if (this.history.length > HISTORY) this.history.shift();
    }
    this.emit();
  }

  private emit() {
    const state = this.state();
    this.told = state.workers;
    this.onState(state);
  }

  private restore() {
    try {
      const s = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<Saved>;
      const limit = parseWorkerLimit(s.limit);
      if (limit !== undefined) this.saved = { limit, by: typeof s.by === 'string' ? s.by : 'someone', at: typeof s.at === 'number' ? s.at : 0 };
    } catch {
      // never set
    }
  }

  private persist() {
    try {
      writeFileSync(this.path, JSON.stringify(this.saved ?? {}, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}
