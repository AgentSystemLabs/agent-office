import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, ensureSelfSigned } from './config.js';
import { startServer } from './server.js';
import { tildify } from './building.js';

const argv = process.argv.slice(2);
if (argv[0] === 'prune') {
  const { prune } = await import('./prune.js');
  process.exit(await prune(argv.slice(1)));
}
if (argv[0] === 'accounts') {
  const { accountsCommand } = await import('./accounts.js');
  process.exit(accountsCommand(argv.slice(1)));
}
if (argv[0] === 'setup') {
  const { setupCommand } = await import('./setup.js');
  process.exit(await setupCommand(argv.slice(1)));
}

const cfg = loadConfig(argv);
await ensureSelfSigned(cfg);
const { interactive, welcome } = await import('./setup.js');
const atTerminal = interactive();
// A new office started in a terminal: where projects go, GitHub, and the first floor, before it opens.
if (!cfg.project && atTerminal) await welcome(cfg);

let office: Awaited<ReturnType<typeof startServer>>;
try {
  office = await startServer(cfg);
} catch (err) {
  const e = err as NodeJS.ErrnoException;
  if (e.code === 'EADDRINUSE') console.error(`agent-office: port ${cfg.port} is already in use (try --port)`);
  else console.error(`agent-office: ${e.message}`);
  process.exit(1);
}

const scheme = cfg.tls ? 'https' : 'http';
const everywhere = cfg.host === '0.0.0.0' || cfg.host === '::';
const loopback = cfg.host === 'localhost' || cfg.host === '::1' || cfg.host.startsWith('127.');
// Where this machine's browser finds the office: localhost, unless it's bound to one other address.
const here = `${scheme}://${everywhere || loopback ? 'localhost' : cfg.host}:${cfg.port}`;
const urls = new Set<string>([here]);
if (everywhere) {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) if (ni.family === 'IPv4' && !ni.internal) urls.add(`${scheme}://${ni.address}:${cfg.port}`);
  }
}

const agent = office.resolvedAgent;
function floorsLine() {
  const floors = office.floors();
  const where = `new ones are cloned into ${tildify(office.projectsDir())}`;
  if (!floors.length) return `🛗 no floors yet — ride the elevator in the office to add a project (${where})`;
  return `🛗 ${floors.length} floor${floors.length === 1 ? '' : 's'}: ${floors.map((f) => f.def.name).join(', ')} (${where})`;
}

function passwordLine() {
  if (!office.accounts.sharedPassword) return 'off — everyone signs in with their own account (agent-office accounts)';
  if (!cfg.passwordGenerated) return '(from --password / AGENT_OFFICE_PASSWORD)';
  if (cfg.claimToken && !cfg.claimed) return 'shown exactly once to whoever opens the claim link (/claim?t=…)';
  if (cfg.claimed || !cfg.password) return '(already claimed — never shown again; reset with --reset-password)';
  return cfg.password;
}
/**
 * Opens the office in this computer's browser. Not over SSH, in CI, or on a Linux box without a
 * desktop: nobody would see it there.
 */
function openBrowser(url: string): boolean {
  if (process.env.SSH_CONNECTION || process.env.SSH_TTY || process.env.CI) return false;
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return false;
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true })
    .on('error', () => {})
    .unref();
  return true;
}

// Someone started it in a terminal: a link that signs them in once, opened in their browser, so
// there's no password to copy. Not for an office that's claimed from a link (deploy/provision.sh)
// or signed in to with accounts only.
let signIn = '';
let opened = false;
if (atTerminal && office.accounts.sharedPassword && !cfg.claimToken) {
  signIn = here + office.signInLink();
  if (cfg.open) opened = openBrowser(signIn);
}

// Started in a project that's still one of the floors (it can be taken off like any other).
const local = cfg.project && office.floors().some((f) => path.resolve(f.def.dir) === cfg.project);
console.log(`
  🏢  agent-office is open${local ? ` for ${cfg.project}` : ''}

  ${floorsLine()}

  ${[...urls].join('\n  ')}${loopback ? '\n  (only this computer can open it: --host 0.0.0.0 lets your network in)' : ''}
${signIn ? `\n  sign in: ${signIn}\n           ${opened ? 'opened in your browser; ' : ''}the link works once\n` : ''}
  password: ${passwordLine()}
  default agent: ${[agent ?? `${cfg.agentCmd} (via login shell)`, ...cfg.agentArgs].join(' ')}
  choose a provider (including Pi) when hiring or queueing a task
${cfg.tls || loopback ? '' : '\n  tip: voice & screen share need https off localhost — use a reverse proxy or --self-signed\n'}`);

let closing = false;
// SIGTERM is a restart (tsx watch reloading, a plain `kill`, systemd): workers keep running in their
// terminal host and the next office picks them back up. Ctrl+C closes the office and stops them.
// (Under systemd that needs KillMode=process, or stopping the service stops the host with it; see
// deploy/provision.sh. Workers cut off that way are resumed and carry on.)
const stop = (signal: NodeJS.Signals) => {
  if (closing) process.exit(1);
  closing = true;
  const keep = signal === 'SIGTERM';
  console.log(keep ? '\n  closing the office — workers keep running for the next one…' : '\n  closing the office…');
  office.shutdown(keep);
  setTimeout(() => process.exit(0), 300);
};
// Last line of defense: one bad request must never take down every running worker.
process.on('unhandledRejection', (err) => console.error('agent-office: unhandled rejection', err));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
