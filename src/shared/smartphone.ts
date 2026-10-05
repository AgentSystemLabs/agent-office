// The player's smartphone: SMS threads and recent calls. Pure data and local persistence both the
// browser's slice and the phone UI use; the server never touches it (SMS rides `worker.prompt`).

/** One line in an SMS thread: what you sent, or a note the phone adds itself (never the worker's words). */
export interface SmsMsg {
  dir: 'out' | 'note';
  text: string;
  /** When it was sent, on Date.now()'s clock. */
  at: number;
}

/** One line in Recents: a call you placed or an SMS you sent. */
export interface RecentEntry {
  kind: 'call' | 'sms';
  workerId: string;
  name: string;
  at: number;
}

/** How many messages a thread keeps per worker, and how many lines Recents keeps. */
export const MAX_THREAD = 100;
export const MAX_RECENTS = 20;
/** How many threads are kept in the browser: keys (floor/worker) accumulate, so the count is capped. */
export const MAX_KEYS = 50;
/** The longest SMS kept or sent: the server truncates `worker.prompt` past this (`ws/handlers/workers.ts`). */
export const MAX_SMS_TEXT = 20000;

const THREAD_KEY = 'agent-office.smartphone.threads';

/** Threads by `floor/worker`, so each floor keeps its own conversations. */
export function threadKey(floor: string | null, workerId: string): string {
  return `${floor ?? 'lobby'}/${workerId}`;
}

/** A thread with `text` appended (a line the phone adds itself is a `note`). */
export function appendSms(thread: SmsMsg[] | undefined, text: string, dir: SmsMsg['dir'] = 'out'): SmsMsg[] {
  return [...(thread ?? []), { dir, text, at: Date.now() }].slice(-MAX_THREAD);
}

/** Recents with `entry` on top, one line per worker and kind at most. */
export function logRecent(recents: RecentEntry[], entry: RecentEntry): RecentEntry[] {
  return [entry, ...recents.filter((r) => r.workerId !== entry.workerId || r.kind !== entry.kind)].slice(0, MAX_RECENTS);
}

/** Whether a kept value is a well-formed thread line (stale or crafted storage is dropped, never rendered). */
function isSmsMsg(m: unknown): m is SmsMsg {
  if (typeof m !== 'object' || m === null) return false;
  const o = m as Record<string, unknown>;
  return (o.dir === 'out' || o.dir === 'note') && typeof o.text === 'string' && typeof o.at === 'number';
}

/** The threads the browser kept, or none (private mode, or nothing sent yet). */
export function loadThreads(): Record<string, SmsMsg[]> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(THREAD_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, SmsMsg[]> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (!Array.isArray(v)) continue;
      const kept = v.filter(isSmsMsg).map((m) => ({ ...m, text: m.text.slice(0, MAX_SMS_TEXT) }));
      if (kept.length) out[k] = kept.slice(-MAX_THREAD);
    }
    return out;
  } catch {
    return {};
  }
}

/** Keeps the threads in the browser: plaintext, like the terminal scrollback the office keeps. Never throws (private mode just doesn't keep them). */
export function saveThreads(threads: Record<string, SmsMsg[]>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const keys = Object.keys(threads).filter((k) => (threads[k]?.length ?? 0) > 0);
    let kept = threads;
    if (keys.length > MAX_KEYS) {
      // Evict the threads quietest the longest.
      const latest = (k: string) => threads[k]?.reduce((m, x) => Math.max(m, x.at), 0) ?? 0;
      kept = Object.fromEntries(keys.sort((a, b) => latest(b) - latest(a)).slice(0, MAX_KEYS).map((k) => [k, threads[k]]));
    }
    localStorage.setItem(THREAD_KEY, JSON.stringify(kept));
  } catch {
    // storage blocked or full: the threads still last the session
  }
}
