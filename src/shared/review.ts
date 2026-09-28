// The review panel's findings: each reviewer at the meeting table writes its own as JSON, the office
// merges them (one finding per problem, tagged with every lens that saw it) and posts them on the pull
// request as one review, inline where the line is in the diff.

export type Severity = 'high' | 'medium' | 'low';

/** One problem a reviewer found. */
export interface ReviewFinding {
  /** Relative to the repository's root. */
  file: string;
  /** In the new version of the file; missing for a finding about the file as a whole. */
  line?: number;
  severity: Severity;
  /** The lenses that found it, e.g. ["Correctness", "Security"]. */
  lenses: string[];
  comment: string;
}

/** A line comment in a GitHub review, as the pulls/{n}/reviews API takes it. */
export interface ReviewComment {
  path: string;
  line: number;
  side: 'RIGHT';
  body: string;
}

/** A review, ready for POST repos/{owner}/{repo}/pulls/{n}/reviews. */
export interface ReviewPayload {
  body: string;
  event: 'COMMENT';
  comments: ReviewComment[];
}

export const MAX_FINDINGS = 60;
const COMMENT_MAX = 2000;
const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
const ICON: Record<Severity, string> = { high: '🔴', medium: '🟠', low: '🟡' };

/** A finding's lens tag: "**[Correctness · Security]**". */
export const lensTag = (f: Pick<ReviewFinding, 'lenses'>) => `**[${f.lenses.join(' · ')}]**`;

/** "src/a.ts:12", or just the file. */
export const where = (f: Pick<ReviewFinding, 'file' | 'line'>) => (f.line ? `${f.file}:${f.line}` : f.file);

/**
 * Reads one reviewer's findings file: a JSON array (or {"findings": [...]}) of {file, line, severity,
 * comment}, possibly inside a ```json fence. Every finding gets `lens`, the reviewer's; malformed ones
 * are dropped. Throws when the text isn't JSON at all.
 */
export function parseFindings(text: string, lens: string): ReviewFinding[] {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)```/.exec(text);
  const raw: unknown = JSON.parse((fenced ? fenced[1] : text).trim() || '[]');
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { findings?: unknown }).findings) ? (raw as { findings: unknown[] }).findings : null;
  if (!list) throw new Error('expected a JSON array of findings');
  const out: ReviewFinding[] = [];
  for (const x of list.slice(0, MAX_FINDINGS)) {
    const f = normalize(x, lens);
    if (f) out.push(f);
  }
  return out;
}

/** One finding as JSON, checked, or null when it can't be used. Takes back what `mergeFindings` writes, too. */
export function normalize(x: unknown, lens?: string): ReviewFinding | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const file = cleanPath(o.file ?? o.path);
  const comment = String(o.comment ?? o.body ?? o.message ?? '').trim().slice(0, COMMENT_MAX);
  if (!file || !comment) return null;
  const n = Number(o.line);
  const line = Number.isInteger(n) && n > 0 ? n : undefined;
  const s = String(o.severity ?? '').toLowerCase();
  const severity: Severity = s === 'high' || s === 'critical' || s === 'blocker' ? 'high' : s === 'low' || s === 'nit' || s === 'minor' ? 'low' : 'medium';
  const given = Array.isArray(o.lenses) ? o.lenses.map((l) => String(l ?? '').trim()).filter(Boolean) : typeof o.lens === 'string' && o.lens.trim() ? [o.lens.trim()] : [];
  const lenses = lens ? [lens] : given;
  if (!lenses.length) return null;
  return { file, line, severity, lenses: [...new Set(lenses)], comment };
}

/** A path as git shows it: no leading ./ or a/ b/ prefixes, forward slashes. Empty when it isn't one. */
function cleanPath(v: unknown): string {
  const p = String(v ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^[ab]\//, '');
  if (!p || p.startsWith('/') || p.split('/').includes('..') || /[\0-\x1f]/.test(p)) return '';
  return p;
}

/** The words of a comment that say something, for telling whether two comments are about the same thing. */
function words(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/`[^`]*`/g, (c) => c.replace(/\W+/g, '_')).split(/[^a-z0-9_]+/).filter((w) => w.length > 2 && !STOP.has(w)));
}
const STOP = new Set(['the', 'and', 'this', 'that', 'with', 'for', 'are', 'was', 'not', 'but', 'can', 'should', 'would', 'could', 'when', 'from', 'here', 'there', 'which', 'will', 'its', 'into', 'than', 'then', 'also', 'use', 'any']);

/** How alike two comments are, 0 to 1: the words they share over the words either has. */
export function similarity(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

/** Lines apart that two findings may be and still be about the same code. */
const NEAR = 3;

/** Whether two findings are the same problem: the same file, the same place, and saying much the same. */
export function sameProblem(a: ReviewFinding, b: ReviewFinding): boolean {
  if (a.file !== b.file) return false;
  if ((a.line === undefined) !== (b.line === undefined)) return false;
  const near = a.line === undefined || Math.abs(a.line - b.line!) <= NEAR;
  if (!near) return false;
  // Two lenses on the very same line usually mean the same thing; farther apart it has to read alike.
  const bar = a.line !== undefined && a.line === b.line ? 0.25 : 0.4;
  return similarity(a.comment, b.comment) >= bar;
}

/**
 * Merges every reviewer's findings into one list: a problem found through several lenses is kept
 * once, with the most serious severity, the fullest wording and every lens that found it. Sorted the
 * most serious first, then by file and line.
 */
export function mergeFindings(lists: ReviewFinding[][]): ReviewFinding[] {
  const merged: ReviewFinding[] = [];
  for (const list of lists) {
    for (const f of list) {
      const same = merged.find((m) => sameProblem(m, f));
      if (!same) {
        merged.push({ ...f, lenses: [...f.lenses] });
        continue;
      }
      for (const l of f.lenses) if (!same.lenses.includes(l)) same.lenses.push(l);
      if (RANK[f.severity] < RANK[same.severity]) same.severity = f.severity;
      if (f.comment.length > same.comment.length) {
        same.comment = f.comment;
        same.line = f.line;
      }
    }
  }
  return merged.sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0)).slice(0, MAX_FINDINGS);
}

/**
 * The lines a review can comment on, per file: those on the new side of the diff's hunks (added or
 * context). GitHub turns down a whole review when one of its comments is on any other line.
 */
export function diffLines(diff: string): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  let lines: Set<number> | undefined;
  let n = 0;
  let inHunk = false;
  for (const l of diff.split('\n')) {
    if (l.startsWith('diff --git ')) {
      lines = undefined;
      inHunk = false;
      continue;
    }
    if (!inHunk && l.startsWith('+++ ')) {
      const p = l.slice(4).trim();
      if (p === '/dev/null') lines = undefined;
      else {
        lines = new Set();
        out.set(cleanPath(p), lines);
      }
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (hunk) {
      n = Number(hunk[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk || !lines) continue;
    if (l.startsWith('+') || l.startsWith(' ')) lines.add(n++);
    else if (l.startsWith('-') || l.startsWith('\\')) continue;
    else inHunk = false;
  }
  return out;
}

/**
 * The panel's review: the head of the table's summary, then one line comment per finding on a line
 * in the diff, each tagged with its lenses. What can't go on a line (outside the diff, or about a whole
 * file) is listed in the review's body instead.
 */
export function buildReview(findings: ReviewFinding[], summary: string, lines: Map<string, Set<number>>, lensNames: string[] = []): ReviewPayload {
  const comments: ReviewComment[] = [];
  const loose: ReviewFinding[] = [];
  for (const f of findings) {
    if (f.line !== undefined && lines.get(f.file)?.has(f.line)) comments.push({ path: f.file, line: f.line, side: 'RIGHT', body: `${ICON[f.severity]} ${lensTag(f)} ${f.comment}` });
    else loose.push(f);
  }
  const parts = [summary.trim()];
  if (!findings.length) parts.push('The panel found nothing to flag.');
  else parts.push(`**${findings.length} finding${findings.length === 1 ? '' : 's'}**${comments.length ? `, ${comments.length} on the lines they're about` : ''}.`);
  if (loose.length) parts.push(['**Elsewhere**', ...loose.map((f) => `- ${ICON[f.severity]} ${lensTag(f)} \`${where(f)}\`: ${f.comment.replace(/\s*\n\s*/g, ' ')}`)].join('\n'));
  parts.push(`<sub>🔍 Review panel in Agent Office${lensNames.length ? `: ${lensNames.join(', ')}` : ''}.</sub>`);
  return { body: parts.filter(Boolean).join('\n\n'), event: 'COMMENT', comments };
}
