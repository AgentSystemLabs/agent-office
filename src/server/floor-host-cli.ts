import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { FLOORHOST_PROTOCOL, isToOffice, type FromFloor, type ToOffice } from '../shared/floorhost.js';
import { HostFloors, hostParts, startHooks } from './host-floor.js';


/**
 * `agent-office floor-host` — the office's side of the socket, run on the member's machine.
 *
 * One command, one connection, outbound only. It dials the office, pairs with a code the first time
 * (or with the token it kept), and then serves whatever floors the office asks it for out of `dir`s
 * on this machine. Nothing inbound: close the laptop or kill this and the floors go offline.
 *
 *   # first time, on the member's machine
 *   agent-office floor-host --office wss://bob.ngrok.app --code 5AVK-3NFP
 *
 *   # after that
 *   agent-office floor-host --office wss://bob.ngrok.app
 *
 * Where each floor lives is *the office's* list, not this one's: it is sent in `welcome`, from the
 * `FloorDef.host` and `FloorDef.dir` the office already holds. So the office decides what runs here,
 * and this command decides only whether to answer — which is the asymmetry the design rests on.
 *
 * The token it keeps is written at 0600 in the host's own home. A machine that has never paired gets
 * its token in `welcome`, so nobody has to carry one between machines.
 */

const USAGE = `Usage: agent-office floor-host --office <url> [options]

Serve floors for an office on someone else's machine. Dials out to the office and holds the
connection; nothing here listens for anything.

  --office <url>       the office's address, e.g. wss://bob.ngrok.app or ws://localhost:4600
  --code <code>        pair for the first time, with the code from \`agent-office hosts pair\`
  --name <name>        what the office calls this machine, e.g. "Alice's laptop" (first pairing only)
  --seats <n>          how many workers this machine will seat across its floors (default 0)
  --projects <dir>     where this machine keeps its checkouts (default ~/work, env AGENT_OFFICE_PROJECTS).
                       Told to the office so it can suggest a path when pointing a floor here
  --config <path>      where to keep the token (default ~/.agent-office-floor-host.json)
  -h, --help           this

Once paired, the token is kept at 0600 and reused. The office sends the floors to serve; this machine
only has to have the checkouts they name. Revoke it with \`agent-office hosts revoke <id>\` on the
office and it is refused at the next connection.`;

interface HostConfig {
  office: string;
  token: string;
  hostId?: string;
}

function loadConfig(file: string): HostConfig | undefined {
  if (!existsSync(file)) return undefined;
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Partial<HostConfig>;
    if (typeof saved.office !== 'string' || typeof saved.token !== 'string') return undefined;
    return { office: saved.office, token: saved.token, hostId: typeof saved.hostId === 'string' ? saved.hostId : undefined };
  } catch {
    console.error(`agent-office floor-host: ${file} couldn't be read — pairing again`);
    return undefined;
  }
}

function saveConfig(file: string, cfg: HostConfig) {
  // Written whole and renamed into place would be better, but this file is one small object and the
  // only thing a torn write costs is pairing again. 0600 because it is a bearer token.
  writeFileSync(file, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

export async function floorHostCommand(argv: string[]): Promise<number> {
  let office = '';
  let code: string | undefined;
  let name: string | undefined;
  let configFile = path.join(homedir(), '.agent-office-floor-host.json');
  let seats = 0;
  // Where this machine keeps its checkouts. Reported to the office as a hint so that `hosts add-floor`
  // can suggest a path here without anyone having to know this machine's layout. Never used to open
  // anything on the office's behalf: the floor it names is still only opened if it is really there.
  let projects = process.env.AGENT_OFFICE_PROJECTS || path.join(homedir(), 'work');
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      console.log(USAGE);
      return 0;
    } else if (a === '--office') {
      if (!argv[i + 1]) return fatal('--office needs a value');
      office = argv[++i];
    } else if (a === '--code') {
      if (!argv[i + 1]) return fatal('--code needs a value');
      code = argv[++i].trim().toUpperCase();
    } else if (a === '--name') {
      if (!argv[i + 1]) return fatal('--name needs a value');
      name = argv[++i];
    } else if (a === '--seats') {
      if (!argv[i + 1]) return fatal('--seats needs a number');
      seats = Number(argv[++i]);
      if (!Number.isInteger(seats) || seats < 0) return fatal('--seats takes a whole number, 0 or more');
    } else if (a === '--config') {
      if (!argv[i + 1]) return fatal('--config needs a value');
      configFile = path.resolve(argv[++i]);
    } else if (a === '--projects') {
      if (!argv[i + 1]) return fatal('--projects needs a value');
      projects = path.resolve(argv[++i]);
    } else return fatal(`unknown option ${a}`);
  }

  const saved = loadConfig(configFile);
  if (!office) office = saved?.office ?? '';
  if (!office) return fatal('--office is needed the first time, e.g. --office wss://bob.ngrok.app');
  const token = saved?.token;
  if (!token && !code) return fatal('no token kept yet — pair first with --code, from `agent-office hosts pair` on the office');

  const url = office.replace(/^http/, 'ws').replace(/\/+$/, '') + '/floor-host';
  return connect(url, { token, code, name, configFile, seats, projects, owner: process.env.USER || process.env.USERNAME });
}

function fatal(msg: string): number {
  console.error(`agent-office floor-host: ${msg}`);
  return 1;
}

async function connect(
  url: string,
  opts: { token?: string; code?: string; name?: string; owner?: string; configFile: string; seats: number; projects: string },
): Promise<number> {
  return new Promise<number>((resolve) => {
    const ws = new WebSocket(url);
    let settled = false;
    const done = (code: number) => {
      if (settled) return;
      settled = true;
      ws.close();
      resolve(code);
    };

    // The floors this machine serves, built once the office says which ones it wants. `send` is bound
    // to the socket here rather than passed in, so a frame that arrives before the connection is ready
    // is dropped rather than queued against a socket that does not exist yet.
    let host: HostFloors | undefined;
    let stopHooks: (() => void) | undefined;
    const send = (msg: FromFloor) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };

    ws.on('open', () => {
      console.log(`floor-host: connected to ${url}`);
      send({
        t: 'hello',
        hostId: '',
        protocol: FLOORHOST_PROTOCOL,
        token: opts.token,
        code: opts.code,
        name: opts.name,
        owner: opts.owner,
        projectsDir: opts.projects,
      });
    });

    ws.on('message', (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!isToOffice(msg)) return;

      if (msg.t === 'welcome') {
        if (msg.token) {
          saveConfig(opts.configFile, { office: url.replace(/\/floor-host$/, ''), token: msg.token, hostId: msg.hostId });
          console.log(`floor-host: paired. Token kept in ${opts.configFile} (0600).`);
        }
        console.log(`floor-host: the office asks for ${msg.floors.length} floor(s) on this machine`);
        serve(msg.floors).catch((err: Error) => {
          // An unhandled rejection here would leave the machine connected and serving nothing, which
          // looks exactly like working. Say what broke and stop.
          console.error(`floor-host: couldn't open the floors — ${err.message}`);
          done(1);
        });
        return;
      }
      if (msg.t === 'bye') {
        if (msg.why) {
          console.error(`floor-host: the office refused this machine — ${msg.why}`);
          return done(1);
        }
        console.log('floor-host: the office is shutting down');
        return done(0);
      }
      // Everything else is the office asking this machine to do something on a floor it is serving.
      if (host) {
        void host.call(msg);
        return;
      }
      // A call that arrives while the floors are still opening. Answering it is the whole point:
      // dropping it leaves the office waiting out its twenty-second timeout for a reply that is never
      // coming, which reads to whoever asked as a machine that has hung.
      if ('floorId' in msg && typeof msg.floorId === 'string' && 'seq' in msg && typeof msg.seq === 'number') {
        send({ t: 'refused', floorId: msg.floorId, reason: `still opening its floors on this machine`, seq: msg.seq });
      }
    });

    /** Opens the floors the office wants, with a hook endpoint this machine's workers report to. */
    async function serve(wanted: { id: string; dir: string; name: string }[]) {
      const dataDir = hostDataDir(opts.configFile);
      mkdirSync(dataDir, { recursive: true, mode: 0o700 });
      const settings = {
        dataDir,
        agentCmd: process.env.AGENT_OFFICE_AGENT || 'claude',
        agentArgs: [],
        dshProfile: process.env.AGENT_OFFICE_DSH_PROFILE || 'acp',
      };
      // The hook listener first: `launch` puts its URL in a worker's environment, so it must exist
      // before any worker starts. It looks workers up through this closure, which is why it can start
      // before the floors are open. Loopback only, and nothing is forwarded (see startHooks).
      const hooks = await startHooks((workerId) => host?.floorOf(workerId)?.workers);
      stopHooks = hooks.close;

      const present = wanted.filter((w) => existsSync(w.dir));
      for (const missing of wanted.filter((w) => !existsSync(w.dir))) {
        console.error(`floor-host: ${missing.name}: no checkout at ${missing.dir} on this machine — skipping`);
      }
      if (!present.length) {
        console.error('floor-host: nothing to serve — no floor the office asked for has a checkout here');
        return done(1);
      }
      host = new HostFloors(hostParts(settings, send, hooks.url, opts.seats));
      // Told to the office in every `ready`, so `agent-office hosts add-floor` on the office can
      // suggest `<this>/owner/repo` for a floor it is about to point at this machine.
      host.projectsDir = opts.projects;
      await host.open(present);
    }

    ws.on('close', () => {
      if (!settled) {
        console.error('floor-host: the office closed the connection');
        done(1);
      }
      stopHooks?.();
      host?.shutdown();
    });
    ws.on('error', (err) => {
      console.error(`floor-host: ${(err as Error).message}`);
      done(1);
    });

    process.on('SIGINT', () => {
      console.log('\nfloor-host: closing. The floors here go offline at the office.');
      stopHooks?.();
      host?.shutdown();
      done(0);
    });
  });
}

/** Where a host keeps its own data: its token, its floors' scrollback, and this machine's ledger. */
function hostDataDir(configFile: string): string {
  return path.join(path.dirname(configFile), '.agent-office-floor-host');
}
