import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MAX_ISSUE_REPOSITORIES, normalizeIssueRepository, sameRepository } from '../shared/issue-repositories.js';
import type { GhCheck, GhComment, GhIssue, GhIssueDetail, GhIssuesState, GhMergeMethod, GhPull, GhPullDetail, GhRepoInfo, GhReviewComment, GhState, IssueRepositoryState } from '../shared/protocol.js';

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

export type GhRunner = (args: string[], cwd: string, timeout?: number) => Promise<string>;

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

export class GitHub {
  issues: GhIssuesState = { items: [], fetchedAt: 0, loading: false };
  pulls: GhState<GhPull> = { items: [], fetchedAt: 0, loading: false };
  private timer?: NodeJS.Timeout;
  private repo?: Promise<GhRepoInfo>;
  private currentRepository?: string;
  private issueRepositories: string[] = [];
  private readonly issueRepositoryPath: string;
  private issueConfigurationError?: string;
  private issueConfigurationCorrupt = false;
  private issueGeneration = 0;
  private issueRefreshRunning = false;
  private issueRefreshQueued = false;
  private readonly issueItems = new Map<string, { name: string; items: GhIssue[]; fetchedAt: number; error?: string }>();
  private readonly runGh: GhRunner;

  constructor(
    private dir: string,
    private onIssues: (s: GhIssuesState) => void,
    private onPulls: (s: GhState<GhPull>) => void,
    dataDir = path.join(dir, '.agent-office'),
    runGh: GhRunner = gh,
  ) {
    this.issueRepositoryPath = path.join(dataDir, 'issue-repositories.json');
    this.runGh = runGh;
    this.restoreIssueRepositories();
    if (this.issueConfigurationError) this.issues.configurationError = this.issueConfigurationError;
  }

  start() {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
  }

  stop() {
    clearInterval(this.timer);
  }

  /** Add a configured issue repository. Returns an error; undefined means it was persisted. */
  addIssueRepository(value: unknown): string | undefined {
    const repository = normalizeIssueRepository(value);
    if (!repository) return 'Invalid issue repository (expected owner/repo)';
    if (this.issueConfigurationCorrupt) return this.issueConfigurationError ?? 'Issue repository configuration is invalid';
    if (this.currentRepository && sameRepository(repository, this.currentRepository)) return 'The current repository is always monitored';
    if (this.issueRepositories.some((r) => sameRepository(r, repository))) return 'Issue repository is already configured';
    if (this.issueRepositories.length >= MAX_ISSUE_REPOSITORIES) return `At most ${MAX_ISSUE_REPOSITORIES} additional issue repositories may be configured`;
    const next = [...this.issueRepositories, repository];
    if (!this.persistIssueRepositories(next)) return this.issueConfigurationError ?? 'Could not save issue repository configuration';
    this.issueRepositories = next;
    this.issueGeneration++;
    this.publishConfiguredIssueState();
    void this.refreshIssues();
    return undefined;
  }

  /** Remove a configured issue repository. The checkout's current repository is permanent. */
  removeIssueRepository(value: unknown): string | undefined {
    const repository = normalizeIssueRepository(value);
    if (!repository) return 'Invalid issue repository (expected owner/repo)';
    if (this.issueConfigurationCorrupt) return this.issueConfigurationError ?? 'Issue repository configuration is invalid';
    if (this.currentRepository && sameRepository(repository, this.currentRepository)) return 'The current repository is always monitored';
    const index = this.issueRepositories.findIndex((r) => sameRepository(r, repository));
    if (index < 0) return 'Issue repository is not configured';
    const removed = this.issueRepositories[index];
    const next = this.issueRepositories.slice();
    next.splice(index, 1);
    if (!this.persistIssueRepositories(next)) return this.issueConfigurationError ?? 'Could not save issue repository configuration';
    this.issueRepositories = next;
    this.issueItems.delete(removed.toLowerCase());
    this.issueGeneration++;
    this.publishConfiguredIssueState();
    void this.refreshIssues();
    return undefined;
  }

  private restoreIssueRepositories() {
    let raw: string;
    try {
      raw = readFileSync(this.issueRepositoryPath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      this.setIssueConfigurationError(`Could not read issue repository configuration: ${(err as Error).message}`, true);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('expected an array of repository names');
      const values: string[] = [];
      for (const value of parsed) {
        const repository = normalizeIssueRepository(value);
        if (!repository) throw new Error('contains an invalid repository name');
        if (!values.some((r) => sameRepository(r, repository))) values.push(repository);
      }
      if (values.length > MAX_ISSUE_REPOSITORIES) throw new Error(`contains more than ${MAX_ISSUE_REPOSITORIES} repositories`);
      this.issueRepositories = values;
    } catch (err) {
      this.setIssueConfigurationError(`Could not load issue repository configuration: ${(err as Error).message}`, true);
    }
  }

  private persistIssueRepositories(repositories: string[]): boolean {
    const temporary = `${this.issueRepositoryPath}.tmp`;
    try {
      mkdirSync(path.dirname(this.issueRepositoryPath), { recursive: true });
      writeFileSync(temporary, `${JSON.stringify(repositories, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      renameSync(temporary, this.issueRepositoryPath);
      this.issueConfigurationError = undefined;
      this.issues.configurationError = undefined;
      return true;
    } catch (err) {
      try { unlinkSync(temporary); } catch { /* best effort cleanup */ }
      this.setIssueConfigurationError(`Could not save issue repository configuration: ${(err as Error).message}`, false);
      return false;
    }
  }

  private setIssueConfigurationError(message: string, corrupt: boolean) {
    this.issueConfigurationError = message;
    this.issueConfigurationCorrupt ||= corrupt;
    this.issues.configurationError = message;
    this.onIssues(this.issues);
  }

  private publishConfiguredIssueState() {
    const repositories: string[] = [];
    if (this.currentRepository) repositories.push(this.currentRepository);
    for (const repository of this.issueRepositories) {
      if (!repositories.some((r) => sameRepository(r, repository))) repositories.push(repository);
    }
    const states: IssueRepositoryState[] = repositories.map((name) => {
      const cached = this.issueItems.get(name.toLowerCase());
      return { name: cached?.name ?? name, current: sameRepository(name, this.currentRepository), fetchedAt: cached?.fetchedAt ?? 0, ...(cached?.error ? { error: cached.error } : {}) };
    });
    this.issues = {
      ...this.issues,
      items: repositories.flatMap((name) => this.issueItems.get(name.toLowerCase())?.items ?? []),
      currentRepository: this.currentRepository,
      repositories: states,
      configurationError: this.issueConfigurationError,
    };
    this.onIssues(this.issues);
  }

  private async resolveIssueRepository(value: unknown): Promise<string> {
    const repository = normalizeIssueRepository(value);
    if (!repository) throw new Error('Invalid issue repository');
    const current = await this.repoInfo().catch(() => undefined);
    const configured = [current?.nameWithOwner, this.currentRepository, ...this.issueRepositories].filter((r): r is string => !!r);
    const found = configured.find((r) => sameRepository(r, repository));
    if (!found) throw new Error('Issue repository is not configured');
    return found;
  }

  /** Resolves and validates an issue repository for trusted queue/server routing. */
  trackedRepository(value: unknown): Promise<string> {
    return this.resolveIssueRepository(value);
  }

  async refresh() {
    await Promise.all([this.refreshIssues(), this.refreshPulls()]);
  }

  /** The repository's full name and how it lets PRs merge. Asked once (again after a failure). */
  repoInfo(): Promise<GhRepoInfo> {
    this.repo ??= this.runGh(['repo', 'view', '--json', 'nameWithOwner,squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed'], this.dir).then((out) => {
      const r = JSON.parse(out);
      const nameWithOwner = normalizeIssueRepository(r.nameWithOwner);
      if (!nameWithOwner) throw new Error('GitHub returned an invalid repository identity');
      this.currentRepository = nameWithOwner;
      const methods = (['squash', 'merge', 'rebase'] as const).filter((m) => r[{ squash: 'squashMergeAllowed', merge: 'mergeCommitAllowed', rebase: 'rebaseMergeAllowed' }[m]]);
      return { nameWithOwner, methods: methods.length ? methods : ['squash', 'merge', 'rebase'] };
    });
    this.repo.catch(() => (this.repo = undefined));
    return this.repo;
  }

  /** A PR's description, conversation, line comments, checks and whether it can merge. */
  async pullDetail(n: number): Promise<GhPullDetail> {
    const fields = 'number,body,state,isDraft,reviewDecision,headRefName,baseRefName,mergeable,mergeStateStatus,commits,comments,reviews,statusCheckRollup';
    const jq = '.[] | {id, in_reply_to_id, path, line, side, body, user: .user.login, created_at, html_url}';
    const [view, lines, repo] = await Promise.all([
      this.runGh(['pr', 'view', String(n), '--json', fields], this.dir),
      this.runGh(['api', `repos/{owner}/{repo}/pulls/${n}/comments?per_page=100`, '--paginate', '--jq', jq], this.dir),
      this.repoInfo(),
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
    };
  }

  /** The PR's unified diff, as `git diff` prints it. */
  pullDiff(n: number): Promise<string> {
    return this.runGh(['pr', 'diff', String(n), '--color', 'never'], this.dir, 60_000);
  }

  async issueDetail(n: number, repository?: string): Promise<GhIssueDetail> {
    const args = ['issue', 'view', String(n)];
    if (repository !== undefined) args.push('--repo', await this.resolveIssueRepository(repository));
    args.push('--json', 'number,body,comments');
    const i = JSON.parse(await this.runGh(args, this.dir));
    return { number: i.number, body: String(i.body ?? ''), comments: commentsOf(i.comments) };
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
      await this.runGh(args, this.dir, 90_000);
    } catch (err) {
      return (err as Error).message;
    }
    void this.refreshPulls();
    return undefined;
  }

  /** Assigns the issue to whoever gh is signed in as, which moves it to In progress on the board. */
  async claim(issue: number, repository?: string): Promise<string | undefined> {
    try {
      const args = ['issue', 'edit', String(issue), '--add-assignee', '@me'];
      if (repository !== undefined) args.push('--repo', await this.resolveIssueRepository(repository));
      await this.runGh(args, this.dir);
    } catch (err) {
      return (err as Error).message;
    }
    void this.refreshIssues();
    return undefined;
  }

  private async refreshIssues() {
    if (this.issueRefreshRunning) {
      this.issueRefreshQueued = true;
      return;
    }
    this.issueRefreshRunning = true;
    this.issues = { ...this.issues, loading: true };
    this.onIssues(this.issues);
    try {
      while (true) {
        let currentError: string | undefined;
        let current: GhRepoInfo | undefined;
        try {
          current = await this.repoInfo();
        } catch (err) {
          currentError = (err as Error).message;
        }
        if (current && !this.issueConfigurationCorrupt) {
          const deduplicated = this.issueRepositories.filter((repository) => !sameRepository(repository, current.nameWithOwner));
          if (deduplicated.length !== this.issueRepositories.length) {
            if (this.persistIssueRepositories(deduplicated)) {
              this.issueRepositories = deduplicated;
              this.issueGeneration++;
              this.publishConfiguredIssueState();
            }
          }
        }
        const generation = this.issueGeneration;
        const currentName = current?.nameWithOwner ?? this.currentRepository;
        const repositories: string[] = [];
        if (currentName) repositories.push(currentName);
        for (const repository of this.issueRepositories) {
          if (!repositories.some((r) => sameRepository(r, repository))) repositories.push(repository);
        }

        const results: ({ name: string; items: GhIssue[] } | { name: string; error: string })[] = new Array(repositories.length);
        let next = 0;
        const worker = async () => {
          while (true) {
            const index = next++;
            if (index >= repositories.length) return;
            const name = repositories[index];
            try {
              results[index] = { name, items: await this.fetchIssuesForRepository(name) };
            } catch (err) {
              results[index] = { name, error: (err as Error).message };
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(3, repositories.length) }, () => worker()));

        // An add/remove may have happened while gh was in flight. Discard all results from that
        // snapshot, then immediately fetch the current configuration instead.
        if (generation !== this.issueGeneration) continue;

        for (const result of results) {
          if ('items' in result) this.issueItems.set(result.name.toLowerCase(), { name: result.name, items: result.items, fetchedAt: Date.now() });
          else {
            const previous = this.issueItems.get(result.name.toLowerCase());
            this.issueItems.set(result.name.toLowerCase(), {
              name: previous?.name ?? result.name,
              items: previous?.items ?? [],
              fetchedAt: previous?.fetchedAt ?? 0,
              error: result.error,
            });
          }
        }
        const repositoryStates: IssueRepositoryState[] = repositories.map((name) => {
          const cached = this.issueItems.get(name.toLowerCase());
          return { name: cached?.name ?? name, current: sameRepository(name, currentName), fetchedAt: cached?.fetchedAt ?? 0, ...(cached?.error ? { error: cached.error } : {}) };
        });
        const items = repositories.flatMap((name) => this.issueItems.get(name.toLowerCase())?.items ?? []);
        const errors = [currentError, ...repositoryStates.map((r) => r.error)].filter((e): e is string => !!e);
        this.issues = {
          ...this.issues,
          items,
          fetchedAt: Date.now(),
          error: errors.length ? errors.join('; ') : undefined,
          currentRepository: currentName,
          repositories: repositoryStates,
          configurationError: this.issueConfigurationError,
        };
        break;
      }
    } finally {
      this.issueRefreshRunning = false;
      this.issues = { ...this.issues, loading: false };
      this.onIssues(this.issues);
      if (this.issueRefreshQueued) {
        this.issueRefreshQueued = false;
        void this.refreshIssues();
      }
    }
  }

  private async fetchIssuesForRepository(repository: string): Promise<GhIssue[]> {
    // Open and closed separately, so old open issues are never crowded out by recent closed ones.
    const fields = 'number,title,state,url,author,labels,assignees,createdAt,updatedAt,body,comments';
    const [open, closed] = await Promise.all([
      this.runGh(['issue', 'list', '--state', 'open', '--limit', '300', '--repo', repository, '--json', fields], this.dir),
      this.runGh(['issue', 'list', '--state', 'closed', '--limit', '40', '--repo', repository, '--json', fields], this.dir),
    ]);
    return [...JSON.parse(open), ...JSON.parse(closed)].map((i: any) => ({
      repository,
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

  private async refreshPulls() {
    if (this.pulls.loading) return;
    this.pulls = { ...this.pulls, loading: true };
    this.onPulls(this.pulls);
    try {
      const fields = 'number,title,state,isDraft,url,author,labels,reviewDecision,headRefName,baseRefName,createdAt,updatedAt,additions,deletions,statusCheckRollup,body,closingIssuesReferences';
      const [open, merged, closed] = await Promise.all([
        this.runGh(['pr', 'list', '--state', 'open', '--limit', '150', '--json', fields], this.dir),
        this.runGh(['pr', 'list', '--state', 'merged', '--limit', '30', '--json', fields], this.dir),
        this.runGh(['pr', 'list', '--state', 'closed', '--limit', '40', '--json', fields], this.dir),
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
