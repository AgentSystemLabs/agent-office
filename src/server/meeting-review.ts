// The review panel's findings (see shared/review.ts): each reviewer writes its own as JSON, the office
// merges them into the notes for the head of the table to go through, then posts the summary and the
// findings on the pull request as one review.
import { closeSync, openSync, readFileSync, readSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { slugify } from '../shared/meetings.js';
import type { Meeting, MeetingTurn } from '../shared/protocol.js';
import { mergeFindings, normalize, parseFindings, type ReviewFinding } from '../shared/review.js';

/** The review panel's merged findings, in the notes, for the head of the table to go through. */
export const FINDINGS = 'findings.json';
/** How much of the head of the table's summary goes on the pull request. */
const SUMMARY_MAX = 20_000;

export interface ReviewPanelDeps {
  /** The meeting's checkout. */
  cwd(m: Meeting): string;
  toast(text: string, level: 'info' | 'warn' | 'error'): void;
  /** The meeting changed: save it and tell everyone. */
  changed(): void;
  /** Hands a worker a prompt. Returns why it couldn't, if it couldn't. */
  prompt(workerId: string, text: string): string | undefined;
  postReview(pr: number, summary: string, findings: ReviewFinding[], lenses: string[], owner?: string): Promise<string>;
}

export class ReviewPanel {
  constructor(private deps: ReviewPanelDeps) {}

  /**
   * A reviewer's findings the office can't read get one more go, apart from the reminder every part
   * gets for not writing its file; the second time they're left out. Returns whether it was sent back.
   */
  sendBack(m: Meeting, t: MeetingTurn, workerId: string): boolean {
    if (m.pattern !== 'review' || t.reread || !t.file.endsWith('.json')) return false;
    const bad = this.unreadable(m, t);
    if (!bad) return false;
    t.reread = true;
    // Moved aside, so the part only counts as done once it's written again.
    const file = path.join(this.deps.cwd(m), t.file);
    try {
      renameSync(file, `${file}.unreadable`);
    } catch {
      return false;
    }
    // Not told, it would never write them again: done, and its findings are left out.
    if (this.deps.prompt(workerId, `The office couldn't read your findings (${bad}); they're in ${file}.unreadable now. Write them again to ${file} as nothing but a JSON array, like [{"file": "src/a.ts", "line": 12, "severity": "high", "comment": "…"}] (or [] when there are none), then end your turn.`)) return false;
    t.state = 'sent';
    t.sentAt = Date.now();
    return true;
  }

  /** Round 1 is written: merge the findings into the notes for the head of the table to go through. */
  gather(m: Meeting) {
    try {
      writeFileSync(path.join(this.deps.cwd(m), m.notes, FINDINGS), `${JSON.stringify(this.merged(m), null, 2)}\n`);
    } catch {
      // finalFindings merges them again
    }
  }

  /** The summary is written: post the review, or hold the findings for someone to trim. */
  finish(m: Meeting) {
    m.findings = this.finalFindings(m);
    if (m.hold) this.deps.toast(`🔍 The panel's ${m.findings.length} finding${m.findings.length === 1 ? '' : 's'} on PR #${m.pr} are waiting in the meeting room: trim them, then post the review`, 'info');
    else this.publish(m, m.findings);
  }

  /**
   * Posts a held review panel's findings on its pull request, leaving out those at the indexes in
   * `drop` (the ones someone trimmed in the meeting room). Returns why it can't.
   */
  post(m: Meeting | null, drop: number[], by: string): string | undefined {
    if (!m || m.pattern !== 'review' || m.status !== 'done' || !m.findings) return 'No review panel has findings waiting';
    if (m.review?.url || m.review?.posting) return 'The panel’s review is already on the pull request';
    const gone = new Set(drop.filter((i) => Number.isInteger(i) && i >= 0 && i < m.findings!.length));
    m.dropped = [...gone].sort((a, b) => a - b);
    this.deps.toast(`🔍 ${by} is posting the panel's review on PR #${m.pr}${gone.size ? ` (${gone.size} finding${gone.size === 1 ? '' : 's'} trimmed)` : ''}`, 'info');
    this.publish(m, m.findings.filter((_, i) => !gone.has(i)));
    return undefined;
  }

  /** Posts the review panel's review: the summary the head of the table wrote, and these findings. */
  private publish(m: Meeting, findings: ReviewFinding[]) {
    const pr = m.pr!;
    let summary = '';
    try {
      summary = readStart(path.join(this.deps.cwd(m), m.output), SUMMARY_MAX * 2).slice(0, SUMMARY_MAX);
    } catch {
      // posted without a summary: the findings are the review
    }
    m.review = { posting: true };
    this.deps.changed();
    void this.deps.postReview(pr, summary, findings, m.seats.map((s) => s.role), m.owner).then(
      (url) => {
        m.review = { url };
        this.deps.toast(`🔍 Posted the panel's review on PR #${pr}: ${findings.length} finding${findings.length === 1 ? '' : 's'}`, 'info');
        this.deps.changed();
      },
      (err) => {
        m.review = { error: (err as Error).message };
        this.deps.toast(`Couldn't post the panel's review on PR #${pr}: ${m.review.error}`, 'warn');
        this.deps.changed();
      },
    );
  }

  /** Why a reviewer's findings file can't be read, or undefined when it can. */
  private unreadable(m: Meeting, t: MeetingTurn): string | undefined {
    try {
      parseFindings(readFileSync(path.join(this.deps.cwd(m), t.file), 'utf8'), m.seats[t.seat].role);
      return undefined;
    } catch (err) {
      return (err as Error).message;
    }
  }

  /** Every reviewer's findings, merged: those the office can't read are left out, saying so. */
  private merged(m: Meeting): ReviewFinding[] {
    const lists: ReviewFinding[][] = [];
    m.seats.forEach((s, i) => {
      try {
        lists.push(parseFindings(readFileSync(path.join(this.deps.cwd(m), findingsNote(m, i)), 'utf8'), s.role));
      } catch {
        this.deps.toast(`🔍 Left out the ${s.role} reviewer's findings: the office couldn't read them`, 'warn');
      }
    });
    return mergeFindings(lists);
  }

  /** The findings to post: the merged file as the head of the table left it, or merged afresh. */
  private finalFindings(m: Meeting): ReviewFinding[] {
    try {
      const raw: unknown = JSON.parse(readFileSync(path.join(this.deps.cwd(m), m.notes, FINDINGS), 'utf8'));
      // Kept as the array it was, or wrapped in {"findings": [...]} as reviewers may write theirs.
      const list = Array.isArray(raw) ? raw : (raw as { findings?: unknown } | null)?.findings;
      if (Array.isArray(list)) return mergeFindings([list.map((x) => normalize(x)).filter((f): f is ReviewFinding => f !== null)]);
    } catch {
      // no merged file, or the head of the table broke it
    }
    return this.merged(m);
  }
}

/** Where the reviewer at seat `i` writes its findings. */
export function findingsNote(m: Meeting, i: number): string {
  return `${m.notes}/r1-${i + 1}-${slugify(m.seats[i].role, 24)}.json`;
}

/** The start of a file, at most `bytes` of it. */
export function readStart(file: string, bytes: number): string {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString('utf8').replace(/�+$/, '');
  } finally {
    closeSync(fd);
  }
}
