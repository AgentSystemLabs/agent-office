import { execFile, execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FLOOR_PALETTES, MAX_FLOORS, forgeOf, gitlabParts, normalizeRepo, sameRepo } from '../shared/floors.js';
import type { ProjectsDirState, RepoChoice } from '../shared/protocol.js';
import { gh } from './github.js';
import { gitlabApi, gitlabHosts, glab, isGitlabHost } from './gitlab.js';

/** A floor as floors.json keeps it. */
export interface FloorDef {
  id: string;
  name: string;
  /** owner/name on GitHub, host/group/…/project on GitLab. */
  repo?: string;
  dir: string;
  palette: number;
  addedBy: string;
  addedAt: number;
}

/** A projects folder picked in ⚙️ Settings (or with --projects), as projects-folder.json keeps it. */
interface PickedDir {
  dir: string;
  by: string;
  at: number;
}

/** How long the list of repositories `gh` and `glab` can see is reused before it's asked again. */
const REPOS_TTL_MS = 5 * 60_000;
const MAX_REPOS = 1000;
const CLONE_TIMEOUT_MS = 30 * 60_000;

/**
 * The floors of the building, saved in <office>/.agent-office/floors.json: which projects there are,
 * where their checkouts live, and how each floor is painted. New floors are cloned with the office
 * machine's `gh` login into <projects>/<owner>/<repo>, or its `glab` login into
 * <projects>/<host>/<group>/…/<project>; the projects folder can be picked in ⚙️ Settings (kept in
 * projects-folder.json).
 */
export class Building {
  private defs: FloorDef[] = [];
  private file: string;
  private pickedFile: string;
  private picked?: PickedDir;
  /** Floors being cloned, by lower-cased repo. Not saved until the clone is there. */
  private cloning = new Map<string, FloorDef>();
  private repoCache?: { at: number; repos: Promise<RepoChoice[]> };
  /** The floor the office was started in (see ensureLocal), which can't be taken off. */
  private localId?: string;

  constructor(
    /** The office's own data folder; `gh` runs there, since the projects folder may not exist yet. */
    private dataDir: string,
    /** Where new floors are cloned unless another folder was picked. */
    private defaultProjectsDir: string,
  ) {
    this.file = path.join(dataDir, 'floors.json');
    this.pickedFile = path.join(dataDir, 'projects-folder.json');
    this.load();
    this.loadPicked();
  }

  /** Where new floors are cloned. Floors already there stay where they are when it moves. */
  get projectsDir(): string {
    return this.picked?.dir ?? this.defaultProjectsDir;
  }

  projectsDirState(): ProjectsDirState {
    return { dir: tildify(this.projectsDir), custom: !!this.picked, by: this.picked?.by, at: this.picked?.at };
  }

  /** Clones new floors into `raw` from now on ('~' is the home folder; '' goes back to the default). Returns why it can't, if it can't. */
  setProjectsDir(raw: string, by: string): string | undefined {
    const text = raw.trim();
    let dir = this.defaultProjectsDir;
    if (text) {
      const typed = untildify(text);
      if (!path.isAbsolute(typed)) return 'Use a full path, like ~/Workspace';
      dir = path.resolve(typed);
    }
    if (dir !== this.defaultProjectsDir) {
      const why = unwritable(dir) ?? insideCheckout(dir);
      if (why) return why;
      // Cloning into a project would nest checkouts inside its git tree.
      const inside = this.defs.find((d) => within(dir, path.resolve(d.dir)));
      if (inside) return `${tildify(dir)} is inside ${inside.name}'s checkout — pick a folder outside every project`;
    }
    this.picked = dir === this.defaultProjectsDir ? undefined : { dir, by, at: Date.now() };
    try {
      writeFileSync(this.pickedFile, JSON.stringify(this.picked ?? {}, null, 2), { mode: 0o600 });
    } catch (err) {
      console.error(`agent-office: couldn't save the projects folder: ${(err as Error).message}`);
    }
    return undefined;
  }

  list(): FloorDef[] {
    return this.defs;
  }

  /** Floors on their way: shown in the elevator, but nobody can ride there yet. */
  pending(): FloorDef[] {
    return [...this.cloning.values()];
  }

  /**
   * Makes the checkout the office was started in a floor, if it isn't one yet. It's the office's own
   * project: `agent-office <dir>` has always meant that one.
   */
  ensureLocal(dir: string, by: string): FloorDef {
    const abs = path.resolve(dir);
    const known = this.defs.find((d) => path.resolve(d.dir) === abs);
    if (known) {
      this.localId = known.id;
      return known;
    }
    // Named after its folder, as the office always called it.
    const def = this.newDef(path.basename(abs), originRepo(abs), abs, by);
    this.defs.unshift(def);
    this.localId = def.id;
    this.save();
    return def;
  }

  /** The office keeps its data in this floor's checkout, and makes it a floor again at every start. */
  isLocal(id: string): boolean {
    return id === this.localId;
  }

  /**
   * Takes a floor off the building. Its checkout stays where it is, with its workers, queue and
   * pictures in its .agent-office folder: adding the repository again moves back in, as long as the
   * checkout is still where the projects folder clones it. Returns the floor, or why it can't.
   */
  remove(id: string): FloorDef | string {
    const def = this.defs.find((d) => d.id === id);
    if (!def) return [...this.cloning.values()].some((d) => d.id === id) ? "That floor is still being cloned — take it off once it's there" : 'No such floor';
    if (this.isLocal(id)) return `${def.name} is the project the office was started in, so it's always a floor`;
    this.defs = this.defs.filter((d) => d !== def);
    this.save();
    return def;
  }

  /**
   * Clones a repository into the projects folder and adds it as a floor. `started` hears about the
   * floor as soon as the clone begins; resolves to the finished floor, or to why there's none. A
   * checkout that's already where the clone would go is used as it is.
   */
  async add(input: string, by: string, started: (def: FloorDef) => void): Promise<FloorDef | string> {
    const wanted = normalizeRepo(input);
    if (!wanted) return 'Pick a repository, or type it as owner/name (GitHub) or a GitLab URL or group/project path';
    if (this.defs.some((d) => sameRepo(d.repo, wanted))) return `${wanted} already has a floor`;
    if (this.cloning.has(wanted.toLowerCase())) return `${wanted} is already being cloned`;
    if (this.defs.length + this.cloning.size >= MAX_FLOORS) return `The building is full (${MAX_FLOORS} floors)`;
    const nested = insideCheckout(this.projectsDir);
    if (nested) return `${nested}. Pick another workspace folder in ⚙️ Settings`;
    // Asking the host first says whether this login can see it at all, and gets the name's real case.
    let repo: string;
    try {
      repo = await this.lookUp(wanted);
    } catch (err) {
      return `Couldn't find ${wanted} on ${forgeOf(wanted) === 'gitlab' ? 'GitLab' : 'GitHub'}: ${(err as Error).message}`;
    }
    const key = repo.toLowerCase();
    if (this.defs.some((d) => sameRepo(d.repo, repo))) return `${repo} already has a floor`;
    if (this.cloning.has(key)) return `${repo} is already being cloned`;
    const dest = path.join(this.projectsDir, ...repo.split('/'));
    if (!within(dest, this.projectsDir)) return `${repo} isn't a repository name the office can clone`;
    if (this.defs.some((d) => path.resolve(d.dir) === dest)) return `${dest} is already a floor`;
    const name = repo.split('/').pop() ?? repo;
    const def = this.newDef(name, repo, dest, by);
    this.cloning.set(key, def);
    started(def);
    try {
      const err = await cloneInto(repo, dest);
      if (err) return err;
    } finally {
      this.cloning.delete(key);
    }
    this.defs.push(def);
    this.save();
    return def;
  }

  /** The repository's name as its host spells it, which also says this login can see it. */
  private async lookUp(repo: string): Promise<string> {
    if (forgeOf(repo) === 'gitlab') {
      const { host, path: full } = gitlabParts(repo);
      const p = JSON.parse(await gitlabApi(host, this.dataDir, `projects/${encodeURIComponent(full)}`, [], 30_000)) as { path_with_namespace?: string };
      return normalizeRepo(`${host}/${p.path_with_namespace ?? full}`) ?? repo;
    }
    const view = JSON.parse(await gh(['repo', 'view', repo, '--json', 'nameWithOwner'], this.dataDir, 30_000)) as { nameWithOwner?: string };
    return normalizeRepo(view.nameWithOwner) ?? repo;
  }

  /**
   * Repositories the office's `gh` and `glab` logins can clone, most recently pushed first. A CLI
   * that's missing or signed out just adds nothing; only when both fail is it an error.
   */
  async repos(refresh = false): Promise<RepoChoice[]> {
    const cached = this.repoCache;
    if (cached && !refresh && Date.now() - cached.at < REPOS_TTL_MS) return cached.repos;
    const repos = listAllRepos(this.dataDir);
    this.repoCache = { at: Date.now(), repos };
    // A failure is worth asking again next time, not keeping for five minutes.
    repos.catch(() => {
      if (this.repoCache?.repos === repos) this.repoCache = undefined;
    });
    return repos;
  }

  private newDef(name: string, repo: string | undefined, dir: string, by: string): FloorDef {
    const taken = new Set([...this.defs, ...this.cloning.values()].map((d) => d.id));
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32) || 'floor';
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    // The first look nobody has, so floors side by side never match; then round again.
    const used = new Set([...this.defs, ...this.cloning.values()].map((d) => d.palette));
    const free = FLOOR_PALETTES.findIndex((_, i) => !used.has(i));
    const palette = free >= 0 ? free : (this.defs.length + this.cloning.size) % FLOOR_PALETTES.length;
    return { id, name, repo, dir, palette, addedBy: by, addedAt: Date.now() };
  }

  private load() {
    if (!existsSync(this.file)) return;
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<FloorDef>[];
      const ids = new Set<string>();
      for (const s of Array.isArray(saved) ? saved : []) {
        if (typeof s.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(s.id) || ids.has(s.id) || typeof s.dir !== 'string' || !path.isAbsolute(s.dir)) continue;
        ids.add(s.id);
        this.defs.push({
          id: s.id,
          name: typeof s.name === 'string' && s.name ? s.name.slice(0, 100) : path.basename(s.dir),
          repo: normalizeRepo(s.repo),
          dir: s.dir,
          palette: Number.isInteger(s.palette) && (s.palette as number) >= 0 ? (s.palette as number) : 0,
          addedBy: typeof s.addedBy === 'string' ? s.addedBy : '?',
          addedAt: typeof s.addedAt === 'number' ? s.addedAt : Date.now(),
        });
      }
    } catch (err) {
      console.error(`agent-office: ${this.file} couldn't be read, so the building starts empty: ${(err as Error).message}`);
    }
  }

  private loadPicked() {
    try {
      const saved = JSON.parse(readFileSync(this.pickedFile, 'utf8')) as Partial<PickedDir>;
      if (typeof saved.dir === 'string' && path.isAbsolute(saved.dir)) {
        this.picked = { dir: saved.dir, by: typeof saved.by === 'string' ? saved.by : '?', at: typeof saved.at === 'number' ? saved.at : Date.now() };
      }
    } catch {
      // never picked: the default
    }
  }

  private save() {
    try {
      writeFileSync(this.file, JSON.stringify(this.defs, null, 2), { mode: 0o600 });
    } catch (err) {
      console.error(`agent-office: couldn't save the floors: ${(err as Error).message}`);
    }
  }
}

/** A path under the home folder as ~/…, for showing people. */
export function tildify(p: string): string {
  const home = os.homedir();
  return p === home || p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p;
}

function untildify(p: string): string {
  return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
}

/** `dir` is `parent` or somewhere under it. */
function within(dir: string, parent: string): boolean {
  const rel = path.relative(parent, dir);
  return !rel || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** Why the office couldn't make checkouts under `dir`, if it couldn't. It's made on the first clone, so it needn't exist yet. */
function unwritable(dir: string): string | undefined {
  let at = dir;
  while (!existsSync(at) && path.dirname(at) !== at) at = path.dirname(at);
  try {
    if (!statSync(at).isDirectory()) return `${tildify(at)} isn't a folder`;
    accessSync(at, constants.W_OK);
  } catch {
    return `The office can't write in ${tildify(at)}`;
  }
  return undefined;
}

/** Why new checkouts can't go under `dir`: it's inside a git checkout, whose tree would take them in. */
export function insideCheckout(dir: string): string | undefined {
  let at = path.resolve(dir);
  for (;;) {
    if (existsSync(path.join(at, '.git'))) return `${tildify(dir)} is inside the git checkout at ${tildify(at)}, so clones there would land in that project's tree`;
    const up = path.dirname(at);
    if (up === at) return undefined;
    at = up;
  }
}

/** The repository a remote URL points at, on GitHub or on a GitLab instance. */
export function remoteRepo(url: string): string | undefined {
  if (/github\.com[/:]/i.test(url)) return normalizeRepo(url);
  const host = /^(?:(?:https?|ssh|git):\/\/)?(?:[\w.~%-]+@)?([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(?::\d+)?[/:]/.exec(url.trim())?.[1];
  return host && isGitlabHost(host) ? normalizeRepo(url) : undefined;
}

/** The GitHub or GitLab repository a checkout's origin points at. */
export function originRepo(dir: string): string | undefined {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).trim();
    return remoteRepo(url);
  } catch {
    return undefined;
  }
}

/** Clones `repo` to `dest`, or checks that what's already there is that repository. Resolves to an error, if any. */
async function cloneInto(repo: string, dest: string): Promise<string | undefined> {
  if (existsSync(dest)) {
    if (!statSync(dest).isDirectory()) return `${dest} is already there and isn't a folder`;
    if (readdirSync(dest).length) {
      // Cloned before (a floor that was taken off the list, or by hand): move back in.
      return sameRepo(originRepo(dest), repo) ? undefined : `${dest} already exists and isn't a checkout of ${repo} — move it out of the way first`;
    }
  }
  try {
    mkdirSync(path.dirname(dest), { recursive: true });
  } catch (err) {
    return `Couldn't make ${path.dirname(dest)}: ${(err as Error).message}`;
  }
  const gitlab = forgeOf(repo) === 'gitlab';
  // glab takes the project's URL, so an instance other than its default is cloned from the right place.
  const [cmd, args] = gitlab ? ['glab', ['repo', 'clone', `https://${repo}`, dest]] : ['gh', ['repo', 'clone', repo, dest]];
  const env = gitlab ? { ...process.env, GLAB_NO_PROMPT: '1', NO_PROMPT: '1' } : process.env;
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: path.dirname(dest), env, timeout: CLONE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, _out, stderr) => {
      if (!err) return resolve(undefined);
      const why = String(stderr || err.message)
        .trim()
        .split('\n')
        .filter(Boolean)
        .slice(-2)
        .join(' ');
      resolve(`Couldn't clone ${repo}: ${why || `${cmd} failed`}`);
    });
  });
}

async function listAllRepos(cwd: string): Promise<RepoChoice[]> {
  const [github, ...gitlab] = await Promise.allSettled([listRepos(cwd), ...gitlabHosts().map((host) => listGitlabRepos(host, cwd))]);
  const lists = [github, ...gitlab];
  const ok = lists.filter((r): r is PromiseFulfilledResult<RepoChoice[]> => r.status === 'fulfilled');
  if (!ok.length) {
    const why = lists.map((r) => (r.status === 'rejected' ? (r.reason as Error).message : '')).filter(Boolean);
    throw new Error(why.join(' · ') || 'neither gh nor glab could list repositories');
  }
  return ok
    .flatMap((r) => r.value)
    .sort((a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? ''))
    .slice(0, MAX_REPOS * 2);
}

/** Projects the `glab` login is a member of on `host`, most recently active first. */
async function listGitlabRepos(host: string, cwd: string): Promise<RepoChoice[]> {
  const out = await glab(['api', '--hostname', host, '--paginate', '--output', 'ndjson', 'projects?membership=true&archived=false&simple=true&per_page=100&order_by=last_activity_at'], cwd, 90_000);
  const repos: RepoChoice[] = [];
  const seen = new Set<string>();
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as { path_with_namespace?: unknown; description?: unknown; visibility?: unknown; last_activity_at?: unknown };
      const name = normalizeRepo(typeof r.path_with_namespace === 'string' ? `${host}/${r.path_with_namespace}` : undefined);
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      repos.push({
        name,
        forge: 'gitlab',
        description: typeof r.description === 'string' && r.description ? r.description.slice(0, 200) : undefined,
        private: r.visibility !== 'public',
        pushedAt: typeof r.last_activity_at === 'string' ? r.last_activity_at : undefined,
      });
    } catch {
      // not a line of ours
    }
    if (repos.length >= MAX_REPOS) break;
  }
  return repos;
}

async function listRepos(cwd: string): Promise<RepoChoice[]> {
  const out = await gh(
    ['api', '--paginate', 'user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member', '--jq', '.[] | {name: .full_name, description: (.description // ""), private: .private, pushedAt: .pushed_at}'],
    cwd,
    90_000,
  );
  const repos: RepoChoice[] = [];
  const seen = new Set<string>();
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as { name?: unknown; description?: unknown; private?: unknown; pushedAt?: unknown };
      const name = normalizeRepo(r.name);
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      repos.push({
        name,
        forge: 'github',
        description: typeof r.description === 'string' && r.description ? r.description.slice(0, 200) : undefined,
        private: r.private === true,
        pushedAt: typeof r.pushedAt === 'string' ? r.pushedAt : undefined,
      });
    } catch {
      // not a line of ours
    }
    if (repos.length >= MAX_REPOS) break;
  }
  return repos.sort((a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? ''));
}
