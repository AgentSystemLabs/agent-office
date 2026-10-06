// Triage on one floor: after each look at the issues board, every open issue that's new or changed
// is classified, labelled, and put on the queue when it passes the rules (see route.ts). One issue
// at a time, so a burst of issues doesn't fire a burst of calls.
import { appendFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { GhIssue, GhIssueDetail, GhLabel, GhState, QueueTriage, TriageModel, TriageResult, TriageServerMsg, TriageState } from '../../shared/protocol.js';
import { Collaborators } from './authors.js';
import { TriageCache, dayOf, issueHash, rulesKey, type TriageEntry } from './cache.js';
import type { Classifier } from './classifier.js';
import { loadTriageConfig, type TriageConfig } from './config.js';
import { ensureLabels, humanOverrode, labelDiff, type GhRun } from './labels.js';
import { DECISION_LABEL, route } from './route.js';
import { MAX_COMMENTS } from './state-block.js';

/** What a floor's triage needs from the floor. */
export interface TriageDeps {
  /** The floor's checkout, and its .agent-office folder. */
  dir: string;
  dataDir: string;
  /** Unset while the office runs without --triage. */
  classifier?: Classifier;
  run: GhRun;
  issueDetail(n: number): Promise<GhIssueDetail>;
  repoName(): Promise<string>;
  repoLabels(): Promise<GhLabel[]>;
  setLabels(n: number, add: string[], remove: string[]): Promise<{ labels?: GhLabel[]; error?: string }>;
  comment(n: number, body: string): Promise<{ error?: string }>;
  /** Puts it on the floor's queue; an error, or undefined once it's there. */
  queue(issue: GhIssue, model: TriageModel, priority: number, area: string | undefined, why: QueueTriage): string | undefined;
  needsDetailComment(issue: GhIssue): string;
  emit(msg: TriageServerMsg): void;
  toast(text: string, level?: 'info' | 'warn' | 'error'): void;
}

/** An issue the classifier or GitHub failed on is tried again after this long. */
const RETRY_MS = 10 * 60_000;
const DESCRIPTION_MS = 60 * 60_000;

export class FloorTriage {
  private cache: TriageCache;
  private authors: Collaborators;
  private issues = new Map<number, GhIssue>();
  private pending = new Map<number, { force?: boolean; reclassify?: boolean }>();
  private working = false;
  /** The issue being triaged: the board GitHub sends back mid-way (setLabels does) isn't news about it. */
  private current?: number;
  private stopped = new AbortController();
  /** Labels the repo has, once asked. */
  private known?: Set<string>;
  private description?: { at: number; text: string };

  constructor(private d: TriageDeps) {
    this.cache = new TriageCache(d.dataDir);
    this.authors = new Collaborators(d.run);
  }

  get enabled(): boolean {
    return !!this.d.classifier && this.config().enabled;
  }

  config(): TriageConfig {
    return loadTriageConfig(this.d.dataDir, (w) => this.log({ warn: w }));
  }

  state(): TriageState {
    return { enabled: this.enabled, results: this.cache.entries().map(publicResult), stats: this.cache.stats(this.config().dailyCap) };
  }

  /** The issues board came back from GitHub. */
  onIssues(state: GhState<GhIssue>) {
    if (state.loading || state.error) return;
    const open = state.items.filter((i) => i.state === 'OPEN');
    this.issues = new Map(open.map((i) => [i.number, i]));
    if (!this.enabled) return;
    this.cache.keepOnly(new Set(this.issues.keys()));
    const cfg = this.config();
    const rules = rulesKey(cfg);
    const today = dayOf(Date.now());
    for (const issue of open) {
      const e = this.cache.get(issue.number);
      if (e?.decision === 'opted-out' || this.pending.has(issue.number) || this.current === issue.number) continue;
      if (cfg.writeLabels && humanOverrode(issue.labels.map((l) => l.name), e?.written)) {
        this.optOut(issue, e);
        continue;
      }
      if (e && e.hash === issueHash(issue, e.ourComments)) {
        // Unchanged: only a failure past its wait, new settings, or a new day for one the daily cap
        // held, are worth another go (the last two only route its answers again, with no new call).
        if (e.decision === 'error' ? Date.now() - e.at < RETRY_MS : e.rules === rules && !(e.decision === 'held' && dayOf(e.at) !== today)) continue;
      }
      this.pending.set(issue.number, {});
    }
    void this.work();
  }

  /** Re-classify: classify it again, and take it back from whoever changed its labels. */
  reclassify(n: number): string | undefined {
    if (!this.enabled) return 'Triage is off on this floor';
    if (!this.issues.has(n)) return `#${n} isn't an open issue here`;
    this.pending.set(n, { reclassify: true });
    void this.work();
    return undefined;
  }

  /** Queue anyway: puts it on the queue whatever the rules said, unless it needs a human. */
  queueAnyway(n: number): string | undefined {
    if (!this.enabled) return 'Triage is off on this floor';
    const e = this.cache.get(n);
    if (!this.issues.has(n) || !e?.answers) return `#${n} hasn't been classified yet`;
    if (e.decision === 'needs-human') return `#${n} needs a human: it can't be queued from here`;
    this.pending.set(n, { force: true });
    void this.work();
    return undefined;
  }

  shutdown() {
    this.stopped.abort();
    this.pending.clear();
  }

  private async work() {
    if (this.working) return;
    this.working = true;
    try {
      while (this.pending.size && !this.stopped.signal.aborted) {
        const [n, opts] = this.pending.entries().next().value!;
        this.pending.delete(n);
        const issue = this.issues.get(n);
        if (!issue) continue;
        this.current = n;
        try {
          await this.triage(issue, opts);
        } finally {
          this.current = undefined;
        }
      }
    } finally {
      this.working = false;
    }
  }

  private async triage(issue: GhIssue, opts: { force?: boolean; reclassify?: boolean }) {
    const cfg = this.config();
    const prev = this.cache.get(issue.number);
    const ourComments = prev?.ourComments ?? 0;
    const hash = issueHash(issue, ourComments);
    const shadow = !cfg.writeLabels;
    const base = { number: issue.number, at: Date.now(), hash, ourComments, commented: prev?.commented, written: prev?.written, shadow, rules: rulesKey(cfg) };
    try {
      let answers = prev?.answers;
      if (!answers || opts.reclassify || prev?.hash !== hash || prev.decision === 'error') {
        answers = await this.classify(issue, cfg);
      }
      const trustedAuthor = await this.authors.trusted(issue.author, cfg.authors);
      const queuedToday = this.cache.stats(cfg.dailyCap).queued;
      let r = route(answers, cfg, { force: opts.force, trustedAuthor, queuedToday, shadow });
      const entry: TriageEntry = { ...base, decision: r.decision, reason: r.reason, answers, lowConfidence: r.lowConfidence, labels: r.labels };

      // Onto the queue first: if it won't go, it's labelled ready rather than queued.
      if (r.queue && (!shadow || opts.force)) {
        const area = answers.area.value || undefined;
        const why: QueueTriage = { reason: r.reason, size: answers.size.value, priority: answers.priority.value, area, confidence: answers.agentReady.p };
        const err = this.d.queue(issue, r.queue.model, r.queue.priority, area, why);
        if (err) {
          r = { ...r, decision: 'held', reason: err, labels: r.labels.map((l) => (l === DECISION_LABEL.queued ? DECISION_LABEL.held! : l)) };
          Object.assign(entry, { decision: r.decision, reason: r.reason, labels: r.labels });
        } else {
          entry.model = r.queue.model;
          this.cache.count('queued');
        }
      }
      if (!shadow) {
        await this.writeLabels(issue, r.labels);
        entry.written = r.labels;
        if (r.comment && !entry.commented) {
          // Counted before it's posted: the board may come back with it before the post does.
          entry.ourComments++;
          entry.commented = true;
          this.cache.set(entry);
          const res = await this.d.comment(issue.number, this.d.needsDetailComment(issue));
          if (res.error) this.log({ n: issue.number, commentError: res.error });
        }
      }
      if (r.decision === 'cross-repo' && prev?.decision !== 'cross-repo') this.d.toast(`🧭 Issue #${issue.number} needs another repo too: pick its floors by hand`, 'warn');
      this.done(entry);
    } catch (err) {
      if (this.stopped.signal.aborted) return;
      const error = (err as Error).message;
      this.done({ ...base, answers: prev?.answers, decision: 'error', reason: 'triage failed', labels: prev?.labels ?? [], error });
    }
  }

  private async classify(issue: GhIssue, cfg: TriageConfig) {
    const detail = await this.d.issueDetail(issue.number);
    const { answers, cost } = await this.d.classifier!.classify(
      {
        repo: await this.d.repoName(),
        description: cfg.description || (await this.repoDescription()),
        areas: cfg.areas,
        folders: this.folders(),
        issue: { number: issue.number, title: issue.title, body: detail.body, author: issue.author, labels: issue.labels.map((l) => l.name) },
        comments: detail.comments.slice(-MAX_COMMENTS).map((c) => ({ author: c.author, body: c.body })),
      },
      this.stopped.signal,
    );
    this.cache.count('triaged');
    if (cost) this.cache.spend(cost);
    return answers;
  }

  private async writeLabels(issue: GhIssue, wanted: string[]) {
    const { add, remove } = labelDiff(
      issue.labels.map((l) => l.name),
      wanted,
    );
    if (!add.length && !remove.length) return;
    this.known ??= new Set((await this.d.repoLabels()).map((l) => l.name));
    await ensureLabels(this.d.run, add, this.known);
    const res = await this.d.setLabels(issue.number, add, remove);
    if (res.error) throw new Error(res.error);
  }

  private optOut(issue: GhIssue, e: TriageEntry | undefined) {
    this.done({
      number: issue.number,
      at: Date.now(),
      hash: issueHash(issue, e?.ourComments ?? 0),
      ourComments: e?.ourComments ?? 0,
      commented: e?.commented,
      written: e?.written,
      answers: e?.answers,
      decision: 'opted-out',
      reason: 'labels changed by hand',
      labels: e?.labels ?? [],
      shadow: false,
    });
  }

  private done(e: TriageEntry) {
    this.cache.set(e);
    const cfg = this.config();
    this.log({ n: e.number, decision: e.decision, reason: e.reason, answers: e.answers, labels: e.labels, model: e.model, shadow: e.shadow, error: e.error });
    this.d.emit({ t: 'triage.result', result: publicResult(e), stats: this.cache.stats(cfg.dailyCap) });
  }

  private async repoDescription(): Promise<string> {
    if (this.description && Date.now() - this.description.at < DESCRIPTION_MS) return this.description.text;
    let text = '';
    try {
      text = (await this.d.run(['repo', 'view', '--json', 'description', '--jq', '.description'])).trim();
    } catch {
      // Not worth failing over.
    }
    this.description = { at: Date.now(), text };
    return text;
  }

  private folders(): string[] {
    try {
      return readdirSync(this.d.dir, { withFileTypes: true })
        .filter((f) => f.isDirectory() && !f.name.startsWith('.') && f.name !== 'node_modules')
        .map((f) => f.name)
        .slice(0, 50);
    } catch {
      return [];
    }
  }

  /** One line per decision in triage.log, to check later how the auto-queued ones went. */
  private log(line: Record<string, unknown>) {
    try {
      appendFileSync(path.join(this.d.dataDir, 'triage.log'), JSON.stringify({ at: new Date().toISOString(), ...line }) + '\n', { mode: 0o600 });
    } catch {
      // Logging never stops triage.
    }
  }
}

/** What the boards are sent: the result without the cache's bookkeeping. */
function publicResult(e: TriageEntry): TriageResult {
  const { hash: _h, written: _w, ourComments: _o, commented: _c, rules: _r, ...r } = e;
  return r;
}
