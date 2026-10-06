// What triage knows about a floor's issues, kept in <floor>/.agent-office/triage-cache.json so an
// issue that hasn't changed is never classified twice, and what it did each day.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { GhIssue, TriageResult, TriageStats } from '../../shared/protocol.js';
import { isOwnedLabel } from './route.js';

export interface TriageEntry extends TriageResult {
  /** The issue as it was when classified (see issueHash). */
  hash: string;
  /** The owned labels triage last wrote to GitHub; unset while it has written none. */
  written?: string[];
  /** Comments triage posted on it, which don't count as the issue changing. */
  ourComments: number;
  /** It already asked for more detail. */
  commented?: boolean;
  /** The floor's settings it was routed with (see rulesKey): new settings route it again. */
  rules?: string;
}

interface Day {
  triaged: number;
  queued: number;
  spend: number;
}

interface CacheFile {
  issues: Record<string, TriageEntry>;
  days: Record<string, Day>;
}

/** Days kept in the file. */
const KEEP_DAYS = 30;

/** The office's local day, as YYYY-MM-DD. */
export function dayOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * What an issue says, without what triage itself does to it: its own labels and comments. Writing
 * those moves the issue's updatedAt, which would have it classified again and again.
 */
export function issueHash(issue: Pick<GhIssue, 'title' | 'body' | 'labels' | 'comments'>, ourComments: number): string {
  const labels = issue.labels.map((l) => l.name).filter((n) => !isOwnedLabel(n)).sort();
  return createHash('sha256')
    .update(JSON.stringify([issue.title, issue.body, labels, issue.comments - ourComments]))
    .digest('hex')
    .slice(0, 32);
}

/** The floor's triage.json, as a short key: routing is redone whenever it changes. */
export function rulesKey(cfg: unknown): string {
  return createHash('sha256').update(JSON.stringify(cfg)).digest('hex').slice(0, 16);
}

export class TriageCache {
  private file: string;
  private data: CacheFile = { issues: {}, days: {} };

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'triage-cache.json');
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8'));
        if (raw && typeof raw === 'object') this.data = { issues: raw.issues ?? {}, days: raw.days ?? {} };
      }
    } catch {
      // A broken cache only costs classifying everything again.
    }
  }

  get(n: number): TriageEntry | undefined {
    return this.data.issues[n];
  }

  set(e: TriageEntry) {
    this.data.issues[e.number] = e;
    this.save();
  }

  /** Forgets issues no longer open on the board. */
  keepOnly(open: Set<number>) {
    let gone = false;
    for (const k of Object.keys(this.data.issues))
      if (!open.has(Number(k))) {
        delete this.data.issues[k];
        gone = true;
      }
    if (gone) this.save();
  }

  entries(): TriageEntry[] {
    return Object.values(this.data.issues);
  }

  count(what: 'triaged' | 'queued', now = Date.now()) {
    this.day(now)[what]++;
    this.save();
  }

  spend(usd: number, now = Date.now()) {
    if (!(usd > 0)) return;
    this.day(now).spend += usd;
    this.save();
  }

  stats(cap: number, now = Date.now()): TriageStats {
    const day = dayOf(now);
    const d = this.data.days[day] ?? { triaged: 0, queued: 0, spend: 0 };
    return { day, triaged: d.triaged, queued: d.queued, cap, spend: Math.round(d.spend * 10000) / 10000 };
  }

  private day(now: number): Day {
    const key = dayOf(now);
    if (!this.data.days[key]) {
      this.data.days[key] = { triaged: 0, queued: 0, spend: 0 };
      const keys = Object.keys(this.data.days).sort();
      for (const old of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete this.data.days[old];
    }
    return this.data.days[key];
  }

  private save() {
    try {
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch {
      // Not fatal: it's a cache.
    }
  }
}
