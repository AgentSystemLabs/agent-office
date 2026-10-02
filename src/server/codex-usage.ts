import { closeSync, constants, fstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Usage } from '../shared/protocol.js';

const TAIL_BYTES = 4 * 1024 * 1024;
const HEADER_BYTES = 1024 * 1024;
const count = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

/** Keep the provider total; split cache reads and reasoning from their parent counters. */
export function codexTokenUsage(value: unknown): Usage | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as Record<string, unknown>;
  const { input_tokens: input, output_tokens: output, cached_input_tokens: cache, reasoning_output_tokens: reasoning, total_tokens: total } = v;
  const cacheWrite = v.cache_write_input_tokens ?? 0;
  if (![input, output, cache, reasoning, total, cacheWrite].every(count)) return;
  const i = input as number, o = output as number, c = cache as number, r = reasoning as number, cw = cacheWrite as number;
  if (c > i || r > o || !Number.isSafeInteger(i + o)) return;
  // Codex can emit synthetic context-window-only snapshots on error. Keep their reported
  // total, but make the incomplete breakdown explicit instead of treating it as billed usage.
  return { input: i - c, output: o - r, reasoning: r, cacheRead: c, cacheWrite: cw, totalTokens: total as number,
    cost: 0, costKnown: false, calls: 0, callsKnown: false, ...(total !== i + o ? { incomplete: true } : {}) };
}

/**
 * Read only the explicitly hooked root rollout, never enumerate other conversations. Bounds both
 * memory and I/O; cumulative counters let a tail read recover totals without replaying messages.
 * Rollout formats are not a stable API: unknown records fail closed instead of inventing usage.
 */
export class CodexUsageReader {
  private stamp = '';
  private identity = '';
  private position = 0;
  private header: Buffer = Buffer.alloc(0);
  private anchor: Buffer = Buffer.alloc(0);
  private partial: Buffer = Buffer.alloc(0);
  private skipping = false;
  private latest?: Usage;

  read(file: string, sessionId: string, home: string): Usage | undefined {
    let fd: number | undefined;
    try {
      if (!path.isAbsolute(file) || !/^[a-zA-Z0-9-]{1,160}$/.test(sessionId)) return;
      const root = realpathSync(home);
      const target = realpathSync(file);
      const relative = path.relative(root, target).split(path.sep);
      if (!['sessions', 'archived_sessions'].includes(relative[0]) || relative.includes('..')) return;
      if (!path.basename(target).endsWith(`-${sessionId}.jsonl`)) return;
      fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = fstatSync(fd);
      const current = statSync(target);
      if (!stat.isFile() || stat.dev !== current.dev || stat.ino !== current.ino || realpathSync(file) !== target || realpathSync(home) !== root) return;
      const identity = `${root}:${target}:${sessionId}:${stat.dev}:${stat.ino}`;
      const stamp = `${identity}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
      // Revalidate metadata even on growth of the same inode; an in-place rewrite can change owners.
      const header = readAt(fd, 0, identity === this.identity && this.header.length ? this.header.length : Math.min(stat.size, HEADER_BYTES));
      const end = header.indexOf(10);
      if (end < 0 || !matchesSession(header.subarray(0, end), sessionId)) { this.reset(); return; }
      if (stamp === this.stamp) return;
      const anchor = this.position >= this.anchor.length ? readAt(fd, this.position - this.anchor.length, this.anchor.length) : Buffer.alloc(0);
      const append = identity === this.identity && stat.size > this.position &&
        header.subarray(0, end + 1).equals(this.header) && anchor.equals(this.anchor) && stat.size - this.position <= TAIL_BYTES;
      let start = this.position;
      if (!append) {
        this.reset();
        start = Math.max(end + 1, stat.size - TAIL_BYTES);
        this.skipping = start > end + 1; // Tail begins in an arbitrary, possibly oversized record.
      }
      const data = readAt(fd, start, Math.min(stat.size - start, TAIL_BYTES));
      this.consume(data);
      this.identity = identity;
      this.header = Buffer.from(header.subarray(0, end + 1));
      this.position = start + data.length;
      this.anchor = readAt(fd, Math.max(0, this.position - 256), Math.min(256, this.position));
      // A concurrently modified file is retried from a fresh bootstrap on the next scan.
      const after = fstatSync(fd);
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) {
        this.reset(); return;
      }
      this.stamp = stamp;
      return this.latest;
    } catch {
      this.reset();
      // Malformed, mismatched and inaccessible files never contribute invented usage.
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }

  private reset() {
    this.stamp = this.identity = '';
    this.position = 0;
    this.header = this.anchor = this.partial = Buffer.alloc(0);
    this.skipping = false;
    this.latest = undefined;
  }

  /** Complete append records only; discard oversized records through their terminating newline. */
  private consume(data: Buffer) {
    let start = 0;
    while (start < data.length) {
      const newline = data.indexOf(10, start);
      const end = newline < 0 ? data.length : newline;
      const part = data.subarray(start, end);
      if (!this.skipping && this.partial.length + part.length <= HEADER_BYTES) {
        this.partial = Buffer.concat([this.partial, part]);
      } else { this.partial = Buffer.alloc(0); this.skipping = true; }
      if (newline < 0) return;
      if (!this.skipping) {
        const usage = usageRecord(this.partial);
        if (usage) this.latest = usage;
      }
      this.partial = Buffer.alloc(0);
      this.skipping = false;
      start = newline + 1;
    }
  }
}

function readAt(fd: number, offset: number, length: number): Buffer {
  const bytes = Buffer.alloc(length);
  return bytes.subarray(0, readSync(fd, bytes, 0, length, offset));
}
function record(bytes: Buffer): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* Partial or unknown records are ignored. */ }
}
function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function matchesSession(bytes: Buffer, sessionId: string): boolean {
  const row = record(bytes);
  return row?.type === 'session_meta' && object(row.payload)?.id === sessionId;
}
function usageRecord(bytes: Buffer): Usage | undefined {
  if (!bytes.includes('"token_count"')) return;
  const row = record(bytes);
  const payload = object(row?.payload);
  if (row?.type === 'event_msg' && payload?.type === 'token_count') return codexTokenUsage(object(payload.info)?.total_token_usage);
}
