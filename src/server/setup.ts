import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { RepoChoice } from '../shared/protocol.js';
import { Building, tildify } from './building.js';
import { defaultProjectsDir, officeHome, suggestedFolder, type Config } from './config.js';

// Setting up an office from its terminal: which folder your projects are in, and which of the git
// checkouts already there are floors. Nothing is cloned or copied. A new office walks you through it
// the first time it starts in a terminal, so it opens on projects of your own instead of an empty
// building. `droid-office setup` runs it again, or does it without asking when given --projects /
// --project.

/** How many checkouts a list shows; typing a word narrows it down. */
const SHOWN = 12;

const SETUP_HELP = `droid-office setup — pick the folder your projects are in and which ones are floors

Usage:
  droid-office setup [--projects <dir>] [--project <dir>]... [--home <dir>]

In a terminal it walks you through it: the workspace folder your git checkouts
are in, and which of them to open as floors. The office uses each checkout where
it is; it never clones or copies a repository. Given --projects or --project it
does just that and asks nothing, for scripts.

A new office runs this by itself the first time it starts in a terminal. Run it
while the office is stopped; while it runs, use its elevator and ⚙️ Settings.

Options:
      --home <dir>        The office to set up (default ~/droid-office, env DROID_OFFICE_HOME)
      --projects <dir>    The workspace folder: where the office looks for your
                          git checkouts. Default a code folder in your home
                          folder (~/Workspace, ~/code, ~/repos…), else the home folder
      --project <dir>     Open this existing checkout as a floor. It has to be in
                          the workspace folder. Repeat it for more than one
  -h, --help              Show this help
`;

/** Someone's at a terminal to answer questions. */
export function interactive(): boolean {
  return !!process.stdin.isTTY && !!process.stdout.isTTY && !process.env.CI;
}

/**
 * The office starting in a terminal with no floors yet: walk through the workspace folder and the
 * first projects before it opens. Enter skips any of it; the elevator does the same.
 */
export async function welcome(cfg: Config): Promise<void> {
  const building = new Building(cfg.dataDir, cfg.projectsDir);
  if (building.list().length) return;
  // --projects is the answer to the first question (the office applies it again as it starts).
  const folderGiven = !!cfg.projects && !building.setProjectsDir(cfg.projects, 'the command line');
  console.log(`
  👋 Welcome to Droid Office!

  Every project is a floor of the building, and this one doesn't have any yet.
  Let's add your first: pick one of the git projects you already have. The office
  works in it right where it is and never clones or copies anything. Press Enter
  to skip any question and do it from the office's elevator instead.`);
  await walkthrough(building, !folderGiven && !building.projectsDirState().custom);
  console.log(building.list().length ? '\n  All set. Opening the office…' : '\n  Opening the office: its elevator asks for your first project.');
}

/** `droid-office setup …`: returns the exit code. */
export async function setupCommand(argv: string[]): Promise<number> {
  let home = '';
  let projects = '';
  const dirs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('-')) {
        console.error(`droid-office setup: ${a} needs a value`);
        process.exit(2);
      }
      return v;
    };
    if (a === '-h' || a === '--help') {
      process.stdout.write(SETUP_HELP);
      return 0;
    } else if (a === '--home') home = path.resolve(value());
    else if (a === '--projects') projects = value();
    else if (a === '--project') dirs.push(value());
    else {
      console.error(`droid-office setup: unknown option ${a}\n`);
      process.stderr.write(SETUP_HELP);
      return 2;
    }
  }

  // The same office `droid-office` would start from here (see loadConfig).
  const cwd = process.cwd();
  let dir = home || officeHome();
  if (!home && !process.env.DROID_OFFICE_HOME && cwd !== dir && existsSync(path.join(cwd, '.droid-office', 'config.json'))) dir = cwd;
  const dataDir = path.join(dir, '.droid-office');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (await officeRunning(dataDir)) {
    console.error(`droid-office setup: the office in ${tildify(dir)} is running. Add projects from its elevator, and pick the workspace folder in ⚙️ Settings.`);
    return 1;
  }
  const building = new Building(dataDir, defaultProjectsDir());

  if (projects || dirs.length || !interactive()) {
    if (!projects && !dirs.length) {
      console.error('droid-office setup: nothing to do without a terminal to ask in. Pass --projects <dir> and/or --project <dir>.');
      return 2;
    }
    let code = 0;
    if (projects) {
      const err = building.setProjectsDir(projects, 'droid-office setup');
      if (err) {
        console.error(`droid-office setup: --projects: ${err}`);
        return 1;
      }
      console.log(`  📁 Looking for your projects in ${building.projectsDirState().dir}`);
    }
    for (const d of dirs) if (!addFloor(building, d, 'droid-office setup')) code = 1;
    return code;
  }

  const floors = building.list();
  console.log(
    floors.length
      ? `\n  🏢 The office in ${tildify(dir)} has ${floors.length} floor${floors.length === 1 ? '' : 's'}: ${floors.map((f) => f.name).join(', ')}.`
      : `\n  🏢 The office in ${tildify(dir)} has no floors yet: every project is a floor of the building.`,
  );
  await walkthrough(building, true);
  return 0;
}

/** The questions: the workspace folder (when `askFolder`), then checkouts to add. */
async function walkthrough(building: Building, askFolder: boolean) {
  if (askFolder) await pickFolder(building);
  await pickProjects(building);
}

async function pickFolder(building: Building) {
  const now = building.projectsDirState();
  const suggestion = now.custom ? now.dir : tildify(suggestedFolder(building.projectsDir));
  console.log('\n  📁 Which folder are your projects in? The office looks for git projects in it and its\n     subfolders (like <folder>/<owner>/<repo>), and uses them right where they are.');
  for (;;) {
    const answer = (await ask(`     Folder [${suggestion}]: `)) || suggestion;
    const err = building.setProjectsDir(answer, whoAmI());
    if (!err) break;
    console.log(`     ✗ ${err}`);
  }
  console.log(`     ✓ Looking in ${building.projectsDirState().dir} (admins can change it in ⚙️ Settings or the elevator)`);
}

async function pickProjects(building: Building) {
  process.stdout.write('     Looking for git projects…');
  let repos: RepoChoice[] = [];
  try {
    repos = await building.repos(true);
  } catch (err) {
    console.log(`\n     ✗ Couldn't look in ${building.projectsDirState().dir}: ${(err as Error).message}`);
  }
  clearLine();
  let shown = repos.slice(0, SHOWN);
  if (shown.length) {
    console.log(`\n  🛗 Git projects in ${building.projectsDirState().dir}, most recently active first${repos.length > SHOWN ? ` (${SHOWN} of ${repos.length}; type a word to search)` : ''}:\n`);
    printRepos(shown, building);
  } else console.log(`\n  🛗 No git projects in ${building.projectsDirState().dir}. Run \`droid-office setup\` again with the right folder, or pick one in the office's ⚙️ Settings.`);
  if (!repos.length) return;
  let added = 0;
  for (;;) {
    const answer = await ask(added ? '\n  Add another? A number, a path or a word to search. Enter opens the office: ' : '\n  Pick a number, type a project’s path or a word to search. Enter skips: ');
    if (!answer) return;
    let pick: string | undefined;
    if (/^\d+$/.test(answer)) {
      pick = shown[Number(answer) - 1]?.dir;
      if (!pick) {
        console.log(`     ✗ There's no ${answer} in the list`);
        continue;
      }
    } else if (answer.startsWith('/') || answer.startsWith('~')) pick = answer;
    if (!pick) {
      const q = answer.toLowerCase();
      const matches = repos.filter((r) => r.name.toLowerCase().includes(q) || r.dir.toLowerCase().includes(q));
      if (!matches.length) {
        console.log(`     Nothing matches “${answer}”. Type a project’s full path to add one that isn't listed.`);
        continue;
      }
      shown = matches.slice(0, SHOWN);
      console.log(`\n     ${matches.length} project${matches.length === 1 ? ' matches' : 's match'} “${answer}”${matches.length > SHOWN ? ` (the first ${SHOWN} here)` : ''}:\n`);
      printRepos(shown, building);
      continue;
    }
    if (addFloor(building, pick, whoAmI())) added++;
  }
}

/** Makes the checkout at `dir` a floor, saying how it went. */
function addFloor(building: Building, dir: string, by: string): boolean {
  const r = building.add(dir, by);
  if (typeof r === 'string') {
    console.log(`     ✗ ${r}`);
    return false;
  }
  console.log(`     ✓ ${r.name} (${tildify(r.dir)}) is floor ${building.list().indexOf(r) + 1}`);
  return true;
}

function printRepos(list: RepoChoice[], building: Building) {
  const width = Math.max(40, (process.stdout.columns || 100) - 1);
  const nameWidth = Math.min(40, Math.max(...list.map((r) => r.name.length)));
  const floors = building.list();
  list.forEach((r, i) => {
    const note = floors.some((f) => path.resolve(f.dir) === path.resolve(r.dir)) ? '(a floor already)' : tildify(r.dir);
    const line = `    ${String(i + 1).padStart(2)}. ${r.name.padEnd(nameWidth)}  ${note}`.trimEnd();
    console.log(line.length > width ? `${line.slice(0, width - 1)}…` : line);
  });
}

/** One question, answered with a line: '' when skipped with Enter or Ctrl+D. Ctrl+C quits. */
async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on('SIGINT', () => {
    process.stdout.write('\n');
    process.exit(130);
  });
  try {
    return await new Promise<string>((resolve) => {
      rl.once('close', () => resolve(''));
      rl.question(question).then(
        (a) => resolve(a.trim()),
        () => resolve(''),
      );
    });
  } finally {
    rl.close();
  }
}

function clearLine() {
  process.stdout.write('\r\x1b[2K');
}

function whoAmI(): string {
  try {
    return os.userInfo().username;
  } catch {
    return 'droid-office setup';
  }
}

/** An office is running from this data folder: its hook server is listening where it said it would. */
function officeRunning(dataDir: string): Promise<boolean> {
  let port = 0;
  try {
    port = Number(readFileSync(path.join(dataDir, 'hook-port'), 'utf8')) || 0;
  } catch {
    // never started
  }
  if (!port) return Promise.resolve(false);
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const done = (up: boolean) => {
      sock.destroy();
      resolve(up);
    };
    sock.setTimeout(800, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}
