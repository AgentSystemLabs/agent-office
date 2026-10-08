// OMP's own session records: where a desk's conversation is, and what it spent (see providers/omp.ts).
// These files are OMP's, not the office's: the same ones a terminal `omp --resume` opens and the ones
// `omp stats` sums. OMP logs one record per assistant response, so totals accumulate as the file grows;
// a scan replaces a worker's numbers from the file rather than adding to them, so reading a file again
// after an office restart cannot double count.
import { closeSync, constants, openSync, readdirSync, readSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Usage } from '../shared/protocol.js';

/** How much of a session file one read takes at a time. */
const CHUNK = 4 * 1024 * 1024;

/** An OMP session id, as OMP itself names one (it goes back on the command line as --resume). */
const SESSION_ID = /^[A-Za-z0-9._-]{1,160}$/;

/** Where OMP keeps everything for a run: $PI_CODING_AGENT_DIR, or ~/.omp/agent (see `omp --help`). */
export function ompAgentDir(cwd: string, env: NodeJS.ProcessEnv): string {
  return path.resolve(cwd, env.PI_CODING_AGENT_DIR || path.join(env.HOME || homedir(), '.omp', 'agent'));
}

/** The session file OMP wrote for `sessionId` in one folder (a project's, or a desk's own). */
export function ompSessionFileIn(dir: string, sessionId: string): string | undefined {
  if (!SESSION_ID.test(sessionId)) return undefined;
  try {
    const name = readdirSync(dir).find((entry) => entry.endsWith(`_${sessionId}.jsonl`));
    return name ? path.join(dir, name) : undefined;
  } catch {
    return undefined;
  }
}

/** The session file OMP wrote for `sessionId`, looked for in each project folder of a sessions tree. */
export function ompSessionFile(sessionsDir: string, sessionId: string): string | undefined {
  if (!SESSION_ID.test(sessionId)) return undefined;
  let folders: string[];
  try {
    folders = readdirSync(sessionsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return undefined;
  }
  for (const folder of folders) {
    const file = ompSessionFileIn(path.join(sessionsDir, folder), sessionId);
    if (file) return file;
  }
  return undefined;
}

/** One field of a parsed record, still data: nothing here is trusted until it is checked. */
function field(value: object, name: string): unknown {
  return name in value ? (value as Record<string, unknown>)[name] : undefined;
}

/** A count OMP reported, or nothing worth counting. */
function tokens(v: unknown): number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0;
}

/** A price OMP reported, or nothing to add when it gave none. */
function usd(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/** What one assistant record reports, when it reports it. */
interface Recorded {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  /** Undefined when the record came without a usable price. */
  cost: number | undefined;
  model: string | undefined;
}

/** The numbers one line of an OMP session reports, when it is an assistant response that reports them. */
function recorded(line: string): Recorded | undefined {
  if (!line.includes('"usage"')) return undefined;
  let row: unknown;
  try {
    row = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!row || typeof row !== 'object') return undefined;
  const message = field(row, 'message');
  if (!message || typeof message !== 'object' || field(message, 'role') !== 'assistant') return undefined;
  const usage = field(message, 'usage');
  if (!usage || typeof usage !== 'object') return undefined;
  const output = tokens(field(usage, 'output'));
  const reasoning = tokens(field(usage, 'reasoningTokens'));
  if (reasoning > output) return undefined; // malformed: never invent tokens
  const cost = field(usage, 'cost');
  const model = field(message, 'model');
  return {
    input: tokens(field(usage, 'input')),
    output: output - reasoning,
    reasoning,
    cacheRead: tokens(field(usage, 'cacheRead')),
    cacheWrite: tokens(field(usage, 'cacheWrite')),
    cost: cost && typeof cost === 'object' ? usd(field(cost, 'total')) : undefined,
    model: typeof model === 'string' && model ? model : undefined,
  };
}

/** The file itself, when it is a `.jsonl` under `root` and not a way out of it. */
function within(root: string, file: string): string | undefined {
  try {
    const base = realpathSync(root);
    const target = realpathSync(file);
    const rel = path.relative(base, target);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return undefined;
    return target.endsWith('.jsonl') ? target : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Follows one OMP session file, read the office's own off the session it started and never another
 * desk's: a file outside `root` is refused, the way Codex's reader refuses one. Nothing here is
 * invented: a record whose numbers don't add up is skipped, and a file that can't be read leaves the
 * numbers as they were.
 */
export class OmpUsageReader {
  private file?: string;
  private offset = 0;
  private spent = { input: 0, output: 0, reasoning: 0, cacheWrite: 0, cacheRead: 0, cost: 0, calls: 0, unpriced: 0 };
  /** The model its latest counted response ran on, as OMP names it. */
  private model?: string;

  /** What the session has spent so far, or undefined when there is nothing readable to say. */
  read(file: string, root: string): Usage | undefined {
    const target = within(root, file);
    if (!target) {
      this.reset();
      return undefined;
    }
    if (target !== this.file) this.reset(target);
    let size: number;
    try {
      size = statSync(target).size;
    } catch {
      this.reset();
      return undefined;
    }
    // Written over under us (a session replaced in place): nothing read so far describes it.
    if (size < this.offset) this.reset(target);
    if (size > this.offset) this.follow(target, size);
    const s = this.spent;
    return {
      input: s.input,
      output: s.output,
      cacheRead: s.cacheRead,
      cacheWrite: s.cacheWrite,
      cost: s.cost,
      calls: s.calls,
      costKnown: s.calls > 0 && s.unpriced === 0,
      ...(s.reasoning ? { reasoning: s.reasoning } : {}),
      ...(this.model ? { model: this.model } : {}),
    };
  }

  private follow(target: string, size: number) {
    let fd: number | undefined;
    try {
      fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      const buf = Buffer.alloc(CHUNK);
      let at = this.offset;
      while (at < size) {
        const got = readSync(fd, buf, 0, Math.min(size - at, CHUNK), at);
        if (got <= 0) break;
        const end = buf.subarray(0, got).lastIndexOf(0x0a);
        if (end < 0) {
          // A line longer than a whole read: nothing in it can be parsed, and it cannot be split.
          if (got < CHUNK) break; // the file ends mid-line: it waits for the rest
          at += got;
          this.offset = at;
          continue;
        }
        for (const line of buf.subarray(0, end).toString('utf8').split('\n')) this.record(line);
        at += end + 1;
        this.offset = at;
      }
    } catch {
      // Unreadable: keep what we have rather than inventing numbers.
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }

  private record(line: string) {
    const r = recorded(line);
    if (!r) return;
    const s = this.spent;
    s.input += r.input;
    s.output += r.output;
    s.reasoning += r.reasoning;
    s.cacheRead += r.cacheRead;
    s.cacheWrite += r.cacheWrite;
    if (r.cost === undefined) s.unpriced += 1;
    else s.cost += r.cost;
    s.calls += 1;
    if (r.model) this.model = r.model;
  }

  private reset(file?: string) {
    this.file = file;
    this.offset = 0;
    this.spent = { input: 0, output: 0, reasoning: 0, cacheWrite: 0, cacheRead: 0, cost: 0, calls: 0, unpriced: 0 };
    this.model = undefined;
  }
}
