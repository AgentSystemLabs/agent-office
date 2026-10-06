/**
 * The workers' terminal host: owns every worker's PTY so a restarting office doesn't take Claude
 * down with it. The office starts it detached (see ptys.ts) and talks to it over a Unix socket
 * that only its own token opens. It keeps a headless copy of each screen, so the next office
 * gets the scrollback back, and ends everything once no office has come back for a while.
 *
 *   node ptyhost.js <socket> <info.json>
 */
import { readFileSync, unlinkSync } from 'node:fs';
import net from 'node:net';
import * as pty from '@lydell/node-pty';
import headless from '@xterm/headless';
import serialize from '@xterm/addon-serialize';
import { PTY_PROTOCOL, SCROLLBACK, readMessages, type FromHost, type SpawnOpts, type ToHost } from './ptys.js';
import { screenSnapshot, withoutFullScreen } from './screen.js';
import { safeEq } from './secrets.js';

/** How long terminals keep running with no office connected before the host gives up on it. */
const ORPHAN_MS = 30 * 60_000;
/** A host nobody connects to at all has nothing to do. */
const UNCLAIMED_MS = 30_000;

interface Session {
  id: string;
  proc: pty.IPty;
  term: InstanceType<typeof headless.Terminal>;
  snapshot: () => string;
  cols: number;
  rows: number;
  busy: boolean;
  title: string;
  /** The connected office knows this one: its output goes there. */
  attached: boolean;
  /** Output held back while an attach snapshot is being taken. */
  held?: string[];
  exitCode?: number;
}

const [socketPath, infoPath] = process.argv.slice(2);
const token: string = JSON.parse(readFileSync(infoPath, 'utf8')).token;
const sessions = new Map<string, Session>();
let office: net.Socket | null = null;
let stopping = false;
let idleTimer: NodeJS.Timeout | undefined;

process.title = 'agent-office-ptys';
// One bad message must never take down every worker's terminal.
process.on('uncaughtException', (err) => console.error('pty host:', err));

function send(msg: FromHost) {
  if (office && !office.destroyed) office.write(`${JSON.stringify(msg)}\n`);
}

function live(): number {
  let n = 0;
  for (const s of sessions.values()) if (s.exitCode === undefined) n++;
  return n;
}

function drop(s: Session) {
  sessions.delete(s.id);
  s.term.dispose();
}

/** No office connected: wait for one to come back, but not forever. */
function orphaned() {
  clearTimeout(idleTimer);
  if (!live()) process.exit(0);
  idleTimer = setTimeout(stopAll, ORPHAN_MS);
}

function stopAll() {
  stopping = true;
  server.close();
  let n = 0;
  for (const s of sessions.values()) {
    if (s.exitCode !== undefined) continue;
    n++;
    try {
      s.proc.kill();
    } catch {
      // already gone
    }
  }
  if (!n) process.exit(0);
  setTimeout(() => process.exit(0), 3000);
}

function spawn(id: string, opts: SpawnOpts) {
  let proc: pty.IPty;
  try {
    proc = pty.spawn(opts.file, opts.args, { name: 'xterm-256color', cols: opts.cols, rows: opts.rows, cwd: opts.cwd, env: opts.env });
  } catch (err) {
    send({ t: 'exit', id, exitCode: -1, error: (err as Error).message });
    return;
  }
  const term = new headless.Terminal({ cols: opts.cols, rows: opts.rows, scrollback: SCROLLBACK, allowProposedApi: true });
  const ser = new serialize.SerializeAddon();
  term.loadAddon(ser as any);
  const snapshot = screenSnapshot(term, ser);
  if (opts.prelude) term.write(opts.prelude);
  const s: Session = { id, proc, term, snapshot, cols: opts.cols, rows: opts.rows, busy: false, title: '', attached: true };
  sessions.set(id, s);
  term.parser.registerOscHandler(9, (data: string) => {
    const m = /^4;(\d)/.exec(data);
    if (m) s.busy = m[1] !== '0';
    return true;
  });
  term.onTitleChange((title: string) => (s.title = title));
  proc.onData((data) => {
    // The host keeps a terminal of its own for the office to pick up, so it needs the same scrollback
    // a full-screen agent's output would otherwise throw away (see withoutFullScreen). What goes to
    // the office is what the worker really printed: it forwards that to viewers.
    term.write(withoutFullScreen(data, opts.rows));
    if (!s.attached) return;
    if (s.held) s.held.push(data);
    else send({ t: 'data', id, data });
  });
  proc.onExit(({ exitCode }) => {
    s.exitCode = exitCode;
    if (s.attached && !s.held) {
      send({ t: 'exit', id, exitCode });
      drop(s);
    }
    if (stopping ? !live() : !office && !live()) process.exit(0);
  });
  send({ t: 'spawned', id, pid: proc.pid });
}

/** Hands a running terminal to the office: a snapshot of it so far, then its output as it comes. */
function attach(id: string) {
  const s = sessions.get(id);
  if (!s || s.exitCode !== undefined) {
    if (s) drop(s);
    send({ t: 'gone', id });
    return;
  }
  const to = office;
  s.attached = true;
  s.held = [];
  // Written output is parsed asynchronously; the callback runs once everything so far is on screen.
  s.term.write('', () => {
    const held = s.held ?? [];
    s.held = undefined;
    if (office !== to) return;
    const snapshot = s.snapshot();
    send({ t: 'attached', id, pid: s.proc.pid, cols: s.cols, rows: s.rows, busy: s.busy, title: s.title, snapshot });
    for (const data of held) send({ t: 'data', id, data });
    if (s.exitCode !== undefined) {
      send({ t: 'exit', id, exitCode: s.exitCode });
      drop(s);
    }
  });
}

function onMessage(msg: ToHost) {
  switch (msg.t) {
    case 'spawn':
      if (!stopping && !sessions.has(msg.id)) spawn(msg.id, msg.opts);
      break;
    case 'attach':
      attach(msg.id);
      break;
    case 'write':
      sessions.get(msg.id)?.proc.write(msg.data);
      break;
    case 'resize': {
      const s = sessions.get(msg.id);
      if (!s || s.exitCode !== undefined) break;
      try {
        s.proc.resize(msg.cols, msg.rows);
        s.term.resize(msg.cols, msg.rows);
        s.cols = msg.cols;
        s.rows = msg.rows;
      } catch {
        // exited between checks
      }
      break;
    }
    case 'kill': {
      const s = sessions.get(msg.id);
      if (!s) break;
      if (s.exitCode !== undefined) drop(s);
      else {
        try {
          s.proc.kill();
        } catch {
          // already gone
        }
      }
      break;
    }
    case 'stop':
      stopAll();
      break;
  }
}

const server = net.createServer((sock) => {
  let authed = false;
  sock.on('error', () => {});
  readMessages(sock, (msg: ToHost) => {
    if (authed) {
      if (office === sock) onMessage(msg);
      return;
    }
    if (msg.t !== 'hello' || !safeEq(String(msg.token ?? ''), token)) {
      sock.destroy();
      return;
    }
    authed = true;
    // The newest office wins; an older connection still open is a restart that hasn't finished dying.
    if (office && office !== sock) office.destroy();
    office = sock;
    clearTimeout(idleTimer);
    for (const s of sessions.values()) {
      s.attached = false;
      s.held = undefined;
    }
    send({ t: 'ready', version: PTY_PROTOCOL, sessions: [...sessions.keys()] });
  });
  sock.on('close', () => {
    if (office !== sock) return;
    office = null;
    for (const s of sessions.values()) s.attached = false;
    if (!stopping) orphaned();
  });
});

// Another host already answering on this socket serves this office; leave it be.
const taken = await new Promise<boolean>((resolve) => {
  const probe = net.createConnection(socketPath);
  probe.on('connect', () => {
    probe.destroy();
    resolve(true);
  });
  probe.on('error', () => resolve(false));
});
if (taken) process.exit(0);
try {
  unlinkSync(socketPath); // left behind by a host that died
} catch {
  // none
}
process.umask(0o077); // the socket is created owner-only
server.listen(socketPath);
idleTimer = setTimeout(() => {
  if (!office && !live()) process.exit(0);
}, UNCLAIMED_MS);
