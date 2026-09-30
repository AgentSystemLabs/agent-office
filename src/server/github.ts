import { execFile, execFileSync } from 'node:child_process';
import { normalizeRepo } from '../shared/floors.js';
import type { GhCheck, GhCloseReason, GhComment, GhIssue, GhIssueDetail, GhLabel, GhMergeMethod, GhPull, GhPullDetail, GhRepoInfo, GhReviewComment, GhState } from '../shared/protocol.js';
import type { GhAs } from './signins.js';

const REFRESH_MS = 90_000;
/** How long the repo's list of labels is kept before the label picker asks GitHub again. */
const LABELS_MS = 60_000;

/** The GitHub repository a checkout's origin points at: the one people here push to. */
export function originRepo(dir: string): string | undefined {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).trim();
    return /github\.com[/:]/i.test(url) ? normalizeRepo(url) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The repository a checkout is worked on: `GH_REPO` when the office was started with it (which is
 * what gh itself would use), else the one origin points at. For a fork that's the fork, not the
 * repository it was forked from — gh, asked about a checkout with an `upstream` remote, works on
 * that one, which fills the boards with someone else's issues and pull requests. Undefined for a
 * checkout with no GitHub origin, where gh's own resolution (or the error it gives) is right.
 */
export function workRepo(dir: string): string | undefined {
  return normalizeRepo(process.env.GH_REPO) ?? originRepo(dir);
}

/**
 * `args` with `repo` said outright: `--repo` on the commands that take it, the name spelled out in
 * a `gh api` path (which has no flag of its own) and `gh repo view`'s own argument, which goes in
 * after the subcommand. Left as they are without one, so a checkout with no GitHub remote still
 * gets gh's own answer.
 */
export function repoArgs(args: string[], repo: string | undefined): string[] {
  if (!repo) return args;
  if (args[0] === 'api') return args.map((a) => (a.startsWith('repos/{owner}/{repo}') ? a.replace('{owner}/{repo}', repo) : a));
  if (args[0] === 'repo' && args[1] === 'view') {
    // The repository is an argument here, not a flag, so it goes in after the subcommand; one
    // already named (a caller asking about another repository) is the one to keep.
    if (args[2] && !args[2].startsWith('-')) return args;
    return [args[0], args[1], repo, ...args.slice(2)];
  }
  return [...args, '--repo', repo];
}

/** Turns gh's stderr into something a person standing at the board can act on. */
function friendly(raw: string): string {
  if (/no git remotes found|none of the git remotes/i.test(raw)) return 'This project has no GitHub remote yet. Push it to GitHub (git remote add origin <url>) to fill the boards.';
  if (/not a git repository/i.test(raw)) return "This folder isn't a git repository";
  if (/auth login|not logged in|authentication/i.test(raw)) return "gh isn't signed in to GitHub on the office's machine — run `gh auth login` there";
  if (/has disabled issues|issues are disabled/i.test(raw)) return 'GitHub issues are turned off for this repository (Settings → General → Features)';
  if (/could not resolve to a repository|not found/i.test(raw)) return "gh can't find this repository on GitHub (check the remote and access)";
  return raw;
}

/** Runs gh as the office, or with `env` as someone signed in to their own GitHub (see signins.ts). */
export function gh(args: string[], cwd: string, timeout = 30_000, env?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { cwd, maxBuffer: 32 * 1024 * 1024, timeout, env }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || err.message || '').trim().split('\n').slice(-2).join(' ');
        const signedOut = env && /auth login|not logged in|authentication/i.test(msg);
        reject(new Error((err as NodeJS.ErrnoException).code === 'ENOENT' ? 'GitHub CLI (gh) is not installed on the server' : signedOut ? 'Your GitHub sign-in stopped working — sign in again (☰ → 🔐 Your sign-ins)' : friendly(msg)));
      } else resolve(stdout);
    });
  });
}

function labels(raw: any[]): GhLabel[] {
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
  private labelList?: { at: number; list: Promise<GhLabel[]> };
  /** The repository this project is worked on (see workRepo), found once: it can't change under us. */
  private target?: Promise<string | undefined>;
  /** Labels just changed from the office, by "issue:N" or "pull:N", and when. */
  private relabeled = new Map<string, { labels: GhLabel[]; at: number }>();

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

  /**
   * `gh` in this project's checkout, told which repository to work on: the one its origin points
   * at, so a fork's boards and pull requests are its own (see workRepo, repoArgs).
   */
  private onRepo(args: string[], as?: GhAs, timeout?: number): Promise<string> {
    // Off the tick, so reading the remote doesn't hold up the rest of the office.
    this.target ??= Promise.resolve().then(() => workRepo(this.dir));
    return this.target.then((repo) => gh(repoArgs(args, repo), this.dir, timeout, as?.env));
  }

  /** The repository's full name and how it lets PRs merge. Asked once (again after a failure). */
  repoInfo(): Promise<GhRepoInfo> {
    this.repo ??= this.onRepo(['repo', 'view', '--json', 'nameWithOwner,squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed']).then((out) => {
      const r = JSON.parse(out);
      const methods = (['squash', 'merge', 'rebase'] as const).filter((m) => r[{ squash: 'squashMergeAllowed', merge: 'mergeCommitAllowed', rebase: 'rebaseMergeAllowed' }[m]]);
      return { nameWithOwner: String(r.nameWithOwner), methods: methods.length ? methods : ['squash', 'merge', 'rebase'] };
    });
    this.repo.catch(() => (this.repo = undefined));
    return this.repo;
  }

  /** Who the office's own gh is signed in as, which is who it comments as for everyone without their own. Asked once; '' when gh can't say. */
  viewer(): Promise<string> {
    this.login ??= gh(['api', 'user', '--jq', '.login'], this.dir).then((out) => out.trim());
    this.login.catch(() => (this.login = undefined));
    return this.login.catch(() => '');
  }

  /**
   * A PR's description, conversation, line comments, checks and whether it can merge. `me` is the
   * GitHub login of whoever asked, when they're signed in to their own; else it's the office's.
   */
  async pullDetail(n: number, me?: string): Promise<GhPullDetail> {
    const fields = 'number,body,state,isDraft,reviewDecision,headRefName,baseRefName,mergeable,mergeStateStatus,commits,comments,reviews,statusCheckRollup';
    const jq = '.[] | {id, in_reply_to_id, path, line, side, body, user: .user.login, created_at, html_url}';
    const [view, lines, repo, viewer] = await Promise.all([
      this.onRepo(['pr', 'view', String(n), '--json', fields]),
      this.onRepo(['api', `repos/{owner}/{repo}/pulls/${n}/comments?per_page=100`, '--paginate', '--jq', jq]),
      this.repoInfo(),
      me ?? this.viewer(),
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
    return this.onRepo(['pr', 'diff', String(n), '--color', 'never'], undefined, 60_000);
  }

  async issueDetail(n: number, me?: string): Promise<GhIssueDetail> {
    const [view, viewer] = await Promise.all([this.onRepo(['issue', 'view', String(n), '--json', 'number,state,body,comments']), me ?? this.viewer()]);
    const i = JSON.parse(view);
    return { number: i.number, state: i.state, body: String(i.body ?? ''), comments: commentsOf(i.comments), viewer };
  }

  /**
   * Comments on an issue, or on a PR's conversation (to GitHub a PR is an issue too), as `as` or
   * else the office. Returns the comment as GitHub saved it, or why it couldn't.
   */
  async comment(kind: 'issue' | 'pull', n: number, body: string, as?: GhAs): Promise<{ comment?: GhComment; error?: string }> {
    let comment: GhComment;
    try {
      // -f sends the body as a plain string: no @file reading, and none of the {owner} filling in -F does.
      const jq = '{id: .node_id, author: {login: .user.login}, body, createdAt: .created_at, url: .html_url}';
      const out = await this.onRepo(['api', '--method', 'POST', `repos/{owner}/{repo}/issues/${n}/comments`, '-f', `body=${body}`, '--jq', jq], as);
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
  async review(n: number, file: string, as?: GhAs): Promise<string> {
    // -F reads @file's contents as the value; the repository is the one this project works on.
    const url = (await this.onRepo(['api', '--method', 'POST', `repos/{owner}/{repo}/pulls/${n}/reviews`, '-F', `body=@${file}`, '-f', 'event=COMMENT', '--jq', '.html_url'], as, 60_000)).trim();
    void this.refreshPulls();
    return url;
  }

  /** Merges a PR, or with `auto` has GitHub merge it once its requirements pass. Returns an error. */
  async merge(n: number, method: GhMergeMethod, deleteBranch: boolean, auto: boolean, as?: GhAs): Promise<string | undefined> {
    try {
      const repo = await this.repoInfo();
      // --repo keeps gh out of the office's own checkout: without it, --delete-branch also deletes
      // the local branch and switches the project folder over to the base branch.
      const args = ['pr', 'merge', String(n), `--${method}`, '--repo', repo.nameWithOwner];
      if (deleteBranch) args.push('--delete-branch');
      if (auto) args.push('--auto');
      await gh(args, this.dir, 90_000, as?.env);
    } catch (err) {
      return (err as Error).message;
    }
    void this.refreshPulls();
    return undefined;
  }

  /** Closes an issue, or a pull request without merging it, optionally saying why. Returns an error. */
  async close(kind: 'issue' | 'pull', n: number, opts: { comment?: string; reason?: GhCloseReason; deleteBranch?: boolean }, as?: GhAs): Promise<string | undefined> {
    try {
      const repo = await this.repoInfo();
      // --repo for the same reason as merge: --delete-branch must leave the office's checkout alone.
      const args = [kind === 'issue' ? 'issue' : 'pr', 'close', String(n), '--repo', repo.nameWithOwner];
      // --flag=value, so a comment starting with "-" isn't read as a flag.
      if (opts.comment) args.push(`--comment=${opts.comment}`);
      if (kind === 'issue' && opts.reason) args.push(`--reason=${opts.reason}`);
      if (kind === 'pull' && opts.deleteBranch) args.push('--delete-branch');
      await gh(args, this.dir, undefined, as?.env);
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

  /** Every label the repository has, for the label picker. Asked again after a minute (or a failure). */
  repoLabels(): Promise<GhLabel[]> {
    if (!this.labelList || Date.now() - this.labelList.at > LABELS_MS) {
      const list = this.onRepo(['api', 'repos/{owner}/{repo}/labels?per_page=100', '--paginate', '--jq', '.[] | {name, color, description}']).then((out) =>
        out
          .split('\n')
          .filter((l) => l.trim())
          .map((l) => JSON.parse(l))
          .map((l: any) => ({ name: String(l.name), color: `#${l.color ?? '888888'}`, description: l.description || undefined })),
      );
      this.labelList = { at: Date.now(), list };
      list.catch(() => this.labelList?.list === list && (this.labelList = undefined));
    }
    return this.labelList.list;
  }

  /**
   * Puts labels on an issue or PR and takes others off (to GitHub a PR is an issue too), as `as` or
   * else the office. Returns the labels it has now, or why they didn't change.
   */
  async setLabels(kind: 'issue' | 'pull', n: number, add: string[], remove: string[], as?: GhAs): Promise<{ labels?: GhLabel[]; error?: string }> {
    const path = `repos/{owner}/{repo}/issues/${n}/labels`;
    const jq = '[.[] | {name, color}]';
    let now: GhLabel[] | undefined;
    try {
      // -f labels[]=… sends a JSON array of plain strings: no @file reading in the values.
      if (add.length) now = labels(JSON.parse(await this.onRepo(['api', '--method', 'POST', path, ...add.flatMap((l) => ['-f', `labels[]=${l}`]), '--jq', jq], as)));
      for (const l of remove) {
        try {
          now = labels(JSON.parse(await this.onRepo(['api', '--method', 'DELETE', `${path}/${encodeURIComponent(l)}`, '--jq', jq], as)));
        } catch (err) {
          // Someone took it off already, which is what was asked for.
          if (!/label does not exist/i.test((err as Error).message)) throw err;
        }
      }
      now ??= labels(JSON.parse(await this.onRepo(['api', `${path}?per_page=100`, '--jq', jq])));
    } catch (err) {
      // Some may have changed before it failed.
      void (kind === 'issue' ? this.refreshIssues() : this.refreshPulls());
      return { error: (err as Error).message };
    }
    // The board shows them at once, before the next look at GitHub (see relabel).
    const at = Date.now();
    this.relabeled.set(`${kind}:${n}`, { labels: now, at });
    if (kind === 'issue') {
      this.issues = { ...this.issues, items: this.relabel('issue', this.issues.items, at) };
      this.onIssues(this.issues);
      void this.refreshIssues();
    } else {
      this.pulls = { ...this.pulls, items: this.relabel('pull', this.pulls.items, at) };
      this.onPulls(this.pulls);
      void this.refreshPulls();
    }
    return { labels: now };
  }

  /**
   * A list asked for before a label change made here still has the old labels, so the new ones are
   * kept over it; a list asked for after the change is believed, and the change forgotten.
   */
  private relabel<T extends GhIssue | GhPull>(kind: 'issue' | 'pull', items: T[], asked: number): T[] {
    return items.map((it) => {
      const key = `${kind}:${it.number}`;
      const r = this.relabeled.get(key);
      if (!r) return it;
      if (r.at < asked) {
        this.relabeled.delete(key);
        return it;
      }
      return { ...it, labels: r.labels };
    });
  }

  /** Assigns the issue to `as` (else the office's own gh), which moves it to In progress on the board. */
  async claim(issue: number, as?: GhAs): Promise<string | undefined> {
    try {
      await this.onRepo(['issue', 'edit', String(issue), '--add-assignee', '@me'], as);
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
    const asked = Date.now();
    try {
      // Open and closed separately, so old open issues are never crowded out by recent closed ones.
      const fields = 'number,title,state,url,author,labels,assignees,createdAt,updatedAt,body,comments';
      const [open, closed] = await Promise.all([
        this.onRepo(['issue', 'list', '--state', 'open', '--limit', '300', '--json', fields]),
        this.onRepo(['issue', 'list', '--state', 'closed', '--limit', '40', '--json', fields]),
      ]);
      const fetched: GhIssue[] = [...JSON.parse(open), ...JSON.parse(closed)].map((i: any) => ({
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
      const items = this.relabel('issue', fetched, asked);
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
    const asked = Date.now();
    try {
      const fields = 'number,title,state,isDraft,url,author,labels,reviewDecision,headRefName,headRefOid,baseRefName,createdAt,updatedAt,additions,deletions,statusCheckRollup,body,closingIssuesReferences';
      const [open, merged, closed] = await Promise.all([
        this.onRepo(['pr', 'list', '--state', 'open', '--limit', '150', '--json', fields]),
        this.onRepo(['pr', 'list', '--state', 'merged', '--limit', '30', '--json', fields]),
        this.onRepo(['pr', 'list', '--state', 'closed', '--limit', '40', '--json', fields]),
      ]);
      // `--state closed` includes merged PRs; keep only the ones closed without merging.
      const seen = new Set<number>();
      const all = [...JSON.parse(open), ...JSON.parse(merged), ...JSON.parse(closed)].filter((p: any) => !seen.has(p.number) && seen.add(p.number));
      const fetched: GhPull[] = all.map((p: any) => ({
        number: p.number,
        title: p.title,
        state: p.state,
        isDraft: !!p.isDraft,
        url: p.url,
        author: p.author?.login ?? '',
        labels: labels(p.labels),
        reviewDecision: p.reviewDecision ?? '',
        headRefName: p.headRefName,
        headRefOid: typeof p.headRefOid === 'string' ? p.headRefOid : undefined,
        baseRefName: p.baseRefName,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        additions: p.additions ?? 0,
        deletions: p.deletions ?? 0,
        checks: checksOf(p.statusCheckRollup),
        body: String(p.body ?? '').slice(0, 4000),
        closes: (p.closingIssuesReferences ?? []).map((r: any) => Number(r.number)).filter((n: number) => Number.isInteger(n) && n > 0),
      }));
      const items = this.relabel('pull', fetched, asked);
      this.pulls = { items, fetchedAt: Date.now(), loading: false };
    } catch (err) {
      this.pulls = { ...this.pulls, loading: false, error: (err as Error).message, fetchedAt: Date.now() };
    }
    this.onPulls(this.pulls);
  }
}
