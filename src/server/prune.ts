import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { WORKSPACE_FILES, WORKTREES_DIR, Worktrees, describeWork, gitError } from './worktrees.js';
import { L } from './i18n.js';

const HELP = L.prune.help(WORKTREES_DIR);

interface SavedWorker {
  name?: string;
  worktree?: { path: string; branch: string; base?: string; made?: string };
  /** A worker across repositories: its worktrees of other floors' projects (see WorkerInfo.repos). */
  repos?: { path?: string; branch?: string }[];
}

/** The workers an office keeps in a project's .agent-office/workers.json; none when it has no office there. */
function savedWorkers(dir: string): SavedWorker[] {
  try {
    const saved = JSON.parse(readFileSync(path.join(dir, '.agent-office', 'workers.json'), 'utf8'));
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

/**
 * What's left in a workspace folder (a worker across repositories): 'empty' when it's only the brief
 * the office wrote there, or the names of folders in it that are still git worktrees.
 */
function workspaceLeft(abs: string): 'empty' | string[] | undefined {
  let names: string[];
  try {
    names = readdirSync(abs);
  } catch {
    return undefined;
  }
  const trees = names.filter((n) => existsSync(path.join(abs, n, '.git')));
  if (trees.length) return trees;
  return names.every((n) => WORKSPACE_FILES.has(n) && statSync(path.join(abs, n)).isFile()) ? 'empty' : undefined;
}

/** `agent-office prune`: exits 0 when done, 1 when the dir is not a git repo, 2 for a usage error. */
export async function prune(argv: string[]): Promise<number> {
  let dir = process.cwd();
  let dryRun = false;
  let force = false;
  for (const a of argv) {
    if (a === '-h' || a === '--help') {
      process.stdout.write(HELP);
      return 0;
    } else if (a === '-n' || a === '--dry-run') dryRun = true;
    else if (a === '-f' || a === '--force') force = true;
    else if (a.startsWith('-')) {
      console.error(`agent-office prune: ${L.cli.unknownOption(a)}\n`);
      process.stderr.write(HELP);
      return 2;
    } else dir = path.resolve(a);
  }
  if (!existsSync(dir)) {
    console.error(`agent-office prune: ${L.cli.noDir(dir)}`);
    return 2;
  }
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd: dir, stdio: 'ignore' });
  } catch {
    console.error(`agent-office prune: ${L.prune.notRepo(dir)}`);
    return 1;
  }

  // Workers the office still has, awake or asleep, keep theirs: send them home from the office instead.
  const ownerOfBranch = new Map<string, string>();
  const ownerOfPath = new Map<string, string>();
  for (const w of savedWorkers(dir)) {
    if (!w.worktree) continue;
    ownerOfBranch.set(w.worktree.branch, w.name ?? L.prune.aWorker);
    if (w.worktree.made) ownerOfBranch.set(w.worktree.made, w.name ?? L.prune.aWorker);
    ownerOfPath.set(path.normalize(w.worktree.path), w.name ?? L.prune.aWorker);
    // Across repositories: the workspace folder its worktrees are in is its too.
    if (w.repos?.length) ownerOfPath.set(path.normalize(path.dirname(w.worktree.path)), w.name ?? L.prune.aWorker);
  }

  const trees = new Worktrees(dir);
  const { worktrees, branches, strays, elsewhere } = await trees.list();
  /** Workspaces a worktree was just taken out of: gone too once nothing but the brief is left. */
  const emptied = new Set<string>();
  let removed = 0;
  let kept = 0;
  const line = (status: string, what: string, why: string) => console.log(`  ${status.padEnd(12)} ${what.padEnd(32)} ${why}`);
  const keep = (what: string, why: string) => {
    kept++;
    line(L.prune.kept, what, why);
  };
  const drop = async (what: string, why: string, act: () => Promise<string | undefined>) => {
    const err = dryRun ? undefined : await act();
    if (err) {
      kept++;
      line(L.prune.failed, what, err);
    } else {
      removed++;
      line(dryRun ? L.prune.wouldRemove : L.prune.removed, what, why);
    }
  };

  console.log(`\n  agent-office prune — ${dir}${dryRun ? ` ${L.prune.dryRun}` : ''}\n`);
  const withWorktree = new Set<string>();
  for (const wt of worktrees) {
    if (wt.branch) withWorktree.add(wt.branch);
    const ref = { path: wt.path, branch: wt.branch ?? wt.head };
    const label = wt.branch ?? `${wt.path} (detached)`;
    const owner = (wt.branch && ownerOfBranch.get(wt.branch)) || ownerOfPath.get(path.normalize(wt.path));
    if (owner) {
      keep(label, L.prune.owned(owner));
      continue;
    }
    const work = describeWork(await trees.inspect(ref));
    if (work && !force) {
      keep(label, L.prune.forceAnyway(work));
      continue;
    }
    await drop(label, work ? L.prune.forced(work) : L.prune.clean, () => trees.remove(ref, wt.branch ? 'all' : 'worktree'));
    if (path.dirname(path.normalize(wt.path)) !== path.normalize(WORKTREES_DIR)) emptied.add(path.dirname(wt.path));
  }
  // This project's worktrees in another floor's workspace, made for a worker there across repositories.
  for (const [branch, abs] of elsewhere) {
    withWorktree.add(branch);
    const at = abs.lastIndexOf(`${path.sep}${WORKTREES_DIR}${path.sep}`);
    if (at < 0) {
      keep(branch, L.prune.checkedOut(abs));
      continue;
    }
    const office = abs.slice(0, at);
    const owner = savedWorkers(office).find((w) => w.worktree?.branch === branch || w.repos?.some((r) => r.branch === branch));
    if (owner) {
      const name = owner.name ?? L.prune.aWorker;
      keep(branch, L.prune.ownedIn(name, abs));
      continue;
    }
    const ref = { path: path.relative(dir, abs), branch };
    const work = describeWork(await trees.inspect(ref));
    if (work && !force) {
      keep(branch, L.prune.forceAnywayIn(work, abs));
      continue;
    }
    await drop(branch, L.prune.inDir(work ? L.prune.forced(work) : L.prune.clean, abs), () => trees.remove(ref, 'all'));
  }
  for (const branch of branches) {
    if (withWorktree.has(branch)) continue;
    const owner = ownerOfBranch.get(branch);
    if (owner) {
      keep(branch, L.prune.ownedGone(owner));
      continue;
    }
    const work = describeWork(await trees.inspect({ branch }));
    if (work && !force) {
      keep(branch, L.prune.forceAnyway(work));
      continue;
    }
    await drop(branch, work ? L.prune.forcedGone(work) : L.prune.branchOnly, () => trees.remove({ branch }, 'all'));
  }
  for (const rel of [...strays, ...[...emptied].filter((e) => !strays.includes(e) && workspaceLeft(path.join(dir, e)) === 'empty')]) {
    const owner = ownerOfPath.get(path.normalize(rel));
    if (owner) {
      keep(rel, L.prune.folderOf(owner));
      continue;
    }
    const left = workspaceLeft(path.join(dir, rel));
    if (Array.isArray(left)) {
      // Worktrees of other projects: pruning those projects takes them out, with their own checks.
      keep(rel, L.prune.workspaceLeft(left.join(', ')));
      continue;
    }
    if (left === 'empty') {
      await drop(rel, L.prune.emptyWorkspace, async () => {
        try {
          await rm(path.join(dir, rel), { recursive: true, force: true });
          return undefined;
        } catch (err) {
          return gitError(err);
        }
      });
      continue;
    }
    if (!force) {
      keep(rel, L.prune.stray);
      continue;
    }
    await drop(rel, L.prune.strayForced, async () => {
      try {
        await rm(path.join(dir, rel), { recursive: true, force: true });
        return undefined;
      } catch (err) {
        return gitError(err);
      }
    });
  }
  if (!worktrees.length && !branches.length && !strays.length && !elsewhere.size) console.log(`  ${L.prune.allClean(WORKTREES_DIR)}`);
  console.log(`\n  ${L.prune.summary(removed, kept, dryRun)}\n`);
  return 0;
}
