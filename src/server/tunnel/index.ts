import { openBrowser } from '../browser.js';
import { Forwarder } from './forwarder.js';
import { Office } from './office.js';
import { forget, signIn, type Credentials } from './session.js';
import { SshTunnel, sshArgs } from './ssh.js';
import type { Forward } from './wire.js';
import { L } from '../i18n.js';

// `agent-office tunnel`, run on your own computer: every web server a worker starts in an office
// somewhere else opens on the same port here, by itself, and closes when the worker stops it. It
// asks the office which servers there are every couple of seconds (wire.ts), and listens on each
// one's port (forwarder.ts). Given an SSH address it opens the tunnel to the office too (ssh.ts).

const DEFAULT_PORT = 4600;
/** How often the office is asked which servers the workers run. It looks itself every 4 seconds. */
const POLL_MS = 2000;


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
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(L.tunnel.needsPort(flag));
  return n;
}

/** Reads the command line; throws what's wrong with it. Undefined for --help. */
export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): Options | undefined {
  const o: Options = { where: '', officePort: DEFAULT_PORT, credentials: { name: env.AGENT_OFFICE_NAME || undefined, password: env.AGENT_OFFICE_PASSWORD || undefined }, open: !env.AGENT_OFFICE_NO_OPEN, insecure: false, ssh: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(L.tunnel.needsValue(a));
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
    else if (a.startsWith('-')) throw new Error(L.tunnel.unknownOption(a));
    else if (o.where) throw new Error(L.tunnel.oneOffice(o.where, a));
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
    throw new Error(L.tunnel.notAddress(where));
  }
}

const say = (line = '') => console.log(line);

function describe(f: Forward): string {
  const what = f.title === f.command ? f.title : `${f.title} — ${f.command}`;
  const who = [f.worker, f.floor].filter(Boolean).join(` ${L.tunnel.on} `);
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
    console.error(`agent-office tunnel: ${(err as Error).message} (${L.tunnel.seeHelp})`);
    return 2;
  }
  if (!parsed) {
    console.log(L.tunnel.help(DEFAULT_PORT));
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
      closed: (f) => say(L.tunnel.closed(f.port, f.worker ?? L.tunnel.theWorker)),
      busy: (f, why) =>
        say(
          why === 'denied' ? L.tunnel.needsRoot(f.port, describe(f)) : L.tunnel.inUse(f.port, describe(f)),
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
    say(`\n  ${L.tunnel.closedAll}`);
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
      if (await office.up()) say(L.tunnel.alreadyOpen(office.origin));
      else {
        say(L.tunnel.opening(o.where));
        ssh = new SshTunnel(sshArgs(o.where, office.port, o.officePort, o.ssh), office, {
          dropped: () => say(L.tunnel.dropped),
          back: () => say(L.tunnel.back),
        });
        const err = await ssh.open();
        if (err) return fail(L.tunnel.sshFailed(err, office.port));
      }
    } else if (!(await office.up())) {
      return fail(L.tunnel.noOffice(office.origin));
    }
    say(L.tunnel.theOffice(office.origin, overSsh ? o.where : ''));
    if (ssh && o.open) openBrowser(office.origin);

    const key = overSsh ? `ssh:${o.where}:${o.officePort}` : office.origin;
    try {
      const err = await signIn(office, key, o.credentials, say);
      if (err) return fail(err);
    } catch (err) {
      return fail(L.tunnel.signInFailed((err as Error).message));
    }

    say(L.tunnel.running);
    let reachable = true;
    let first = true;
    for (;;) {
      const list = await office.forwards().catch(() => undefined);
      if (!list) {
        if (reachable) say(L.tunnel.notAnswering);
        reachable = false;
      } else if (list === 'old') {
        return fail(L.tunnel.old);
      } else if (list === 'signed-out') {
        forget(office, key);
        say(L.tunnel.signedOut);
        const err = await signIn(office, key, o.credentials, say).catch((e: Error) => e.message);
        if (err) return fail(err);
        continue;
      } else {
        if (!reachable) say(L.tunnel.answering);
        reachable = true;
        await forwarder.sync(list.items);
        if (first && !list.items.length) say(L.tunnel.noServers);
        // Every port taken, at an office on localhost that this command didn't tunnel to itself.
        else if (first && !overSsh && office.local && !forwarder.ports().length) say(L.tunnel.local);
        first = false;
      }
      await sleep(POLL_MS);
    }
  }
}
