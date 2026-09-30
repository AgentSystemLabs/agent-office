import type { GhCheck, GhCloseReason, GhComment, GhIssue, GhIssueDetail, GhLabel, GhMergeMethod, GhPull, GhPullDetail, GhRepoInfo, GhReviewComment, GhState } from '../shared/protocol.js';
import { Forge, gh, repoArgs, workRepo } from './forge.js';
import type { ForgeAs } from './signins.js';

/** How long the repo's list of labels is kept before the label picker asks GitHub again. */
const LABELS_MS = 60_000;

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

/** A floor on GitHub: its issues and pull requests, read with the GitHub CLI (gh). */
export class GitHub extends Forge {
  private labelList?: { at: number; list: Promise<GhLabel[]> };
  /** The repository this project is worked on (see workRepo), found once: it can't change under us. */
  private target?: Promise<string | undefined>;

  constructor(
    dir: string,
    onIssues: (s: GhState<GhIssue>) => void,
    onPulls: (s: GhState<GhPull>) => void,
  ) {
    super(dir, 'github', onIssues, onPulls);
  }

  /**
   * `gh` in this project's checkout, told which repository to work on: the one its origin points
   * at, so a fork's boards and pull requests are its own (see workRepo, repoArgs).
   */
  private onRepo(args: string[], as?: ForgeAs, timeout?: number): Promise<string> {
    // Off the tick, so reading the remote doesn't hold up the rest of the office.
    this.target ??= Promise.resolve().then(() => workRepo(this.dir));
    return this.target.then((repo) => gh(repoArgs(args, repo), this.dir, timeout, as?.env));
  }

  /** The repository's full name and how it lets PRs merge. Asked once (again after a failure). */
  repoInfo(): Promise<GhRepoInfo> {
    return this.askRepo(() =>
      this.onRepo(['repo', 'view', '--json', 'nameWithOwner,squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed']).then((out) => {
        const r = JSON.parse(out);
        const methods = (['squash', 'merge', 'rebase'] as const).filter((m) => r[{ squash: 'squashMergeAllowed', merge: 'mergeCommitAllowed', rebase: 'rebaseMergeAllowed' }[m]]);
        return { nameWithOwner: String(r.nameWithOwner), methods: methods.length ? methods : (['squash', 'merge', 'rebase'] as GhMergeMethod[]), forge: 'github' as const };
      }),
    );
  }

  /** Who the office's own gh is signed in as, which is who it comments as for everyone without their own. Asked once; '' when gh can't say. */
  viewer(): Promise<string> {
    return this.askViewer(() => gh(['api', 'user', '--jq', '.login'], this.dir).then((out) => out.trim()));
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
    const reviewComments: GhPullDetail['reviewComments'] = lines
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
      forge: 'github',
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
    return { number: i.number, state: i.state, body: String(i.body ?? ''), comments: commentsOf(i.comments), forge: 'github', viewer };
  }

  /**
   * Comments on an issue, or on a PR's conversation (to GitHub a PR is an issue too), as `as` or
   * else the office. Returns the comment as GitHub saved it, or why it couldn't.
   */
  async comment(kind: 'issue' | 'pull', n: number, body: string, as?: ForgeAs): Promise<{ comment?: GhComment; error?: string }> {
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
    void (kind === 'issue' ? this.issues.refresh() : this.pulls.refresh());
    return { comment };
  }

  /**
   * Posts a review on a pull request that only comments (the meeting room's review panel), its body
   * read from a file. Resolves to the review's URL.
   */
  async review(n: number, file: string, as?: ForgeAs): Promise<string> {
    // -F reads @file's contents as the value; {owner}/{repo} are filled in from the checkout's remote.
    const url = (await this.onRepo(['api', '--method', 'POST', `repos/{owner}/{repo}/pulls/${n}/reviews`, '-F', `body=@${file}`, '-f', 'event=COMMENT', '--jq', '.html_url'], as, 60_000)).trim();
    void this.pulls.refresh();
    return url;
  }

  /** Merges a PR, or with `auto` has GitHub merge it once its requirements pass. Returns an error. */
  async merge(n: number, method: GhMergeMethod, deleteBranch: boolean, auto: boolean, as?: ForgeAs): Promise<string | undefined> {
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
    void this.pulls.refresh();
    return undefined;
  }

  /** Closes an issue, or a pull request without merging it, optionally saying why. Returns an error. */
  async close(kind: 'issue' | 'pull', n: number, opts: { comment?: string; reason?: GhCloseReason; deleteBranch?: boolean }, as?: ForgeAs): Promise<string | undefined> {
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
    this.lookAgain(kind, n);
    return undefined;
  }

  /**
   * A refresh already in flight returns at once and can still list it as open, so look again shortly
   * after a close, to be sure the board takes the card down.
   */
  private lookAgain(kind: 'issue' | 'pull', n: number) {
    const board = kind === 'issue' ? this.issues : this.pulls;
    const refresh = () => void board.refresh();
    void board.refresh().then(() => {
      if (board.items.some((i) => i.number === n && i.state === 'OPEN')) setTimeout(refresh, 3000);
    });
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
  async setLabels(kind: 'issue' | 'pull', n: number, add: string[], remove: string[], as?: ForgeAs): Promise<{ labels?: GhLabel[]; error?: string }> {
    const path = `repos/{owner}/{repo}/issues/${n}/labels`;
    const jq = '[.[] | {name, color}]';
    let now: GhLabel[] | undefined;
    try {
      // -f labels[]=… sends a JSON array of plain strings: no @file reading, no {owner} filling in.
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
      void (kind === 'issue' ? this.issues : this.pulls).refresh();
      return { error: (err as Error).message };
    }
    // The board shows them at once, before the next look at GitHub (see Board.remember).
    (kind === 'issue' ? this.issues : this.pulls).remember(n, now);
    void (kind === 'issue' ? this.issues : this.pulls).refresh();
    return { labels: now };
  }

  /** Assigns the issue to `as` (else the office's own gh), which moves it to In progress on the board. */
  async claim(issue: number, as?: ForgeAs): Promise<string | undefined> {
    try {
      await this.onRepo(['issue', 'edit', String(issue), '--add-assignee', '@me'], as);
    } catch (err) {
      return (err as Error).message;
    }
    void this.issues.refresh();
    return undefined;
  }

  protected async listIssues(): Promise<GhIssue[]> {
    // Open and closed separately, so old open issues are never crowded out by recent closed ones.
    const fields = 'number,title,state,url,author,labels,assignees,createdAt,updatedAt,body,comments';
    const [open, closed] = await Promise.all([
      this.onRepo(['issue', 'list', '--state', 'open', '--limit', '300', '--json', fields]),
      this.onRepo(['issue', 'list', '--state', 'closed', '--limit', '40', '--json', fields]),
    ]);
    return [...JSON.parse(open), ...JSON.parse(closed)].map((i: any) => ({
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
  }

  protected async listPulls(): Promise<GhPull[]> {
    const fields = 'number,title,state,isDraft,url,author,labels,reviewDecision,headRefName,headRefOid,baseRefName,createdAt,updatedAt,additions,deletions,statusCheckRollup,body,closingIssuesReferences';
    const [open, merged, closed] = await Promise.all([
      this.onRepo(['pr', 'list', '--state', 'open', '--limit', '150', '--json', fields]),
      this.onRepo(['pr', 'list', '--state', 'merged', '--limit', '30', '--json', fields]),
      this.onRepo(['pr', 'list', '--state', 'closed', '--limit', '40', '--json', fields]),
    ]);
    // `--state closed` includes merged PRs; keep only the ones closed without merging.
    const seen = new Set<number>();
    const all = [...JSON.parse(open), ...JSON.parse(merged), ...JSON.parse(closed)].filter((p: any) => !seen.has(p.number) && seen.add(p.number));
    return all.map((p: any) => ({
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
  }
}
