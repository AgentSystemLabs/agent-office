import { openBrowser } from '../browser.js';
import { Forwarder } from './forwarder.js';
import { Office } from './office.js';
import { forget, signIn, type Credentials } from './session.js';
import { SshTunnel, sshArgs } from './ssh.js';
import type { Forward } from './wire.js';

// `agent-office tunnel`, run on your own computer: every web server a worker starts in an office
// somewhere else opens on the same port here, by itself, and closes when the worker stops it. It
// asks the office which servers there are every couple of seconds (wire.ts), and listens on each
// one's port (forwarder.ts). Given an SSH address it opens the tunnel to the office too (ssh.ts).

const DEFAULT_PORT = 4600;
/** How often the office is asked which servers the workers run. It looks itself every 4 seconds. */
const POLL_MS = 2000;

const HELP = `agent-office tunnel — open every worker's web server on this computer, by itself

Usage:
  agent-office tunnel [where] [options] [-- <ssh options>]

Run it on your own computer and leave it running. Whenever a worker in the office
starts a web server (npm run dev, a preview build), the same port opens here:
http://localhost:5173 on this computer is the worker's localhost:5173. It closes
again when the worker stops the server. No command per server, nothing to restart.

Where the office is:
  office@203.0.113.7      An SSH address (the one 👥 Invite teammates shows, also
  ssh://office@host:2222  as ssh://, or a Host from your ssh config). Opens the
                          tunnel to the office as well, and the office in your
                          browser, and opens the tunnel again when it drops
  http://localhost:4600   An office you can already open in a browser: through a
  https://office.example  tunnel that's running, on a domain, or on your tailnet.
                          The default is http://localhost:4600

It signs in like a browser does. The first time it asks for the office password
(or your name and your own) and keeps the session for next time.

Options:
  -p, --port <n>          With an SSH address: the port the office gets on this
                          computer (default: the same as --office-port)
      --office-port <n>   With an SSH address: the office's port on its own
                          machine (default ${DEFAULT_PORT})
      --name <name>       Sign in with this account (env AGENT_OFFICE_NAME)
      --password <pw>     The password, instead of being asked for it
                          (env AGENT_OFFICE_PASSWORD)
      --no-open           With an SSH address: don't open the office in a browser
      --insecure          Accept a certificate nobody vouches for (--self-signed)
  -h, --help              Show this help

Everything after -- goes to ssh, e.g.  agent-office tunnel office@host -- -i ~/.ssh/office
`;

interface Options {
  where: string;
  /** The port the office gets on this computer, over SSH. */
  port?: number;
  officePort: number;
  credentials: Credentials;
  open: boolean;
  insecure: boolean;
  ssh: string[];
}

function parsePort(v: string, flag: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`${flag} needs a port number`);
  return n;
}

/** Reads the command line; throws what's wrong with it. Undefined for --help. */
export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): Options | undefined {
  const o: Options = { where: '', officePort: DEFAULT_PORT, credentials: { name: env.AGENT_OFFICE_NAME || undefined, password: env.AGENT_OFFICE_PASSWORD || undefined }, open: !env.AGENT_OFFICE_NO_OPEN, insecure: false, ssh: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '-h' || a === '--help') return undefined;
    else if (a === '--') {
      o.ssh = argv.slice(i + 1);
      break;
    } else if (a === '-p' || a === '--port') o.port = parsePort(value(), a);
    else if (a === '--office-port') o.officePort = parsePort(value(), a);
    else if (a === '--name') o.credentials.name = value();
    else if (a === '--password') o.credentials.password = value();
    else if (a === '--no-open') o.open = false;
    else if (a === '--insecure') o.insecure = true;
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else if (o.where) throw new Error(`one office at a time: ${o.where} or ${a}?`);
    else o.where = a;
  }
  return o;
}

/** The office's address, when `where` is one a browser could open; an SSH address isn't. */
export function officeUrl(where: string): URL | undefined {
  if (!/^https?:\/\//i.test(where)) return undefined;
  try {
    return new URL(where);
  } catch {
    throw new Error(`${where} isn't an address`);
  }
}

const say = (line = '') => console.log(line);

function describe(f: Forward): string {
  const what = f.title === f.command ? f.title : `${f.title} — ${f.command}`;
  const who = [f.worker, f.floor].filter(Boolean).join(' on ');
  return who ? `${what} (${who})` : what;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs until Ctrl-C; resolves to an exit code only when it can't go on. */
export async function tunnelCommand(argv: string[]): Promise<number> {
  let parsed: Options | undefined;
  let url: URL | undefined;
  try {
    parsed = parseArgs(argv);
    if (parsed) url = officeUrl(parsed.where || `http://localhost:${DEFAULT_PORT}`);
  } catch (err) {
    console.error(`agent-office tunnel: ${(err as Error).message} (see agent-office tunnel --help)`);
    return 2;
  }
  if (!parsed) {
    console.log(HELP);
    return 0;
  }
  const o = parsed;
  const fail = (why: string) => {
    console.error(`agent-office tunnel: ${why}`);
    return 1;
  };

  const overSsh = !url;
  const office = new Office(url ?? new URL(`http://localhost:${o.port ?? o.officePort}`), o.insecure);
  const forwarder = new Forwarder(
    office,
    {
      opened: (f) => say(`  + http://localhost:${f.port}  ${describe(f)}`),
      closed: (f) => say(`  - localhost:${f.port} closed: ${f.worker ?? 'the worker'} stopped the server`),
      busy: (f, why) =>
        say(
          why === 'denied'
            ? `  ! localhost:${f.port} can't be opened on this computer without root: ${describe(f)}`
            : `  ! localhost:${f.port} is already in use on this computer, so it isn't opened: ${describe(f)}\n    Stop what's running there and it opens by itself.`,
        ),
    },
    // The office's own port here is the office, whatever a worker runs on that port over there.
    new Set(office.local ? [office.port] : []),
  );

  let ssh: SshTunnel | undefined;
  const close = () => {
    ssh?.stop();
    forwarder.close();
    office.close();
  };
  const stop = () => {
    close();
    say('\n  closed');
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    return await run();
  } finally {
    close();
  }

  async function run(): Promise<number> {
    say(`\n  🔌 agent-office tunnel\n`);
    if (overSsh) {
      // A tunnel that's already open (this command running twice, or the one from 👥 Invite teammates) will do.
      if (await office.up()) say(`  the office is already open at ${office.origin}: using that tunnel`);
      else {
        say(`  opening the tunnel to ${o.where}…`);
        ssh = new SshTunnel(sshArgs(o.where, office.port, o.officePort, o.ssh), office, {
          dropped: () => say('  … the tunnel dropped: opening it again'),
          back: () => say('  ✓ the tunnel is open again'),
        });
        const err = await ssh.open();
        if (err) return fail(`${err}. Is localhost:${office.port} free on this computer (--port picks another), and is your SSH key invited to the office?`);
      }
    } else if (!(await office.up())) {
      return fail(`no office answers at ${office.origin}. Open the tunnel to it first, or give its SSH address: agent-office tunnel office@<address>`);
    }
    say(`  the office: ${office.origin}${overSsh ? ` (over SSH to ${o.where})` : ''}`);
    if (ssh && o.open) openBrowser(office.origin);

    const key = overSsh ? `ssh:${o.where}:${o.officePort}` : office.origin;
    try {
      const err = await signIn(office, key, o.credentials, say);
      if (err) return fail(err);
    } catch (err) {
      return fail(`couldn't sign in: ${(err as Error).message}`);
    }

    say(`\n  Every web server a worker starts opens on the same port here. Leave this running; Ctrl-C closes them all.\n`);
    let reachable = true;
    let first = true;
    for (;;) {
      const list = await office.forwards().catch(() => undefined);
      if (!list) {
        if (reachable) say("  … the office isn't answering: still trying");
        reachable = false;
      } else if (list === 'old') {
        return fail("this office is a version from before it could list its workers' servers. Upgrade it (⬆️ Upgrade the office in its ☰ menu, or the deploy script's update), then run this again.");
      } else if (list === 'signed-out') {
        forget(office, key);
        say('  … signed out of the office (the password changed, or the session ran out)');
        const err = await signIn(office, key, o.credentials, say).catch((e: Error) => e.message);
        if (err) return fail(err);
        continue;
      } else {
        if (!reachable) say('  ✓ the office is answering again');
        reachable = true;
        await forwarder.sync(list.items);
        if (first && !list.items.length) say('  No worker is running a web server yet. Ask one to start its dev server and it shows up here.');
        // Every port taken, at an office on localhost that this command didn't tunnel to itself.
        else if (first && !overSsh && office.local && !forwarder.ports().length) say("  If this office runs on this computer, there's nothing to tunnel: its workers' servers are on localhost already.");
        first = false;
      }
      await sleep(POLL_MS);
    }
  }
}
