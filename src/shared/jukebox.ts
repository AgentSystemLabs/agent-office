import { type Messages, messages } from './i18n.js';
// The lounge jukebox: the tunes it has and what it's playing, shared by the server (which keeps one
// per floor) and the browser (which synthesizes the tunes, see client/sound/music.ts).

export interface JukeboxTune {
  id: string;
  title: string;
  /** A few words on the card in its list. */
  mood: string;
}

export const JUKEBOX_TUNES: readonly JukeboxTune[] = [
  { id: 'rainy-window', title: 'Rainy Window', mood: 'slow and dreamy' },
  { id: 'coffee-break', title: 'Coffee Break', mood: 'jazzy, easy swing' },
  { id: 'late-commit', title: 'Late Commit', mood: 'minor key, 2 a.m.' },
  { id: 'green-build', title: 'Green Build', mood: 'bright and bouncy' },
];

/** The `track` of a stream someone pasted. */
export const STREAM = 'stream';

export interface JukeboxState {
  on: boolean;
  /** One of JUKEBOX_TUNES, or STREAM for `url`. It stays put while the jukebox is off, to turn back on. */
  track: string;
  /** Internet radio or an audio file someone pasted. */
  url?: string;
  /** Who last put something on, or turned it off. */
  by?: string;
  /** When the track started, on the office's clock (see the 'pong' message), so everyone hears the same bar. */
  startedAt: number;
  /** How far into the track it was when this was sent, in ms, for until the clocks are compared. */
  elapsed: number;
}

export const tuneById = (id: string): JukeboxTune | undefined => JUKEBOX_TUNES.find((t) => t.id === id);

/** What's on, for the hint bar and the jukebox's own display: a tune's title, or where the stream comes from. */
export function trackTitle(s: Pick<JukeboxState, 'track' | 'url'>, m: Messages = messages('en')): string {
  if (s.track !== STREAM) return tuneById(s.track)?.title ?? m.shared.aTune;
  try {
    const u = new URL(s.url ?? '');
    const file = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '');
    return file ? `${u.hostname} · ${file}` : u.hostname;
  } catch {
    return m.shared.aStream;
  }
}

export function checkStreamUrl(raw: unknown, m: Messages = messages('en')): { url: string } | { error: string } {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return { error: m.shared.pasteStream };
  if (s.length > 2048) return { error: m.shared.linkTooLong };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { error: m.shared.notWebLink };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: m.shared.httpJukebox };
  return { url: u.href };
}
