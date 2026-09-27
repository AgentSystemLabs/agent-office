import { execFile, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { normalizeIssueRepository } from '../shared/issue-repositories.js';
import type { WorkerProject } from '../shared/protocol.js';

const execFileP = promisify(execFile);
const MAX_PATH = 4096;
const MAX_MAPPINGS = 256;
const GENERATED_MARKER = '<!-- agent-office generated repository map -->';
const PATH_CONTROL = /[\u0000-\u001f\u007f]/;

interface StoredProject {
  repository: string;
  dir: string;
}

interface GithubRemote {
  owner: string;
  repository: string;
}

/** Verified checkouts used when an office works on more than its current repository. */
export class RepositoryProjects {
  private readonly officeDir: string;
  private readonly dataDir: string;
  private readonly registryPath: string;
  private readonly instructionPath: string;
  private mappings = new Map<string, StoredProject>();
  private configurationError?: string;
  private serial: Promise<void> = Promise.resolve();

  constructor(officeDir: string, dataDir: string) {
    this.officeDir = absolutePath(officeDir, 'office directory');
    this.dataDir = absolutePath(dataDir, 'data directory');
    this.registryPath = checkedPath(path.join(this.dataDir, 'repository-projects.json'), 'registry path');
    this.instructionPath = checkedPath(path.join(this.dataDir, 'repositories', 'AGENTS.md'), 'instructions path');
    this.restore();
  }

  /** A verified checkout for a repository, discovered only at bounded candidate paths. */
  resolve(repository: string): Promise<WorkerProject | undefined> {
    return this.lock(async () => {
      const name = repositoryName(repository);
      if (this.configurationError) throw new Error(this.configurationError);
      if (!name) return undefined;
      const key = name.toLowerCase();
      const saved = this.mappings.get(key);
      if (saved) {
        const project = await this.verifyCheckout(name, saved.dir).catch(() => undefined);
        if (project) {
          await this.writeInstructions();
          return project;
        }
        // A known mapping is authoritative. Do not silently replace a stale or moved checkout
        // with an unrelated bounded candidate; the caller must explicitly bind or clone again.
        return undefined;
      }

      for (const candidate of this.discoveryCandidates(name)) {
        const project = await this.verifyCheckout(name, candidate).catch(() => undefined);
        if (!project) continue;
        const previous = this.mappings.get(key);
        this.mappings.set(key, { repository: name, dir: project.dir });
        if (!(await this.persist())) {
          if (previous) this.mappings.set(key, previous);
          else this.mappings.delete(key);
          return undefined;
        }
        await this.writeInstructions();
        return project;
      }
      return undefined;
    });
  }

  /** Verify and register an existing checkout. */
  bind(repository: string, directory: string): Promise<WorkerProject> {
    return this.lock(async () => {
      this.requireWritableConfiguration();
      const name = requireRepository(repository);
      const project = await this.verifyCheckout(name, directory);
      const key = name.toLowerCase();
      const previous = this.mappings.get(key);
      this.mappings.set(key, { repository: name, dir: project.dir });
      if (!(await this.persist())) {
        if (previous) this.mappings.set(key, previous);
        else this.mappings.delete(key);
        throw new Error(this.configurationError ?? 'Could not save repository project configuration');
      }
      await this.writeInstructions();
      return project;
    });
  }

  /** Clone a repository into a new destination, then verify and register the checkout. */
  clone(repository: string, destination: string): Promise<WorkerProject> {
    return this.lock(async () => {
      this.requireWritableConfiguration();
      const name = requireRepository(repository);
      const target = absolutePath(destination, 'clone destination');
      if (await exists(target)) throw new Error(`Clone destination already exists: ${target}`);

      const url = `https://github.com/${name}.git`;
      try {
        // Keep every value an execFile argument: repository names and paths never become shell code.
        await execFileP('git', ['clone', url, '--', target], {
          cwd: this.officeDir,
          encoding: 'utf8',
          timeout: 120_000,
          maxBuffer: 16 * 1024 * 1024,
        });
      } catch (err) {
        // A failed clone may have created useful partial state; deliberately leave it in place.
        throw new Error(`Could not clone ${name}: ${gitError(err)}`);
      }

      // Do not trust a successful process exit alone; the resulting checkout must pass every bind check.
      return this.bindUnlocked(name, target);
    });
  }

  /** Prompt guidance for a worker assigned to a verified project. */
  context(project: WorkerProject): string {
    return [
      `Assigned repository: ${project.repository}`,
      `Repository checkout: ${project.dir}`,
      'Your current working directory is the assigned checkout or its task worktree. Keep changes in the current working directory; do not switch back to the source checkout.',
      `Read project instructions in ${path.join(project.dir, 'AGENTS.md')} and the saved repository map in ${this.instructionPath} before working.`,
    ].join('\n');
  }

  get configurationErrorMessage(): string | undefined {
    return this.configurationError;
  }

  private bindUnlocked(repository: string, directory: string): Promise<WorkerProject> {
    return this.verifyCheckout(repository, directory).then(async (project) => {
      const key = repository.toLowerCase();
      const previous = this.mappings.get(key);
      this.mappings.set(key, { repository, dir: project.dir });
      if (!(await this.persist())) {
        if (previous) this.mappings.set(key, previous);
        else this.mappings.delete(key);
        throw new Error(this.configurationError ?? 'Could not save repository project configuration');
      }
      await this.writeInstructions();
      return project;
    });
  }

  private async verifyCheckout(repository: string, directory: string): Promise<WorkerProject> {
    const requested = await realpath(absolutePath(directory, 'checkout directory'));
    const top = await this.git(['rev-parse', '--show-toplevel'], requested).then((out) => realpath(absolutePath(out.trim(), 'git top level')));
    if (top !== requested) throw new Error(`Checkout must be the repository root, not a nested directory: ${requested}`);

    const remotes = await this.git(['remote'], top).catch(() => '');
    const candidates = remotes.split(/\r?\n/).map((line) => line.trim()).filter((remote) => remote === 'origin' || remote === 'upstream');
    let matched = false;
    for (const remote of candidates) {
      const url = await this.git(['remote', 'get-url', remote], top).catch(() => '');
      const parsed = parseGithubRemote(url);
      if (parsed && parsed.owner.toLowerCase() + '/' + parsed.repository.toLowerCase() === repository.toLowerCase()) {
        matched = true;
        break;
      }
    }
    if (!matched) throw new Error(`Checkout remote does not match GitHub repository ${repository}`);
    return { repository, dir: top };
  }

  private discoveryCandidates(repository: string): string[] {
    const basename = repository.slice(repository.indexOf('/') + 1);
    const parent = path.dirname(this.officeDir);
    const candidates = [this.officeDir, path.join(this.officeDir, basename), parent, path.join(parent, basename)];
    const unique: string[] = [];
    for (const candidate of candidates) {
      const checked = checkedPath(path.resolve(candidate), 'discovery candidate');
      if (!unique.includes(checked)) unique.push(checked);
    }
    return unique;
  }

  private restore() {
    let raw: string;
    try {
      raw = readFileSync(this.registryPath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      this.configurationError = `Could not read repository project configuration: ${errorMessage(err)}`;
      return;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected an object of repository names to absolute directories');
      const entries = Object.entries(parsed as Record<string, unknown>);
      if (entries.length > MAX_MAPPINGS) throw new Error(`contains more than ${MAX_MAPPINGS} mappings`);
      for (const [key, value] of entries) {
        const repository = requireRepository(key);
        if (typeof value !== 'string' || PATH_CONTROL.test(value) || !path.isAbsolute(value)) throw new Error(`mapping for ${repository} is not an absolute directory`);
        const directory = checkedPath(value, 'mapped directory');
        const lower = repository.toLowerCase();
        if (this.mappings.has(lower)) throw new Error(`contains duplicate repository ${repository}`);
        this.mappings.set(lower, { repository, dir: directory });
      }
    } catch (err) {
      this.mappings.clear();
      this.configurationError = `Could not load repository project configuration: ${errorMessage(err)}`;
    }
  }

  private async persist(): Promise<boolean> {
    if (this.configurationError) return false;
    const object: Record<string, string> = {};
    for (const [key, value] of [...this.mappings.entries()].sort(([a], [b]) => a.localeCompare(b))) object[value.repository] = value.dir;
    const temporary = `${this.registryPath}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
    let created = false;
    try {
      await mkdir(path.dirname(this.registryPath), { recursive: true, mode: 0o700 });
      await writeFile(temporary, `${JSON.stringify(object, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      created = true;
      await chmod(temporary, 0o600);
      await rename(temporary, this.registryPath);
      created = false;
      return true;
    } catch (err) {
      if (created) await unlink(temporary).catch(() => undefined);
      this.configurationError = `Could not save repository project configuration: ${errorMessage(err)}`;
      return false;
    }
  }

  private async writeInstructions() {
    const parent = path.dirname(this.instructionPath);
    try {
      await mkdir(parent, { recursive: true, mode: 0o700 });
      const current = await readFile(this.instructionPath, 'utf8').catch(() => undefined);
      if (current !== undefined && !current.includes(GENERATED_MARKER)) return;
      const entries = [...this.mappings.values()].sort((a, b) => a.repository.localeCompare(b.repository));
      const lines = [
        GENERATED_MARKER,
        '# Saved repository checkouts',
        '',
        'This file is generated from saved repository checkouts. Agent Office revalidates each selected path before starting work.',
        '',
        ...(entries.length ? entries.map((project) => `- \`${project.repository}\`: \`${project.dir}\``) : ['- No repository checkouts have been saved yet.']),
        '',
        'When working in an assigned repository or worktree, read its project AGENTS.md instructions before changing files and keep the work scoped to that checkout.',
        '',
      ];
      await writeFile(this.instructionPath, lines.join('\n'), { encoding: 'utf8', mode: 0o600 });
      await chmod(this.instructionPath, 0o600);
    } catch {
      // The registry is authoritative. A read-only or user-owned instructions file must not make
      // a verified checkout unusable.
    }
  }

  private requireWritableConfiguration() {
    if (this.configurationError) throw new Error(this.configurationError);
  }

  private async git(args: string[], cwd: string): Promise<string> {
    const { stdout } = await execFileP('git', args, { cwd, encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    return stdout;
  }

  private lock<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.serial.then(operation, operation);
    this.serial = run.then(() => undefined, () => undefined);
    return run;
  }
}

/** Synchronous launch-time verification for workers restored from persisted state. */
export function verifyRepositoryProject(value: unknown): WorkerProject | string {
  const project = value as Partial<WorkerProject> | undefined;
  const repository = repositoryName(project?.repository);
  if (!repository || typeof project?.dir !== 'string' || !project.dir || !path.isAbsolute(project.dir) || PATH_CONTROL.test(project.dir) || project.dir.length > MAX_PATH) return 'Invalid worker project';
  const directory = project.dir;
  if (!existsSync(directory)) return `Project checkout is gone: ${directory}`;
  try {
    const requested = realpathSync(directory);
    const top = realpathSync(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: requested, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim());
    if (top !== requested) return `Project path is not a repository root: ${directory}`;
    const remotes = execFileSync('git', ['remote'], { cwd: top, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).split(/\r?\n/);
    const matched = remotes.filter((remote) => remote === 'origin' || remote === 'upstream').some((remote) => {
      try {
        const url = execFileSync('git', ['remote', 'get-url', remote], { cwd: top, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        const parsed = parseGithubRemote(url);
        return parsed && `${parsed.owner}/${parsed.repository}`.toLowerCase() === repository.toLowerCase();
      } catch {
        return false;
      }
    });
    if (!matched) return `Project checkout remote does not match ${repository}`;
    return { repository, dir: top };
  } catch {
    return `Project checkout is not a usable git repository: ${directory}`;
  }
}

function repositoryName(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.includes('\0')) return undefined;
  return normalizeIssueRepository(value);
}

function requireRepository(value: unknown): string {
  const repository = repositoryName(value);
  if (!repository) throw new Error('Invalid GitHub repository (expected owner/repo)');
  return repository;
}

function absolutePath(value: string, label: string): string {
  if (typeof value !== 'string' || !value || PATH_CONTROL.test(value) || value.length > MAX_PATH) throw new Error(`Invalid ${label}`);
  if (!path.isAbsolute(value)) throw new Error(`Invalid ${label}`);
  return checkedPath(value, label);
}

function checkedPath(value: string, label: string): string {
  if (!value || PATH_CONTROL.test(value) || value.length > MAX_PATH) throw new Error(`Invalid ${label}`);
  return value;
}

async function exists(value: string): Promise<boolean> {
  try {
    await lstat(value);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

function parseGithubRemote(raw: string): GithubRemote | undefined {
  const value = raw.trim();
  if (!value || value.includes('\0')) return undefined;
  let ownerRepo: string | undefined;
  if (/^(?:https|ssh|git\+ssh):\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (!['https:', 'ssh:', 'git+ssh:'].includes(url.protocol.toLowerCase()) || url.hostname.toLowerCase() !== 'github.com' || url.port || url.search || url.hash) return undefined;
      ownerRepo = url.pathname.slice(1);
    } catch {
      return undefined;
    }
  } else {
    const scp = /^(?:[^@\s/:]+@)?([^:\s/]+):([^\s]+)$/.exec(value);
    if (!scp || scp[1].toLowerCase() !== 'github.com') return undefined;
    ownerRepo = scp[2];
  }
  if (!ownerRepo || ownerRepo.endsWith('/')) return undefined;
  if (ownerRepo.endsWith('.git')) ownerRepo = ownerRepo.slice(0, -4);
  const parts = ownerRepo.split('/');
  if (parts.length !== 2) return undefined;
  const repository = normalizeIssueRepository(parts.join('/'));
  if (!repository) return undefined;
  const [owner, repo] = repository.split('/');
  return { owner, repository: repo };
}

function errorMessage(err: unknown): string {
  const e = err as { stderr?: string; message?: string };
  return String(e.stderr || e.message || err).trim().split('\n').filter(Boolean).pop() ?? 'unknown error';
}

function gitError(err: unknown): string {
  return errorMessage(err).replace(/\s+/g, ' ').slice(0, 500);
}
