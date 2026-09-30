import { execFileSync, spawn } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FLOOR_PALETTES, MAX_FLOORS, normalizeRepo, sameRepo } from '../shared/floors.js';
import type { CloneProgress, ProjectsDirState, RepoChoice } from '../shared/protocol.js';
import { CloneRun, dropLog, whyCloneFailed, type CloneEnd, type CloneRunOptions } from './clone.js';
import { gh } from './github.js';

/** A floor as floors.json keeps it. */
export interface FloorDef {
  id: string;
  name: string;
  /** owner/name on GitHub. */
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

/** The checkout the office was started in, once it's been taken off the building (local-floor.json). */
interface LocalOff {
  dir: string;
  by: string;
  at: number;
}

/** A floor on its way: its clone, and who can stop it besides admins. */
interface Pending {
  def: FloorDef;
  run?: CloneRun;
  /** The account that added it. */
  owner?: string;
  /** GitHub says the repository has no commits yet, so there's nothing to check out. */
  empty: boolean;
}

/** A clone under way, as cloning.json keeps it for the next office to pick up (see resumeClones). */
interface SavedClone extends FloorDef {
  pid: number;
  log: string;
  owner?: string;
  empty?: boolean;
}

export interface BuildingOptions {
  /**
   * Clones run in this terminal (`agent-office setup`), showing git's own progress and asking
   * there if ssh or git has a question, rather than watched by the office.
   */
  terminal?: boolean;
  /** How clones are watched (tests shorten these). */
  clone?: Pick<CloneRunOptions, 'stallMs' | 'tickMs'>;
}

/** How long the list of repositories `gh` can see is reused before it's asked again. */
const REPOS_TTL_MS = 5 * 60_000;
const MAX_REPOS = 1000;

/**
 * The floors of the building, saved in <office>/.agent-office/floors.json: which projects there are,
 * where their checkouts live, and how each floor is painted. New floors are cloned with the office
 * machine's `gh` login into <projects>/<owner>/<repo>; the projects folder can be picked in ⚙️ Settings
 * (kept in projects-folder.json).
 */
export class Building {
  private defs: FloorDef[] = [];
  private file: string;
  private pickedFile: string;
  private picked?: PickedDir;
  /** Floors being cloned, by lower-cased repo. Not in floors.json until the clone is there, but in cloning.json. */
  private cloning = new Map<string, Pending>();
  private clonesFile: string;
  /** Where clones write their progress. */
  private logsDir: string;
  /** Hears when a clone gets further along. */
  private cloneChanged?: () => void;
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
    private opts: BuildingOptions = {},
  ) {
    this.file = path.join(dataDir, 'floors.json');
    this.clonesFile = path.join(dataDir, 'cloning.json');
    this.logsDir = path.join(dataDir, 'clones');
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
    return [...this.cloning.values()].map((p) => p.def);
  }

  /** How a floor on its way is getting on, once git says. */
  cloneProgress(id: string): CloneProgress | undefined {
    return this.pendingFloor(id)?.run?.progress;
  }

  /** `fn` hears whenever a clone gets further along (at most once a second each). */
  watchClones(fn: () => void) {
    this.cloneChanged = fn;
  }

  /**
   * Stops a floor's clone before it's there, if `may` lets whoever's asking stop one `owner` added.
   * git tidies away what it had cloned, and add() resolves to `why`. Returns why it can't, if it can't.
   */
  cancel(id: string, why: string, may: (owner: string | undefined) => boolean): string | undefined {
    const p = this.pendingFloor(id);
    if (!p) return this.defs.some((d) => d.id === id) ? 'That floor is already there' : 'No such floor';
    if (!may(p.owner)) return 'Only admins, or whoever added it, can stop a floor on its way';
    if (!p.run) return "There's no clone to stop yet — try again in a moment";
    p.run.stop(why);
    return undefined;
  }

  /**
   * Picks up the clones an office before this one left running (it restarted mid-clone): each goes
   * on as a floor on its way, and `done` hears how it ended. One that finished with no office
   * watching becomes its floor now.
   */
  resumeClones(done: (r: FloorDef | string) => void) {
    for (const s of this.loadClones()) {
      const repo = normalizeRepo(s.repo);
      if (!repo || this.defs.some((d) => sameRepo(d.repo, repo)) || this.cloning.has(repo.toLowerCase())) {
        dropLog(s.log);
        continue;
      }
      const def = this.newDef(s.name, repo, s.dir, s.addedBy);
      const pending: Pending = { def, owner: s.owner, empty: !!s.empty };
      const run = CloneRun.adopt(s.pid, s.log, { ...this.opts.clone, changed: () => this.cloneChanged?.() });
      if (!run) {
        dropLog(s.log);
        if (checkoutAt(def.dir, repo, pending.empty) !== 'ok') {
          done(`Cloning ${repo} stopped when the office restarted — add it again`);
          continue;
        }
        this.defs.push(def);
        this.save();
        done(def);
        continue;
      }
      pending.run = run;
      this.cloning.set(repo.toLowerCase(), pending);
      void run.done.then((end) => {
        const err = this.settle(pending, end);
        this.cloning.delete(repo.toLowerCase());
        this.saveClones();
        if (!err) {
          this.defs.push(def);
          this.save();
        }
        done(err ?? def);
      });
    }
    this.saveClones();
  }

  /** The office is closing: its clones stop, or with `keep` (a restart) carry on for the next office to pick up. */
  shutdown(keep: boolean) {
    for (const p of this.cloning.values()) {
      if (keep) p.run?.release();
      else p.run?.stop('The office closed before the clone finished');
    }
    if (keep) return;
    this.cloning.clear();
    this.saveClones();
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
    if (!def) return this.pendingFloor(id) ? "That floor is still being cloned — stop it, or take it off once it's there" : 'No such floor';
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
   * checkout that's already where the clone would go is used as it is. `account` (whoever's adding it)
   * can stop the clone, as admins can.
   */
  async add(input: string, by: string, started: (def: FloorDef) => void, account?: string): Promise<FloorDef | string> {
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
    // Asking GitHub first says whether this login can see it at all, and gets the name's real case.
    let repo: string;
    let empty = false;
    try {
      const view = JSON.parse(await gh(['repo', 'view', wanted, '--json', 'nameWithOwner,isEmpty'], this.dataDir, 30_000)) as { nameWithOwner?: string; isEmpty?: boolean };
      repo = normalizeRepo(view.nameWithOwner) ?? wanted;
      empty = view.isEmpty === true;
    } catch (err) {
      return `Couldn't find ${wanted} on GitHub: ${(err as Error).message}`;
    }
    const key = repo.toLowerCase();
    if (this.defs.some((d) => sameRepo(d.repo, repo))) return `${repo} already has a floor`;
    if (this.cloning.has(key)) return `${repo} is already being cloned`;
    const [owner, name] = repo.split('/');
    const dest = path.join(this.projectsDir, owner, name);
    if (this.defs.some((d) => path.resolve(d.dir) === dest)) return `${dest} is already a floor`;
    const def = this.newDef(name, repo, dest, by);
    const pending: Pending = { def, owner: account, empty };
    this.cloning.set(key, pending);
    started(def);
    try {
      const err = await this.clone(pending);
      if (err) return err;
    } finally {
      this.cloning.delete(key);
      this.saveClones();
    }
    this.defs.push(def);
    this.save();
    return def;
  }

  /** Clones a floor on its way, or checks that what's already there is its repository. Resolves to an error, if any. */
  private async clone(p: Pending): Promise<string | undefined> {
    const { dir: dest } = p.def;
    const repo = p.def.repo!;
    const there = checkoutAt(dest, repo, p.empty);
    // Cloned before (a floor that was taken off the list, or by hand): move back in.
    if (there === 'ok') return undefined;
    if (there !== 'none') return there;
    try {
      mkdirSync(path.dirname(dest), { recursive: true });
    } catch (err) {
      return `Couldn't make ${path.dirname(dest)}: ${(err as Error).message}`;
    }
    if (this.opts.terminal) return cloneHere(repo, dest);
    try {
      mkdirSync(this.logsDir, { recursive: true, mode: 0o700 });
    } catch (err) {
      return `Couldn't make ${this.logsDir}: ${(err as Error).message}`;
    }
    const run = await CloneRun.start(repo, dest, path.join(this.logsDir, `${repo.replace('/', '__')}.log`), { ...this.opts.clone, changed: () => this.cloneChanged?.() });
    if (typeof run === 'string') return run;
    p.run = run;
    this.saveClones();
    return this.settle(p, await run.done);
  }

  /** Whether a clone that ended left its checkout: an error if it didn't. */
  private settle(p: Pending, end: CloneEnd): string | undefined {
    if (p.run) dropLog(p.run.log);
    if (end.stopped) return end.stopped;
    // Its exit code isn't the word on it (a clone an office before this one started has none): the checkout is.
    if (checkoutAt(p.def.dir, p.def.repo!, p.empty) === 'ok') return undefined;
    return `Couldn't clone ${p.def.repo}: ${whyCloneFailed(end.output)}`;
  }

  private pendingFloor(id: string): Pending | undefined {
    return [...this.cloning.values()].find((p) => p.def.id === id);
  }

  /** Repositories the office's `gh` login can clone, most recently pushed first. */
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

  private newDef(name: string, repo: string | undefined, dir: string, by: string): FloorDef {
    const taken = new Set([...this.defs, ...this.pending()].map((d) => d.id));
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'floor';
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    // The first look nobody has, so floors side by side never match; then round again.
    const used = new Set([...this.defs, ...this.pending()].map((d) => d.palette));
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

  private loadClones(): SavedClone[] {
    try {
      const saved = JSON.parse(readFileSync(this.clonesFile, 'utf8')) as Partial<SavedClone>[];
      return (Array.isArray(saved) ? saved : []).filter(
        // Its log is one of ours (it gets deleted), in .agent-office/clones.
        (s): s is SavedClone =>
          Number.isInteger(s.pid) && (s.pid as number) > 0 && typeof s.log === 'string' && path.dirname(s.log) === this.logsDir && typeof s.dir === 'string' && path.isAbsolute(s.dir) && typeof s.name === 'string',
      );
    } catch {
      return [];
    }
  }

  /** Keeps the clones under way in cloning.json, so the next office can pick them up after a restart. */
  private saveClones() {
    const saved: SavedClone[] = [...this.cloning.values()].flatMap((p) => (p.run ? [{ ...p.def, pid: p.run.pid, log: p.run.log, owner: p.owner, empty: p.empty }] : []));
    try {
      if (saved.length) writeFileSync(this.clonesFile, JSON.stringify(saved, null, 2), { mode: 0o600 });
      else rmSync(this.clonesFile, { force: true });
    } catch (err) {
      console.error(`agent-office: couldn't save ${this.clonesFile}: ${(err as Error).message}`);
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

/** The GitHub repository a checkout's origin points at. */
export function originRepo(dir: string): string | undefined {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).trim();
    return /github\.com[/:]/i.test(url) ? normalizeRepo(url) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What's at `dest`: nothing yet ('none'), a checkout of `repo` ('ok'), or why it's in the way. A
 * clone that was cut off has its origin but no commit checked out; an `empty` repository has none to.
 */
function checkoutAt(dest: string, repo: string, empty: boolean): 'none' | 'ok' | string {
  if (!existsSync(dest)) return 'none';
  if (!statSync(dest).isDirectory()) return `${dest} is already there and isn't a folder`;
  if (!readdirSync(dest).length) return 'none';
  if (!sameRepo(originRepo(dest), repo)) return `${dest} already exists and isn't a checkout of ${repo} — move it out of the way first`;
  if (!empty && !hasCommit(dest)) return `${dest} is a clone of ${repo} that didn't finish — delete that folder and add the floor again`;
  return 'ok';
}

function hasCommit(dir: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { cwd: dir, stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/** Clones `repo` to `dest` in this terminal: git shows its progress, and ssh or git can ask here. Resolves to an error, if any. */
function cloneHere(repo: string, dest: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn('gh', ['repo', 'clone', repo, dest], { cwd: path.dirname(dest), stdio: 'inherit' });
    child.once('error', (err: NodeJS.ErrnoException) => resolve(err.code === 'ENOENT' ? "The GitHub CLI (gh) isn't installed on this machine" : `Couldn't run gh: ${err.message}`));
    child.once('exit', (code, signal) => resolve(code === 0 ? undefined : `Couldn't clone ${repo}: gh ${signal ? `stopped (${signal})` : `failed (exit ${code})`}`));
  });
}

async function listRepos(cwd: string): Promise<RepoChoice[]> {
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
