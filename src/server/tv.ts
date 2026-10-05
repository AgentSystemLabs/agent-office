import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { checkTvUrl, positionAt, startSeconds, tvTitle, type TvState } from '../shared/tv.js';

interface Saved {
  on: boolean;
  url?: string;
  by?: string;
  playing: boolean;
  position: number;
  /** When `position` and `playing` were last true, on this machine's clock. */
  at: number;
  /** Whether the room's light is down for the picture (see shared/tv.ts). */
  theatre: boolean;
}

/** A position in seconds, floored into something a video could be at. */
function secs(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(v, 86_400) : fallback;
}

/**
 * The big TV on one floor, saved in .agent-office/tv.json. It says which link, whether it's running
 * and how far in, and whether the room's light is down for the picture; every browser plays the link
 * for itself from the same point (see client/tvscreen.ts), the way the jukebox plays its tunes.
 */
export class Tv {
  private s: Saved = { on: false, playing: false, position: 0, at: Date.now(), theatre: false };
  private file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'tv.json');
    this.load();
  }

  state(): TvState {
    const { on, url, by, playing, position, at, theatre } = this.s;
    return { on, ...(url ? { url } : {}), ...(by ? { by } : {}), playing, position, at, theatre };
  }

  /** What's on, for toasts: where the link comes from, and its file. */
  title(): string {
    return tvTitle(this.s.url);
  }

  /**
   * Puts `url` on (or resumes what's there with neither), from `position` — a link's own timestamp
   * if none was said, else where it had got to. Says whether it can't.
   */
  play(input: { url?: unknown; position?: unknown }, by: string): { changed: boolean } | { error: string } {
    const fromLink = input.url !== undefined && input.url !== '';
    let url = this.s.url;
    if (fromLink) {
      const u = checkTvUrl(input.url);
      if ('error' in u) return u;
      url = u.url;
    }
    if (!url) return { error: 'Nothing to play — paste a link to a video first' };
    const position = input.position !== undefined ? secs(input.position, 0) : fromLink ? startSeconds(url) : this.s.position;
    this.set({ ...this.s, on: true, url, playing: true, position, by });
    return { changed: true };
  }

  /** Stops it where it is, so Play picks it back up from there. */
  pause(position: unknown, by: string): boolean {
    if (!this.s.on || !this.s.playing) return false;
    this.set({ ...this.s, playing: false, position: secs(position, positionAt(this.s, Date.now())), by });
    return true;
  }

  /** Jumps to `position`, keeping play and pause as they are. */
  seek(position: unknown, by: string): boolean {
    if (!this.s.on) return false;
    const at = secs(position, this.s.position);
    // Already there: dragging the scrubber over the same spot twice isn't news.
    if (Math.abs(at - positionAt(this.s, Date.now())) < 0.25) return false;
    this.set({ ...this.s, position: at, by });
    return true;
  }

  /** Off; the link stays for next time. */
  stop(by: string): boolean {
    if (!this.s.on) return false;
    this.set({ ...this.s, on: false, playing: false, position: 0, by });
    return true;
  }

  /**
   * The switch by the TV: `on` puts the room's light down for the picture, `off` brings it back.
   * Says whether that changed anything, so two people at the switch in a moment don't fight over it.
   * Deliberately doesn't go through `set`, which would move `at` and so jump the video along with it.
   */
  theatre(on: boolean, by: string): boolean {
    if (on !== true && on !== false) return false;
    if (this.s.theatre === on) return false;
    this.s = { ...this.s, theatre: on, by };
    this.save();
    return true;
  }

  private set(s: Omit<Saved, 'at'> & { at?: number }) {
    this.s = { ...s, at: Date.now() };
    this.save();
  }

  private load() {
    if (!existsSync(this.file)) return;
    try {
      const s = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Saved>;
      const url = s.url === undefined ? undefined : checkTvUrl(s.url);
      if (url && 'error' in url) return;
      this.s = {
        on: s.on === true,
        ...(url && 'url' in url ? { url: url.url } : {}),
        ...(typeof s.by === 'string' ? { by: s.by.slice(0, 24) } : {}),
        playing: s.on === true && s.playing === true,
        position: secs(s.position, 0),
        at: typeof s.at === 'number' && Number.isFinite(s.at) ? s.at : Date.now(),
        theatre: s.theatre === true,
      };
    } catch {
      // a broken file just means a dark screen
    }
  }

  private save() {
    try {
      writeFileSync(this.file, JSON.stringify(this.s, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}
