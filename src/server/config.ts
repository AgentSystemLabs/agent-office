import { randomBytes, scryptSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { WEATHERS, type Weather } from '../shared/protocol.js';
import { MAX_WORKER_LIMIT, parseWorkerLimit } from './machine.js';

export interface Config {
  /** The office's own folder: the building's data lives in its .agent-office. */
  dir: string;
  dataDir: string;
  /** Where new floors are cloned by default, as <projectsDir>/<owner>/<repo>. */
  projectsDir: string;
  /** --projects / AGENT_OFFICE_PROJECTS: picks the projects folder, as ⚙️ Settings in the office does. */
  projects?: string;
  /** Started as `agent-office <dir>`: that checkout is a floor of its own (it's also `dir`). */
  project?: string;
  host: string;
  port: number;
  /** Plaintext password, only when known: from --password, or generated and not yet claimed. */
  password?: string;
  passwordGenerated: boolean;
  /** scrypt(password, salt): what logins are checked against and sessions are keyed on. */
  verifier: Buffer;
  salt: Buffer;
  secret: string;
  /** One-time token that lets the first visitor see the generated password (then never again). */
  claimToken?: string;
  claimed: boolean;
  /** Forget the plaintext password for good once it has been shown. */
  markClaimed(): void;
  agentCmd: string;
  agentArgs: string[];
  tls?: { cert: string; key: string };
  trustProxy: boolean;
  iceServers: RTCIceServerLike[];
  /** Address teammates SSH-tunnel to (set by deploy/aws.sh); enables invites from the office. */
  publicHost?: string;
  /** Daily tracked Claude Code spend budget, USD. OpenCode/Codex spend is excluded. */
  budget?: number;
  /** Refuse new hires for the rest of the day once the budget is spent. */
  budgetPause: boolean;
  /** The most workers the office runs at once, across every floor; ⚙️ Settings can't go past it. */
  maxWorkers?: number;
  /** Slack / Discord webhook to post to when a worker needs input or finishes ('' turns it off). */
  webhook?: string;
  /** Where the office is: its sun and live weather follow this city's forecast. */
  city?: string;
  /** Weather pinned for good, instead of made up or forecast. */
  weather?: Weather;
}

export interface RTCIceServerLike {
  urls: string | string[];
  username?: string;
  credential?: string;
}

const HELP = `agent-office — a 3D office for your team and its Claude Code / OpenCode / Codex workers

Usage:
  agent-office [options]
  agent-office [dir] [options]
  agent-office prune [dir] [--dry-run] [--force]
  agent-office accounts [list|invite|revoke|role|password] ...

Runs the office. Every project is a floor of the building: ride the elevator,
pick one of the repositories your \`gh\` login can see, and the office clones it
into the projects folder as a new floor. Workers, terminals, boards and the
task queue on a floor all belong to that floor's checkout.

Started from anywhere, the office keeps its data in --home. Given a [dir] (or
started in a project where an office already ran), it keeps its data in
<dir>/.agent-office as it always has, and that project is one of the floors.

Commands:
  prune                   Remove leftover worker worktrees (.agent-office/worktrees/)
                          and their office/* branches. Anything with uncommitted
                          changes or unpushed commits is kept unless --force is given.
  accounts                Invite, list and revoke people's own accounts, and switch
                          the shared password off or on (see accounts --help)

Options:
      --home <dir>        Where the office keeps its data when no [dir] is given
                          (default ~/agent-office, env AGENT_OFFICE_HOME)
      --projects <dir>    Where new floors are cloned, as <dir>/<owner>/<repo>
                          (default ~/agent-office, env AGENT_OFFICE_PROJECTS).
                          Also settable from ⚙️ Settings in the office
  -p, --port <n>          Port to listen on (default 4600, env PORT)
  -H, --host <addr>       Address to bind (default 0.0.0.0)
      --password <pw>     Office password (env AGENT_OFFICE_PASSWORD).
                          Without one, a random password is generated once and
                          saved in <dir>/.agent-office/config.json
      --claim-token <t>   Show the generated password exactly once, at /claim?t=<t>
                          (env AGENT_OFFICE_CLAIM_TOKEN). After that only a hash
                          is kept and the password is never displayed again.
      --reset-password    Forget the generated password (a new one is made on the
                          next start) and exit
      --agent <cmd>       Default agent command (default "claude", env AGENT_OFFICE_AGENT)
      --agent-args <str>  Extra args for the configured agent, e.g. "--model opus"
                          Workers can also select Claude Code, OpenCode or Codex in the UI
      --tls-cert <file>   Serve HTTPS with this certificate (PEM)
      --tls-key <file>    ...and this private key (PEM)
      --self-signed       Serve HTTPS with a generated self-signed certificate
      --trust-proxy       Trust X-Forwarded-* headers (behind Caddy/nginx)
      --turn <url>        Add a TURN server for voice (repeatable), e.g.
                          turn:user:pass@turn.example.com:3478
      --budget <usd>      Daily budget for tracked Claude Code spend (env
                          AGENT_OFFICE_BUDGET). Everyone is warned when the
                          day's spend passes it. OpenCode/Codex spend is excluded
      --budget-pause      ...and no new workers can be hired until the next
                          day (env AGENT_OFFICE_BUDGET_PAUSE=1)
      --max-workers <n>   Run at most this many workers at once, across every
                          floor (env AGENT_OFFICE_MAX_WORKERS). Hiring past it
                          is refused. Admins can lower the limit from ⚙️
                          Settings, but not raise it past this
      --webhook <url>     Post to this Slack or Discord webhook when a worker
                          needs input or finishes (env AGENT_OFFICE_WEBHOOK).
                          Also settable from ⚙️ Settings in the office; "" turns it off
      --city <name>       Put the office in a real city, e.g. "Berlin" or
                          "Portland, Oregon" (env AGENT_OFFICE_CITY): day, night
                          and the weather outside follow its live forecast from
                          open-meteo.com. Without it the sun follows this
                          machine's clock and the weather is made up
      --weather <kind>    Pin the weather: clear, cloudy, rain, storm, snow or
                          fog (env AGENT_OFFICE_WEATHER)
  -h, --help              Show this help

Voice and screen sharing need a secure context: use https (a reverse proxy,
--tls-cert/--tls-key or --self-signed) unless everyone is on localhost.
`;

function takeValue(args: string[], i: number, flag: string): string {
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) {
    console.error(`agent-office: ${flag} needs a value`);
    process.exit(2);
  }
  return v;
}

function splitArgs(s: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function parseTurn(url: string): RTCIceServerLike {
  // turn:user:pass@host:port  ->  { urls: 'turn:host:port', username, credential }
  const m = /^(turns?):([^:@]+):([^@]+)@(.+)$/.exec(url);
  if (m) return { urls: `${m[1]}:${m[4]}`, username: decodeURIComponent(m[2]), credential: decodeURIComponent(m[3]) };
  return { urls: url };
}

/** Where the office lives when it isn't started in a project: ~/agent-office, or $AGENT_OFFICE_HOME. */
export function officeHome(): string {
  return path.resolve(process.env.AGENT_OFFICE_HOME || path.join(os.homedir(), 'agent-office'));
}

/** Keep the office's own data out of git without touching the project's .gitignore. */
export function excludeFromGit(dir: string) {
  try {
    const gitDir = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const exclude = path.resolve(dir, gitDir, 'info', 'exclude');
    const cur = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
    if (!cur.split('\n').some((l) => l.trim() === '.agent-office/' || l.trim() === '.agent-office')) {
      mkdirSync(path.dirname(exclude), { recursive: true });
      appendFileSync(exclude, `${cur && !cur.endsWith('\n') ? '\n' : ''}.agent-office/\n`);
    }
  } catch {
    // not a git repo; nothing to exclude
  }
}

export function loadConfig(argv: string[]): Config {
  let project = '';
  let home = officeHome();
  let homeGiven = !!process.env.AGENT_OFFICE_HOME;
  let projects = process.env.AGENT_OFFICE_PROJECTS ? path.resolve(process.env.AGENT_OFFICE_PROJECTS) : '';
  let port = Number(process.env.PORT) || 4600;
  let host = '0.0.0.0';
  let password = process.env.AGENT_OFFICE_PASSWORD || '';
  let agentCmd = process.env.AGENT_OFFICE_AGENT || 'claude';
  let agentArgs: string[] = splitArgs(process.env.AGENT_OFFICE_AGENT_ARGS || '');
  let tlsCert = '';
  let tlsKey = '';
  let selfSigned = false;
  let trustProxy = false;
  let claimToken = process.env.AGENT_OFFICE_CLAIM_TOKEN || '';
  let resetPassword = false;
  let budget = process.env.AGENT_OFFICE_BUDGET || '';
  let budgetPause = !!process.env.AGENT_OFFICE_BUDGET_PAUSE && process.env.AGENT_OFFICE_BUDGET_PAUSE !== '0';
  let maxWorkers = process.env.AGENT_OFFICE_MAX_WORKERS || '';
  let webhook = process.env.AGENT_OFFICE_WEBHOOK;
  let city = process.env.AGENT_OFFICE_CITY || '';
  let weather = process.env.AGENT_OFFICE_WEATHER || '';
  const iceServers: RTCIceServerLike[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-h':
      case '--help':
        process.stdout.write(HELP);
        process.exit(0);
      case '-p':
      case '--port':
        port = Number(takeValue(argv, i++, a));
        break;
      case '-H':
      case '--host':
        host = takeValue(argv, i++, a);
        break;
      case '--password':
        password = takeValue(argv, i++, a);
        break;
      case '--agent':
        agentCmd = takeValue(argv, i++, a);
        break;
      case '--agent-args':
        // Its value is flags itself ("--model opus"), so a leading -- doesn't mean the value is missing.
        if (argv[i + 1] === undefined) takeValue(argv, i, a);
        agentArgs = splitArgs(argv[++i]);
        break;
      case '--tls-cert':
        tlsCert = takeValue(argv, i++, a);
        break;
      case '--tls-key':
        tlsKey = takeValue(argv, i++, a);
        break;
      case '--self-signed':
        selfSigned = true;
        break;
      case '--trust-proxy':
        trustProxy = true;
        break;
      case '--claim-token':
        claimToken = takeValue(argv, i++, a);
        break;
      case '--reset-password':
        resetPassword = true;
        break;
      case '--turn':
        iceServers.push(parseTurn(takeValue(argv, i++, a)));
        break;
      case '--budget':
        budget = takeValue(argv, i++, a);
        break;
      case '--budget-pause':
        budgetPause = true;
        break;
      case '--max-workers':
        maxWorkers = takeValue(argv, i++, a);
        break;
      case '--webhook':
        webhook = takeValue(argv, i++, a);
        break;
      case '--home':
        home = path.resolve(takeValue(argv, i++, a));
        homeGiven = true;
        break;
      case '--projects':
        projects = path.resolve(takeValue(argv, i++, a));
        break;
      case '--city':
        city = takeValue(argv, i++, a);
        break;
      case '--weather':
        weather = takeValue(argv, i++, a);
        break;
      default:
        if (a.startsWith('-')) {
          console.error(`agent-office: unknown option ${a}\n`);
          process.stderr.write(HELP);
          process.exit(2);
        }
        project = path.resolve(a);
    }
  }

  // An office already runs in this project (started here before there were floors): carry on with
  // it, its workers and its password, rather than open an empty building somewhere else.
  const cwd = process.cwd();
  if (!project && !homeGiven && cwd !== home && existsSync(path.join(cwd, '.agent-office', 'config.json'))) project = cwd;
  if (project && !existsSync(project)) {
    console.error(`agent-office: directory not found: ${project}`);
    process.exit(2);
  }
  const dir = project || home;
  // New floors go next to the office's data when it has a home of its own, and never into a project.
  const projectsDir = project ? path.join(os.homedir(), 'agent-office') : home;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error('agent-office: invalid --port');
    process.exit(2);
  }
  const budgetUsd = budget ? Number(budget.replace(/^\$/, '')) : undefined;
  if (budgetUsd !== undefined && !(budgetUsd > 0)) {
    console.error('agent-office: --budget needs an amount in dollars, e.g. --budget 20');
    process.exit(2);
  }
  const workerLimit = maxWorkers ? parseWorkerLimit(maxWorkers) : undefined;
  if (maxWorkers && workerLimit === undefined) {
    console.error(`agent-office: --max-workers needs a whole number from 1 to ${MAX_WORKER_LIMIT}, e.g. --max-workers 6`);
    process.exit(2);
  }
  weather = weather.trim().toLowerCase();
  if (weather && !(WEATHERS as readonly string[]).includes(weather)) {
    console.error(`agent-office: --weather is one of ${WEATHERS.join(', ')}`);
    process.exit(2);
  }

  const dataDir = path.join(dir, '.agent-office');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (project) excludeFromGit(dir);

  const cfgPath = path.join(dataDir, 'config.json');
  let stored: { password?: string; verifier?: string; salt?: string; secret?: string; claimedAt?: number } = {};
  try {
    stored = JSON.parse(readFileSync(cfgPath, 'utf8'));
  } catch {
    // first run
  }
  const save = () => writeFileSync(cfgPath, JSON.stringify(stored, null, 2), { mode: 0o600 });
  if (!stored.secret) stored.secret = randomBytes(32).toString('hex');
  if (!stored.salt) stored.salt = randomBytes(16).toString('hex');
  const salt = Buffer.from(stored.salt, 'hex');
  const hash = (pw: string) => scryptSync(pw, salt, 32);

  if (resetPassword) {
    delete stored.password;
    delete stored.verifier;
    delete stored.claimedAt;
    save();
    console.log('agent-office: password forgotten — a new one is generated on the next start');
    process.exit(0);
  }

  let verifier: Buffer;
  let passwordGenerated = false;
  if (password) {
    verifier = hash(password);
  } else {
    passwordGenerated = true;
    if (stored.verifier) {
      verifier = Buffer.from(stored.verifier, 'hex');
      password = stored.password ?? '';
    } else {
      // New password (or a legacy plaintext one): keep the plaintext only until it's been shown.
      password = stored.password ?? randomBytes(9).toString('base64url');
      stored.password = password;
      verifier = hash(password);
      stored.verifier = verifier.toString('hex');
      delete stored.claimedAt;
    }
  }
  save();

  let tls: Config['tls'];
  if (tlsCert || tlsKey) {
    if (!tlsCert || !tlsKey) {
      console.error('agent-office: --tls-cert and --tls-key go together');
      process.exit(2);
    }
    tls = { cert: readFileSync(tlsCert, 'utf8'), key: readFileSync(tlsKey, 'utf8') };
  } else if (selfSigned) {
    tls = { cert: '', key: '' }; // filled in by ensureSelfSigned()
  }

  return {
    dir,
    dataDir,
    projectsDir,
    projects: projects || undefined,
    project: project || undefined,
    host,
    port,
    password: password || undefined,
    passwordGenerated,
    verifier,
    salt,
    secret: stored.secret,
    claimToken: claimToken || undefined,
    claimed: !!stored.claimedAt,
    markClaimed() {
      stored.claimedAt = Date.now();
      delete stored.password;
      save();
      this.claimed = true;
      this.password = undefined;
    },
    agentCmd,
    agentArgs,
    tls,
    trustProxy,
    iceServers,
    publicHost: process.env.AGENT_OFFICE_PUBLIC_HOST || undefined,
    budget: budgetUsd,
    budgetPause,
    maxWorkers: workerLimit,
    webhook,
    city: city.trim() || undefined,
    weather: (weather as Weather) || undefined,
  };
}

export async function ensureSelfSigned(cfg: Config): Promise<void> {
  if (!cfg.tls || cfg.tls.cert) return;
  const certPath = path.join(cfg.dataDir, 'tls-cert.pem');
  const keyPath = path.join(cfg.dataDir, 'tls-key.pem');
  if (existsSync(certPath) && existsSync(keyPath)) {
    cfg.tls = { cert: readFileSync(certPath, 'utf8'), key: readFileSync(keyPath, 'utf8') };
    return;
  }
  const selfsigned = await import('selfsigned');
  const gen = (selfsigned as any).generate ?? (selfsigned as any).default?.generate;
  const pems = await gen([{ name: 'commonName', value: 'agent-office' }], { days: 825, keySize: 2048 });
  writeFileSync(certPath, pems.cert, { mode: 0o600 });
  writeFileSync(keyPath, pems.private, { mode: 0o600 });
  cfg.tls = { cert: pems.cert, key: pems.private };
}
