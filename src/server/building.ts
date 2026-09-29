import { execFileSync } from 'node:child_process';
import { type Dirent, accessSync, constants, existsSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FLOOR_PALETTES, MAX_FLOORS, forgeOf, normalizeRepo } from '../shared/floors.js';
import type { ProjectsDirState, RepoChoice } from '../shared/protocol.js';
import { isGitlabHost } from './gitlab.js';

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

/** The workspace folder picked in ⚙️ Settings (or with --projects), as projects-folder.json keeps it. */
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

/** How long the list of checkouts found in the workspace folder is reused before the folder is searched again. */
const REPOS_TTL_MS = 30_000;
const MAX_REPOS = 1000;
/** How many folders deep under the workspace folder a checkout is looked for (owner/repo is two; GitLab groups go deeper). */
const SCAN_DEPTH = 4;
/** The most directory entries one search reads, so a workspace folder as big as the home folder can't stall the office. */
const SCAN_ENTRIES = 20_000;
/** Folders that hold no projects and are big or private enough to skip when the workspace folder is the home folder. */
const SCAN_SKIP = new Set(['node_modules', 'Library', 'Applications', 'Movies', 'Music', 'Pictures', 'Downloads', 'AppData']);

/**
 * The floors of the building, saved in <office>/.droid-office/floors.json: which projects there are,
 * where their checkouts live, and how each floor is painted. A floor is a checkout that already
 * exists on the office's machine: the office never clones or copies a repository. The workspace
 * folder (picked in ⚙️ Settings, kept in projects-folder.json) is where it looks for checkouts to
 * offer, and the only place a floor can be added from.
 */
export class Building {
  private defs: FloorDef[] = [];
  private file: string;
  private pickedFile: string;
  private picked?: PickedDir;
  private repoCache?: { at: number; repos: Promise<RepoChoice[]> };
  /** The checkout the office was started in (see ensureLocal), and the repository it's a checkout of. */
  private local?: { dir: string; repo?: string };
  /** The floor that checkout is, while it is one. */
  private localId?: string;
  private localFile: string;
  /** That checkout was taken off the building: a restart doesn't put it back. */
  private localOff?: LocalOff;

  constructor(
    /** The office's own data folder. */
    dataDir: string,
    /** Where checkouts are looked for unless another folder was picked. */
    private defaultProjectsDir: string,
  ) {
    this.file = path.join(dataDir, 'floors.json');
    this.pickedFile = path.join(dataDir, 'projects-folder.json');
    this.localFile = path.join(dataDir, 'local-floor.json');
    this.load();
    this.loadPicked();
    this.loadLocalOff();
  }

  /** The workspace folder: where checkouts are looked for. Floors elsewhere stay when it moves. */
  get projectsDir(): string {
    return this.picked?.dir ?? this.defaultProjectsDir;
  }

  projectsDirState(): ProjectsDirState {
    return { dir: tildify(this.projectsDir), custom: !!this.picked, by: this.picked?.by, at: this.picked?.at };
  }

  /** Looks for checkouts in `raw` from now on ('~' is the home folder; '' goes back to the default). Returns why it can't, if it can't. */
  setProjectsDir(raw: string, by: string): string | undefined {
    const text = raw.trim();
    let dir = this.defaultProjectsDir;
    if (text) {
      const typed = untildify(text);
      if (!path.isAbsolute(typed)) return 'Use a full path, like ~/Workspace';
      dir = path.resolve(typed);
    }
    if (dir !== this.defaultProjectsDir) {
      const why = unreadable(dir);
      if (why) return why;
    }
    this.picked = dir === this.defaultProjectsDir ? undefined : { dir, by, at: Date.now() };
    this.repoCache = undefined;
    try {
      writeFileSync(this.pickedFile, JSON.stringify(this.picked ?? {}, null, 2), { mode: 0o600 });
    } catch (err) {
      console.error(`droid-office: couldn't save the workspace folder: ${(err as Error).message}`);
    }
    return undefined;
  }

  list(): FloorDef[] {
    return this.defs;
  }

  /**
   * Makes the checkout the office was started in a floor, if it isn't one yet: `droid-office <dir>`
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
   * pictures in its .droid-office folder: adding the checkout again moves back in. Returns the
   * floor, or why it can't.
   */
  remove(id: string, by = '?'): FloorDef | string {
    const def = this.defs.find((d) => d.id === id);
    if (!def) return 'No such floor';
    this.defs = this.defs.filter((d) => d !== def);
    if (this.isLocal(id)) {
      this.localId = undefined;
      this.setLocalOff({ dir: def.dir, by, at: Date.now() });
    }
    this.save();
    return def;
  }

  /**
   * Makes a checkout that already exists a floor, where it is: nothing is cloned, copied or moved.
   * `input` is the checkout's full path, which has to be in the workspace folder (or be the
   * checkout the office was started in). Returns the floor, or why there's none.
   */
  add(input: string, by: string): FloorDef | string {
    const text = input.trim();
    if (!text) return 'Pick a checkout from the list, or type its full path, like ~/Workspace/my-project';
    const typed = untildify(text);
    if (!path.isAbsolute(typed)) return 'Use the checkout’s full path, like ~/Workspace/my-project';
    const dir = path.resolve(typed);
    const shown = tildify(dir);
    if (!existsSync(dir)) return `${shown} doesn't exist`;
    if (!existsSync(path.join(dir, '.git'))) return `${shown} isn't a git checkout`;
    const back = this.localOff && path.resolve(this.localOff.dir) === dir;
    if (!back && !within(realPath(dir), realPath(this.projectsDir))) return `${shown} isn't in the workspace folder (${tildify(this.projectsDir)}). Pick another workspace folder in ⚙️ Settings`;
    const known = this.defs.find((d) => path.resolve(d.dir) === dir);
    if (known) return `${shown} already has a floor (${known.name})`;
    if (this.defs.length >= MAX_FLOORS) return `The building is full (${MAX_FLOORS} floors)`;
    const repo = originRepo(dir);
    // The office's own checkout, taken off before: it moves back in where it is.
    const def = this.newDef(repo?.split('/').pop() ?? path.basename(dir), repo, dir, by);
    this.defs.push(def);
    if (back) {
      this.localId = def.id;
      this.setLocalOff(undefined);
    }
    this.save();
    return def;
  }

  /** The checkouts in the workspace folder that could become floors, most recently active first. */
  async repos(refresh = false): Promise<RepoChoice[]> {
    const cached = this.repoCache;
    if (cached && !refresh && Date.now() - cached.at < REPOS_TTL_MS) return cached.repos;
    const repos = findCheckouts(this.projectsDir);
    this.repoCache = { at: Date.now(), repos };
    return repos;
  }

  private newDef(name: string, repo: string | undefined, dir: string, by: string): FloorDef {
    const taken = new Set(this.defs.map((d) => d.id));
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32) || 'floor';
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    // The first look nobody has, so floors side by side never match; then round again.
    const used = new Set(this.defs.map((d) => d.palette));
    const free = FLOOR_PALETTES.findIndex((_, i) => !used.has(i));
    const palette = free >= 0 ? free : this.defs.length % FLOOR_PALETTES.length;
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
      console.error(`droid-office: ${this.file} couldn't be read, so the building starts empty: ${(err as Error).message}`);
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
      console.error(`droid-office: couldn't save ${this.localFile}: ${(err as Error).message}`);
    }
  }

  private save() {
    try {
      writeFileSync(this.file, JSON.stringify(this.defs, null, 2), { mode: 0o600 });
    } catch (err) {
      console.error(`droid-office: couldn't save the floors: ${(err as Error).message}`);
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

/** Why the office can't look for checkouts in `dir`, if it can't. */
function unreadable(dir: string): string | undefined {
  try {
    if (!statSync(dir).isDirectory()) return `${tildify(dir)} isn't a folder`;
    accessSync(dir, constants.R_OK | constants.X_OK);
  } catch {
    return `${tildify(dir)} isn't a folder the office can read`;
  }
  return undefined;
}

function realPath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
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

/** The URL of a checkout's origin remote, read from its git config (cheaper than running git for every folder found). */
function configOrigin(dir: string): string | undefined {
  let text: string;
  try {
    text = readFileSync(path.join(dir, '.git', 'config'), 'utf8');
  } catch {
    return undefined;
  }
  let inOrigin = false;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.startsWith('[')) inOrigin = /^\[remote\s+"origin"\]/.test(t);
    else if (inOrigin) {
      const m = /^url\s*=\s*(.+)$/.exec(t);
      if (m) return m[1].trim();
    }
  }
  return undefined;
}

/** Git checkouts in `root` (or `root` itself), down to SCAN_DEPTH folders, most recently active first. Never descends into a checkout. */
async function findCheckouts(root: string): Promise<RepoChoice[]> {
  const found: RepoChoice[] = [];
  let budget = SCAN_ENTRIES;
  const visit = async (dir: string, depth: number): Promise<void> => {
    if (found.length >= MAX_REPOS || budget <= 0) return;
    const git = await stat(path.join(dir, '.git')).catch(() => undefined);
    if (git) {
      const url = configOrigin(dir);
      const repo = url ? remoteRepo(url) : undefined;
      found.push({ name: repo ?? path.basename(dir), dir, repo, forge: forgeOf(repo), activeAt: git.mtime.toISOString() });
      return;
    }
    if (depth >= SCAN_DEPTH) return;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    budget -= entries.length;
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.') && !SCAN_SKIP.has(e.name)) await visit(path.join(dir, e.name), depth + 1);
    }
  };
  await visit(root, 0);
  return found.sort((a, b) => (b.activeAt ?? '').localeCompare(a.activeAt ?? '') || a.dir.localeCompare(b.dir));
}
