// The reels studio's records on disk, and how what an agent sends becomes one: every field an agent
// gives is checked here before the studio keeps it (see endpoint.ts, which hands them over).

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { str } from '../office/input.js';
import { PLATFORMS, type Platform, type Reel, type ReelsState, type Scene, type Series } from './types.js';

/** At most this many scenes to a reel: about a minute of narration. */
export const MAX_SCENES = 14;
/** How many of the analyst's notes a series keeps. */
const MAX_NOTES = 30;
/** Posting more than this a day reads as spam to the platforms. */
export const MAX_POSTS_PER_DAY = 6;

const TIKTOK_PRIVACY = ['SELF_ONLY', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'PUBLIC_TO_EVERYONE'] as const;
const YOUTUBE_PRIVACY = ['private', 'unlisted', 'public'] as const;

export const newId = (prefix: string) => `${prefix}-${randomBytes(4).toString('hex')}`;

/** A file name, never a path: music is only ever read from the studio's own folder. */
const fileName = (v: unknown) => {
  const s = str(v, 120).trim();
  return s && path.basename(s) === s && !s.startsWith('.') ? s : '';
};

const tags = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\s,]+/) : [])
    .map((t) => str(t, 40).trim().replace(/^#+/, ''))
    .filter((t) => /^[\p{L}\p{N}_]+$/u.test(t))
    .slice(0, 12);

/** What's settable on a series, from what an agent sent; a string says what's wrong. `base` is the series being changed. */
export function readSeries(body: unknown, base?: Series): Partial<Series> | string {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const out: Partial<Series> = {};
  const text = (k: 'name' | 'niche' | 'style' | 'voice' | 'tone' | 'cta', max: number) => {
    if (b[k] === undefined) return;
    out[k] = str(b[k], max).trim();
  };
  text('name', 60);
  text('niche', 400);
  text('style', 300);
  text('voice', 60);
  text('tone', 300);
  text('cta', 150);
  if (b.music !== undefined) {
    const m = fileName(b.music);
    if (b.music && !m) return 'music is the file name of a track in the studio\'s music folder, not a path';
    out.music = m || undefined;
  }
  if (b.platforms !== undefined) {
    const list = Array.isArray(b.platforms) ? b.platforms : String(b.platforms).split(/[\s,]+/).filter(Boolean);
    const bad = list.find((p) => !PLATFORMS.includes(p as Platform));
    if (bad !== undefined) return `platforms are ${PLATFORMS.join(', ')} (got ${String(bad)})`;
    out.platforms = [...new Set(list as Platform[])];
  }
  if (b.postsPerDay !== undefined) {
    const n = Number(b.postsPerDay);
    if (!(n >= 0.25 && n <= MAX_POSTS_PER_DAY)) return `postsPerDay is between 0.25 and ${MAX_POSTS_PER_DAY}`;
    out.postsPerDay = n;
  }
  if (b.backlog !== undefined) {
    const n = Number(b.backlog);
    if (!Number.isInteger(n) || n < 1 || n > 30) return 'backlog is a whole number from 1 to 30';
    out.backlog = n;
  }
  if (b.hashtags !== undefined) out.hashtags = tags(b.hashtags);
  if (b.tiktokPrivacy !== undefined) {
    if (!TIKTOK_PRIVACY.includes(b.tiktokPrivacy as Series['tiktokPrivacy'])) return `tiktokPrivacy is one of ${TIKTOK_PRIVACY.join(', ')}`;
    out.tiktokPrivacy = b.tiktokPrivacy as Series['tiktokPrivacy'];
  }
  if (b.youtubePrivacy !== undefined) {
    if (!YOUTUBE_PRIVACY.includes(b.youtubePrivacy as Series['youtubePrivacy'])) return `youtubePrivacy is one of ${YOUTUBE_PRIVACY.join(', ')}`;
    out.youtubePrivacy = b.youtubePrivacy as Series['youtubePrivacy'];
  }
  if (b.paused !== undefined) out.paused = b.paused === true;
  if (!base) {
    if (!out.name) return 'A series needs a name';
    if (!out.niche) return 'A series needs a niche: what its reels are about';
  } else if (out.name === '' || out.niche === '') return 'A series keeps a name and a niche';
  return out;
}

/** A new series, with the studio's defaults for what wasn't said. */
export function makeSeries(fields: Partial<Series>, by: string, now: number): Series {
  return {
    id: newId('s'),
    name: fields.name ?? 'Untitled',
    niche: fields.niche ?? '',
    style: fields.style || 'cinematic digital painting, dramatic lighting, rich color, vertical composition',
    voice: fields.voice || 'onyx',
    tone: fields.tone,
    music: fields.music,
    platforms: fields.platforms ?? [],
    postsPerDay: fields.postsPerDay ?? 1,
    backlog: fields.backlog ?? 3,
    cta: fields.cta,
    hashtags: fields.hashtags ?? [],
    tiktokPrivacy: fields.tiktokPrivacy ?? 'SELF_ONLY',
    youtubePrivacy: fields.youtubePrivacy ?? 'private',
    paused: fields.paused ?? false,
    notes: [],
    createdBy: by,
    createdAt: now,
  };
}

/** A writer's script, from what it sent; a string says what's wrong. */
export function readScript(body: unknown): { title?: string; hook?: string; scenes: Scene[]; caption: string; hashtags: string[] } | string {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (!Array.isArray(b.scenes) || !b.scenes.length) return 'A script is its scenes: [{"narration": "…", "visual": "…"}, …]';
  if (b.scenes.length > MAX_SCENES) return `At most ${MAX_SCENES} scenes: a reel is a minute at most`;
  const scenes: Scene[] = [];
  for (const [i, s] of b.scenes.entries()) {
    const narration = str((s as Scene)?.narration, 600).replace(/\s+/g, ' ').trim();
    const visual = str((s as Scene)?.visual, 500).replace(/\s+/g, ' ').trim();
    if (!narration || !visual) return `Scene ${i + 1} needs both narration (what's said) and visual (the image prompt)`;
    scenes.push({ narration, visual });
  }
  const words = scenes.reduce((n, s) => n + s.narration.split(' ').length, 0);
  if (words > 190) return `The narration is ${words} words: keep it under 190 (about 70 seconds)`;
  const caption = str(b.caption, 1500).trim();
  if (!caption) return 'A script needs the caption it posts with';
  const title = str(b.title, 100).trim() || undefined;
  const hook = str(b.hook, 200).trim() || undefined;
  return { title, hook, scenes, caption, hashtags: tags(b.hashtags) };
}

/** Takes a note onto a series, dropping the oldest past the limit. */
export function addNote(series: Series, by: string, text: string, now: number) {
  series.notes.push({ at: now, by, text });
  if (series.notes.length > MAX_NOTES) series.notes.splice(0, series.notes.length - MAX_NOTES);
}

/** What a reel posts with: its caption, the call to action and the hashtags, within `max` characters. */
export function postCaption(reel: Reel, series: Series, max = 2200): string {
  const hashtags = [...new Set([...(reel.hashtags ?? []), ...series.hashtags])].map((t) => `#${t}`).join(' ');
  return [reel.caption ?? reel.title, series.cta, hashtags].filter(Boolean).join('\n\n').slice(0, max);
}

/** The studio's records, saved after each change. */
export class ReelsStore {
  readonly dir: string;
  private file: string;
  state: ReelsState;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'reels');
    this.file = path.join(this.dir, 'reels.json');
    this.state = { series: [], reels: [], crew: [], lastPost: {} };
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<ReelsState>;
      this.state = { series: saved.series ?? [], reels: saved.reels ?? [], crew: saved.crew ?? [], lastPost: saved.lastPost ?? {} };
    } catch {
      // nothing saved yet
    }
    // A production or a post the last office was in the middle of didn't finish.
    for (const r of this.state.reels) {
      if (r.status === 'rendering') r.status = 'scripted';
      if (r.status === 'posting') r.status = 'approved';
    }
  }

  /** Whether there's anything at all: the studio sleeps until someone makes a series. */
  get active() {
    return this.state.series.length > 0;
  }

  series(id: string): Series | undefined {
    const key = id.trim().toLowerCase();
    return this.state.series.find((s) => s.id === id) ?? this.state.series.find((s) => s.name.toLowerCase() === key);
  }

  reel(id: string): Reel | undefined {
    return this.state.reels.find((r) => r.id === id.trim());
  }

  save() {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 1), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  /** A folder of the studio's, made when first asked for. */
  folder(name: 'out' | 'work' | 'music'): string {
    const dir = path.join(this.dir, name);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
  }
}
