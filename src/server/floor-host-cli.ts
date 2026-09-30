import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { FLOORHOST_PROTOCOL, isToOffice, type FromFloor, type ToOffice } from '../shared/floorhost.js';
import type { ServerMsg, WorkerInfo } from '../shared/protocol.js';

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

/**
 * One floor this machine is serving.
 *
 * A real `Floor` runs here — the same class the office runs for its own — with a context that sends
 * upward over the socket instead of delivering locally. That is the whole design: the floor is whole,
 * and only the room it reports into is elsewhere.
 */
interface ServedFloor {
  id: string;
  dir: string;
  name: string;
  /** The workers on this floor, by id, so `ready` can name them. */
  workers: Map<string, WorkerInfo>;
}

export async function floorHostCommand(argv: string[]): Promise<number> {
  let office = '';
  let code: string | undefined;
  let name: string | undefined;
  let configFile = path.join(homedir(), '.agent-office-floor-host.json');
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
    } else if (a === '--config') {
      if (!argv[i + 1]) return fatal('--config needs a value');
      configFile = path.resolve(argv[++i]);
    } else return fatal(`unknown option ${a}`);
  }

  const saved = loadConfig(configFile);
  if (!office) office = saved?.office ?? '';
  if (!office) return fatal('--office is needed the first time, e.g. --office wss://bob.ngrok.app');
  const token = saved?.token;
  if (!token && !code) return fatal('no token kept yet — pair first with --code, from `agent-office hosts pair` on the office');

  const url = office.replace(/^http/, 'ws').replace(/\/+$/, '') + '/floor-host';
  return connect(url, { token, code, name, configFile, owner: process.env.USER || process.env.USERNAME });
}

function fatal(msg: string): number {
  console.error(`agent-office floor-host: ${msg}`);
  return 1;
}

async function connect(
  url: string,
  opts: { token?: string; code?: string; name?: string; owner?: string; configFile: string },
): Promise<number> {
  const served = new Map<string, ServedFloor>();
  return new Promise<number>((resolve) => {
    const ws = new WebSocket(url);
    /** Set once so a reconnect refusals does not loop forever on a dead token. */
    let settled = false;
    const done = (code: number) => {
      if (settled) return;
      settled = true;
      ws.close();
      resolve(code);
    };

    ws.on('open', () => {
      console.log(`floor-host: connected to ${url}`);
      ws.send(
        JSON.stringify({
          t: 'hello',
          hostId: '',
          protocol: FLOORHOST_PROTOCOL,
          token: opts.token,
          code: opts.code,
          name: opts.name,
          owner: opts.owner,
        } satisfies FromFloor),
      );
    });

    ws.on('message', (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      // The office's frames are ToOffice; this machine's are FromFloor. A refusal before any floor is
      // involved means the pairing or the token failed, which is settled rather than refused here.
      if (!isToOffice(msg)) return;
      if (msg.t === 'welcome') {
        if (msg.token) {
          saveConfig(opts.configFile, { office: url.replace(/\/floor-host$/, ''), token: msg.token, hostId: msg.hostId });
          console.log(`floor-host: paired. Token kept in ${opts.configFile} (0600).`);
        }
        console.log(`floor-host: the office asks for ${msg.floors.length} floor(s) on this machine`);
        for (const want of msg.floors) {
          if (served.has(want.id)) continue;
          if (!existsSync(want.dir)) {
            console.error(`floor-host: ${want.name}: no checkout at ${want.dir} on this machine — skipping`);
            continue;
          }
          served.set(want.id, { id: want.id, dir: want.dir, name: want.name, workers: new Map() });
          announce(ws, served.get(want.id)!);
        }
        if (!served.size) {
          console.error('floor-host: nothing to serve — no floor the office asked for has a checkout here');
          return done(1);
        }
        return;
      }
      if (msg.t === 'bye') {
        // A bye with a reason is the office turning this machine away; without one, it is shutting
        // down. Either way there is nothing to reconnect to, so say which and stop.
        if (msg.why) {
          console.error(`floor-host: the office refused this machine — ${msg.why}`);
          return done(1);
        }
        console.log('floor-host: the office is shutting down');
        return done(0);
      }
      // Everything else is the office asking this machine to do something on a floor. Serving those is
      // running the real thing: the floor's own WorkerManager, queue, forge and changes, on this disk.
      void handleCall(ws, served, msg);
    });

    ws.on('close', () => {
      if (!settled) {
        console.error('floor-host: the office closed the connection');
        done(1);
      }
    });
    ws.on('error', (err) => {
      console.error(`floor-host: ${(err as Error).message}`);
      done(1);
    });

    process.on('SIGINT', () => {
      console.log('\nfloor-host: closing. The floors here go offline at the office.');
      done(0);
    });
  });
}

/** Tells the office this floor is up, with its seats and the workers already on it. */
function announce(ws: WebSocket, floor: ServedFloor) {
  ws.send(
    JSON.stringify({
      t: 'ready',
      floor: {
        floorId: floor.id,
        name: floor.name,
        seats: 4,
        accepting: false,
        forge: 'github',
        workers: [...floor.workers.values()].map((w) => ({ id: w.id, status: w.status, deskId: w.deskId })),
      },
    } satisfies FromFloor),
  );
  console.log(`floor-host: serving "${floor.name}" from ${floor.dir}`);
}

/**
 * Runs one of the office's calls against this machine.
 *
 * The full version drives a real `Floor` here — its own `WorkerManager`, `TaskQueue`, `Forge` and
 * `Changes`, on this disk — and that is what the next commit does. Until then a call is answered as a
 * refusal naming the machine, so the office always gets an answer rather than waiting out a timeout.
 * Answering honestly and doing nothing is better than appearing to work.
 */
async function handleCall(ws: WebSocket, served: Map<string, ServedFloor>, msg: ToOffice) {
  if (!('floorId' in msg) || typeof msg.floorId !== 'string') return;
  const floor = served.get(msg.floorId);
  if (!floor) return;
  const seq = 'seq' in msg && typeof msg.seq === 'number' ? msg.seq : undefined;
  if (seq === undefined) return;
  ws.send(
    JSON.stringify({
      t: 'refused',
      floorId: msg.floorId,
      reason: 'this machine is not running floors yet',
      seq,
    } satisfies FromFloor),
  );
  void floor;
}
