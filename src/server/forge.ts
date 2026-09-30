import { execFile, execFileSync } from 'node:child_process';
import { normalizeRepo } from '../shared/floors.js';
import type { ForgeKind, GhCloseReason, GhComment, GhIssue, GhIssueDetail, GhLabel, GhMergeMethod, GhPull, GhPullDetail, GhRepoInfo, GhState } from '../shared/protocol.js';
import { FORGE_LABEL } from '../shared/protocol.js';
import type { ForgeAs } from './signins.js';

/*
 * Forges: where a floor's code is hosted
 * ---------------------------------------
 * A floor is a checkout with an origin, and that origin is on GitHub or on Bitbucket. The office
 * asks whichever one it is through that forge's own CLI — GitHub's `gh` or the Bitbucket CLI's
 * `bb` — and reads both into the same Gh* shapes, so the boards, the pull request window and the
 * workers are written once (see floor.ts). This module is the part both forges share: the two
 * runners, which forge a remote points at, the list a board shows (Board), the gong (MergeWatch),
 * and opening a pull request for a worker's branch.
 *
 * Everything here is deliberately forge-neutral except the two runners, which know the wording of
 * their own CLI's failures.
 */

/** gh's and bb's way of saying the sign-in is gone, from a per-account run (see signins.ts). */
const SIGNED_OUT = /auth login|not logged in|authenticat|401|bad credentials|credentials not found/i;

/** `dir`'s origin URL, or undefined when it isn't a git checkout. */
export function originUrl(dir: string, timeout = 10_000): string | undefined {
  try {
    return execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Which forge a checkout's remote points at: Bitbucket for bitbucket.org, GitHub for everything
 * else — github.com, a GitHub Enterprise host, or no remote at all, where gh works out the rest.
 */
export function forgeOf(remote: string | undefined): ForgeKind {
  return remote && /bitbucket\.org[/:]/i.test(remote) ? 'bitbucket' : 'github';
}

/** The forge a checkout at `dir` is on, from its origin (see forgeOf). */
export function forgeOfDir(dir: string): ForgeKind {
  return forgeOf(originUrl(dir));
}

/** owner/name of a checkout's origin, when it's on a forge the office knows (GitHub or Bitbucket). */
export function originRepo(dir: string, timeout = 10_000): string | undefined {
  const url = originUrl(dir, timeout);
  return url && /github\.com[/:]|bitbucket\.org[/:]/i.test(url) ? normalizeRepo(url) : undefined;
}

/**
 * The GitHub repository a checkout is worked on: `GH_REPO` when the office was started with it
 * (which is what gh itself would use), else the GitHub one its origin points at. For a fork that's
 * the fork, not the repository it was forked from — gh, asked about a checkout with an `upstream`
 * remote, works on that one, which fills the boards with someone else's issues and pull requests.
 * Undefined for a checkout with no GitHub origin, where gh's own resolution (or the error it gives)
 * is right.
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

/** The repository a command about `cwd` is about: gh's own `--repo`/`GH_REPO` convention on GitHub. */
function targetOf(cwd: string, kind: ForgeKind): string | undefined {
  return kind === 'github' ? workRepo(cwd) : undefined;
}

/** Runs a forge's CLI, and turns its failures into something a person standing at a board can act on. */
function spawnCli(bin: string, args: string[], cwd: string, timeout: number, env: Record<string, string> | undefined, kind: ForgeKind): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { cwd, maxBuffer: 32 * 1024 * 1024, timeout, env }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout);
      const said = (stderr || err.message || '').trim().split('\n').slice(-2).join(' ');
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return reject(new Error(`${FORGE_LABEL[kind]} CLI (${bin}) is not installed on the server`));
      // `env` means this ran as someone signed in to an account of their own, so it's their sign-in that stopped.
      if (env && SIGNED_OUT.test(said)) return reject(new Error(`Your ${FORGE_LABEL[kind]} sign-in stopped working — sign in again (☰ → 🔐 Your sign-ins)`));
      reject(new Error(kind === 'bitbucket' ? friendlyBb(said) : friendlyGh(said)));
    });
  });
}

/** Runs gh as the office, or with `env` as someone signed in to their own GitHub (see signins.ts). */
export function gh(args: string[], cwd: string, timeout = 30_000, env?: Record<string, string>): Promise<string> {
  return spawnCli('gh', args, cwd, timeout, env, 'github');
}

/** Runs bb as the office, or with `env` as someone signed in to their own Bitbucket (see signins.ts). */
export function bb(args: string[], cwd: string, timeout = 30_000, env?: Record<string, string>): Promise<string> {
  return spawnCli('bb', args, cwd, timeout, env, 'bitbucket');
}

/** Turns gh's stderr into something a person standing at the board can act on. */
function friendlyGh(raw: string): string {
  if (/no git remotes found|none of the git remotes/i.test(raw)) return 'This project has no GitHub remote yet. Push it to GitHub (git remote add origin <url>) to fill the boards.';
  if (/not a git repository/i.test(raw)) return "This folder isn't a git repository";
  if (SIGNED_OUT.test(raw)) return "gh isn't signed in to GitHub on the office's machine — run `gh auth login` there";
  if (/has disabled issues|issues are disabled/i.test(raw)) return 'GitHub issues are turned off for this repository (Settings → General → Features)';
  if (/could not resolve to a repository|not found/i.test(raw)) return "gh can't find this repository on GitHub (check the remote and access)";
  return raw;
}

/** bb's errors arrive as a JSON envelope under --json ({name, code, message}); take the message out of it. */
function bbSaid(raw: string): string {
  try {
    const e = JSON.parse(raw) as { message?: unknown };
    if (typeof e.message === 'string' && e.message) return e.message;
  } catch {
    // plain text
  }
  return raw;
}

/**
 * The office reads Bitbucket with the Bitbucket CLI (`bb pr`, `bb auth`,
 * https://bitbucket-cli.paulvanderlei.com). Atlassian's own Bitbucket CLI answers to the same `bb`
 * and shares none of it: it wants `bb pullrequest`, has no `auth` command, spells its output
 * `-o json` rather than `--json`, and wants lower-case `--state` values. A machine with that one
 * installed gives every Bitbucket floor an unfamiliar error, so the office says which `bb` it found
 * instead of passing on `unknown flag: --json`.
 */
const NOT_OUR_BB = /unknown command "(?:auth|api|status)"|unknown flag: ?--json|invalid argument "[A-Z]+" for "--state" flag|Expected values are (?:all|OPEN)/i;

/** The office's one sentence for a `bb` that isn't the one it reads, naming both. */
export const WRONG_BB = "the `bb` on this machine isn't the Bitbucket CLI the office reads — Atlassian's own Bitbucket CLI answers to the same name, and uses `bb pullrequest` instead of `bb pr`. Install the one the office wants with `npm install -g @pilatos/bitbucket-cli`.";

/** Turns bb's stderr into something a person standing at the board can act on. */
function friendlyBb(raw: string): string {
  const said = bbSaid(raw);
  if (NOT_OUR_BB.test(said)) return WRONG_BB;
  if (/no git remote|remote.*not found|not a git repository/i.test(said)) return 'This project has no Bitbucket remote yet. Push it to Bitbucket (git remote add origin <url>) to fill the boards.';
  if (SIGNED_OUT.test(raw) || /\b1001\b|AUTH_REQUIRED/i.test(said)) return "bb isn't signed in to Bitbucket on the office's machine — run `bb auth login` there";
  if (/context_repo_not_found|repository not found|6001|404/i.test(said)) return "bb can't find this repository on Bitbucket (check the remote and access)";
  return said;
}

/**
 * A board's list, kept between looks: the items as the forge last had them, the loading flag and
 * whatever went wrong. Both forges use it, so the loading flag, the error and the label overlay below
 * are written once.
 */
export class Board<T extends GhIssue | GhPull> {
  /** The list as the last look left it, and whatever that look said about it. */
  state: GhState<T> = { items: [], fetchedAt: 0, loading: false };

  /** Labels just changed from the office, by number and when, so a list asked for before them can be corrected. */
  private relabeled = new Map<number, { labels: GhLabel[]; at: number }>();

  /** `list` asks the forge for the board's items as they stand now. */
  constructor(
    private forge: ForgeKind,
    private send: (state: GhState<T>) => void,
    private list: () => Promise<T[]>,
  ) {}

  get items(): T[] {
    return this.state.items;
  }
  get fetchedAt(): number {
    return this.state.fetchedAt;
  }
  get loading(): boolean {
    return this.state.loading;
  }
  get error(): string | undefined {
    return this.state.error;
  }

  /** Looks the board over again, and sends it on. A look already under way is left to finish. */
  async refresh(): Promise<void> {
    if (this.state.loading) return;
    this.state = { ...this.state, loading: true };
    this.send(this.state);
    const asked = Date.now();
    try {
      // A list asked for before a label change made here still has the old labels (see relabel).
      const items = this.relabel(await this.list(), asked);
      this.state = { items, fetchedAt: Date.now(), loading: false, forge: this.forge };
    } catch (err) {
      this.state = { ...this.state, loading: false, error: (err as Error).message, fetchedAt: Date.now(), forge: this.forge };
    }
    this.send(this.state);
  }

  /** Puts labels on the board at once, before the next look comes back with them. */
  remember(n: number, labels: GhLabel[]) {
    this.relabeled.set(n, { labels, at: Date.now() });
    this.state = { ...this.state, items: this.relabel(this.state.items, this.relabeled.get(n)!.at) };
    this.send(this.state);
  }

  /**
   * A list asked for before a label change made here still has the old labels, so the new ones are
   * kept over it; a list asked for after the change is believed, and the change forgotten.
   */
  private relabel(items: T[], asked: number): T[] {
    return items.map((it) => {
      const r = this.relabeled.get(it.number);
      if (!r) return it;
      if (r.at < asked) {
        this.relabeled.delete(it.number);
        return it;
      }
      return { ...it, labels: r.labels };
    });
  }
}

/**
 * Spots pull requests that merged between two looks at the list, so the gong rings however they
 * merged: from the PR window, by a worker's `gh pr merge`, by auto-merge, or on the forge itself.
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

  /** A fresh list from the forge: the pull requests that merged since the last look and haven't rung yet. */
  look(pulls: GhPull[]): GhPull[] {
    const open = this.open;
    const merged = open ? pulls.filter((p) => p.state === 'MERGED' && open.has(p.number) && !this.rang.has(p.number)) : [];
    // Once the forge says it merged, it never shows as open again to ring twice.
    for (const p of pulls) if (p.state === 'MERGED') this.rang.delete(p.number);
    this.open = new Set(pulls.filter((p) => p.state === 'OPEN').map((p) => p.number));
    return merged;
  }
}

/**
 * A floor's forge: its two boards and everything the office does to its issues and pull requests.
 * GitHub through `gh` (see github.ts), Bitbucket through `bb` (see bitbucket.ts).
 */
export abstract class Forge {
  readonly issues: Board<GhIssue>;
  readonly pulls: Board<GhPull>;
  protected constructor(
    /** The checkout every command about this floor runs in. */
    readonly dir: string,
    /** Which forge this floor is on. */
    readonly kind: ForgeKind,
    onIssues: (s: GhState<GhIssue>) => void,
    onPulls: (s: GhState<GhPull>) => void,
  ) {
    this.issues = new Board<GhIssue>(kind, onIssues, () => this.listIssues());
    this.pulls = new Board<GhPull>(kind, onPulls, () => this.listPulls());
  }

  /** Looks both boards over. */
  refresh(): Promise<void> {
    return Promise.all([this.issues.refresh(), this.pulls.refresh()]).then(() => undefined);
  }

  /**
   * Asks the forge something the office wants to know once (the repository, who it's signed in as),
   * and keeps the answer until asking fails.
   */
  private repo?: Promise<GhRepoInfo>;
  private login?: Promise<string>;

  /** The repository's full name and how it lets PRs merge, asked once and believed until it fails. */
  protected askRepo(ask: () => Promise<GhRepoInfo>): Promise<GhRepoInfo> {
    this.repo ??= ask();
    this.repo.catch(() => (this.repo = undefined));
    return this.repo;
  }

  /** Who the CLI on this machine is signed in as, or '' when it can't say. */
  protected askViewer(ask: () => Promise<string>): Promise<string> {
    this.login ??= ask();
    this.login.catch(() => (this.login = undefined));
    return this.login.catch(() => '');
  }

  /** The repository's full name and how it lets PRs merge. */
  abstract repoInfo(): Promise<GhRepoInfo>;
  /** A PR's description, conversation, line comments, checks and whether it can merge. */
  abstract pullDetail(n: number, me?: string): Promise<GhPullDetail>;
  /** The PR's unified diff, as `git diff` prints it. */
  abstract pullDiff(n: number): Promise<string>;
  /** An issue's description and conversation. */
  abstract issueDetail(n: number, me?: string): Promise<GhIssueDetail>;
  /** Comments on an issue, or on a PR's conversation, as `as` or else the office. */
  abstract comment(kind: 'issue' | 'pull', n: number, body: string, as?: ForgeAs): Promise<{ comment?: GhComment; error?: string }>;
  /** Posts a review that only comments (the meeting room's review panel), its body read from a file. */
  abstract review(n: number, file: string, as?: ForgeAs): Promise<string>;
  /** Merges a PR, or with `auto` has the forge merge it once its requirements pass. Returns an error. */
  abstract merge(n: number, method: GhMergeMethod, deleteBranch: boolean, auto: boolean, as?: ForgeAs): Promise<string | undefined>;
  /** Closes an issue, or a pull request without merging it, optionally saying why. Returns an error. */
  abstract close(kind: 'issue' | 'pull', n: number, opts: { comment?: string; reason?: GhCloseReason; deleteBranch?: boolean }, as?: ForgeAs): Promise<string | undefined>;
  /** Every label the repository has, for the label picker. */
  abstract repoLabels(): Promise<GhLabel[]>;
  /** Puts labels on an issue or PR and takes others off. */
  abstract setLabels(kind: 'issue' | 'pull', n: number, add: string[], remove: string[], as?: ForgeAs): Promise<{ labels?: GhLabel[]; error?: string }>;
  /** Assigns the issue to `as` (else the office), which moves it to In progress on the board. */
  abstract claim(issue: number, as?: ForgeAs): Promise<string | undefined>;
  /** The repository's open and recent closed issues, as the office's shape. Fills the 📌 board. */
  protected abstract listIssues(): Promise<GhIssue[]>;
  /** The repository's open, merged and recently closed pull requests. Fills the 🔀 board. */
  protected abstract listPulls(): Promise<GhPull[]>;
}

// --- Opening a pull request for a worker's branch ----------------------------------------------------------------

/** `gh pr create` or `bb pr create` for a pushed branch, in the repository that branch was pushed to. */
export async function openPull(branch: string, base: string | undefined, title: string, body: string, cwd: string, kind: ForgeKind, env?: Record<string, string>): Promise<{ number: number; url: string }> {
  if (kind === 'bitbucket') {
    // bb answers with the pull request itself, so the URL is read out of it rather than off stdout.
    const out = await bb(['pr', 'create', '--title', title, '--body', body, '--source', branch, ...(base ? ['--destination', base] : []), '--json'], cwd, 60_000, env);
    const url = String((JSON.parse(out || '{}') as { links?: { html?: { href?: string } } }).links?.html?.href ?? '').trim();
    const number = Number(/\/pull-requests\/(\d+)/.exec(url)?.[1]);
    if (!number) throw new Error(`bb did not return a pull request URL (${url.slice(0, 120)})`);
    return { number, url };
  }
  const out = await gh(repoArgs(['pr', 'create', '--head', branch, ...(base ? ['--base', base] : []), '--title', title, '--body', body], targetOf(cwd, kind)), cwd, 60_000, env);
  const url = out.trim().split('\n').pop() ?? '';
  const number = Number(/\/pull\/(\d+)/.exec(url)?.[1]);
  if (!number) throw new Error(`gh did not return a pull request URL (${url.slice(0, 120) || out.trim().slice(0, 120)})`);
  return { number, url };
}

/** The open pull request for `branch` in `cwd`, if there is one. */
export async function findPull(branch: string, cwd: string, kind: ForgeKind, env?: Record<string, string>): Promise<{ number: number; url: string } | undefined> {
  if (kind === 'bitbucket') {
    const out = await bb(['pr', 'list', '--state', 'OPEN', '--limit', '100', '--json'], cwd, 60_000, env);
    const found = ((JSON.parse(out || '{}') as { pullRequests?: any[] }).pullRequests ?? []).find((p) => p?.source?.branch?.name === branch);
    const url = String(found?.links?.html?.href ?? '');
    return found?.id ? { number: Number(found.id), url } : undefined;
  }
  const out = await gh(repoArgs(['pr', 'list', '--head', branch, '--state', 'open', '--limit', '1', '--json', 'number,url'], targetOf(cwd, kind)), cwd, undefined, env);
  const first = (JSON.parse(out || '[]') as { number: number; url: string }[])[0];
  return first ? { number: first.number, url: first.url } : undefined;
}

/** A pull request's description, from a URL (or, for Bitbucket, its number). */
export async function pullBody(url: string, cwd: string, kind: ForgeKind, env?: Record<string, string>): Promise<string> {
  if (kind === 'bitbucket') {
    const out = await bb(['pr', 'view', String(numberOf(url)), '--json'], cwd, 30_000, env);
    return String((JSON.parse(out || '{}') as { description?: string }).description ?? '');
  }
  return gh(repoArgs(['pr', 'view', url, '--json', 'body', '--jq', '.body'], targetOf(cwd, kind)), cwd, 30_000, env);
}

/** Replaces a pull request's description, from a URL (or, for Bitbucket, its number). */
export async function setPullBody(url: string, body: string, cwd: string, kind: ForgeKind, env?: Record<string, string>): Promise<void> {
  if (kind === 'bitbucket') await bb(['pr', 'edit', String(numberOf(url)), '--body', body], cwd, 60_000, env);
  else await gh(repoArgs(['pr', 'edit', url, '--body', body], targetOf(cwd, kind)), cwd, 60_000, env);
}

/** A pull request's number, from its URL. */
function numberOf(url: string): number {
  return Number(/\/pull(?:-requests)?\/(\d+)/.exec(url)?.[1] ?? 0);
}

/** owner/name#12 for a pull request on either forge (which links it with its title), else its URL. */
export function prRef(url: string): string {
  const m = /(github\.com|bitbucket\.org)\/([^/]+\/[^/]+)\/pull(?:-requests)?\/(\d+)/.exec(url);
  return m ? `${m[2]}#${m[3]}` : url;
}
