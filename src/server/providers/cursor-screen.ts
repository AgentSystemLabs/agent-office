import type { WorkerHandle } from '../workers/types.js';

// Hooks remain authoritative. This repairs a missed Stop only after Cursor's actual empty
// follow-up composer and footer have stayed unchanged through another screen observation.
const QUIET_MS = 6000;
const candidates = new WeakMap<object, { text: string; key: string; since: number }>();

export function cursorAtFollowup(text: string): boolean {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  let at = -1;
  lines.forEach((line, i) => { if (/^→\s+Add a follow-up$/.test(line)) at = i; });
  if (at < 0) return false;
  const tail = lines.slice(at + 1);
  // Only the footer may follow the empty composer, never tool output, a typed prompt or a spinner.
  if (tail.length < 2 || tail.length > 4) return false;
  if (!/^.+\s·\s[\d.]+%\s·\s.*Run Everything\s*$/.test(tail[0])) return false;
  return /^(?:~[\\/]|[A-Za-z]:[\\/]|\/)/.test(tail[1]) &&
    !/\b(?:esc to|thinking|running|allow|approve|permission)\b/i.test(tail.slice(1).join(' '));
}

/** A fresh lifecycle event invalidates the old idle frame, including a new prompt before repaint. */
export function resetCursorScreen(h: WorkerHandle): void {
  candidates.delete(h);
}

export function reconcileCursorScreen(h: WorkerHandle, text: string, now = Date.now()): void {
  const info = h.info;
  if (!h.running || info.status !== 'working' || !info.sessionId || !cursorAtFollowup(text)) {
    candidates.delete(h);
    return;
  }
  const key = `${info.sessionId}:${info.workingSince}:${info.lastInput?.at}`;
  const previous = candidates.get(h);
  if (!previous || previous.text !== text || previous.key !== key) {
    candidates.set(h, { text, key, since: now });
    return;
  }
  if (now - previous.since < QUIET_MS) return;
  candidates.delete(h);
  h.setStatus('done');
  h.emit();
  h.persist();
}
