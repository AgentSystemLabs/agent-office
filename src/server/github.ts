import { execFile } from 'node:child_process';
import type { GhIssue, GhPull, GhState } from '../shared/protocol.js';

const REFRESH_MS = 90_000;

function gh(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { cwd, maxBuffer: 32 * 1024 * 1024, timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || err.message || '').trim().split('\n').slice(-2).join(' ');
        reject(new Error((err as NodeJS.ErrnoException).code === 'ENOENT' ? 'GitHub CLI (gh) is not installed on the server' : msg));
      } else resolve(stdout);
    });
  });
}

function labels(raw: any[]): { name: string; color: string }[] {
  return (raw ?? []).map((l) => ({ name: String(l.name), color: `#${l.color ?? '888888'}` }));
}

function checksOf(rollup: any[]): GhPull['checks'] {
  if (!rollup?.length) return 'none';
  let pending = false;
  for (const c of rollup) {
    const concl = String(c.conclusion ?? c.state ?? '').toUpperCase();
    const status = String(c.status ?? '').toUpperCase();
    if (['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(concl)) return 'fail';
    if (status && status !== 'COMPLETED') pending = true;
    if (concl === 'PENDING' || concl === 'EXPECTED') pending = true;
  }
  return pending ? 'pending' : 'pass';
}

export class GitHub {
  issues: GhState<GhIssue> = { items: [], fetchedAt: 0, loading: false };
  pulls: GhState<GhPull> = { items: [], fetchedAt: 0, loading: false };
  private timer?: NodeJS.Timeout;

  constructor(
    private dir: string,
    private onIssues: (s: GhState<GhIssue>) => void,
    private onPulls: (s: GhState<GhPull>) => void,
  ) {}

  start() {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
  }

  stop() {
    clearInterval(this.timer);
  }

  async refresh() {
    await Promise.all([this.refreshIssues(), this.refreshPulls()]);
  }

  private async refreshIssues() {
    if (this.issues.loading) return;
    this.issues = { ...this.issues, loading: true };
    this.onIssues(this.issues);
    try {
      const out = await gh(
        ['issue', 'list', '--state', 'all', '--limit', '150', '--json', 'number,title,state,url,author,labels,assignees,createdAt,updatedAt,body,comments'],
        this.dir,
      );
      const items: GhIssue[] = JSON.parse(out).map((i: any) => ({
        number: i.number,
        title: i.title,
        state: i.state,
        url: i.url,
        author: i.author?.login ?? '',
        labels: labels(i.labels),
        assignees: (i.assignees ?? []).map((a: any) => a.login),
        createdAt: i.createdAt,
        updatedAt: i.updatedAt,
        body: String(i.body ?? '').slice(0, 4000),
        comments: Array.isArray(i.comments) ? i.comments.length : Number(i.comments ?? 0),
      }));
      this.issues = { items, fetchedAt: Date.now(), loading: false };
    } catch (err) {
      this.issues = { ...this.issues, loading: false, error: (err as Error).message, fetchedAt: Date.now() };
    }
    this.onIssues(this.issues);
  }

  private async refreshPulls() {
    if (this.pulls.loading) return;
    this.pulls = { ...this.pulls, loading: true };
    this.onPulls(this.pulls);
    try {
      const out = await gh(
        [
          'pr', 'list', '--state', 'all', '--limit', '80', '--json',
          'number,title,state,isDraft,url,author,labels,reviewDecision,headRefName,baseRefName,createdAt,updatedAt,additions,deletions,statusCheckRollup,body',
        ],
        this.dir,
      );
      const items: GhPull[] = JSON.parse(out).map((p: any) => ({
        number: p.number,
        title: p.title,
        state: p.state,
        isDraft: !!p.isDraft,
        url: p.url,
        author: p.author?.login ?? '',
        labels: labels(p.labels),
        reviewDecision: p.reviewDecision ?? '',
        headRefName: p.headRefName,
        baseRefName: p.baseRefName,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        additions: p.additions ?? 0,
        deletions: p.deletions ?? 0,
        checks: checksOf(p.statusCheckRollup),
        body: String(p.body ?? '').slice(0, 4000),
      }));
      this.pulls = { items, fetchedAt: Date.now(), loading: false };
    } catch (err) {
      this.pulls = { ...this.pulls, loading: false, error: (err as Error).message, fetchedAt: Date.now() };
    }
    this.onPulls(this.pulls);
  }
}
