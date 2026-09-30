import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { JUKEBOX_HOME, JUKEBOX_TUNES, STREAM, checkStreamUrl, sanitizeSpot, trackTitle, tuneById, type JukeboxSpot, type JukeboxState } from '../shared/jukebox.js';

interface Saved {
  on: boolean;
  track: string;
  url?: string;
  /** Where its cabinet stands, once somebody has moved it off its corner of the lounge. */
  spot?: JukeboxSpot;
  by?: string;
  /** When the track started, on this machine's clock. */
  startedAt: number;
}

/**
 * The lounge jukebox on one floor, saved in .agent-office/jukebox.json. It says what's on, since
 * when, and where the cabinet stands; every browser plays it for itself, from the same point.
 */
export class Jukebox {
  private s: Saved = { on: false, track: JUKEBOX_TUNES[0].id, startedAt: Date.now() };
  private file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'jukebox.json');
    this.load();
  }

  state(): JukeboxState {
    const { on, track, url, by, startedAt } = this.s;
    return { on, track, ...(url && track === STREAM ? { url } : {}), spot: this.spot(), ...(by ? { by } : {}), startedAt, elapsed: Math.max(0, Date.now() - startedAt) };
  }

  /** Where its cabinet stands: where somebody last moved it to, or the corner of the lounge. */
  spot(): JukeboxSpot {
    return this.s.spot ?? JUKEBOX_HOME;
  }

  /** What's on, for toasts: “Rainy Window”, or where a stream comes from. */
  title(): string {
    return trackTitle(this.s);
  }

  /** Puts on a tune, a stream, or (with neither) whatever it had. Says whether anything changed, or why it can't. */
  play(input: { track?: unknown; url?: unknown }, by: string): { changed: boolean } | { error: string } {
    if (input.url !== undefined && input.url !== '') {
      const u = checkStreamUrl(input.url);
      if ('error' in u) return u;
      this.set({ on: true, track: STREAM, url: u.url, by });
    } else if (input.track !== undefined) {
      if (typeof input.track !== 'string' || !tuneById(input.track)) return { error: "The jukebox doesn't have that one" };
      this.set({ on: true, track: input.track, by });
    } else {
      if (this.s.on) return { changed: false };
      this.set({ ...this.s, on: true, by });
    }
    return { changed: true };
  }

  /** On to the next tune; from a stream, back to the first one. */
  skip(by: string) {
    const i = JUKEBOX_TUNES.findIndex((t) => t.id === this.s.track);
    this.set({ on: true, track: JUKEBOX_TUNES[(i + 1) % JUKEBOX_TUNES.length].id, by });
  }

  stop(by: string): boolean {
    if (!this.s.on) return false;
    this.s = { ...this.s, on: false, by };
    this.save();
    return true;
  }

  /** Stands the cabinet somewhere else, or says why it can't go there. Moving it doesn't touch the music. */
  place(input: unknown): JukeboxSpot | string {
    const spot = sanitizeSpot(input);
    if (typeof spot === 'string') return spot;
    this.s = { ...this.s, spot };
    this.save();
    return spot;
  }

  /** Starts a track. Only what changes is passed: where the cabinet stands isn't touched by the music. */
  private set(s: Omit<Saved, 'startedAt' | 'spot'>) {
    this.s = { ...this.s, ...s, startedAt: Date.now() };
    this.save();
  }

  private load() {
    if (!existsSync(this.file)) return;
    try {
      const s = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Saved>;
      const url = s.track === STREAM ? checkStreamUrl(s.url) : undefined;
      if (s.track === STREAM ? !url || 'error' in url : typeof s.track !== 'string' || !tuneById(s.track)) return;
      // A spot nobody could stand a cabinet at is as good as no spot: it stays in its corner.
      const spot = s.spot === undefined ? undefined : sanitizeSpot(s.spot);
      this.s = {
        on: s.on === true,
        track: s.track!,
        ...(url && 'url' in url ? { url: url.url } : {}),
        ...(spot && typeof spot !== 'string' ? { spot } : {}),
        ...(typeof s.by === 'string' ? { by: s.by.slice(0, 24) } : {}),
        startedAt: typeof s.startedAt === 'number' && Number.isFinite(s.startedAt) ? s.startedAt : Date.now(),
      };
    } catch {
      // a broken file just means a quiet lounge
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
