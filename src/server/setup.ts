import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { normalizeRepo, sameRepo } from '../shared/floors.js';
import type { RepoChoice } from '../shared/protocol.js';
import { Building, tildify } from './building.js';
import { defaultProjectsDir, officeHome, type Config } from './config.js';
import { forgetGitlabHosts, gitlabHosts } from './gitlab.js';

// Setting up an office from its terminal: where projects are cloned, signing the GitHub or GitLab CLI
// in, and picking the first repositories to clone as floors. A new office walks you through it the
// first time it starts in a terminal, so it opens on projects of your own instead of an empty
// building. `agent-office setup` runs it again, or does it without asking when given --projects /
// --project (deploy/provision.sh does).

/** How many repositories a list shows; typing a word narrows it down. */
const SHOWN = 12;

/** Folders people keep their code in, in the home folder: the first one that's there is the suggestion. */
const CODE_FOLDERS = ['Workspace', 'workspace', 'Developer', 'code', 'Code', 'projects', 'Projects', 'repos', 'src', 'dev', 'git', 'GitHub', 'github'];

const SETUP_HELP = `agent-office setup — pick where projects are cloned and which ones are floors

Usage:
  agent-office setup [--projects <dir>] [--project <repo>]... [--home <dir>]

In a terminal it walks you through it: the workspace folder new projects are cloned
into, signing the GitHub CLI (gh) or GitLab CLI (glab) in, and picking repositories
to clone as floors. Given --projects or --project it does just that and asks
nothing, for scripts.

A new office runs this by itself the first time it starts in a terminal. Run it
while the office is stopped; while it runs, use its elevator and ⚙️ Settings.

Options:
      --home <dir>        The office to set up (default ~/agent-office, env AGENT_OFFICE_HOME)
      --projects <dir>    Clone new projects into <dir>/<owner>/<repo> (GitLab:
                          <dir>/<host>/<group>/<project>) from now on. Default
                          ~/.agent-office/projects
      --project <repo>    Clone this repository as a floor: owner/name or a GitHub
                          URL, or a GitLab project URL or host/group/project path.
                          Repeat it for more than one
  -h, --help              Show this help
`;

/** Someone's at a terminal to answer questions. */
export function interactive(): boolean {
  return !!process.stdin.isTTY && !!process.stdout.isTTY && !process.env.CI;
}

/**
 * The office starting in a terminal with no floors yet: walk through the workspace folder, the
 * GitHub / GitLab sign-in and the first projects before it opens. Enter skips any of it; the
 * elevator does the same.
 */
export async function welcome(cfg: Config): Promise<void> {
  const building = new Building(cfg.dataDir, cfg.projectsDir);
  if (building.list().length) return;
  // --projects is the answer to the first question (the office applies it again as it starts).
  const folderGiven = !!cfg.projects && !building.setProjectsDir(cfg.projects, 'the command line');
  console.log(`
  👋 Welcome to Agent Office!

  Every project is a floor of the building, and this one doesn't have any yet.
  Let's add your first: pick one of your GitHub or GitLab repositories and the
  office clones it. Press Enter to skip any question and do it from the office's
  elevator instead.`);
  await walkthrough(building, cfg.dataDir, !folderGiven && !building.projectsDirState().custom);
  console.log(building.list().length ? '\n  All set. Opening the office…' : '\n  Opening the office: its elevator asks for your first project.');
}

/** `agent-office setup …`: returns the exit code. */
export async function setupCommand(argv: string[]): Promise<number> {
  let home = '';
  let projects = '';
  const repos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('-')) {
        console.error(`agent-office setup: ${a} needs a value`);
        process.exit(2);
      }
      return v;
    };
    if (a === '-h' || a === '--help') {
      process.stdout.write(SETUP_HELP);
      return 0;
    } else if (a === '--home') home = path.resolve(value());
    else if (a === '--projects') projects = value();
    else if (a === '--project') repos.push(value());
    else {
      console.error(`agent-office setup: unknown option ${a}\n`);
      process.stderr.write(SETUP_HELP);
      return 2;
    }
  }

  // The same office `agent-office` would start from here (see loadConfig).
  const cwd = process.cwd();
  let dir = home || officeHome();
  if (!home && !process.env.AGENT_OFFICE_HOME && cwd !== dir && existsSync(path.join(cwd, '.agent-office', 'config.json'))) dir = cwd;
  const dataDir = path.join(dir, '.agent-office');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (await officeRunning(dataDir)) {
    console.error(`agent-office setup: the office in ${tildify(dir)} is running. Add projects from its elevator, and pick the workspace folder in ⚙️ Settings.`);
    return 1;
  }
  const building = new Building(dataDir, defaultProjectsDir());

  if (projects || repos.length || !interactive()) {
    if (!projects && !repos.length) {
      console.error('agent-office setup: nothing to do without a terminal to ask in. Pass --projects <dir> and/or --project <repo>.');
      return 2;
    }
    let code = 0;
    if (projects) {
      const err = building.setProjectsDir(projects, 'agent-office setup');
      if (err) {
        console.error(`agent-office setup: --projects: ${err}`);
        return 1;
      }
      console.log(`  📁 New projects are cloned into ${building.projectsDirState().dir}/<owner>/<repo>`);
    }
    for (const repo of repos) if (!(await addFloor(building, repo, 'agent-office setup'))) code = 1;
    return code;
  }

  const floors = building.list();
  console.log(
    floors.length
      ? `\n  🏢 The office in ${tildify(dir)} has ${floors.length} floor${floors.length === 1 ? '' : 's'}: ${floors.map((f) => f.name).join(', ')}.`
      : `\n  🏢 The office in ${tildify(dir)} has no floors yet: every project is a floor of the building.`,
  );
  await walkthrough(building, dataDir, true);
  return 0;
}

/** The questions: the workspace folder (when `askFolder`), GitHub / GitLab, then repositories to add. */
async function walkthrough(building: Building, dataDir: string, askFolder: boolean) {
  if (askFolder) await pickFolder(building);
  const login = await signIn(dataDir);
  if (!login) {
    console.log('\n  Add projects from the elevator in the office once gh or glab is ready (or run `agent-office setup` again).');
    return;
  }
  await pickProjects(building, login);
}

async function pickFolder(building: Building) {
  const now = building.projectsDirState();
  const suggestion = now.custom ? now.dir : tildify(suggestedFolder(building.projectsDir));
  console.log('\n  📁 Where should the office clone your projects? Each one goes in <folder>/<owner>/<repo>\n     (GitLab projects keep their host and groups: <folder>/<host>/<group>/<project>).');
  for (;;) {
    const answer = (await ask(`     Folder [${suggestion}]: `)) || suggestion;
    const err = building.setProjectsDir(answer, whoAmI());
    if (!err) break;
    console.log(`     ✗ ${err}`);
  }
  console.log(`     ✓ ${building.projectsDirState().dir}/<owner>/<repo> (admins can change it in ⚙️ Settings or the elevator)`);
}

/** Where to suggest cloning projects: a code folder that's already in the home folder, else `fallback`. */
export function suggestedFolder(fallback: string, home = os.homedir()): string {
  let names: string[] = [];
  try {
    names = readdirSync(home);
  } catch {
    return fallback;
  }
  for (const name of CODE_FOLDERS) {
    const dir = path.join(home, name);
    try {
      if (names.includes(name) && statSync(dir).isDirectory()) return dir;
    } catch {
      // a broken link
    }
  }
  return fallback;
}

/** What one CLI says about who it's signed in as. */
interface Login {
  login?: string;
  /** The GitLab instance it's signed in to. */
  host?: string;
  missing?: boolean;
  error?: string;
}

interface Cli {
  name: 'gh' | 'glab';
  site: string;
  icon: string;
  install: string;
  check(cwd: string): Promise<Login>;
}

const CLIS: Cli[] = [
  {
    name: 'gh',
    site: 'GitHub',
    icon: '🐙',
    install: process.platform === 'darwin' ? 'brew install gh' : process.platform === 'win32' ? 'winget install GitHub.cli' : 'sudo apt install gh',
    check: ghUser,
  },
  {
    name: 'glab',
    site: 'GitLab',
    icon: '🦊',
    install: process.platform === 'darwin' ? 'brew install glab' : process.platform === 'win32' ? 'winget install GLab.GLab' : 'see https://gitlab.com/gitlab-org/cli',
    check: glabUser,
  },
];

/**
 * Who the office can clone as, after offering to sign gh or glab in. Either one is enough: the
 * repository list below comes from both. Undefined when neither can be used.
 */
async function signIn(cwd: string): Promise<string | undefined> {
  for (let tried = false; ; tried = true) {
    const logins = await Promise.all(CLIS.map((cli) => cli.check(cwd)));
    const signedIn = CLIS.flatMap((cli, i) => (logins[i].login ? [`${logins[i].host ?? cli.site} as ${logins[i].login}`] : []));
    if (signedIn.length) {
      console.log(`\n  🔑 Signed in to ${signedIn.join(' and ')}`);
      return logins.find((l) => l.login)?.login;
    }
    const installed = CLIS.filter((_, i) => !logins[i].missing);
    if (!installed.length) {
      console.log('\n  🔑 The office clones projects with the GitHub CLI (gh) or the GitLab CLI (glab), and neither is installed.');
      for (const cli of CLIS) console.log(`     ${cli.icon} ${cli.site}: ${cli.install}, then \`${cli.name} auth login\``);
      return undefined;
    }
    if (tried) {
      for (const cli of installed) console.log(`\n  ${cli.icon} Couldn't reach ${cli.site} with ${cli.name}: ${logins[CLIS.indexOf(cli)].error ?? `${cli.name} failed`}`);
      return undefined;
    }
    console.log(`\n  🔑 The office clones projects with ${installed.map((cli) => `the ${cli.site} CLI (${cli.name})`).join(' or ')}, and ${installed.length > 1 ? 'neither is' : "it isn't"} signed in.`);
    let cli: Cli | undefined;
    if (installed.length === 1) {
      if (/^n/i.test(await ask(`     Sign in to ${installed[0].site} now? [Y/n] `))) return undefined;
      cli = installed[0];
    } else {
      installed.forEach((c, i) => console.log(`     ${i + 1}. ${c.site} (\`${c.name} auth login\`)`));
      const answer = await ask('     Sign in to which? A number, or Enter to skip: ');
      cli = installed[Number(answer) - 1];
      if (!cli) return undefined;
    }
    spawnSync(cli.name, ['auth', 'login'], { stdio: 'inherit' });
    if (cli.name === 'glab') forgetGitlabHosts();
  }
}

function ghUser(cwd: string): Promise<Login> {
  return new Promise((resolve) => {
    execFile('gh', ['api', 'user', '--jq', '.login'], { cwd, timeout: 30_000 }, (err, stdout, stderr) => {
      if (!err && stdout.trim()) return resolve({ login: stdout.trim() });
      if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') return resolve({ missing: true });
      resolve({ error: lastLine(stderr || err?.message) ?? 'gh failed' });
    });
  });
}

/** The first GitLab instance glab is signed in to, and who as. */
async function glabUser(cwd: string): Promise<Login> {
  let error: string | undefined;
  for (const host of gitlabHosts()) {
    const r = await new Promise<Login>((resolve) => {
      execFile('glab', ['api', '--hostname', host, 'user'], { cwd, timeout: 30_000, env: { ...process.env, GLAB_NO_PROMPT: '1', NO_PROMPT: '1', NO_COLOR: '1' } }, (err, stdout, stderr) => {
        if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') return resolve({ missing: true });
        try {
          const user = err ? undefined : (JSON.parse(stdout) as { username?: unknown }).username;
          if (typeof user === 'string' && user) return resolve({ login: user, host });
        } catch {
          // not JSON: an error page
        }
        resolve({ error: lastLine(stderr || err?.message) ?? 'glab failed' });
      });
    });
    if (r.login || r.missing) return r;
    error ??= r.error;
  }
  return { error };
}

function lastLine(text: string | undefined): string | undefined {
  return String(text ?? '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .slice(-1)[0];
}

async function pickProjects(building: Building, login: string) {
  process.stdout.write('     Asking GitHub and GitLab for your repositories…');
  let repos: RepoChoice[] = [];
  try {
    repos = await building.repos();
    clearLine();
  } catch (err) {
    clearLine();
    console.log(`     ✗ Couldn't list your repositories: ${(err as Error).message}`);
  }
  let shown = repos.slice(0, SHOWN);
  if (shown.length) {
    console.log(`\n  🛗 Your repositories, most recently pushed first${repos.length > SHOWN ? ` (${SHOWN} of ${repos.length}; type a word to search)` : ''}:\n`);
    printRepos(shown, building);
  } else if (!repos.length) console.log('\n  🛗 No repositories to list. Type owner/name (GitHub), or paste a GitLab project URL, to clone any repository you can see.');
  let added = 0;
  for (;;) {
    const answer = await ask(added ? '\n  Add another? A number, a repository or a word to search. Enter opens the office: ' : '\n  Pick a number, type a repository (owner/name or a GitLab URL) or a word to search. Enter skips: ');
    if (!answer) return;
    let pick: string | undefined;
    if (/^\d+$/.test(answer)) {
      pick = shown[Number(answer) - 1]?.name;
      if (!pick) {
        console.log(`     ✗ There's no ${answer} in the list`);
        continue;
      }
    } else pick = normalizeRepo(answer);
    if (!pick) {
      const q = answer.toLowerCase();
      const matches = repos.filter((r) => r.name.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q));
      if (!matches.length) {
        console.log(`     Nothing matches “${answer}”. Type owner/name (GitHub), or paste a GitLab project URL, to clone any repository.`);
        continue;
      }
      shown = matches.slice(0, SHOWN);
      console.log(`\n     ${matches.length} repositor${matches.length === 1 ? 'y matches' : 'ies match'} “${answer}”${matches.length > SHOWN ? ` (the first ${SHOWN} here)` : ''}:\n`);
      printRepos(shown, building);
      continue;
    }
    if (await addFloor(building, pick, login)) added++;
  }
}

/** Clones `repo` as a new floor, saying how it went. */
async function addFloor(building: Building, repo: string, by: string): Promise<boolean> {
  const r = await building.add(repo, by, (def) => {
    console.log(`     ⏳ Cloning ${def.repo ?? repo} into ${tildify(def.dir)}… (a big repository can take a minute)`);
  });
  if (typeof r === 'string') {
    console.log(`     ✗ ${r}`);
    return false;
  }
  console.log(`     ✓ ${r.repo ?? r.name} is floor ${building.list().indexOf(r) + 1}`);
  return true;
}

function printRepos(list: RepoChoice[], building: Building) {
  const width = Math.max(40, (process.stdout.columns || 100) - 1);
  const nameWidth = Math.min(48, Math.max(...list.map((r) => r.name.length)));
  const floors = building.list();
  list.forEach((r, i) => {
    const note = floors.some((f) => sameRepo(f.repo, r.name)) ? '(a floor already)' : [r.private ? 'private' : '', r.description ?? ''].filter(Boolean).join(' · ');
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
    return 'agent-office setup';
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
