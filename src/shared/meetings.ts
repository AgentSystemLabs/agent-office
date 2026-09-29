// The meeting room's patterns: how 2–5 workers at the table work on one question or task together.
// The server runs them (server/meetings.ts); the client offers them when a meeting is called.

import { fmtCost, fmtTokens, type Meeting, type MeetingPattern, type MeetingRecord } from './protocol.js';

export interface PatternDef {
  icon: string;
  label: string;
  /** What happens, in a line. */
  blurb: string;
  /** A role per chair, the head of the table first; a meeting takes the first few. */
  roles: readonly string[];
  /** How many workers sit down: the fewest, the most, and how many by default. */
  seats: { min: number; max: number; default: number };
  /** The round limit: the fewest, the most, and the default. Fixed when min equals max. */
  rounds: { min: number; max: number; default: number };
  /** What a round is, for the dialog. */
  roundsNote: string;
  /** Where the output goes when whoever calls the meeting doesn't say (`slug` is the meeting's title as a file name). */
  output(slug: string, pr?: number): string;
  /** Needs a pull request (the review panel) or a list of parts (map-reduce). */
  needs?: 'pr' | 'parts';
}

export const MEETING_PATTERNS: Record<MeetingPattern, PatternDef> = {
  debate: {
    icon: '🗣️',
    label: 'Debate',
    blurb: 'Each worker proposes, then critiques the others; in the last round the head of the table writes the decision.',
    roles: ['Chair', 'Pragmatist', 'Skeptic', 'Simplifier', 'User advocate'],
    seats: { min: 2, max: 5, default: 3 },
    rounds: { min: 2, max: 4, default: 3 },
    roundsNote: 'Proposals, then a round of critique per extra round, then the decision.',
    output: (slug) => `docs/decisions/${slug}.md`,
  },
  lead: {
    icon: '🧭',
    label: 'Lead & team',
    blurb: 'The lead splits the task into parts, the team each do one, and the lead merges their work and writes it up.',
    roles: ['Lead', 'Engineer', 'Engineer', 'Engineer', 'Engineer'],
    seats: { min: 2, max: 5, default: 3 },
    rounds: { min: 3, max: 3, default: 3 },
    roundsNote: 'Plan, work, merge.',
    output: (slug) => `docs/meetings/${slug}.md`,
  },
  mapreduce: {
    icon: '🗂️',
    label: 'Map-reduce',
    blurb: 'The same task over each part (files, modules, issues) in parallel; the head of the table combines the results.',
    roles: ['Reducer', 'Mapper', 'Mapper', 'Mapper', 'Mapper'],
    seats: { min: 2, max: 5, default: 3 },
    rounds: { min: 2, max: 2, default: 2 },
    roundsNote: 'Map, then reduce.',
    output: (slug) => `docs/meetings/${slug}.md`,
    needs: 'parts',
  },
  redblue: {
    icon: '🛡️',
    label: 'Red / blue',
    blurb: 'Red attacks the change (bugs, security), blue fixes what holds up, round after round; blue writes it up.',
    roles: ['Blue team', 'Red team'],
    seats: { min: 2, max: 2, default: 2 },
    rounds: { min: 1, max: 5, default: 3 },
    roundsNote: 'An attack and a fix per round; it ends early when red finds nothing more.',
    output: (slug) => `docs/reviews/${slug}.md`,
  },
  review: {
    icon: '🔍',
    label: 'Review panel',
    blurb: 'Reviewers read a pull request through their own lens; the head of the table merges them into one review, posted on the PR.',
    roles: ['Correctness', 'Security', 'Performance & simplicity', 'Tests', 'API design'],
    seats: { min: 2, max: 5, default: 3 },
    rounds: { min: 2, max: 2, default: 2 },
    roundsNote: 'Reviews, then the combined review.',
    output: (_slug, pr) => `reviews/pr-${pr ?? 'n'}.md`,
    needs: 'pr',
  },
};

export const MEETING_PATTERN_IDS = Object.keys(MEETING_PATTERNS) as MeetingPattern[];

export function isMeetingPattern(v: unknown): v is MeetingPattern {
  // Own keys only: `in` would also take the prototype's (constructor, toString…), and those crash the server.
  return typeof v === 'string' && Object.hasOwn(MEETING_PATTERNS, v);
}

/** Tokens a meeting may use by default: a million per worker at the table. */
export const TOKENS_PER_SEAT = 1_000_000;
/** The most a meeting may be given, however many workers sit down. */
export const MAX_MEETING_BUDGET = 50_000_000;

/**
 * The round notes' folder at the top of a meeting's worktree. It's left out of the meeting's commit and
 * cleared away with the room (a copy stays in the floor's .agent-office/meetings/). Not under
 * .agent-office/: Claude Code asks before writing there in a worktree nested in the project.
 */
export const MEETING_NOTES_DIR = '.meeting';

/** A title as a file or branch name: "Pick a cache!" → "pick-a-cache". */
export function slugify(s: string, max = 40): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/, '') || 'meeting'
  );
}

/**
 * Why an output path can't be used, or undefined when it's fine: a file inside the checkout, not in
 * the office's own folder or git's.
 */
export function outputProblem(p: string): string | undefined {
  if (!p.trim()) return 'Say which file the meeting writes';
  if (p.length > 200) return 'That output path is too long';
  if (/^[/\\]|^[a-zA-Z]:/.test(p)) return 'The output file goes inside the project: give a path relative to it';
  const parts = p.split(/[/\\]/);
  if (parts.some((x) => x === '..' || x === '.' || x === '')) return 'The output path can’t have empty, . or .. parts';
  if (parts[0] === '.git' || parts[0] === '.agent-office' || parts[0] === MEETING_NOTES_DIR) return `The output can’t go in ${parts[0]}/`;
  if (/[\0-\x1f]/.test(p)) return 'The output path has control characters in it';
  return undefined;
}

/** "3 rounds" / "round 2 of 3". */
const rounds = (n: number) => `${n} round${n === 1 ? '' : 's'}`;

/** The spend, e.g. "1.2M tokens · $2.40" (or without the cost when a provider doesn't report it). */
export function meetingSpend(m: Pick<Meeting, 'tokens' | 'cost' | 'costKnown'>): string {
  return `${fmtTokens(m.tokens)} tokens${m.costKnown ? ` · ${fmtCost(m.cost)}` : m.cost > 0 ? ` · ${fmtCost(m.cost)}+` : ''}`;
}

/** What's on the table in a line: "Round 2 of 3 · critiquing". */
export function meetingStage(m: Meeting): string {
  const doing = [...new Set(m.turns.filter((t) => t.state !== 'done').map((t) => t.doing))].join(', ');
  return `Round ${m.round} of ${m.rounds}${doing ? ` · ${doing}` : ''}`;
}

/**
 * The line on the room's door once a meeting is over: pattern, rounds, tokens, cost, and the output
 * file it wrote (and where), or why it stopped.
 */
export function meetingSummary(m: Meeting): string {
  const p = MEETING_PATTERNS[m.pattern];
  const ran = m.status === 'done' ? rounds(m.round) : `${m.status === 'stopped' ? 'in ' : ''}round ${m.round} of ${m.rounds}`;
  const head = `${p.icon} ${p.label} · ${ran} · ${meetingSpend(m)}`;
  if (m.status === 'stopped') return `${head} · ⛔ ${m.reason ?? 'stopped'}`;
  if (m.status === 'running') return head;
  const where = m.review?.url ? ' · posted on the PR' : m.review?.error ? ` · couldn't post it: ${m.review.error}` : m.commit ? ` on ${m.worktree?.branch}` : m.worktree ? ` in ${m.worktree.branch}'s worktree` : '';
  return `${head} · ✅ ${m.output}${where}`;
}

export function meetingRecord(m: Meeting): MeetingRecord {
  return { id: m.id, pattern: m.pattern, title: m.title, status: m.status, summary: meetingSummary(m), calledBy: m.calledBy, finishedAt: m.finishedAt ?? Date.now(), branch: m.worktree?.branch, output: m.output };
}
