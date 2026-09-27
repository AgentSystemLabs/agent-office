import { execFile } from 'node:child_process';
import type { GhCheck, GhCloseReason, GhComment, GhIssue, GhIssueDetail, GhMergeMethod, GhPull, GhPullDetail, GhRepoInfo, GhReviewComment, GhState } from '../shared/protocol.js';

const REFRESH_MS = 90_000;

/** Turns gh's stderr into something a person standing at the board can act on. */
function friendly(raw: string): string {
  if (/no git remotes found|none of the git remotes/i.test(raw)) return 'This project has no GitHub remote yet. Push it to GitHub (git remote add origin <url>) to fill the boards.';
  if (/not a git repository/i.test(raw)) return "This folder isn't a git repository";
  if (/auth login|not logged in|authentication/i.test(raw)) return "gh isn't logged in on the server — run `gh auth login`";
  if (/could not resolve to a repository|not found/i.test(raw)) return "gh can't find this repository on GitHub (check the remote and access)";
  return raw;
}

export function gh(args: string[], cwd: string, timeout = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { cwd, maxBuffer: 32 * 1024 * 1024, timeout }, (err, stdout, stderr) => {
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

/**
 * How urgent an issue's labels say it is, 0 (critical) to 3 (low); 4 when it has no priority label.
 * Reads "priority: high", "priority/low", "P1", "critical" and the like.
 */
export function priorityRank(labels: { name: string }[]): number {
  let best = 4;
  for (const { name } of labels) {
    const n = name.toLowerCase().trim();
    const p = /^p([0-3])$/.exec(n) ?? /^priority\W*p?([0-3])$/.exec(n);
    let rank = p ? Number(p[1]) : 4;
    if (!p && (n.includes('priority') || /^(critical|urgent|blocker)$/.test(n))) {
      if (/critical|urgent|blocker|highest/.test(n)) rank = 0;
      else if (/high/.test(n)) rank = 1;
      else if (/medium|\bmed\b|normal|moderate/.test(n)) rank = 2;
      else if (/low|minor/.test(n)) rank = 3;
    }
    best = Math.min(best, rank);
  }
  return best;
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

const FAILED = ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'];

/** One entry of statusCheckRollup: a CheckRun (Actions) or a StatusContext (other CI). */
function checkOf(c: any): GhCheck {
  const concl = String(c.conclusion ?? c.state ?? '').toUpperCase();
  const status = String(c.status ?? '').toUpperCase();
  let state: GhCheck['state'] = 'pass';
  if (FAILED.includes(concl)) state = 'fail';
  else if ((status && status !== 'COMPLETED') || !concl || concl === 'PENDING' || concl === 'EXPECTED') state = 'pending';
  else if (['SKIPPED', 'NEUTRAL', 'STALE'].includes(concl)) state = 'skip';
  const name = String(c.name ?? c.context ?? 'check');
  return { name: c.workflowName ? `${c.workflowName} / ${name}` : name, state, url: c.detailsUrl ?? c.targetUrl ?? undefined };
}

function commentsOf(raw: any[]): GhComment[] {
  return (raw ?? []).map((c: any) => ({
    id: String(c.id),
    author: c.author?.login ?? 'ghost',
    body: String(c.body ?? ''),
    createdAt: c.createdAt ?? c.submittedAt ?? '',
    url: c.url,
    state: c.state,
  }));
}

/**
 * Spots pull requests that merged between two looks at the list, so the gong rings however they
 * merged: from the PR window, by a worker's `gh pr merge`, by auto-merge, or on GitHub itself.
 */
export class MergeWatch {
  /** Open at the last look; unset until the first, so starting the office up rings for nothing. */
  private open?: Set<number>;
  /** Rang for already (merged from the PR window), so the next look doesn't ring them again. */
  private rang = new Set<number>();

  /** The gong rings for `n`: false if it already has. */
  ring(n: number): boolean {
    if (this.rang.has(n)) return false;
    this.rang.add(n);
    return true;
  }

  /** A fresh list from GitHub: the pull requests that merged since the last look and haven't rung yet. */
  look(pulls: GhPull[]): GhPull[] {
    const open = this.open;
    const merged = open ? pulls.filter((p) => p.state === 'MERGED' && open.has(p.number) && !this.rang.has(p.number)) : [];
    // Once GitHub says it merged, it never shows as open again to ring twice.
    for (const p of pulls) if (p.state === 'MERGED') this.rang.delete(p.number);
    this.open = new Set(pulls.filter((p) => p.state === 'OPEN').map((p) => p.number));
    return merged;
  }
}

export class GitHub {
  issues: GhState<GhIssue> = { items: [], fetchedAt: 0, loading: false };
  pulls: GhState<GhPull> = { items: [], fetchedAt: 0, loading: false };
  private timer?: NodeJS.Timeout;
  private repo?: Promise<GhRepoInfo>;
  private login?: Promise<string>;

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

  /** The repository's full name and how it lets PRs merge. Asked once (again after a failure). */
  repoInfo(): Promise<GhRepoInfo> {
    this.repo ??= gh(['repo', 'view', '--json', 'nameWithOwner,squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed'], this.dir).then((out) => {
      const r = JSON.parse(out);
      const methods = (['squash', 'merge', 'rebase'] as const).filter((m) => r[{ squash: 'squashMergeAllowed', merge: 'mergeCommitAllowed', rebase: 'rebaseMergeAllowed' }[m]]);
      return { nameWithOwner: String(r.nameWithOwner), methods: methods.length ? methods : ['squash', 'merge', 'rebase'] };
    });
    this.repo.catch(() => (this.repo = undefined));
    return this.repo;
  }

  /** Who gh is signed in as, which is who the office comments as. Asked once; '' when gh can't say. */
  viewer(): Promise<string> {
    this.login ??= gh(['api', 'user', '--jq', '.login'], this.dir).then((out) => out.trim());
    this.login.catch(() => (this.login = undefined));
    return this.login.catch(() => '');
  }

  /** A PR's description, conversation, line comments, checks and whether it can merge. */
  async pullDetail(n: number): Promise<GhPullDetail> {
    const fields = 'number,body,state,isDraft,reviewDecision,headRefName,baseRefName,mergeable,mergeStateStatus,commits,comments,reviews,statusCheckRollup';
    const jq = '.[] | {id, in_reply_to_id, path, line, side, body, user: .user.login, created_at, html_url}';
    const [view, lines, repo, viewer] = await Promise.all([
      gh(['pr', 'view', String(n), '--json', fields], this.dir),
      gh(['api', `repos/{owner}/{repo}/pulls/${n}/comments?per_page=100`, '--paginate', '--jq', jq], this.dir),
      this.repoInfo(),
      this.viewer(),
    ]);
    const p = JSON.parse(view);
    const reviewComments: GhReviewComment[] = lines
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l))
      .map((c: any) => ({
        id: c.id,
        replyTo: c.in_reply_to_id ?? undefined,
        author: c.user ?? 'ghost',
        body: String(c.body ?? ''),
        createdAt: c.created_at,
        url: c.html_url,
        path: c.path,
        line: c.line ?? null,
        side: c.side === 'LEFT' ? 'LEFT' : 'RIGHT',
      }));
    return {
      number: p.number,
      body: String(p.body ?? ''),
      state: p.state,
      isDraft: !!p.isDraft,
      reviewDecision: p.reviewDecision ?? '',
      headRefName: p.headRefName,
      baseRefName: p.baseRefName,
      mergeable: p.mergeable ?? 'UNKNOWN',
      mergeStateStatus: p.mergeStateStatus ?? 'UNKNOWN',
      commits: (p.commits ?? []).length,
      comments: commentsOf(p.comments),
      // A line comment also makes an empty COMMENTED review; the comment itself is shown instead.
      reviews: commentsOf(p.reviews).filter((r) => r.body.trim() || r.state !== 'COMMENTED'),
      reviewComments,
      checks: (p.statusCheckRollup ?? []).map(checkOf),
      repo,
      viewer,
    };
  }

  /** The PR's unified diff, as `git diff` prints it. */
  pullDiff(n: number): Promise<string> {
    return gh(['pr', 'diff', String(n), '--color', 'never'], this.dir, 60_000);
  }

  async issueDetail(n: number): Promise<GhIssueDetail> {
    const [view, viewer] = await Promise.all([gh(['issue', 'view', String(n), '--json', 'number,state,body,comments'], this.dir), this.viewer()]);
    const i = JSON.parse(view);
    return { number: i.number, state: i.state, body: String(i.body ?? ''), comments: commentsOf(i.comments), viewer };
  }

  /**
   * Comments on an issue, or on a PR's conversation (to GitHub a PR is an issue too), as whoever gh
   * is signed in as. Returns the comment as GitHub saved it, or why it couldn't.
   */
  async comment(kind: 'issue' | 'pull', n: number, body: string): Promise<{ comment?: GhComment; error?: string }> {
    let comment: GhComment;
    try {
      // -f sends the body as a plain string: no @file reading, no {owner} filling in.
      const jq = '{id: .node_id, author: {login: .user.login}, body, createdAt: .created_at, url: .html_url}';
      const out = await gh(['api', '--method', 'POST', `repos/{owner}/{repo}/issues/${n}/comments`, '-f', `body=${body}`, '--jq', jq], this.dir);
      [comment] = commentsOf([JSON.parse(out)]);
    } catch (err) {
      return { error: (err as Error).message };
    }
    // The issue board counts comments; a PR's card shows when it was last updated.
    void (kind === 'issue' ? this.refreshIssues() : this.refreshPulls());
    return { comment };
  }

  /**
   * Posts a review on a pull request that only comments (the meeting room's review panel), its body
   * read from a file. Resolves to the review's URL.
   */
  async review(n: number, file: string): Promise<string> {
    // -F reads @file's contents as the value; {owner}/{repo} are filled in from the checkout's remote.
    const url = (await gh(['api', '--method', 'POST', `repos/{owner}/{repo}/pulls/${n}/reviews`, '-F', `body=@${file}`, '-f', 'event=COMMENT', '--jq', '.html_url'], this.dir, 60_000)).trim();
    void this.refreshPulls();
    return url;
  }

  /** Merges a PR, or with `auto` has GitHub merge it once its requirements pass. Returns an error. */
  async merge(n: number, method: GhMergeMethod, deleteBranch: boolean, auto: boolean): Promise<string | undefined> {
    try {
      const repo = await this.repoInfo();
      // --repo keeps gh out of the office's own checkout: without it, --delete-branch also deletes
      // the local branch and switches the project folder over to the base branch.
      const args = ['pr', 'merge', String(n), `--${method}`, '--repo', repo.nameWithOwner];
      if (deleteBranch) args.push('--delete-branch');
      if (auto) args.push('--auto');
      await gh(args, this.dir, 90_000);
    } catch (err) {
      return (err as Error).message;
    }
    void this.refreshPulls();
    return undefined;
  }

  /** Closes an issue, or a pull request without merging it, optionally saying why. Returns an error. */
  async close(kind: 'issue' | 'pull', n: number, opts: { comment?: string; reason?: GhCloseReason; deleteBranch?: boolean }): Promise<string | undefined> {
    try {
      const repo = await this.repoInfo();
      // --repo for the same reason as merge: --delete-branch must leave the office's checkout alone.
      const args = [kind === 'issue' ? 'issue' : 'pr', 'close', String(n), '--repo', repo.nameWithOwner];
      // --flag=value, so a comment starting with "-" isn't read as a flag.
      if (opts.comment) args.push(`--comment=${opts.comment}`);
      if (kind === 'issue' && opts.reason) args.push(`--reason=${opts.reason}`);
      if (kind === 'pull' && opts.deleteBranch) args.push('--delete-branch');
      await gh(args, this.dir);
    } catch (err) {
      return (err as Error).message;
    }
    const refresh = () => (kind === 'issue' ? this.refreshIssues() : this.refreshPulls());
    // A refresh already in flight returns at once and can still list it as open, so look again shortly after.
    void refresh().then(() => {
      if ((kind === 'issue' ? this.issues : this.pulls).items.some((i) => i.number === n && i.state === 'OPEN')) setTimeout(() => void refresh(), 3000);
    });
    return undefined;
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
      // Highest priority first, so the board (and the notes that fit on the wall) lead with it.
      // The sort is stable: within a priority, gh's newest-first order stays.
      items.sort((a, b) => priorityRank(a.labels) - priorityRank(b.labels));
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
