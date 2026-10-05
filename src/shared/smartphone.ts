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

/** How many messages a thread keeps, and how many lines Recents keeps. */
export const MAX_THREAD = 50;
export const MAX_RECENTS = 20;
/** How many threads are kept, in memory and in the browser: the quietest go first. */
export const MAX_KEYS = 20;
/** The longest SMS kept or sent: the server truncates `worker.prompt` past this (`ws/handlers/workers.ts`). */
export const MAX_SMS_TEXT = 20000;

/** One entry per thread, so sending a text writes one small entry, never the whole map. */
const THREAD_PREFIX = 'agent-office.smartphone.thread:';

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

/** Never a storage key that would mutate a prototype when it becomes an object key. */
function isKeySafe(key: string): boolean {
  return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

/** The newest line's time, for evicting the quietest threads first (computed once per key). */
function latest(thread: SmsMsg[]): number {
  let m = 0;
  for (const x of thread) if (x.at > m) m = x.at;
  return m;
}

/** A stored value as a thread, or null when it isn't one (stale, truncated, or crafted). */
function cleanThread(v: unknown): SmsMsg[] | null {
  if (!Array.isArray(v)) return null;
  const kept = v.filter(isSmsMsg).map((m) => ({ ...m, text: m.text.slice(0, MAX_SMS_TEXT) }));
  return kept.length ? kept.slice(-MAX_THREAD) : null;
}

/** The threads the browser kept, or none (private mode, or nothing sent yet). Whatever is dropped
 * (malformed, unsafe, or past the cap) is forgotten from storage too, so the map stays bounded. */
export function loadThreads(): Record<string, SmsMsg[]> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const names: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(THREAD_PREFIX)) names.push(k);
    }
    const found: [string, SmsMsg[]][] = [];
    const drop: string[] = [];
    for (const storageKey of names) {
      const key = storageKey.slice(THREAD_PREFIX.length);
      let thread: SmsMsg[] | null = null;
      try {
        thread = isKeySafe(key) ? cleanThread(JSON.parse(localStorage.getItem(storageKey) ?? 'null')) : null;
      } catch {
        thread = null;
      }
      if (thread) found.push([key, thread]);
      else drop.push(storageKey);
    }
    // Newest first, so the cap drops the quietest.
    found.sort((a, b) => latest(b[1]) - latest(a[1]));
    for (const [key] of found.slice(MAX_KEYS)) drop.push(THREAD_PREFIX + key);
    for (const k of drop) localStorage.removeItem(k);
    return Object.fromEntries(found.slice(0, MAX_KEYS));
  } catch {
    return {};
  }
}

/** Keeps one thread in the browser: plaintext, like the terminal scrollback the office keeps. Never throws. */
export function saveThread(key: string, thread: SmsMsg[]): void {
  try {
    if (typeof localStorage === 'undefined' || !isKeySafe(key)) return;
    if (!thread.length) localStorage.removeItem(THREAD_PREFIX + key);
    else localStorage.setItem(THREAD_PREFIX + key, JSON.stringify(thread.slice(-MAX_THREAD)));
  } catch {
    // storage blocked or full: the threads still last the session
  }
}

/** Forgets every kept text (kept in this browser only). Never throws. */
export function clearThreads(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const gone: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(THREAD_PREFIX)) gone.push(k);
    }
    for (const k of gone) localStorage.removeItem(k);
  } catch {
    // storage blocked: nothing kept to forget
  }
}

/** The in-memory map kept to the same cap (callers keep the returned map): the quietest go first. */
export function pruneThreadKeys(threads: Record<string, SmsMsg[]>): Record<string, SmsMsg[]> {
  const all = Object.keys(threads);
  const keys = all.filter((k) => isKeySafe(k) && threads[k].length > 0);
  if (keys.length === all.length && keys.length <= MAX_KEYS) return threads;
  const byLatest = new Map(keys.map((k) => [k, latest(threads[k])] as const));
  return Object.fromEntries(keys.sort((a, b) => (byLatest.get(b) ?? 0) - (byLatest.get(a) ?? 0)).slice(0, MAX_KEYS).map((k) => [k, threads[k]]));
}
