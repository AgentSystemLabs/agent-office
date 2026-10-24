// The reels studio: what its crew asks of it (endpoint.ts passes the asks on), and its own clock,
// which makes the scripted reels into videos one at a time, posts each series' approved reels on
// its schedule, and asks the crew for more when there's work for them (schedule.ts says what).

import { existsSync } from 'node:fs';
import type { WorkerStatus } from '../../shared/protocol.js';
import { AccountsFile, connected } from './accounts.js';
import { nudge } from './crew.js';
import { mediaKeys } from './media.js';
import { produce as produceReel, tidy } from './pipeline.js';
import { fetchStats as fetchPostStats, publish as publishReel } from './publish.js';
import { counts, nextToPost, nextToProduce, nudges, postDue } from './schedule.js';
import { ReelsStore, addNote, makeSeries, newId, postCaption, readScript, readSeries } from './store.js';
import type { CrewMember, CrewRole, Platform, Post, Reel, Series } from './types.js';

export interface StudioDeps {
  toast(text: string, level?: 'info' | 'warn'): void;
  /** Where a crew member's worker is; undefined once it has left the office. */
  workerStatus(m: CrewMember): WorkerStatus | undefined;
  /** Types `text` to a crew member as its next prompt; a string says why it couldn't. */
  tell(m: CrewMember, text: string): string | undefined;
  produce?: typeof produceReel;
  publish?: typeof publishReel;
  fetchStats?: typeof fetchPostStats;
  now?: () => number;
}

/** A crew member may be asked for something when it's sitting still. */
const RESTING: (WorkerStatus | undefined)[] = ['idle', 'done', 'exited', 'offline'];
/** The clock's step. */
export const TICK_MS = 60_000;

/** A reel in a line, for the status list. */
function summary(r: Reel) {
  const posts = Object.entries(r.posts).map(([p, post]) => ({ platform: p, url: post?.url, error: post?.error, views: post?.stats?.views }));
  return {
    id: r.id,
    series: r.seriesId,
    status: r.status,
    title: r.title,
    ...(r.hook ? { hook: r.hook } : {}),
    by: r.scriptedBy ?? r.addedBy,
    ...(r.review ? { review: r.review } : {}),
    ...(r.error ? { error: r.error } : {}),
    ...(r.duration ? { seconds: Math.round(r.duration) } : {}),
    ...(posts.length ? { posts } : {}),
  };
}

export class Studio {
  readonly store: ReelsStore;
  readonly accounts: AccountsFile;
  private producing = false;
  private posting = false;
  /** Series already told they have nowhere to post, so it's said once. */
  private toldUnposted = new Set<string>();
  private now: () => number;

  constructor(dataDir: string, private deps: StudioDeps) {
    this.store = new ReelsStore(dataDir);
    this.accounts = new AccountsFile(this.store.dir);
    this.now = deps.now ?? Date.now;
  }

  private series(id: unknown): Series | string {
    const s = typeof id === 'string' ? this.store.series(id) : undefined;
    return s ?? `No series ${String(id ?? '')}: run office-reels status for their ids`;
  }

  private reel(id: unknown): Reel | string {
    const r = typeof id === 'string' ? this.store.reel(id) : undefined;
    return r ?? `No reel ${String(id ?? '')}: run office-reels status for their ids`;
  }

  /** Everything at a glance: the series and how their pipelines stand, the reels on the go, the crew, and what's set up. */
  overview() {
    const st = this.store.state;
    const recentPosted = st.reels.filter((r) => r.status === 'posted').sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 15);
    return {
      series: st.series.map((s) => ({
        ...s,
        notes: s.notes.slice(-8),
        pipeline: counts(st, s.id),
        lastPost: st.lastPost[s.id],
        nextPostAfter: st.lastPost[s.id] ? st.lastPost[s.id] + Math.round((86400_000 / s.postsPerDay) * 0.97) : undefined,
      })),
      reels: [...st.reels.filter((r) => r.status !== 'posted'), ...recentPosted].map(summary),
      crew: st.crew.map((m) => ({ ...m, status: this.deps.workerStatus(m) ?? 'gone' })),
      media: mediaKeys(),
      connected: connected(this.accounts.read()),
      lastStats: st.lastStats,
    };
  }

  /** One reel in full. */
  show(id: unknown) {
    const r = this.reel(id);
    if (typeof r === 'string') return r;
    const s = this.store.series(r.seriesId);
    return { ...r, ...(r.video ? { videoExists: existsSync(r.video) } : {}), ...(s ? { postCaption: postCaption(r, s) } : {}) };
  }

  addSeries(body: unknown, by: string): Series | string {
    const fields = readSeries(body);
    if (typeof fields === 'string') return fields;
    if (this.store.series(fields.name!)) return `There's already a series called ${fields.name}`;
    const s = makeSeries(fields, by, this.now());
    this.store.state.series.push(s);
    this.store.save();
    this.deps.toast(`🎬 ${by} started the reels series “${s.name}”`);
    return s;
  }

  setSeries(id: unknown, body: unknown, by: string): Series | string {
    const s = this.series(id);
    if (typeof s === 'string') return s;
    const fields = readSeries(body, s);
    if (typeof fields === 'string') return fields;
    Object.assign(s, fields);
    this.store.save();
    this.deps.toast(`🎬 ${by} changed “${s.name}”: ${Object.keys(fields).join(', ')}`);
    return s;
  }

  addIdea(seriesId: unknown, body: unknown, by: string): Reel | string {
    const s = this.series(seriesId);
    if (typeof s === 'string') return s;
    const b = (body ?? {}) as Record<string, unknown>;
    const title = typeof b.title === 'string' ? b.title.trim().slice(0, 100) : '';
    if (!title) return 'An idea needs a title';
    const now = this.now();
    const r: Reel = {
      id: newId('r'), seriesId: s.id, status: 'idea', title, addedBy: by, posts: {}, createdAt: now, updatedAt: now,
      ...(typeof b.hook === 'string' && b.hook.trim() ? { hook: b.hook.trim().slice(0, 200) } : {}),
      ...(typeof b.idea === 'string' && b.idea.trim() ? { idea: b.idea.trim().slice(0, 1500) } : {}),
    };
    this.store.state.reels.push(r);
    this.store.save();
    return r;
  }

  /** A writer's script for an idea (or a reel to fix), or a new reel straight from a script when `seriesId` is given instead. */
  script(reelId: unknown, seriesId: unknown, body: unknown, by: string): Reel | string {
    const script = readScript(body);
    if (typeof script === 'string') return script;
    let r: Reel | string;
    if (reelId) {
      r = this.reel(reelId);
      if (typeof r === 'string') return r;
      if (['rendering', 'posting', 'posted'].includes(r.status)) return `${r.id} is ${r.status}: it can't be rewritten now`;
    } else {
      const s = this.series(seriesId);
      if (typeof s === 'string') return s;
      r = this.addIdea(s.id, { title: script.title ?? script.scenes[0].narration.slice(0, 80) }, by) as Reel;
    }
    Object.assign(r, { scenes: script.scenes, caption: script.caption, hashtags: script.hashtags, status: 'scripted', scriptedBy: by, updatedAt: this.now() });
    if (script.title) r.title = script.title;
    if (script.hook) r.hook = script.hook;
    delete r.error;
    delete r.reviewedBy;
    this.store.save();
    setTimeout(() => void this.tick(), 0).unref?.();
    return r;
  }

  review(id: unknown, approve: boolean, note: string, by: string): Reel | string {
    const r = this.reel(id);
    if (typeof r === 'string') return r;
    if (r.status !== 'rendered' && !(r.status === 'approved' && !approve)) return `${r.id} is ${r.status}: only a rendered reel is reviewed`;
    if (approve && r.scriptedBy === by) return "You wrote it: another member of the crew has to approve it";
    if (!approve && !note.trim()) return 'Say what to fix: --note "…"';
    Object.assign(r, { status: approve ? 'approved' : 'rejected', reviewedBy: by, updatedAt: this.now() });
    if (note.trim()) r.review = note.trim().slice(0, 1000);
    else delete r.review;
    this.store.save();
    this.deps.toast(approve ? `✅ ${by} approved the reel “${r.title}”` : `✏️ ${by} sent “${r.title}” back: ${r.review}`);
    return r;
  }

  /** Makes a reel again (after its music changed, say): it goes to the front of the line. */
  remake(id: unknown): Reel | string {
    const r = this.reel(id);
    if (typeof r === 'string') return r;
    if (!r.scenes?.length) return `${r.id} has no script yet`;
    if (['rendering', 'posting', 'posted'].includes(r.status)) return `${r.id} is ${r.status}`;
    Object.assign(r, { status: 'scripted', updatedAt: 0 });
    delete r.error;
    this.store.save();
    setTimeout(() => void this.tick(), 0).unref?.();
    return r;
  }

  note(seriesId: unknown, text: unknown, by: string): Series | string {
    const s = this.series(seriesId);
    if (typeof s === 'string') return s;
    const t = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, 600) : '';
    if (!t) return 'The note is empty';
    addNote(s, by, t, this.now());
    this.store.save();
    return s;
  }

  /** Takes a crew member on, in place of anyone already in that role on that series. */
  addCrew(m: CrewMember) {
    const st = this.store.state;
    st.crew = st.crew.filter((c) => !(c.role === m.role && c.seriesId === m.seriesId) && c.workerId !== m.workerId);
    st.crew.push(m);
    this.store.save();
  }

  crewOf(role: CrewRole, seriesId?: string) {
    return this.store.state.crew.find((c) => c.role === role && c.seriesId === seriesId);
  }

  /** Posts an approved reel now, outside the schedule. */
  async postNow(id: unknown, by: string): Promise<Reel | string> {
    const r = this.reel(id);
    if (typeof r === 'string') return r;
    if (r.status !== 'approved') return `${r.id} is ${r.status}: only an approved reel is posted`;
    if (this.posting) return 'The studio is posting another reel: try again in a minute';
    this.deps.toast(`📲 ${by} is posting “${r.title}” now`);
    await this.post(r);
    return r;
  }

  /** Fetches the numbers for every post, and keeps them. */
  async stats(): Promise<{ id: string; title: string; series: string; posts: Partial<Record<Platform, Post>> }[] | string> {
    const st = this.store.state;
    const posted = st.reels.filter((r) => Object.keys(r.posts).length);
    const ids = posted.flatMap((r) => Object.entries(r.posts).filter(([, p]) => p?.id && !p.error?.startsWith('Not posted')).map(([platform, p]) => ({ platform: platform as Platform, id: p!.id! })));
    if (!ids.length) return 'Nothing has been posted yet';
    const got = await (this.deps.fetchStats ?? fetchPostStats)(ids, this.accounts);
    for (const r of posted) for (const [platform, p] of Object.entries(r.posts)) {
      const s = p?.id ? got.get(`${platform}:${p.id}`) : undefined;
      if (s && p) p.stats = s;
    }
    st.lastStats = this.now();
    this.store.save();
    return posted.map((r) => ({ id: r.id, title: r.title, series: r.seriesId, posts: r.posts }));
  }

  /** The studio's clock: make the next reel, post what's due, ask the crew for what's needed. */
  async tick() {
    if (!this.store.active) return;
    const st = this.store.state;
    // Crew whose workers have left the office.
    const gone = st.crew.filter((m) => this.deps.workerStatus(m) === undefined);
    if (gone.length) {
      st.crew = st.crew.filter((m) => !gone.includes(m));
      this.store.save();
    }
    void this.produceNext();
    void this.postDue();
    const now = this.now();
    for (const { member, why } of nudges(st, now, (m) => RESTING.includes(this.deps.workerStatus(m)))) {
      member.nudgedAt = now;
      const err = this.deps.tell(member, nudge(member.role, why));
      if (err) this.deps.toast(`🎬 Couldn't ask the ${member.role} ${member.name}: ${err}`, 'warn');
    }
    this.store.save();
  }

  private async produceNext() {
    if (this.producing) return;
    const r = nextToProduce(this.store.state);
    const s = r && this.store.series(r.seriesId);
    if (!r || !s) return;
    this.producing = true;
    r.status = 'rendering';
    this.store.save();
    try {
      const { video, duration } = await (this.deps.produce ?? produceReel)(r, s, this.store);
      Object.assign(r, { status: 'rendered', video, duration, updatedAt: this.now() });
      this.deps.toast(`🎬 The reel “${r.title}” is made (${Math.round(duration)}s): it's waiting for the editor`);
    } catch (e) {
      Object.assign(r, { status: 'failed', error: (e as Error).message, updatedAt: this.now() });
      this.deps.toast(`🎬 Making “${r.title}” failed: ${r.error}`, 'warn');
    } finally {
      this.producing = false;
      this.store.save();
    }
    // The next one, if there is one.
    void this.produceNext();
  }

  private async postDue() {
    if (this.posting) return;
    const st = this.store.state;
    const live = connected(this.accounts.read());
    for (const s of st.series) {
      if (!postDue(s, st.lastPost[s.id], this.now())) continue;
      const r = nextToPost(st, s.id);
      if (!r) continue;
      if (!s.platforms.some((p) => live.includes(p))) {
        if (!this.toldUnposted.has(s.id)) this.deps.toast(`🎬 “${s.name}” has reels ready but none of its platforms (${s.platforms.join(', ')}) is connected: see docs/reels.md`, 'warn');
        this.toldUnposted.add(s.id);
        continue;
      }
      await this.post(r);
      return;
    }
  }

  /** Posts a reel to each of its series' platforms it isn't on yet. */
  private async post(r: Reel) {
    const s = this.store.series(r.seriesId);
    if (!s || !r.video) return;
    this.posting = true;
    r.status = 'posting';
    this.store.save();
    const live = connected(this.accounts.read());
    const went: string[] = [];
    const failed: string[] = [];
    try {
      for (const p of s.platforms) {
        if (r.posts[p]?.id) continue;
        if (!live.includes(p)) {
          r.posts[p] = { at: this.now(), error: `Not posted: ${p} isn't connected` };
          continue;
        }
        try {
          r.posts[p] = await (this.deps.publish ?? publishReel)(p, { video: r.video, title: r.title, caption: postCaption(r, s), tiktokPrivacy: s.tiktokPrivacy, youtubePrivacy: s.youtubePrivacy }, this.accounts);
          went.push(r.posts[p]!.url ? `${p} (${r.posts[p]!.url})` : p);
        } catch (e) {
          r.posts[p] = { at: this.now(), error: (e as Error).message };
          failed.push(`${p}: ${(e as Error).message}`);
        }
      }
    } finally {
      this.posting = false;
    }
    if (went.length) {
      r.status = 'posted';
      this.store.state.lastPost[s.id] = this.now();
      tidy(r, this.store);
      this.deps.toast(`📲 Posted “${r.title}” to ${went.join(', ')}`);
    } else {
      // Nothing went: it waits for the next try, rather than going out on the next tick and failing again.
      r.status = 'approved';
      this.store.state.lastPost[s.id] = this.now();
    }
    if (failed.length) this.deps.toast(`📲 Posting “${r.title}” failed on ${failed.join('; ')}`, 'warn');
    r.updatedAt = this.now();
    this.store.save();
  }
}
