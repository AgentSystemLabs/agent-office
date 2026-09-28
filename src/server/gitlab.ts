import { execFile, execFileSync } from 'node:child_process';
import { gitlabParts } from '../shared/floors.js';
import type { GhCheck, GhCloseReason, GhComment, GhIssue, GhIssueDetail, GhLabel, GhMergeMethod, GhPull, GhPullDetail, GhRepoInfo, GhReviewComment, GhState } from '../shared/protocol.js';
import { type Board, type BoardListener, type PullRef, Relabels } from './forge.js';
import { priorityRank } from './github.js';

const REFRESH_MS = 90_000;
/** How long the project's list of labels is kept before the label picker asks GitLab again. */
const LABELS_MS = 60_000;

/** Turns glab's stderr into something a person standing at the board can act on. */
function friendly(raw: string): string {
  if (/not a git repository/i.test(raw)) return "This folder isn't a git repository";
  if (/401|unauthorized|auth login|not logged in|no token/i.test(raw)) return "glab isn't logged in on the server — run `glab auth login`";
  if (/404|not found/i.test(raw)) return "glab can't find this project on GitLab (check the remote and access)";
  return raw;
}

export function glab(args: string[], cwd: string, timeout = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    // No prompts or pagers: the office runs glab without a terminal.
    const env = { ...process.env, GLAB_NO_PROMPT: '1', NO_PROMPT: '1', GLAB_PAGER: 'cat', PAGER: 'cat', NO_COLOR: '1' };
    execFile('glab', args, { cwd, env, maxBuffer: 32 * 1024 * 1024, timeout }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || stdout || err.message || '').trim().split('\n').filter(Boolean).slice(-2).join(' ');
        reject(new Error((err as NodeJS.ErrnoException).code === 'ENOENT' ? 'GitLab CLI (glab) is not installed on the server' : friendly(msg)));
      } else resolve(stdout);
    });
  });
}

let hosts: string[] | undefined;

/** The GitLab instances glab is signed in to (gitlab.com unless it says otherwise). */
export function gitlabHosts(): string[] {
  if (hosts) return hosts;
  try {
    const out = execFileSync('glab', ['auth', 'status'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000, env: { ...process.env, NO_COLOR: '1' } });
    hosts = parseHosts(out);
  } catch (err) {
    // glab exits non-zero when any instance's token is bad, but still lists them all.
    const e = err as { stdout?: string; stderr?: string };
    hosts = parseHosts(`${e.stdout ?? ''}\n${e.stderr ?? ''}`);
  }
  if (!hosts.length) hosts = ['gitlab.com'];
  return hosts;
}

function parseHosts(out: string): string[] {
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l, i, all) => /^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?$/i.test(l) && all.indexOf(l) === i)
    .map((l) => l.toLowerCase());
}

/** A host a checkout's remote points at is GitLab when glab is signed in to it or it's named so. */
export function isGitlabHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'gitlab.com' || /(^|\.)gitlab\./.test(h) || gitlabHosts().includes(h);
}

/** Calls GitLab's REST API on `host` (the path is under /api/v4). */
export function gitlabApi(host: string, cwd: string, path: string, args: string[] = [], timeout?: number): Promise<string> {
  return glab(['api', '--hostname', host, ...args, path], cwd, timeout);
}

const PROJECT_Q = `project(fullPath: $path)`;

const ISSUE_FIELDS = 'iid title state webUrl createdAt updatedAt description userNotesCount author { username } labels { nodes { title color } } assignees { nodes { username } }';
const MR_FIELDS =
  'iid title state draft webUrl createdAt updatedAt description sourceBranch targetBranch diffHeadSha author { username } labels { nodes { title color } } approvedBy { nodes { username } } approvalsLeft reviewers { nodes { mergeRequestInteraction { reviewState } } } diffStatsSummary { additions deletions } headPipeline { status }';

type Node = Record<string, any>;

function colorOf(c: unknown): string {
  return typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : '#888888';
}

function labelsOf(raw: any): GhLabel[] {
  return (raw?.nodes ?? []).map((l: any) => ({ name: String(l.title), color: colorOf(l.color) }));
}

function issueState(s: string): string {
  return s === 'closed' ? 'CLOSED' : 'OPEN';
}

function mrState(s: string): string {
  if (s === 'merged') return 'MERGED';
  if (s === 'closed') return 'CLOSED';
  return 'OPEN';
}

/** What the reviews add up to, in GitHub's words (the boards sort PRs into columns by it). */
function reviewDecision(mr: Node): string {
  const states: string[] = (mr.reviewers?.nodes ?? []).map((r: any) => r.mergeRequestInteraction?.reviewState ?? '');
  if (states.includes('REQUESTED_CHANGES')) return 'CHANGES_REQUESTED';
  if ((mr.approvedBy?.nodes ?? []).length && !(mr.approvalsLeft > 0)) return 'APPROVED';
  if (mr.approvalsLeft > 0) return 'REVIEW_REQUIRED';
  return '';
}

function pipelineChecks(status: string | undefined): GhPull['checks'] {
  if (!status) return 'none';
  if (status === 'SUCCESS') return 'pass';
  if (status === 'FAILED' || status === 'CANCELED' || status === 'CANCELING') return 'fail';
  if (status === 'SKIPPED') return 'none';
  return 'pending';
}

function jobCheck(job: any, host: string): GhCheck {
  const s = String(job.status ?? '');
  let state: GhCheck['state'] = 'pending';
  if (s === 'SUCCESS') state = 'pass';
  else if (s === 'FAILED') state = job.allowFailure ? 'skip' : 'fail';
  else if (s === 'CANCELED') state = 'fail';
  else if (s === 'SKIPPED' || s === 'MANUAL') state = 'skip';
  const stage = job.stage?.name;
  return { name: stage ? `${stage} / ${job.name}` : String(job.name), state, url: job.webPath ? `https://${host}${job.webPath}` : undefined };
}

const CLOSING = /\b(?:clos(?:e[sd]?|ing)|fix(?:e[sd]|ing)?|resolv(?:e[sd]?|ing)|implement(?:s|ed|ing)?)\b:?((?:[\s,]+(?:and\s+)?(?:#\d+|https?:\/\/\S+?\/-\/(?:issues|work_items)\/\d+))+)/gi;

/**
 * Issues a merge request closes, from its description, the way GitLab reads it: "Closes #12",
 * "Fixes #3 and #4", or a full link to an issue of this project.
 */
export function closesOf(body: string, projectUrl: string): number[] {
  const out = new Set<number>();
  const base = projectUrl.toLowerCase().replace(/\/+$/, '');
  for (const m of body.matchAll(CLOSING)) {
    for (const ref of m[1].matchAll(/#(\d+)|(https?:\/\/\S+?)\/-\/(?:issues|work_items)\/(\d+)/gi)) {
      if (ref[1]) out.add(Number(ref[1]));
      else if (ref[2].toLowerCase() === base) out.add(Number(ref[3]));
    }
  }
  return [...out].filter((n) => Number.isInteger(n) && n > 0);
}

/**
 * Where an MR stands, in GitHub's mergeable/mergeStateStatus words (which the PR window reads),
 * plus what's blocking it in plain words when GitHub's words don't cover it.
 */
export function mergeState(detailed: string, conflicts: boolean): { mergeable: string; mergeStateStatus: string; blocked?: string } {
  if (conflicts || detailed === 'CONFLICT') return { mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' };
  switch (detailed) {
    case 'MERGEABLE':
      return { mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' };
    case 'NEED_REBASE':
      return { mergeable: 'MERGEABLE', mergeStateStatus: 'BEHIND' };
    case 'DRAFT_STATUS':
      return { mergeable: 'MERGEABLE', mergeStateStatus: 'DRAFT' };
    case 'CI_MUST_PASS':
    case 'CI_STILL_RUNNING':
    case 'NOT_APPROVED':
    case 'REQUESTED_CHANGES':
      return { mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED' };
    case 'DISCUSSIONS_NOT_RESOLVED':
      return { mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', blocked: 'every thread must be resolved' };
    case 'COMMITS_STATUS':
      return { mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', blocked: 'the source branch has no commits or is missing' };
    case 'BLOCKED_STATUS':
      return { mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', blocked: 'it depends on another merge request' };
    case 'EXTERNAL_STATUS_CHECKS':
      return { mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', blocked: 'external status checks must pass' };
    case 'JIRA_ASSOCIATION':
      return { mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', blocked: 'its title or description must name a Jira issue' };
    case 'TITLE_NOT_MATCHING':
      return { mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', blocked: "its title doesn't match the project's rule" };
    case 'LOCKED_PATHS':
    case 'LOCKED_LFS_FILES':
      return { mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', blocked: 'it changes locked files' };
    case 'MERGE_TIME':
      return { mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', blocked: "it's scheduled to merge later" };
    case 'SECURITY_POLICIES_VIOLATIONS':
    case 'SECURITY_POLICY_PIPELINE_CHECK':
      return { mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', blocked: 'a security policy is not met' };
    case 'NOT_OPEN':
      return { mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' };
    default:
      // UNCHECKED, CHECKING, PREPARING, APPROVALS_SYNCING: GitLab is still working it out.
      return { mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' };
  }
}

interface RestNote {
  id: number;
  body?: string;
  system?: boolean;
  created_at?: string;
  author?: { username?: string };
  position?: { new_path?: string; old_path?: string; new_line?: number | null; old_line?: number | null } | null;
}

/** Discussions on a merge request, split the way the PR window shows them. */
export function splitDiscussions(discussions: { notes?: RestNote[] }[], itemUrl: string): { comments: GhComment[]; reviews: GhComment[]; reviewComments: GhReviewComment[] } {
  const comments: GhComment[] = [];
  const reviews: GhComment[] = [];
  const reviewComments: GhReviewComment[] = [];
  for (const d of discussions) {
    const notes = d.notes ?? [];
    const first = notes.find((n) => !n.system);
    for (const n of notes) {
      const author = n.author?.username ?? 'ghost';
      const createdAt = n.created_at ?? '';
      const url = `${itemUrl}#note_${n.id}`;
      if (n.system) {
        // Approvals and change requests only show up as system notes.
        const body = String(n.body ?? '');
        const state = /^approved this merge request/i.test(body) ? 'APPROVED' : /^requested changes/i.test(body) ? 'CHANGES_REQUESTED' : undefined;
        if (state) reviews.push({ id: String(n.id), author, body: '', createdAt, url, state });
        continue;
      }
      if (n.position && (n.position.new_path || n.position.old_path)) {
        const onNew = n.position.new_line != null;
        reviewComments.push({
          id: n.id,
          replyTo: first && first.id !== n.id ? first.id : undefined,
          author,
          body: String(n.body ?? ''),
          createdAt,
          url,
          path: String(n.position.new_path ?? n.position.old_path),
          line: (onNew ? n.position.new_line : n.position.old_line) ?? null,
          side: onNew ? 'RIGHT' : 'LEFT',
        });
      } else comments.push({ id: String(n.id), author, body: String(n.body ?? ''), createdAt, url });
    }
  }
  return { comments, reviews, reviewComments };
}

/** Parses glab api --paginate output: one JSON array per page, back to back. */
function pages<T>(out: string): T[] {
  const trimmed = out.trim();
  if (!trimmed) return [];
  try {
    const one = JSON.parse(trimmed);
    return Array.isArray(one) ? one : [one];
  } catch {
    return JSON.parse(`[${trimmed.replace(/\]\s*\[/g, '],[')}]`).flat();
  }
}

/**
 * A floor's boards for a GitLab project, through the office machine's `glab` login: issues, merge
 * requests (shown on the PR board), their detail, diffs and comments, merging and closing. Lists
 * come from GitLab's GraphQL API, one request per state; everything that changes something goes
 * through the REST API or glab's own commands.
 */
export class GitLab implements Board {
  readonly forge = 'gitlab' as const;
  issues: GhState<GhIssue> = { items: [], fetchedAt: 0, loading: false };
  pulls: GhState<GhPull> = { items: [], fetchedAt: 0, loading: false };
  private timer?: NodeJS.Timeout;
  private info?: Promise<GhRepoInfo & { squashAlways: boolean }>;
  private login?: Promise<string>;
  private host: string;
  private path: string;
  /** The project's id in REST paths (the URL-encoded full path works everywhere an id does). */
  private id: string;
  private projectUrl: string;
  private labelList?: { at: number; list: Promise<GhLabel[]> };
  private relabeled = new Relabels();

  constructor(
    private dir: string,
    /** host/group/…/project */
    repo: string,
    private onIssues: BoardListener<GhIssue>,
    private onPulls: BoardListener<GhPull>,
  ) {
    const { host, path } = gitlabParts(repo);
    this.host = host;
    this.path = path;
    this.id = encodeURIComponent(path);
    this.projectUrl = `https://${host}/${path}`;
  }

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

  private api(path: string, args: string[] = [], timeout?: number): Promise<string> {
    return gitlabApi(this.host, this.dir, path, args, timeout);
  }

  private async gql(query: string, vars: Record<string, string | number | undefined>): Promise<any> {
    const args = ['-f', `query=${query}`];
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) continue;
      args.push(typeof v === 'number' ? '-F' : '-f', `${k}=${v}`);
    }
    const res = JSON.parse(await this.api('graphql', args, 60_000));
    if (res.errors?.length) throw new Error(res.errors.map((e: any) => e.message).join('; '));
    if (!res.data?.project) throw new Error("glab can't find this project on GitLab (check the remote and access)");
    return res.data.project;
  }

  /** Up to `limit` issues or MRs in one state, newest first, a page of 100 at a time. */
  private async list(kind: 'issues' | 'mergeRequests', state: string, sort: string, limit: number): Promise<Node[]> {
    const fields = kind === 'issues' ? ISSUE_FIELDS : MR_FIELDS;
    const stateType = kind === 'issues' ? 'IssuableState' : 'MergeRequestState';
    const sortType = kind === 'issues' ? 'IssueSort' : 'MergeRequestSort';
    const query = `query($path: ID!, $state: ${stateType}, $sort: ${sortType}, $first: Int!, $after: String) { ${PROJECT_Q} { ${kind}(state: $state, sort: $sort, first: $first, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${fields} } } } }`;
    const out: Node[] = [];
    let after: string | undefined;
    while (out.length < limit) {
      const page = (await this.gql(query, { path: this.path, state, sort, first: Math.min(100, limit - out.length), after }))[kind];
      out.push(...(page?.nodes ?? []));
      if (!page?.pageInfo?.hasNextPage) break;
      after = page.pageInfo.endCursor;
    }
    return out;
  }

  /** How the project lets merge requests merge. Asked once (again after a failure). */
  repoInfo(): Promise<GhRepoInfo> {
    return this.projectInfo();
  }

  private projectInfo(): Promise<GhRepoInfo & { squashAlways: boolean }> {
    this.info ??= this.api(`projects/${this.id}`).then((out) => {
      const p = JSON.parse(out);
      const squash = String(p.squash_option ?? 'default_off');
      // The project picks how merges land (merge commit, semi-linear or fast-forward); squashing is the only choice per MR.
      const methods: GhMergeMethod[] = squash === 'always' ? ['squash'] : squash === 'never' ? ['merge'] : squash === 'default_on' ? ['squash', 'merge'] : ['merge', 'squash'];
      return { nameWithOwner: String(p.path_with_namespace ?? this.path), methods, squashAlways: squash === 'always' };
    });
    this.info.catch(() => (this.info = undefined));
    return this.info;
  }

  viewer(): Promise<string> {
    this.login ??= this.api('user').then((out) => String(JSON.parse(out).username ?? ''));
    this.login.catch(() => (this.login = undefined));
    return this.login.catch(() => '');
  }

  private itemUrl(kind: 'issue' | 'pull', n: number) {
    return `${this.projectUrl}/-/${kind === 'issue' ? 'issues' : 'merge_requests'}/${n}`;
  }

  async pullDetail(n: number): Promise<GhPullDetail> {
    const query = `query($path: ID!, $iid: String!) { ${PROJECT_Q} { mergeRequest(iid: $iid) { iid description state draft sourceBranch targetBranch detailedMergeStatus conflicts commitCount approvalsLeft approvedBy { nodes { username } } reviewers { nodes { mergeRequestInteraction { reviewState } } } headPipeline { jobs(first: 100, retried: false) { nodes { name status allowFailure webPath stage { name } } } } } } }`;
    const [project, discussions, repo, viewer] = await Promise.all([
      this.gql(query, { path: this.path, iid: String(n) }),
      this.api(`projects/${this.id}/merge_requests/${n}/discussions?per_page=100`, ['--paginate'], 60_000).then((out) => pages<{ notes?: RestNote[] }>(out)),
      this.repoInfo(),
      this.viewer(),
    ]);
    const mr = project.mergeRequest;
    if (!mr) throw new Error(`There's no merge request !${n} in ${this.path}`);
    const state = mrState(mr.state);
    const { mergeable, mergeStateStatus, blocked } = mergeState(String(mr.detailedMergeStatus ?? ''), mr.conflicts === true);
    return {
      number: Number(mr.iid),
      body: String(mr.description ?? ''),
      state,
      isDraft: !!mr.draft,
      reviewDecision: reviewDecision(mr),
      headRefName: mr.sourceBranch,
      baseRefName: mr.targetBranch,
      mergeable,
      mergeStateStatus,
      blocked,
      commits: Number(mr.commitCount ?? 0),
      ...splitDiscussions(discussions, this.itemUrl('pull', n)),
      checks: (mr.headPipeline?.jobs?.nodes ?? []).map((j: any) => jobCheck(j, this.host)),
      repo,
      viewer,
    };
  }

  pullDiff(n: number): Promise<string> {
    return glab(['mr', 'diff', String(n), '--repo', this.projectUrl, '--raw'], this.dir, 60_000);
  }

  async issueDetail(n: number): Promise<GhIssueDetail> {
    const [issue, notes, viewer] = await Promise.all([
      this.api(`projects/${this.id}/issues/${n}`).then((out) => JSON.parse(out)),
      this.api(`projects/${this.id}/issues/${n}/notes?sort=asc&order_by=created_at&per_page=100`, ['--paginate'], 60_000).then((out) => pages<RestNote>(out)),
      this.viewer(),
    ]);
    const url = this.itemUrl('issue', n);
    return {
      number: Number(issue.iid),
      state: issueState(issue.state),
      body: String(issue.description ?? ''),
      comments: notes.filter((c) => !c.system).map((c) => ({ id: String(c.id), author: c.author?.username ?? 'ghost', body: String(c.body ?? ''), createdAt: c.created_at ?? '', url: `${url}#note_${c.id}` })),
      viewer,
    };
  }

  private notesPath(kind: 'issue' | 'pull', n: number) {
    return `projects/${this.id}/${kind === 'issue' ? 'issues' : 'merge_requests'}/${n}/notes`;
  }

  async comment(kind: 'issue' | 'pull', n: number, body: string): Promise<{ comment?: GhComment; error?: string }> {
    let comment: GhComment;
    try {
      // -f sends the body as a plain string, never reading an @file.
      const note = JSON.parse(await this.api(this.notesPath(kind, n), ['--method', 'POST', '-f', `body=${body}`])) as RestNote;
      comment = { id: String(note.id), author: note.author?.username ?? '', body: String(note.body ?? ''), createdAt: note.created_at ?? '', url: `${this.itemUrl(kind, n)}#note_${note.id}` };
    } catch (err) {
      return { error: (err as Error).message };
    }
    void (kind === 'issue' ? this.refreshIssues() : this.refreshPulls());
    return { comment };
  }

  async review(n: number, file: string): Promise<string> {
    // -F body=@file reads the file's contents as the body.
    const note = JSON.parse(await this.api(this.notesPath('pull', n), ['--method', 'POST', '-F', `body=@${file}`], 60_000)) as RestNote;
    void this.refreshPulls();
    return `${this.itemUrl('pull', n)}#note_${note.id}`;
  }

  async merge(n: number, method: GhMergeMethod, deleteBranch: boolean, auto: boolean): Promise<string | undefined> {
    try {
      const info = await this.projectInfo();
      const args = ['--method', 'PUT', '-F', `squash=${method === 'squash' || info.squashAlways}`, '-F', `should_remove_source_branch=${deleteBranch}`];
      // auto_merge is today's name; merge_when_pipeline_succeeds is what older instances know.
      if (auto) args.push('-F', 'auto_merge=true', '-F', 'merge_when_pipeline_succeeds=true');
      await this.api(`projects/${this.id}/merge_requests/${n}/merge`, args, 90_000);
    } catch (err) {
      return (err as Error).message;
    }
    void this.refreshPulls();
    return undefined;
  }

  async close(kind: 'issue' | 'pull', n: number, opts: { comment?: string; reason?: GhCloseReason; deleteBranch?: boolean }): Promise<string | undefined> {
    try {
      const path = `projects/${this.id}/${kind === 'issue' ? 'issues' : 'merge_requests'}/${n}`;
      if (opts.comment) await this.api(this.notesPath(kind, n), ['--method', 'POST', '-f', `body=${opts.comment}`]);
      const closed = JSON.parse(await this.api(path, ['--method', 'PUT', '-f', 'state_event=close'])) as { source_branch?: string };
      if (kind === 'pull' && opts.deleteBranch && closed.source_branch) {
        await this.api(`projects/${this.id}/repository/branches/${encodeURIComponent(closed.source_branch)}`, ['--method', 'DELETE']);
      }
    } catch (err) {
      return (err as Error).message;
    }
    const refresh = () => (kind === 'issue' ? this.refreshIssues() : this.refreshPulls());
    void refresh().then(() => {
      if ((kind === 'issue' ? this.issues : this.pulls).items.some((i) => i.number === n && i.state === 'OPEN')) setTimeout(() => void refresh(), 3000);
    });
    return undefined;
  }

  async claim(issue: number): Promise<string | undefined> {
    try {
      const me = await this.viewer();
      if (!me) throw new Error("glab can't say who it's signed in as");
      await glab(['issue', 'update', String(issue), '--repo', this.projectUrl, '--assignee', `+${me}`], this.dir);
    } catch (err) {
      return (err as Error).message;
    }
    void this.refreshIssues();
    return undefined;
  }

  /** Every label the project can use (its group's too), for the label picker. Asked again after a minute (or a failure). */
  repoLabels(): Promise<GhLabel[]> {
    if (!this.labelList || Date.now() - this.labelList.at > LABELS_MS) {
      const list = this.api(`projects/${this.id}/labels?per_page=100`, ['--paginate'], 60_000).then((out) =>
        pages<{ name?: string; color?: string; description?: string | null }>(out).map((l) => ({ name: String(l.name), color: colorOf(l.color), description: l.description || undefined })),
      );
      this.labelList = { at: Date.now(), list };
      list.catch(() => this.labelList?.list === list && (this.labelList = undefined));
    }
    return this.labelList.list;
  }

  /**
   * Puts labels on an issue or MR and takes others off, as whoever glab is signed in as. Returns the
   * labels it has now, or why they didn't change.
   */
  async setLabels(kind: 'issue' | 'pull', n: number, add: string[], remove: string[]): Promise<{ labels?: GhLabel[]; error?: string }> {
    // GitLab label names can't hold a comma, so the comma-separated lists below are safe.
    if ([...add, ...remove].some((l) => l.includes(','))) return { error: "GitLab label names can't contain a comma" };
    let now: GhLabel[];
    try {
      const args = ['--method', 'PUT'];
      if (add.length) args.push('-f', `add_labels=${add.join(',')}`);
      if (remove.length) args.push('-f', `remove_labels=${remove.join(',')}`);
      const saved = JSON.parse(await this.api(`projects/${this.id}/${kind === 'issue' ? 'issues' : 'merge_requests'}/${n}`, args)) as { labels?: string[] };
      // The answer names the labels without their colors; the project's list has those.
      const known = new Map((await this.repoLabels().catch(() => [] as GhLabel[])).map((l) => [l.name, l.color]));
      now = (saved.labels ?? []).map((name) => ({ name: String(name), color: known.get(name) ?? '#888888' }));
    } catch (err) {
      void (kind === 'issue' ? this.refreshIssues() : this.refreshPulls());
      return { error: (err as Error).message };
    }
    // The board shows them at once, before the next look at GitLab.
    const at = Date.now();
    this.relabeled.set(kind, n, now, at);
    if (kind === 'issue') {
      this.issues = { ...this.issues, items: this.relabeled.apply('issue', this.issues.items, at).sort((a, b) => priorityRank(a.labels) - priorityRank(b.labels)) };
      this.onIssues(this.issues);
      void this.refreshIssues();
    } else {
      this.pulls = { ...this.pulls, items: this.relabeled.apply('pull', this.pulls.items, at) };
      this.onPulls(this.pulls);
      void this.refreshPulls();
    }
    return { labels: now };
  }

  async createPull(cwd: string, head: string, base: string | undefined, title: string, body: string): Promise<PullRef> {
    const args = ['mr', 'create', '--repo', this.projectUrl, '--head', this.projectUrl, '--source-branch', head, '--title', title, `--description=${body}`, '--yes'];
    if (base) args.push('--target-branch', base);
    const out = await glab(args, cwd, 120_000);
    const url = /https?:\/\/\S+\/-\/merge_requests\/\d+/.exec(out)?.[0] ?? '';
    const number = Number(/\/merge_requests\/(\d+)/.exec(url)?.[1]);
    if (!number) throw new Error(`glab did not return a merge request URL (${out.trim().slice(0, 120)})`);
    return { number, url };
  }

  async findOpenPull(branch: string, cwd: string): Promise<PullRef | undefined> {
    const out = await glab(['mr', 'list', '--repo', this.projectUrl, '--source-branch', branch, '--output', 'json', '--per-page', '1'], cwd);
    const found = (JSON.parse(out || '[]') as { iid: number; web_url: string }[])[0];
    return found ? { number: Number(found.iid), url: found.web_url } : undefined;
  }

  private async refreshIssues() {
    if (this.issues.loading) return;
    this.issues = { ...this.issues, loading: true };
    this.onIssues(this.issues);
    const asked = Date.now();
    try {
      const [open, closed] = await Promise.all([this.list('issues', 'opened', 'CREATED_DESC', 300), this.list('issues', 'closed', 'UPDATED_DESC', 40)]);
      const fetched: GhIssue[] = [...open, ...closed].map((i) => ({
        number: Number(i.iid),
        title: String(i.title),
        state: issueState(i.state),
        url: String(i.webUrl),
        author: i.author?.username ?? '',
        labels: labelsOf(i.labels),
        assignees: (i.assignees?.nodes ?? []).map((a: any) => String(a.username)),
        createdAt: i.createdAt,
        updatedAt: i.updatedAt,
        body: String(i.description ?? '').slice(0, 4000),
        comments: Number(i.userNotesCount ?? 0),
      }));
      const items = this.relabeled.apply('issue', fetched, asked);
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
    const asked = Date.now();
    try {
      const [open, merged, closed] = await Promise.all([this.list('mergeRequests', 'opened', 'CREATED_DESC', 150), this.list('mergeRequests', 'merged', 'MERGED_AT_DESC', 30), this.list('mergeRequests', 'closed', 'UPDATED_DESC', 40)]);
      const fetched: GhPull[] = [...open, ...merged, ...closed].map((p) => {
        const body = String(p.description ?? '');
        return {
          number: Number(p.iid),
          title: String(p.title),
          state: mrState(p.state),
          isDraft: !!p.draft,
          url: String(p.webUrl),
          author: p.author?.username ?? '',
          labels: labelsOf(p.labels),
          reviewDecision: reviewDecision(p),
          headRefName: p.sourceBranch,
          headRefOid: typeof p.diffHeadSha === 'string' ? p.diffHeadSha : undefined,
          baseRefName: p.targetBranch,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          additions: Number(p.diffStatsSummary?.additions ?? 0),
          deletions: Number(p.diffStatsSummary?.deletions ?? 0),
          checks: pipelineChecks(p.headPipeline?.status),
          body: body.slice(0, 4000),
          closes: closesOf(body, this.projectUrl),
        };
      });
      const items = this.relabeled.apply('pull', fetched, asked);
      this.pulls = { items, fetchedAt: Date.now(), loading: false };
    } catch (err) {
      this.pulls = { ...this.pulls, loading: false, error: (err as Error).message, fetchedAt: Date.now() };
    }
    this.onPulls(this.pulls);
  }
}
