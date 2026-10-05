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

/** The threads the browser kept, or none (private mode, or nothing sent yet). */
export function loadThreads(): Record<string, SmsMsg[]> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(THREAD_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, SmsMsg[]>;
    const out: Record<string, SmsMsg[]> = {};
    for (const [k, v] of Object.entries(parsed)) if (Array.isArray(v)) out[k] = v.slice(-MAX_THREAD);
    return out;
  } catch {
    return {};
  }
}

/** Keeps the threads in the browser. Never throws (private mode just doesn't keep them). */
export function saveThreads(threads: Record<string, SmsMsg[]>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(THREAD_KEY, JSON.stringify(threads));
  } catch {
    // storage blocked or full: the threads still last the session
  }
}
