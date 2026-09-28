import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { UpgradeState, VersionInfo } from '../shared/protocol.js';

/** The install this server runs from (deploy/aws.sh makes it a git checkout). */
function findAppDir(): string | undefined {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++, dir = path.dirname(dir)) {
    try {
      if (JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).name === 'agent-office') return dir;
    } catch {
      // keep looking
    }
  }
  return undefined;
}

const APP_DIR = findAppDir() ?? process.cwd();
// The new version is built here, next to the install, so swapping it in is a few renames.
const STAGE = path.join(APP_DIR, '.upgrade');
const CHECK_EVERY_MS = 15 * 60_000;
const SHOW_CHANGES = 15;

const tail = (s: string, lines = 25) => s.trim().split('\n').slice(-lines).join('\n');

function run(cmd: string, args: string[], opts: { cwd?: string; timeout?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd: opts.cwd ?? APP_DIR, timeout: opts.timeout ?? 60_000, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, (err, out, errOut) => {
      if (err) reject(new Error(tail(`${out}\n${errOut}`) || err.message));
      else resolve(out.trim());
    });
  });
}

function gitSync(args: string[]): string | undefined {
  try {
    return execFileSync('git', args, { cwd: APP_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
}

function parseVersion(line: string | undefined): VersionInfo | undefined {
  if (!line) return undefined;
  const [sha, subject, date] = line.split('\0');
  return { sha, subject, date };
}

const VERSION_FORMAT = '--format=%h%x00%s%x00%cI';

/**
 * systemd's default KillMode stops everything in the service once the office exits: the workers'
 * terminal host too (see ptys.ts), so every worker would be cut off mid-turn by an upgrade. Offices
 * provisioned before deploy/provision.sh set KillMode=process get it from a drop-in here; the
 * install's user has passwordless sudo. Best effort: without it, workers are resumed and carry on.
 */
async function keepWorkersThroughRestart() {
  if (process.platform !== 'linux') return;
  let cgroup: string;
  try {
    cgroup = readFileSync('/proc/self/cgroup', 'utf8');
  } catch {
    return;
  }
  const unit = /:\/system\.slice\/([^/\n]+\.service)$/m.exec(cgroup)?.[1];
  if (!unit || (await run('systemctl', ['show', '--property=KillMode', '--value', unit])) === 'process') return;
  await run('sudo', [
    '-n',
    'sh',
    '-c',
    'mkdir -p "$1" && printf "[Service]\\nKillMode=process\\n" > "$1/keep-workers.conf" && systemctl daemon-reload',
    'sh',
    `/etc/systemd/system/${unit}.d`,
  ]);
}

/**
 * Lets an office installed by deploy/aws.sh upgrade itself from the UI. The new version is
 * built next to the running one (the office keeps working meanwhile, and a failed build changes
 * nothing), swapped in, and then the process exits so systemd starts the new version. Workers keep
 * running through it in their terminal host, which the new version picks back up.
 */
export class Upgrader {
  readonly state: UpgradeState;
  /** What the running server is: its commit, or the package version outside a git checkout. */
  readonly version: string;
  private branch?: string;
  private latestSha?: string;
  private checking?: Promise<void>;
  private timer?: NodeJS.Timeout;

  constructor(
    private emit: (state: UpgradeState) => void,
    private restart: () => void,
  ) {
    const current = existsSync(path.join(APP_DIR, '.git')) ? parseVersion(gitSync(['log', '-1', VERSION_FORMAT, 'HEAD'])) : undefined;
    let pkg = '0.0.0';
    try {
      pkg = JSON.parse(readFileSync(path.join(APP_DIR, 'package.json'), 'utf8')).version ?? pkg;
    } catch {
      // keep the default
    }
    this.version = current?.sha ?? pkg;
    const branch = current ? gitSync(['rev-parse', '--abbrev-ref', 'HEAD']) : undefined;
    // Only deploy/aws.sh's systemd unit sets this, and it restarts the office whenever it exits.
    // A checkout on a tag (detached HEAD) has no branch to follow.
    const enabled = process.env.AGENT_OFFICE_SELF_UPDATE === '1' && !!branch && branch !== 'HEAD';
    this.branch = enabled ? branch : undefined;
    this.state = { available: enabled, current, phase: 'idle' };
    if (!enabled) return;
    void rm(STAGE, { recursive: true, force: true }); // what's left of the previous version
    this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS);
    setTimeout(() => void this.check(), 10_000);
  }

  stop() {
    clearInterval(this.timer);
  }

  private get busy() {
    return this.state.phase === 'building' || this.state.phase === 'restarting';
  }

  private set(patch: Partial<UpgradeState>) {
    Object.assign(this.state, patch);
    this.emit(this.state);
  }

  /** Looks upstream for new commits on the installed branch. */
  check(): Promise<void> {
    if (!this.branch || this.busy) return Promise.resolve();
    this.checking ??= this.fetchLatest(this.branch).finally(() => (this.checking = undefined));
    return this.checking;
  }

  private async fetchLatest(branch: string) {
    this.set({ checking: true, ...(this.state.phase === 'failed' ? { phase: 'idle', error: undefined } : {}) });
    try {
      // Deep enough to list what changed; the install stays a shallow clone.
      await run('git', ['fetch', '--quiet', '--depth', '50', 'origin', branch]);
      const [head, fetched] = await Promise.all([run('git', ['rev-parse', 'HEAD']), run('git', ['rev-parse', 'FETCH_HEAD'])]);
      if (head === fetched) {
        this.latestSha = undefined;
        this.set({ checking: false, checkedAt: Date.now(), latest: undefined, changes: undefined, behind: undefined, error: undefined });
        return;
      }
      const [latest, behind, log] = await Promise.all([
        run('git', ['log', '-1', VERSION_FORMAT, fetched]),
        run('git', ['rev-list', '--count', `${head}..${fetched}`]),
        run('git', ['log', '-n', String(SHOW_CHANGES), '--format=%h%x00%s', `${head}..${fetched}`]),
      ]);
      this.latestSha = fetched;
      this.set({
        checking: false,
        checkedAt: Date.now(),
        latest: parseVersion(latest),
        behind: Number(behind) || undefined,
        changes: log
          .split('\n')
          .filter(Boolean)
          .map((l) => {
            const [sha, subject] = l.split('\0');
            return { sha, subject };
          }),
        error: undefined,
      });
    } catch (err) {
      this.set({ checking: false, checkedAt: Date.now(), error: `Couldn't check for updates: ${(err as Error).message}` });
    }
  }

  /** Starts building the newest version. Returns why it can't, if it can't. */
  async start(by: string): Promise<string | undefined> {
    if (!this.branch) return "This office can't upgrade itself (it wasn't installed by deploy/aws.sh)";
    if (this.busy) return 'An upgrade is already running';
    await this.check();
    if (this.busy) return 'An upgrade is already running';
    const sha = this.latestSha;
    if (!sha) return this.state.error ?? 'The office is already up to date';
    this.set({ phase: 'building', by, error: undefined });
    void this.build(sha);
    return undefined;
  }

  private async build(sha: string) {
    const next = path.join(STAGE, 'next');
    const old = path.join(STAGE, 'old');
    try {
      await rm(STAGE, { recursive: true, force: true });
      await mkdir(next, { recursive: true });
      await run('sh', ['-c', 'git archive "$1" | tar -x -C "$2"', 'sh', sha, next]);
      // npm install runs the prepare script, which builds the client and the server.
      await run('npm', ['install', '--no-audit', '--no-fund'], { cwd: next, timeout: 15 * 60_000 });
      for (const f of ['dist/server/server/cli.js', 'dist/public/index.html']) {
        if (!existsSync(path.join(next, f))) throw new Error(`the build didn't produce ${f}`);
      }
      // Swap it in. The running process already has everything it needs loaded.
      await run('git', ['reset', '--quiet', '--hard', sha]);
      await mkdir(old);
      for (const d of ['dist', 'node_modules']) {
        if (existsSync(path.join(APP_DIR, d))) await rename(path.join(APP_DIR, d), path.join(old, d));
        await rename(path.join(next, d), path.join(APP_DIR, d));
      }
    } catch (err) {
      await rm(STAGE, { recursive: true, force: true }).catch(() => {});
      this.set({ phase: 'failed', error: `The upgrade failed, so the office stays on ${this.state.current?.sha}.\n\n${(err as Error).message}` });
      return;
    }
    this.set({ phase: 'restarting' });
    await keepWorkersThroughRestart().catch((err) => console.warn(`agent-office: workers will be resumed after the restart, not kept running: ${(err as Error).message}`));
    // Give every browser a moment to hear about it, then hand over to the new version.
    setTimeout(this.restart, 1500);
  }
}
