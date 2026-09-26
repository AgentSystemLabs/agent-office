import { execFile } from 'node:child_process';
import type { GhIssue, GhPull, GhState } from '../shared/protocol.js';

const REFRESH_MS = 90_000;

/** Turns gh's stderr into something a person standing at the board can act on. */
function friendly(raw: string): string {
  if (/no git remotes found|none of the git remotes/i.test(raw)) return 'This project has no GitHub remote yet. Push it to GitHub (git remote add origin <url>) to fill the boards.';
  if (/not a git repository/i.test(raw)) return "This folder isn't a git repository";
  if (/auth login|not logged in|authentication/i.test(raw)) return "gh isn't logged in on the server — run `gh auth login`";
  if (/could not resolve to a repository|not found/i.test(raw)) return "gh can't find this repository on GitHub (check the remote and access)";
  return raw;
}

function gh(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { cwd, maxBuffer: 32 * 1024 * 1024, timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || err.message || '').trim().split('\n').slice(-2).join(' ');
        reject(new Error((err as NodeJS.ErrnoException).code === 'ENOENT' ? 'GitHub CLI (gh) is not installed on the server' : friendly(msg)));
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

  /** Assigns the issue to whoever gh is signed in as, which moves it to In progress on the board. */
  async claim(issue: number): Promise<string | undefined> {
    try {
      await gh(['issue', 'edit', String(issue), '--add-assignee', '@me'], this.dir);
    } catch (err) {
      return (err as Error).message;
    }
    void this.refreshIssues();
    return undefined;
  }

  private async refreshIssues() {
    if (this.issues.loading) return;
    this.issues = { ...this.issues, loading: true };
    this.onIssues(this.issues);
    try {
      // Open and closed separately, so old open issues are never crowded out by recent closed ones.
      const fields = 'number,title,state,url,author,labels,assignees,createdAt,updatedAt,body,comments';
      const [open, closed] = await Promise.all([
        gh(['issue', 'list', '--state', 'open', '--limit', '300', '--json', fields], this.dir),
        gh(['issue', 'list', '--state', 'closed', '--limit', '40', '--json', fields], this.dir),
      ]);
      const items: GhIssue[] = [...JSON.parse(open), ...JSON.parse(closed)].map((i: any) => ({
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
      const fields = 'number,title,state,isDraft,url,author,labels,reviewDecision,headRefName,baseRefName,createdAt,updatedAt,additions,deletions,statusCheckRollup,body,closingIssuesReferences';
      const [open, merged, closed] = await Promise.all([
        gh(['pr', 'list', '--state', 'open', '--limit', '150', '--json', fields], this.dir),
        gh(['pr', 'list', '--state', 'merged', '--limit', '30', '--json', fields], this.dir),
        gh(['pr', 'list', '--state', 'closed', '--limit', '40', '--json', fields], this.dir),
      ]);
      // `--state closed` includes merged PRs; keep only the ones closed without merging.
      const seen = new Set<number>();
      const all = [...JSON.parse(open), ...JSON.parse(merged), ...JSON.parse(closed)].filter((p: any) => !seen.has(p.number) && seen.add(p.number));
      const items: GhPull[] = all.map((p: any) => ({
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
        closes: (p.closingIssuesReferences ?? []).map((r: any) => Number(r.number)).filter((n: number) => Number.isInteger(n) && n > 0),
      }));
      this.pulls = { items, fetchedAt: Date.now(), loading: false };
    } catch (err) {
      this.pulls = { ...this.pulls, loading: false, error: (err as Error).message, fetchedAt: Date.now() };
    }
    this.onPulls(this.pulls);
  }
}
