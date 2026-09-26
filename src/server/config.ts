import { randomBytes, scryptSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export interface Config {
  dir: string;
  dataDir: string;
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
}

export interface RTCIceServerLike {
  urls: string | string[];
  username?: string;
  credential?: string;
}

const HELP = `agent-office — a 3D office for your team and its Claude Code workers

Usage:
  agent-office [dir] [options]
  agent-office prune [dir] [--dry-run] [--force]

Runs the office for the project in [dir] (default: current directory).
Every worker, terminal and GitHub board is scoped to that directory.

Commands:
  prune                   Remove leftover worker worktrees (.agent-office/worktrees/)
                          and their office/* branches. Anything with uncommitted
                          changes or unpushed commits is kept unless --force is given.

Options:
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
      --agent <cmd>       Command a worker runs (default "claude", env AGENT_OFFICE_AGENT)
      --agent-args <str>  Extra args for every worker, e.g. "--model opus"
      --tls-cert <file>   Serve HTTPS with this certificate (PEM)
      --tls-key <file>    ...and this private key (PEM)
      --self-signed       Serve HTTPS with a generated self-signed certificate
      --trust-proxy       Trust X-Forwarded-* headers (behind Caddy/nginx)
      --turn <url>        Add a TURN server for voice (repeatable), e.g.
                          turn:user:pass@turn.example.com:3478
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

/** Keep the office's own data out of git without touching the project's .gitignore. */
function excludeFromGit(dir: string) {
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
  let dir = process.cwd();
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
        agentArgs = splitArgs(takeValue(argv, i++, a));
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
      default:
        if (a.startsWith('-')) {
          console.error(`agent-office: unknown option ${a}\n`);
          process.stderr.write(HELP);
          process.exit(2);
        }
        dir = path.resolve(a);
    }
  }

  if (!existsSync(dir)) {
    console.error(`agent-office: directory not found: ${dir}`);
    process.exit(2);
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error('agent-office: invalid --port');
    process.exit(2);
  }

  const dataDir = path.join(dir, '.agent-office');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  excludeFromGit(dir);

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
