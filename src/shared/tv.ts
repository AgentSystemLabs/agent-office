// The big TV on the lounge's east wall: the link on it and how far into it everyone is, shared by
// the server (one per floor, kept in .agent-office/tv.json) and the browser, which plays the link
// itself (see client/tvscreen.ts). Same idea as the jukebox in shared/jukebox.ts, with pause, seek
// and a link instead of a tune.

export interface TvState {
  /** Whether something is meant to be on: a link on the screen, playing or paused. */
  on: boolean;
  /** The link on it. Kept when it's turned off, so Play puts the same one back. */
  url?: string;
  /** Who last put something on, paused, seeked or turned it off. */
  by?: string;
  /** Running rather than paused. */
  playing: boolean;
  /** How far into the video it was, in seconds, at `at`. */
  position: number;
  /** When that was true, on the office's clock (see the 'pong' message). */
  at: number;
}

/** The TV in a building with no floors, or on a floor nobody has put anything on. */
export const TV_OFF: TvState = { on: false, playing: false, position: 0, at: 0 };

/** How a link gets played: through YouTube's player, as a plain media file, or in an iframe. */
export type TvKind = 'youtube' | 'media' | 'embed';

/** The extensions the office hands to a `<video>` rather than an `<iframe>`. */
const MEDIA = /\.(mp4|m4v|mov|webm|og[gv]|mp3|wav|m4a|aac|flac|m3u8|mpd)(?:$|[?#])/i;

/** Seconds into the video the TV is meant to be at `now` on the office's clock. */
export function positionAt(s: Pick<TvState, 'playing' | 'position' | 'at'>, now: number): number {
  return Math.max(0, s.position + (s.playing ? (now - s.at) / 1000 : 0));
}

/**
 * A link fit to put on the TV. Only web links, and (when `self` is this office's origin, which the
 * browser passes and the server can't know) not a page of the office itself: a page framed in its
 * own origin would reach straight out of the screen to the page it's hanging on.
 */
export function checkTvUrl(raw: unknown, self?: string): { url: string } | { error: string } {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return { error: 'Paste a link to a video' };
  if (s.length > 2048) return { error: 'That link is too long' };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { error: "That isn't a web link. Paste an address that starts with https://" };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'Only http and https links can play on the TV' };
  if (self && u.origin === self) return { error: "That's this office itself — pick a video from the web" };
  return { url: u.href };
}

/** Whether `host` (or a subdomain of it) is `name`. */
function hostIs(host: string, name: string): boolean {
  return host === name || host.endsWith(`.${name}`);
}

/**
 * The video id out of a YouTube link, from `watch?v=`, `youtu.be/`, `/shorts/`, `/live/` or
 * `/embed/`. The player needs it by itself (see client/tvscreen.ts); `embedUrl` builds the link.
 */
export function youtubeId(url: string | URL): string | undefined {
  let u: URL;
  try {
    u = typeof url === 'string' ? new URL(url) : url;
  } catch {
    return undefined;
  }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  if (hostIs(host, 'youtu.be')) return u.pathname.split('/').filter(Boolean)[0] || undefined;
  const fromPath = u.pathname.split('/').filter(Boolean);
  if (fromPath.length >= 2 && ['embed', 'shorts', 'live', 'v'].includes(fromPath[0].toLowerCase())) return fromPath[1];
  return u.searchParams.get('v') ?? undefined;
}

/** How a link is played: YouTube's player, a `<video>`, or an iframe with whatever the site offers. */
export function classify(url: string): TvKind {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'embed';
  }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  if (hostIs(host, 'youtube.com') || hostIs(host, 'youtube-nocookie.com') || hostIs(host, 'youtu.be')) return 'youtube';
  if (MEDIA.test(u.pathname + u.search)) return 'media';
  return 'embed';
}

/** `1h2m3s`, `90`, `1:23:45` or `02:03` in a link's `t=`/`start=`, as seconds. */
function stamp(v: string | null): number {
  if (!v) return 0;
  const clock = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(v);
  if (clock) return (Number(clock[1] ?? 0) * 3600) + Number(clock[2]) * 60 + Number(clock[3]);
  const hms = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(v);
  if (hms && (hms[1] || hms[2] || hms[3])) return Number(hms[1] ?? 0) * 3600 + Number(hms[2] ?? 0) * 60 + Number(hms[3] ?? 0);
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Where a link says to start: `t=1h2m3s`, `start=90`, `time_continue=90`. 0 for a link that doesn't. */
export function startSeconds(url: string): number {
  try {
    const u = new URL(url);
    return Math.max(0, stamp(u.searchParams.get('t') ?? u.searchParams.get('start') ?? u.searchParams.get('time_continue')));
  } catch {
    return 0;
  }
}

/**
 * What to load for a link, at `start` seconds in: the embed YouTube lets pages use (its cookieless
 * domain, autoplaying), a direct media URL as it is, Vimeo's player, or the link itself for
 * anything else to frame or refuse to.
 */
export function embedUrl(url: string, start = 0): string {
  const kind = classify(url);
  const at = Math.floor(start);
  try {
    const u = new URL(url);
    if (kind === 'youtube') {
      const id = youtubeId(u);
      const list = u.searchParams.get('list');
      const q = new URLSearchParams({ autoplay: '1', rel: '0', playsinline: '1' });
      if (at > 0) q.set('start', String(at));
      if (id) return `https://www.youtube-nocookie.com/embed/${id}?${q}`;
      if (list) return `https://www.youtube-nocookie.com/playlist?${q}&list=${encodeURIComponent(list)}`;
      return url;
    }
    if (hostIs(u.hostname.replace(/^www\./, '').toLowerCase(), 'vimeo.com')) {
      const id = u.pathname.split('/').filter(Boolean).find((s) => /^\d+$/.test(s));
      if (!id) return url;
      return `https://player.vimeo.com/video/${id}?autoplay=1${at > 0 ? `#t=${at}s` : ''}`;
    }
    return url;
  } catch {
    return url;
  }
}

/** What the TV is showing, for the hint bar and toasts: where the link comes from, and its file. */
export function tvTitle(url: string | undefined): string {
  try {
    const u = new URL(url ?? '');
    const file = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '');
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (hostIs(host, 'youtube.com') || hostIs(host, 'youtube-nocookie.com') || hostIs(host, 'youtu.be')) return 'YouTube';
    if (hostIs(host, 'vimeo.com')) return 'Vimeo';
    return file ? `${u.hostname} · ${file}` : u.hostname;
  } catch {
    return 'A video';
  }
}
