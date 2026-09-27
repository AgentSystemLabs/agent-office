import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
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
      if (!stat.isFile()) return;
      const stamp = `${target}:${sessionId}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
      if (stamp === this.stamp) return;
      const head = Buffer.alloc(Math.min(stat.size, HEADER_BYTES));
      const headBytes = readSync(fd, head, 0, head.length, 0);
      const firstNewline = head.subarray(0, headBytes).indexOf(10);
      if (firstNewline < 0) return;
      const meta = JSON.parse(head.subarray(0, firstNewline).toString('utf8'));
      if (meta.type !== 'session_meta' || meta.payload?.id !== sessionId) return;
      const start = Math.max(0, stat.size - TAIL_BYTES);
      const tail = Buffer.alloc(stat.size - start);
      const bytes = readSync(fd, tail, 0, tail.length, start);
      const text = tail.subarray(0, bytes).toString('utf8');
      const lines = text.split('\n');
      lines.pop(); // A final partial line is retried after the next append.
      if (start) lines.shift();
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].includes('"token_count"')) continue;
        let row;
        try { row = JSON.parse(lines[i]); } catch { continue; }
        if (row.type !== 'event_msg' || row.payload?.type !== 'token_count') continue;
        const usage = codexTokenUsage(row.payload.info?.total_token_usage);
        if (!usage) continue;
        this.stamp = stamp;
        return usage;
      }
    } catch {
      // No data is preferable to exposing malformed, mismatched, or inaccessible files.
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
    return undefined;
  }
}
