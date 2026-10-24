// What the studio does next, worked out from its records and the clock: which reel to make, which
// series is due to post, and which crew member to ask for more. Pure, so it's tested without a clock.

import type { CrewMember, CrewRole, Reel, ReelsState, Series } from './types.js';

const HOUR = 3600_000;
/** A crew member isn't asked again sooner than this. */
export const NUDGE_EVERY = 3 * HOUR;
/** The analyst is asked for the numbers once a day. */
const STATS_EVERY = 24 * HOUR;
/** Below this many ideas waiting, the scout is asked for more. */
const IDEAS_LOW = 3;

/** Waiting to go out: scripted and on its way to being posted. */
const IN_PIPE: Reel['status'][] = ['scripted', 'rendering', 'rendered', 'approved'];

/** Whether `series` may post now: it isn't paused, and its gap since the last post has passed (with a little slack for the clock's step). */
export function postDue(series: Series, lastPost: number | undefined, now: number): boolean {
  if (series.paused || !series.platforms.length) return false;
  if (lastPost === undefined) return true;
  return now - lastPost >= (24 * HOUR / series.postsPerDay) * 0.97;
}

const oldest = (reels: Reel[]) => [...reels].sort((a, b) => a.updatedAt - b.updatedAt)[0];

/** The next approved reel of a series to post. */
export const nextToPost = (state: ReelsState, seriesId: string) => oldest(state.reels.filter((r) => r.seriesId === seriesId && r.status === 'approved'));

/** The next scripted reel to make, of a series that isn't paused. */
export function nextToProduce(state: ReelsState): Reel | undefined {
  const live = new Set(state.series.filter((s) => !s.paused).map((s) => s.id));
  return oldest(state.reels.filter((r) => r.status === 'scripted' && live.has(r.seriesId)));
}

/** How a series' pipeline stands, counted by where its reels are. */
export function counts(state: ReelsState, seriesId: string) {
  const mine = state.reels.filter((r) => r.seriesId === seriesId);
  const n = (...s: Reel['status'][]) => mine.filter((r) => s.includes(r.status)).length;
  return { ideas: n('idea', 'rejected'), inPipe: n(...IN_PIPE), toReview: n('rendered'), approved: n('approved'), posted: n('posted'), failed: n('failed') };
}

/** Whether a crew member works on a series: one hired for one, or for them all. */
const covers = (m: CrewMember, seriesId: string) => !m.seriesId || m.seriesId === seriesId;

/**
 * Who in the crew should be asked for something now, and why. Each role is asked when there's work
 * it does: the scout when ideas run low, the writer when the backlog does and there are ideas to
 * write (or rejected reels to fix), the editor when there are reels to review, the analyst for the
 * daily numbers. `idle` says whether a member is free to be asked; nobody is asked twice in NUDGE_EVERY.
 */
export function nudges(state: ReelsState, now: number, idle: (m: CrewMember) => boolean): { member: CrewMember; why: string }[] {
  const lastStats = state.lastStats;
  const out: { member: CrewMember; why: string }[] = [];
  const asked = new Set<CrewMember>();
  const ask = (role: CrewRole, seriesId: string | undefined, why: string) => {
    const m = state.crew.find((c) => c.role === role && (!seriesId || covers(c, seriesId)) && !asked.has(c) && idle(c) && (c.nudgedAt === undefined || now - c.nudgedAt >= NUDGE_EVERY));
    if (!m) return;
    asked.add(m);
    out.push({ member: m, why });
  };
  for (const s of state.series) {
    if (s.paused) continue;
    const c = counts(state, s.id);
    if (c.toReview) ask('editor', s.id, `"${s.name}" has ${c.toReview} reel${c.toReview === 1 ? '' : 's'} waiting for review.`);
    if (c.inPipe < s.backlog && c.ideas) ask('writer', s.id, `"${s.name}" has ${c.inPipe} reel${c.inPipe === 1 ? '' : 's'} ready to go, under its backlog of ${s.backlog}, and ${c.ideas} idea${c.ideas === 1 ? '' : 's'} to write.`);
    if (c.ideas < IDEAS_LOW) ask('scout', s.id, `"${s.name}" is down to ${c.ideas} idea${c.ideas === 1 ? '' : 's'}.`);
  }
  if (state.reels.some((r) => r.status === 'posted') && now - (lastStats ?? 0) >= STATS_EVERY) ask('analyst', undefined, 'It is time for the daily numbers.');
  return out;
}
