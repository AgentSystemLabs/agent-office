import { readFileSync } from 'node:fs';
import type { GhCheck, GhCloseReason, GhComment, GhIssue, GhIssueDetail, GhLabel, GhMergeMethod, GhPull, GhPullDetail, GhRepoInfo, GhReviewComment, GhState } from '../shared/protocol.js';
import { bb, Forge } from './forge.js';
import type { ForgeAs } from './signins.js';

/** How long the repository's own list of merge strategies is kept. */
const REPO_MS = 5 * 60_000;

/**
 * A floor on Bitbucket Cloud, read with the Bitbucket CLI (`bb`, the gh-shaped CLI at
 * https://bitbucket-cli.paulvanderlei.com). It answers `--json` with Bitbucket's own API objects —
 * snake_case, and wrapped in an envelope whose array key names the collection — so everything here is
 * about reading those into the same Gh* shapes GitHub's gh fills in directly (see github.ts).
 *
 * Two things Bitbucket Cloud has no equivalent of, which the office says so about rather than
 * pretending: labels (so the 🏷️ picker is off) and repository issues (Bitbucket's issues belong to
 * the whole workspace, and the CLI can't list them, so the 📌 board stays empty).
 */

/** Bitbucket's PR states, as the office's own three. */
function state(raw: unknown): string {
  const s = String(raw ?? '').toUpperCase();
  if (s === 'MERGED') return 'MERGED';
  // DECLINED (closed without merging) and SUPERSEDED are both a closed PR as far as the board cares.
  return s === 'OPEN' ? 'OPEN' : 'CLOSED';
}

/** The name a board card shows for whoever wrote it. Bitbucket's nickname, else their display name. */
function who(user: any): string {
  return String(user?.nickname ?? user?.display_name ?? user?.username ?? '').trim();
}

/** Bitbucket's html link, which every resource carries under links.html.href. */
function link(o: any): string {
  return String(o?.links?.html?.href ?? o?.links?.self?.href ?? '');
}

/** One entry of `bb pr checks`: a commit status, whose state is Bitbucket's own word for it. */
function checkOf(c: any): GhCheck {
  const s = String(c?.state ?? '').toUpperCase();
  const state: GhCheck['state'] = s === 'SUCCESSFUL' ? 'pass' : s === 'FAILED' || s === 'STOPPED' ? 'fail' : s === 'INPROGRESS' || s === 'PENDING' ? 'pending' : 'skip';
  return { name: String(c?.name ?? c?.key ?? 'check'), state, url: c?.url ?? (link(c) || undefined) };
}

/** The checks on a PR, as `bb pr checks` returns them. */
function checks(raw: any[]): GhCheck[] {
  return (raw ?? []).map(checkOf);
}

/** A comment, wherever bb puts it: in an activity entry, or in `bb pr comments list`. */
function commentOf(c: any): GhComment | undefined {
  if (!c) return undefined;
  return {
    id: String(c.id ?? ''),
    author: who(c.user) || 'ghost',
    body: String(c.content?.raw ?? c.content ?? c.body ?? ''),
    createdAt: String(c.created_on ?? c.createdAt ?? ''),
    url: link(c) || undefined,
  };
}

/**
 * The office's review decision, from the participants Bitbucket carries on a pull request: it has
 * no single field, so this is worked out from what each participant said.
 */
function decision(participants: any[]): string {
  let approved = false;
  let changes = false;
  for (const p of participants ?? []) {
    const said = String(p?.state ?? '').toUpperCase();
    if (p?.approved === true || said === 'APPROVED') approved = true;
    if (said === 'CHANGES_REQUESTED') changes = true;
  }
  // A request for changes outranks an approval, whichever order the two arrived in.
  return changes ? 'CHANGES_REQUESTED' : approved ? 'APPROVED' : '';
}

/** A pull request as `bb pr list` and `bb pr view` return it, as the office's shape. */
function pull(p: any): GhPull {
  return {
    number: Number(p?.id ?? 0),
    title: String(p?.title ?? ''),
    state: state(p?.state),
    isDraft: !!p?.draft,
    url: link(p),
    author: who(p?.author),
    // Bitbucket Cloud has no labels on pull requests.
    labels: [],
    reviewDecision: decision(p?.participants),
    headRefName: String(p?.source?.branch?.name ?? ''),
    headRefOid: typeof p?.source?.commit?.hash === 'string' ? p.source.commit.hash : undefined,
    baseRefName: String(p?.destination?.branch?.name ?? ''),
    createdAt: String(p?.created_on ?? ''),
    updatedAt: String(p?.updated_on ?? ''),
    additions: Number(p?.additions ?? 0),
    deletions: Number(p?.deletions ?? 0),
    checks: 'none',
    body: String(p?.description ?? p?.summary?.raw ?? '').slice(0, 4000),
    // Bitbucket tracks "closes PROJ-1" in Jira, not in the description: nothing to link.
    closes: [],
  };
}

/** A floor on Bitbucket: its pull requests, read with the Bitbucket CLI (bb). */
export class Bitbucket extends Forge {
  private repoList?: { at: number; info: Promise<GhRepoInfo> };

  constructor(
    dir: string,
    onIssues: (s: GhState<GhIssue>) => void,
    onPulls: (s: GhState<GhPull>) => void,
  ) {
    super(dir, 'bitbucket', onIssues, onPulls);
  }

  /**
   * The repository's full name (workspace/slug) and how it lets PRs merge. Bitbucket keeps one merge
   * strategy setting per repository rather than allowing a set, so all three are offered and Bitbucket
   * decides; asked again after a while (or a failure), since the setting can change under the office.
   */
  repoInfo(): Promise<GhRepoInfo> {
    if (!this.repoList || Date.now() - this.repoList.at > REPO_MS) {
      const info = bb(['repo', 'view', '--json'], this.dir, 30_000).then((out) => {
        const r = JSON.parse(out || '{}') as { full_name?: string };
        return { nameWithOwner: String(r.full_name ?? ''), methods: ['squash', 'merge', 'rebase'] as GhMergeMethod[], forge: 'bitbucket' as const };
      });
      this.repoList = { at: Date.now(), info };
      info.catch(() => this.repoList?.info === info && (this.repoList = undefined));
    }
    return this.repoList.info;
  }

  /** Who the office's own bb is signed in as; '' when it can't say. */
  viewer(): Promise<string> {
    return this.askViewer(() => bb(['auth', 'status', '--json'], this.dir, 30_000).then((out) => String((JSON.parse(out || '{}') as { user?: { username?: string } }).user?.username ?? '').trim()));
  }

  /**
   * A PR's description, conversation, line comments and checks. `me` is the Bitbucket username of
   * whoever asked, when they're signed in to their own; else it's the office's.
   */
  async pullDetail(n: number, me?: string): Promise<GhPullDetail> {
    const [view, activity, built, repo, viewer] = await Promise.all([
      bb(['pr', 'view', String(n), '--json'], this.dir, 30_000),
      bb(['pr', 'activity', String(n), '--all', '--json'], this.dir, 30_000),
      this.builds(n),
      this.repoInfo(),
      me ?? this.viewer(),
    ]);
    const p = JSON.parse(view || '{}');
    const log = (JSON.parse(activity || '{}') as { activities?: any[] }).activities ?? [];
    // Every entry carries a `pull_request_activity` with exactly one of comment/update/approval in it.
    const inner = (a: any) => a?.pull_request_activity ?? a ?? {};
    const comments: GhComment[] = [];
    const reviews: GhComment[] = [];
    const reviewComments: GhReviewComment[] = [];
    let commits = 0;
    for (const a of log) {
      const what = inner(a);
      if (what.comment) {
        const c = commentOf({ ...what.comment, user: what.comment.user ?? a.user, created_on: what.comment.created_on ?? a.created_on });
        if (!c) continue;
        // An inline comment belongs on the diff, not in the conversation.
        if (what.comment.inline) {
          reviewComments.push({
            id: Number(c.id),
            author: c.author,
            body: c.body,
            createdAt: c.createdAt,
            url: c.url ?? link(what.comment),
            path: String(what.comment.inline.path ?? ''),
            line: Number.isInteger(what.comment.inline.to) ? Number(what.comment.inline.to) : null,
            side: what.comment.inline.to === undefined || what.comment.inline.to === null ? 'LEFT' : 'RIGHT',
          });
        } else comments.push(c);
        continue;
      }
      if (what.approval) {
        // Approve, unapprove, and "request changes" all come through as an approval activity.
        const c = commentOf({ ...what.approval, user: what.approval.user ?? a.user, created_on: what.approval.created_on ?? a.created_on });
        if (c) reviews.push({ ...c, state: what.approval.approved ? 'APPROVED' : what.approval.changes_requested ? 'CHANGES_REQUESTED' : 'COMMENTED' });
        continue;
      }
      if (what.commit) commits++;
    }
    return {
      number: Number(p.id ?? n),
      body: String(p.description ?? ''),
      state: state(p.state),
      isDraft: !!p.draft,
      reviewDecision: decision(p.participants),
      headRefName: String(p?.source?.branch?.name ?? ''),
      baseRefName: String(p?.destination?.branch?.name ?? ''),
      // Bitbucket Cloud doesn't say whether a PR would merge; only a failed merge tells you.
      mergeable: 'UNKNOWN',
      mergeStateStatus: 'UNKNOWN',
      commits,
      comments,
      reviews,
      reviewComments,
      checks: built,
      repo,
      forge: 'bitbucket',
      viewer,
    };
  }

  /** The PR's unified diff, as `git diff` prints it. */
  async pullDiff(n: number): Promise<string> {
    const out = await bb(['pr', 'diff', String(n), '--json'], this.dir, 60_000);
    return String((JSON.parse(out || '{}') as { diff?: string }).diff ?? '');
  }

  /** Bitbucket Cloud issues belong to a workspace rather than a repository, and bb can't list them. */
  async issueDetail(): Promise<GhIssueDetail> {
    throw new Error('Bitbucket Cloud issues belong to a whole workspace, which the Bitbucket CLI can’t list — the 📌 board is for GitHub');
  }

  /**
   * Comments on a PR's conversation, as `as` or else the office. Bitbucket has no comments on
   * issues, so `kind` is the office's word for which board asked, and only 'pull' can happen.
   *
   * bb answers with `{success, pullRequestId}` rather than the comment it saved, so the comment the
   * office shows is the one it sent, stamped with who is posting.
   */
  async comment(kind: 'issue' | 'pull', n: number, body: string, as?: ForgeAs): Promise<{ comment?: GhComment; error?: string }> {
    if (kind === 'issue') return { error: 'Bitbucket Cloud issues belong to a whole workspace, which the Bitbucket CLI can’t comment on — the 📌 board is for GitHub' };
    try {
      // The message is positional, so a body starting with "-" is not read as a flag.
      await bb(['pr', 'comments', 'add', String(n), body], this.dir, 60_000, as?.env);
    } catch (err) {
      return { error: (err as Error).message };
    }
    void this.pulls.refresh();
    return { comment: { id: '', author: as ? as.name : await this.viewer(), body, createdAt: new Date().toISOString() } };
  }

  /**
   * Posts a review on a pull request that only comments (the meeting room's review panel), its body
   * read from a file. bb has no comment-only review, so this is a comment on the conversation.
   * Resolves to the pull request's URL.
   */
  async review(n: number, file: string, as?: ForgeAs): Promise<string> {
    await bb(['pr', 'comments', 'add', String(n), readFileSync(file, 'utf8')], this.dir, 60_000, as?.env);
    void this.pulls.refresh();
    const repo = await this.repoInfo();
    return `${repo.nameWithOwner}#${n}`;
  }

  /**
   * Merges a PR. Bitbucket has no "merge once the checks pass", so `auto` is refused rather than
   * quietly merged now: the meeting room's "merge when ready" turns it off for Bitbucket anyway.
   */
  async merge(n: number, method: GhMergeMethod, deleteBranch: boolean, auto: boolean, as?: ForgeAs): Promise<string | undefined> {
    if (auto) return 'Bitbucket can’t merge a pull request later on — merge it when you’re ready instead';
    try {
      const strategy: Record<GhMergeMethod, string> = { squash: 'squash', merge: 'merge_commit', rebase: 'rebase_fast_forward' };
      const args = ['pr', 'merge', String(n), '--strategy', strategy[method] ?? 'merge_commit'];
      if (deleteBranch) args.push('--close-source-branch');
      await bb(args, this.dir, 90_000, as?.env);
    } catch (err) {
      return (err as Error).message;
    }
    void this.pulls.refresh();
    return undefined;
  }

  /** Closes a pull request without merging it, optionally saying why first. Returns an error. */
  async close(kind: 'issue' | 'pull', n: number, opts: { comment?: string; reason?: GhCloseReason; deleteBranch?: boolean }, as?: ForgeAs): Promise<string | undefined> {
    if (kind === 'issue') return 'Bitbucket Cloud issues belong to a whole workspace, which the Bitbucket CLI can’t close — the 📌 board is for GitHub';
    try {
      // Bitbucket's close is `pr decline`, which takes no comment: say it first, so the why is on record.
      if (opts.comment) await bb(['pr', 'comments', 'add', String(n), opts.comment], this.dir, 60_000, as?.env);
      await bb(['pr', 'decline', String(n)], this.dir, 60_000, as?.env);
    } catch (err) {
      return (err as Error).message;
    }
    const board = this.pulls;
    void board.refresh().then(() => {
      if (board.items.some((p) => p.number === n && p.state === 'OPEN')) setTimeout(() => void board.refresh(), 3000);
    });
    return undefined;
  }

  /** Bitbucket Cloud has no labels, so the picker has nothing to offer. */
  async repoLabels(): Promise<GhLabel[]> {
    return [];
  }

  /** Bitbucket Cloud has no labels, so nothing can be changed. */
  async setLabels(): Promise<{ labels?: GhLabel[]; error?: string }> {
    return { error: 'Bitbucket Cloud has no labels on pull requests — the 🏷️ picker is for GitHub' };
  }

  /** The queue assigns issues, and Bitbucket Cloud has no repository issues to assign. */
  async claim(): Promise<string | undefined> {
    return 'Bitbucket Cloud issues belong to a whole workspace, which the Bitbucket CLI can’t assign — the 📌 board is for GitHub';
  }

  protected async listIssues(): Promise<GhIssue[]> {
    // Nothing to ask for: see issueDetail. The board shows why, rather than looking broken.
    return [];
  }

  protected async listPulls(): Promise<GhPull[]> {
    // Open and closed separately, so old open PRs are never crowded out by recent closed ones.
    const [open, merged, declined] = await Promise.all([this.prs('OPEN', 150), this.prs('MERGED', 30), this.prs('DECLINED', 40)]);
    const seen = new Set<number>();
    // `bb pr list` doesn't carry a PR's build statuses, and asking per PR would mean one process per
    // card every refresh, so the board's ✅/❌ stays off for Bitbucket; the PR window shows them.
    return [...open, ...merged, ...declined].filter((p) => !seen.has(p.number) && seen.add(p.number));
  }

  /** One `bb pr list` page, as the office's shape. */
  private async prs(wanted: 'OPEN' | 'MERGED' | 'DECLINED', limit: number): Promise<GhPull[]> {
    const out = await bb(['pr', 'list', '--state', wanted, '--limit', String(limit), '--json'], this.dir, 60_000);
    return ((JSON.parse(out || '{}') as { pullRequests?: any[] }).pullRequests ?? []).map(pull);
  }

  /** The checks on a PR, or [] when bb can't say (a repository with no pipelines). */
  private async builds(n: number): Promise<GhCheck[]> {
    try {
      const out = await bb(['pr', 'checks', String(n), '--json'], this.dir, 30_000);
      return checks((JSON.parse(out || '{}') as { statuses?: any[] }).statuses ?? []);
    } catch {
      // No pipelines configured is a normal answer, not a failure.
      return [];
    }
  }
}
