import { execFile } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FLOOR_PALETTES, MAX_FLOORS, normalizeRepo, sameRepo } from '../shared/floors.js';
import type { ForgeKind, ProjectsDirState, RepoChoice } from '../shared/protocol.js';
import { bb, gh, originRepo } from './forge.js';

/** A floor as floors.json keeps it. */
export interface FloorDef {
  id: string;
  name: string;
  /** owner/name on the forge (GitHub or Bitbucket) it came from. */
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

/** What a forge said about a name someone typed: the repository's real name, and its CLI. */
interface Found {
  repo: string;
  forge: ForgeKind;
  /** The name the forge's own CLI answered to, which is the one it can clone from. */
  asked?: string;
}

/** The checkout the office was started in, once it's been taken off the building (local-floor.json). */
interface LocalOff {
  dir: string;
  by: string;
  at: number;
}

/** How long the list of repositories the office's forge sign-ins can see is reused before it's asked again. */
const REPOS_TTL_MS = 5 * 60_000;
const MAX_REPOS = 1000;
const CLONE_TIMEOUT_MS = 30 * 60_000;

/**
 * The floors of the building, saved in <office>/.agent-office/floors.json: which projects there are,
 * where their checkouts live, and how each floor is painted. New floors are cloned with the office
 * machine's own forge sign-ins into <projects>/<owner>/<repo> — `gh repo clone` for a GitHub
 * repository, `bb repo clone` for a Bitbucket one; the projects folder can be picked in ⚙️ Settings
 * (kept in projects-folder.json).
 */
export class Building {
  private defs: FloorDef[] = [];
  private file: string;
  private pickedFile: string;
  private picked?: PickedDir;
  /** Floors being cloned, by lower-cased repo. Not saved until the clone is there. */
  private cloning = new Map<string, FloorDef>();
  private repoCache?: { at: number; repos: Promise<RepoChoice[]> };
  /** The checkout the office was started in (see ensureLocal), and the repository it's a checkout of. */
  private local?: { dir: string; repo?: string };
  /** The floor that checkout is, while it is one. */
  private localId?: string;
  private localFile: string;
  /** That checkout was taken off the building: a restart doesn't put it back. */
  private localOff?: LocalOff;

  constructor(
    /** The office's own data folder; `gh` runs there, since the projects folder may not exist yet. */
    private dataDir: string,
    /** Where new floors are cloned unless another folder was picked. */
    private defaultProjectsDir: string,
  ) {
    this.file = path.join(dataDir, 'floors.json');
    this.pickedFile = path.join(dataDir, 'projects-folder.json');
    this.localFile = path.join(dataDir, 'local-floor.json');
    this.load();
    this.loadPicked();
    this.loadLocalOff();
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
      const why = unwritable(dir);
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
   * Makes the checkout the office was started in a floor, if it isn't one yet: `agent-office <dir>`
   * has always meant that project. Once someone takes it off the building it stays off (the office
   * still keeps its own data in it), until its repository is added again from the elevator.
   */
  ensureLocal(dir: string, by: string): FloorDef | undefined {
    const abs = path.resolve(dir);
    const known = this.defs.find((d) => path.resolve(d.dir) === abs);
    this.local = { dir: abs, repo: known?.repo ?? originRepo(abs) };
    if (known) {
      this.localId = known.id;
      if (this.localOff) this.setLocalOff(undefined);
      return known;
    }
    if (this.localOff && path.resolve(this.localOff.dir) === abs) return undefined;
    // Named after its folder, as the office always called it.
    const def = this.newDef(path.basename(abs), this.local.repo, abs, by);
    this.defs.unshift(def);
    this.localId = def.id;
    this.save();
    return def;
  }

  /** The office keeps its own data in this floor's checkout. */
  isLocal(id: string): boolean {
    return id === this.localId;
  }

  /**
   * Takes a floor off the building. Its checkout stays where it is, with its workers, queue and
   * pictures in its .agent-office folder: adding the repository again moves back in, as long as the
   * checkout is still where the projects folder clones it (or it's the one the office was started
   * in). Returns the floor, or why it can't.
   */
  remove(id: string, by = '?'): FloorDef | string {
    const def = this.defs.find((d) => d.id === id);
    if (!def) return [...this.cloning.values()].some((d) => d.id === id) ? "That floor is still being cloned — take it off once it's there" : 'No such floor';
    this.defs = this.defs.filter((d) => d !== def);
    if (this.isLocal(id)) {
      this.localId = undefined;
      this.setLocalOff({ dir: def.dir, by, at: Date.now() });
    }
    this.save();
    return def;
  }

  /**
   * Clones a repository into the projects folder and adds it as a floor. `started` hears about the
   * floor as soon as the clone begins; resolves to the finished floor, or to why there's none. A
   * checkout that's already where the clone would go is used as it is. `kind` says which forge the
   * repository is on; without it, GitHub is asked first and Bitbucket second.
   */
  async add(input: string, by: string, started: (def: FloorDef) => void, kind?: ForgeKind): Promise<FloorDef | string> {
    const wanted = normalizeRepo(input);
    if (!wanted) return 'Pick a repository, or type it as owner/name';
    if (this.defs.some((d) => sameRepo(d.repo, wanted))) return `${wanted} already has a floor`;
    if (this.cloning.has(wanted.toLowerCase())) return `${wanted} is already being cloned`;
    if (this.defs.length + this.cloning.size >= MAX_FLOORS) return `The building is full (${MAX_FLOORS} floors)`;
    // The office's own checkout, taken off before: it moves back in where it is, not into a second clone.
    const home = this.local;
    if (this.localOff && home && sameRepo(home.repo, wanted) && existsSync(home.dir)) {
      const def = this.newDef(path.basename(home.dir), home.repo, home.dir, by);
      started(def);
      this.defs.push(def);
      this.localId = def.id;
      this.setLocalOff(undefined);
      this.save();
      return def;
    }
    // Asking the forge first says whether this login can see it at all, and gets the name's real case.
    let repo: string;
    let forge: ForgeKind;
    /** The name bb answered to, which is the one it can clone from (see askBb). */
    let asked: string | undefined;
    try {
      const found = await (kind ? this.ask(kind, wanted, this.dataDir) : this.askAny(wanted, this.dataDir));
      if (!found) throw new Error(`${wanted} isn't on GitHub or Bitbucket, or this login can't see it`);
      ({ repo, forge, asked } = found);
    } catch (err) {
      return (err as Error).message;
    }
    const key = repo.toLowerCase();
    if (this.defs.some((d) => sameRepo(d.repo, repo))) return `${repo} already has a floor`;
    if (this.cloning.has(key)) return `${repo} is already being cloned`;
    const [owner, name] = repo.split('/');
    const dest = path.join(this.projectsDir, owner, name);
    if (this.defs.some((d) => path.resolve(d.dir) === dest)) return `${dest} is already a floor`;
    const def = this.newDef(name, repo, dest, by);
    this.cloning.set(key, def);
    started(def);
    try {
      const err = await cloneInto(repo, dest, forge, asked);
      if (err) return err;
    } finally {
      this.cloning.delete(key);
    }
    this.defs.push(def);
    this.save();
    return def;
  }

  /** Repositories the office's own forge sign-ins can clone, most recently pushed first. */
  async repos(refresh = false): Promise<RepoChoice[]> {
    const cached = this.repoCache;
    if (cached && !refresh && Date.now() - cached.at < REPOS_TTL_MS) return cached.repos;
    const repos = listRepos(this.dataDir);
    this.repoCache = { at: Date.now(), repos };
    // A failure is worth asking again next time, not keeping for five minutes.
    repos.catch(() => {
      if (this.repoCache?.repos === repos) this.repoCache = undefined;
    });
    return repos;
  }

  /**
   * Asks one forge about `repo`: the name's real case, and that this login can see it. Resolves to
   * nothing when the forge doesn't have it, rather than failing, so the next one can be asked.
   * `asked` is the name the forge itself answered to, which is the one it can go on to clone from.
   */
  private async ask(kind: ForgeKind, repo: string, cwd: string): Promise<Found | undefined> {
    try {
      if (kind === 'bitbucket') return await askBb(repo, cwd);
      const view = JSON.parse(await gh(['repo', 'view', repo, '--json', 'nameWithOwner'], cwd, 30_000)) as { nameWithOwner?: string };
      return view.nameWithOwner ? { repo: normalizeRepo(view.nameWithOwner) ?? repo, forge: 'github' } : undefined;
    } catch {
      return undefined;
    }
  }

  /** A name with no forge said: GitHub first, then Bitbucket, so `agent-office owner/name` still works. */
  private async askAny(repo: string, cwd: string): Promise<Found | undefined> {
    return (await this.ask('github', repo, cwd)) ?? (await this.ask('bitbucket', repo, cwd));
  }

  private newDef(name: string, repo: string | undefined, dir: string, by: string): FloorDef {
    const taken = new Set([...this.defs, ...this.cloning.values()].map((d) => d.id));
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'floor';
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

  private loadLocalOff() {
    try {
      const saved = JSON.parse(readFileSync(this.localFile, 'utf8')) as Partial<LocalOff>;
      if (typeof saved.dir === 'string' && path.isAbsolute(saved.dir)) {
        this.localOff = { dir: saved.dir, by: typeof saved.by === 'string' ? saved.by : '?', at: typeof saved.at === 'number' ? saved.at : Date.now() };
      }
    } catch {
      // never taken off
    }
  }

  private setLocalOff(off: LocalOff | undefined) {
    this.localOff = off;
    try {
      if (off) writeFileSync(this.localFile, JSON.stringify(off, null, 2), { mode: 0o600 });
      else rmSync(this.localFile, { force: true });
    } catch (err) {
      console.error(`agent-office: couldn't save ${this.localFile}: ${(err as Error).message}`);
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

/**
 * Asks bb about a repository someone typed, and reports the name bb itself answers to.
 *
 * bb works out its workspace from `BB_WORKSPACE` or the default its sign-in recorded, and that is
 * the only way to reach a personal workspace, whose slug is often not the username: asked as
 * `tradai/discovery` it says the repository is not found, while `discovery` alone works. So the name
 * is asked about both ways and whichever bb recognises is the one given back — and the one cloned
 * from later, since `repo clone` takes the same forms and fails the same way.
 */
async function askBb(repo: string, cwd: string): Promise<Found | undefined> {
  const slug = repo.split('/').pop() ?? repo;
  for (const asked of [repo, slug]) {
    try {
      const out = await bb(['repo', 'view', asked, '--json', 'full_name'], cwd, 30_000);
      const full = normalizeRepo((JSON.parse(out || '{}') as { full_name?: string }).full_name);
      if (full) return { repo: full, forge: 'bitbucket', asked };
    } catch {
      // Not that one, or not under that name: try the next way of saying it.
    }
  }
  return undefined;
}

/** Clones `repo` to `dest`, or checks that what's already there is that repository. `asked` is the
 * name the forge answered to, which for Bitbucket is the form its CLI can clone from. */
async function cloneInto(repo: string, dest: string, kind: ForgeKind, asked?: string): Promise<string | undefined> {
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
  const how = kind === 'bitbucket' ? 'bb' : 'gh';
  const name = kind === 'bitbucket' ? (asked ?? repo) : repo;
  const args = kind === 'bitbucket' ? ['repo', 'clone', name, '--directory', dest] : ['repo', 'clone', repo, dest];
  return new Promise((resolve) => {
    execFile(kind === 'bitbucket' ? 'bb' : 'gh', args, { cwd: path.dirname(dest), timeout: CLONE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, _out, stderr) => {
      if (!err) return resolve(undefined);
      const why = String(stderr || err.message).trim().split('\n').filter(Boolean).slice(-2).join(' ');
      resolve(`Couldn't clone ${repo}: ${why || `${how} failed`}`);
    });
  });
}

/**
 * Repositories the office's own sign-ins can clone, most recently pushed first. Both forges are
 * asked, and one that isn't installed or isn't signed in is quietly left out rather than failing
 * the whole list: GitHub-only and Bitbucket-only people get theirs either way.
 */
async function listRepos(cwd: string): Promise<RepoChoice[]> {
  const [github, bitbucket] = await Promise.allSettled([githubRepos(cwd), bitbucketRepos(cwd)]);
  if (github.status === 'rejected' && bitbucket.status === 'rejected') throw github.reason;
  const repos = [...(github.status === 'fulfilled' ? github.value : []), ...(bitbucket.status === 'fulfilled' ? bitbucket.value : [])];
  const seen = new Set<string>();
  return repos
    .filter((r) => (seen.has(r.name.toLowerCase()) ? false : seen.add(r.name.toLowerCase())))
    .sort((a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? ''))
    .slice(0, MAX_REPOS);
}

async function githubRepos(cwd: string): Promise<RepoChoice[]> {
  const out = await gh(
    [
      'api',
      '--paginate',
      'user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member',
      '--jq',
      '.[] | {name: .full_name, description: (.description // ""), private: .private, pushedAt: .pushed_at}',
    ],
    cwd,
    90_000,
  );
  const repos: RepoChoice[] = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as { name?: unknown; description?: unknown; private?: unknown; pushedAt?: unknown };
      const name = normalizeRepo(r.name);
      if (!name) continue;
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
  return repos;
}

/**
 * The repositories in every Bitbucket workspace this login belongs to.
 *
 * bb works out a workspace for itself — `BB_WORKSPACE`, or the default its sign-in recorded — and
 * that is the only way to reach a *personal* workspace, whose slug is often not the username: named
 * outright, bb answers `No workspace with identifier 'tradai'` and `repo view tradi/discovery` says
 * the repository is not found, while `discovery` alone works. So the workspace bb has for itself is
 * listed without one, and every other workspace is asked for by name, with any that won't answer
 * left out rather than failing the whole list.
 */
async function bitbucketRepos(cwd: string): Promise<RepoChoice[]> {
  const repos: RepoChoice[] = [];
  // A workspace list that can't be read is not a reason to show nothing: the default one still can.
  const slugs = await Promise.allSettled([bbWorkspaceSlugs(cwd)]).then(([s]) => (s.status === 'fulfilled' ? s.value : []));
  // Asking for exactly the fields the elevator shows, rather than each repository in full, is a
  // fraction of the JSON: four fields against a links-and-permissions object apiece.
  const pages = await Promise.allSettled([undefined, ...slugs].map((s) => bbRepoPage(s, cwd)));
  for (const page of pages) {
    if (page.status !== 'fulfilled') continue;
    for (const r of page.value) {
      repos.push(r);
      if (repos.length >= MAX_REPOS) break;
    }
    if (repos.length >= MAX_REPOS) break;
  }
  return repos;
}

/** The slugs of the workspaces this login belongs to; the default one among them, if bb names it. */
async function bbWorkspaceSlugs(cwd: string): Promise<string[]> {
  const listed = await bb(['workspace', 'list', '--json'], cwd, 60_000);
  // Each entry is a workspace_access wrapper with the workspace itself under `workspace`, so the
  // slug is one level in — reading it off the entry finds nothing and the list comes back empty.
  return ((JSON.parse(listed || '{}') as { workspaces?: any[] }).workspaces ?? [])
    .map((w) => String(w?.workspace?.slug ?? w?.slug ?? '').trim())
    .filter(Boolean);
}

/** One page of `bb repo list`: `workspace` is undefined for the workspace bb has for itself. */
async function bbRepoPage(workspace: string | undefined, cwd: string): Promise<RepoChoice[]> {
  const out = await bb(['repo', 'list', ...(workspace ? ['--workspace', workspace] : []), '--all', '--json', 'full_name,description,is_private,updated_on'], cwd, 90_000);
  // Naming the fields drops the envelope and answers with a flat array; a bare `--json` keeps it.
  const parsed = JSON.parse(out || '[]') as any[] | { repositories?: any[] };
  const rows = Array.isArray(parsed) ? parsed : (parsed.repositories ?? []);
  const repos: RepoChoice[] = [];
  for (const r of rows) {
    const name = normalizeRepo(r?.full_name);
    if (!name) continue;
    repos.push({
      name,
      forge: 'bitbucket',
      description: typeof r?.description === 'string' && r.description ? r.description.slice(0, 200) : undefined,
      private: r?.is_private === true,
      pushedAt: typeof r?.updated_on === 'string' ? r.updated_on : undefined,
    });
  }
  return repos;
}
