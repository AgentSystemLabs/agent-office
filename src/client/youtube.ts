/** A YouTube video or playlist a pasted link pointed at. */
export interface YoutubeTarget {
  videoId?: string;
  list?: string;
  start?: number;
}

const VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;
const LIST_ID = /^[A-Za-z0-9_-]{2,80}$/;

/** Seconds from a YouTube `t` or `start` value: `90`, `1m30s`, `1h2m3s`. */
export function parseYoutubeStart(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return Number(raw);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
  if (!m || (!m[1] && !m[2] && !m[3])) return undefined;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/**
 * A pasted YouTube link: watch, youtu.be, shorts, embed, live, or a playlist.
 * A bare 11-character video id works too. Anything else is null.
 */
export function parseYoutubeLink(raw: string): YoutubeTarget | null {
  const text = raw.trim();
  if (!text) return null;
  if (VIDEO_ID.test(text)) return { videoId: text };

  let url: URL;
  try {
    url = new URL(text.includes('://') ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m)\./, '');
  if (host !== 'youtube.com' && host !== 'youtu.be' && host !== 'music.youtube.com' && host !== 'youtube-nocookie.com') return null;

  const start = parseYoutubeStart(url.searchParams.get('t') ?? url.searchParams.get('start'));
  const listRaw = url.searchParams.get('list');
  const list = listRaw && LIST_ID.test(listRaw) ? listRaw : undefined;
  const withList = (videoId?: string): YoutubeTarget | null => {
    if (videoId && !VIDEO_ID.test(videoId)) return null;
    if (!videoId && !list) return null;
    return { videoId, list, start };
  };

  if (host === 'youtu.be') return withList(url.pathname.split('/').filter(Boolean)[0]);

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'watch' || parts[0] === 'playlist') return withList(url.searchParams.get('v') ?? undefined);
  if ((parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live' || parts[0] === 'v') && parts[1]) return withList(parts[1]);
  return withList(undefined);
}

/** 0–100, and a missing or nonsense value is full volume. */
export function clampVolume(n: number): number {
  if (!Number.isFinite(n)) return 100;
  return Math.max(0, Math.min(100, Math.round(n)));
}
