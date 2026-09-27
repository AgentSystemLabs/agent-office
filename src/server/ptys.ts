import { createHash, randomBytes } from 'node:crypto';
import { spawn as spawnProcess } from 'node:child_process';
import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pty from '@lydell/node-pty';

/**
 * Workers' terminals live in a small host process of their own (ptyhost.ts), not in the office.
 * When the office restarts (a dev-server reload, a self-upgrade), Claude keeps working in the host,
 * and the new office picks every terminal back up where it was. Without a host, terminals run
 * in-process as before and die with the office.
 */

/** Bump whenever the host's messages change: an office that finds an older host stops it and starts its own. */
export const PTY_PROTOCOL = 1;
export const SCROLLBACK = 3000;

export interface SpawnOpts {
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
  /** Output from before this process (a restored scrollback), for the host's copy of the screen. */
  prelude?: string;
}

export interface PtyExit {
  exitCode: number;
  /** It never started. */
  error?: string;
  /** The host went away under it; the process is gone. */
  lost?: boolean;
}

/** A worker's terminal process, wherever it runs. */
export interface Pty {
  /** Its session in the host, which outlives the office. None: it dies with the office. */
  readonly id?: string;
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: PtyExit) => void): void;
}

/** A terminal the host was still running when the office came back. */
export interface Adopted {
  pty: Pty;
  cols: number;
  rows: number;
  /** Claude's last OSC 9;4 progress report. */
  busy: boolean;
  title: string;
  /** Scrollback and screen, to replay into a fresh terminal. */
  snapshot: string;
}

export type ToHost =
  | { t: 'hello'; token: string }
  | { t: 'spawn'; id: string; opts: SpawnOpts }
  | { t: 'attach'; id: string }
  | { t: 'write'; id: string; data: string }
  | { t: 'resize'; id: string; cols: number; rows: number }
  | { t: 'kill'; id: string }
  | { t: 'stop' };

export type FromHost =
  | { t: 'ready'; version: number; sessions: string[] }
  | { t: 'spawned'; id: string; pid: number }
  | ({ t: 'attached'; id: string; pid: number } & Omit<Adopted, 'pty'>)
  | { t: 'gone'; id: string }
  | { t: 'data'; id: string; data: string }
  | { t: 'exit'; id: string; exitCode: number; error?: string };

/** Calls `onMsg` with each newline-delimited JSON message on the socket. */
export function readMessages(sock: net.Socket, onMsg: (msg: any) => void) {
  sock.setEncoding('utf8');
  let buf = '';
  sock.on('data', (chunk: string) => {
    buf += chunk;
    let start = 0;
    let nl: number;
    while ((nl = buf.indexOf('\n', start)) >= 0) {
      const line = buf.slice(start, nl);
      start = nl + 1;
      if (!line) continue;
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      onMsg(msg);
    }
    buf = buf.slice(start);
  });
}

class RemotePty implements Pty {
  pid = 0;
  private dataCbs: ((data: string) => void)[] = [];
  private exitCbs: ((e: PtyExit) => void)[] = [];
  /** Output that came in before anyone listened (between an attach and the worker wiring up). */
  private held: string[] = [];
  private exited?: PtyExit;

  constructor(
    readonly id: string,
    private send: (msg: ToHost) => void,
  ) {}

  write(data: string) {
    this.send({ t: 'write', id: this.id, data });
  }

  resize(cols: number, rows: number) {
    this.send({ t: 'resize', id: this.id, cols, rows });
  }

  kill() {
    this.send({ t: 'kill', id: this.id });
  }

  onData(cb: (data: string) => void) {
    this.dataCbs.push(cb);
    for (const d of this.held.splice(0)) cb(d);
  }

  onExit(cb: (e: PtyExit) => void) {
    this.exitCbs.push(cb);
    if (this.exited) cb(this.exited);
  }

  emitData(data: string) {
    if (!this.dataCbs.length) this.held.push(data);
    for (const cb of this.dataCbs) cb(data);
  }

  emitExit(e: PtyExit) {
    this.exited = e;
    for (const cb of this.exitCbs) cb(e);
  }
}

export class PtyHost {
  private sock: net.Socket | null = null;
  private ptys = new Map<string, RemotePty>();
  private attaching = new Map<string, (msg: FromHost | undefined) => void>();
  /** Sessions the host already had when the office connected, not yet claimed by a worker. */
  private unclaimed = new Set<string>();
  /** Leaving on purpose: the connection closing is not the host dying. */
  private leaving = false;
  private socketPath: string;
  private infoPath: string;

  constructor(
    private dataDir: string,
    private onLost: () => void,
  ) {
    this.infoPath = path.join(dataDir, 'pty-host.json');
    // Unix socket paths are capped at ~104 bytes; a deep project falls back to the temp dir.
    const inData = path.join(dataDir, 'pty.sock');
    const hash = createHash('sha256').update(dataDir).digest('hex').slice(0, 16);
    this.socketPath = Buffer.byteLength(inData) < 100 ? inData : path.join(os.tmpdir(), `agent-office-${hash}.sock`);
  }

  get hosted(): boolean {
    return this.sock !== null;
  }

  /**
   * Finds the host this office left running, or starts one. Resolves to false when there is no
   * host to be had: terminals then run in-process.
   */
  async connect(): Promise<boolean> {
    if (process.platform === 'win32') return false;
    try {
      let found = await this.hello();
      if (found && found.version !== PTY_PROTOCOL) {
        // A host from an older build: its terminals go (workers resume their conversations).
        await new Promise<void>((resolve) => {
          found!.sock.once('close', () => resolve());
          found!.sock.end(frame({ t: 'stop' }));
          setTimeout(resolve, 5000);
        });
        found = undefined;
      }
      if (!found) {
        this.startHost();
        const deadline = Date.now() + 10_000;
        while (!found && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 100));
          found = await this.hello();
        }
      }
      if (!found) return false;
      const { sock, sessions } = found;
      this.sock = sock;
      this.unclaimed = new Set(sessions);
      readMessages(sock, (msg) => this.onMessage(msg as FromHost));
      sock.on('close', () => this.onClose(sock));
      return true;
    } catch {
      return false;
    }
  }

  /** A new terminal: in the host when there is one, else in-process. Throws if it can't start. */
  spawn(opts: SpawnOpts): Pty {
    if (!this.sock) return pty.spawn(opts.file, opts.args, { name: 'xterm-256color', cols: opts.cols, rows: opts.rows, cwd: opts.cwd, env: opts.env });
    const id = randomBytes(8).toString('hex');
    const p = new RemotePty(id, (m) => this.send(m));
    this.ptys.set(id, p);
    this.send({ t: 'spawn', id, opts });
    return p;
  }

  /** Picks up a terminal from before the restart. Undefined if the host no longer has it running. */
  async attach(id: string): Promise<Adopted | undefined> {
    if (!this.sock || !this.unclaimed.delete(id)) return undefined;
    const p = new RemotePty(id, (m) => this.send(m));
    this.ptys.set(id, p);
    const msg = await new Promise<FromHost | undefined>((resolve) => {
      // The office waits on this before it opens its doors: never for long.
      const timer = setTimeout(() => {
        this.attaching.delete(id);
        resolve(undefined);
      }, 5000);
      this.attaching.set(id, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
      this.send({ t: 'attach', id });
    });
    if (msg?.t !== 'attached') {
      this.ptys.delete(id);
      // Its worker resumes the conversation afresh; the old process mustn't carry on beside it.
      this.send({ t: 'kill', id });
      return undefined;
    }
    p.pid = msg.pid;
    return { pty: p, cols: msg.cols, rows: msg.rows, busy: msg.busy, title: msg.title, snapshot: msg.snapshot };
  }

  /** Ends the host's terminals that no worker claimed (their worker was sent home meanwhile). */
  killUnclaimed() {
    for (const id of this.unclaimed) this.send({ t: 'kill', id });
    this.unclaimed.clear();
  }

  /** The office is restarting: leave every terminal running in the host for the next one. */
  detach() {
    this.leaving = true;
    this.sock?.end();
  }

  /** The office is closing for good: the host ends every terminal and exits. */
  stop() {
    this.leaving = true;
    this.sock?.end(frame({ t: 'stop' }));
  }

  private send(msg: ToHost) {
    if (this.sock && !this.sock.destroyed) this.sock.write(frame(msg));
  }

  private onMessage(msg: FromHost) {
    switch (msg.t) {
      case 'spawned': {
        const p = this.ptys.get(msg.id);
        if (p) p.pid = msg.pid;
        break;
      }
      case 'attached':
      case 'gone':
        this.attaching.get(msg.id)?.(msg);
        this.attaching.delete(msg.id);
        break;
      case 'data':
        this.ptys.get(msg.id)?.emitData(msg.data);
        break;
      case 'exit': {
        const p = this.ptys.get(msg.id);
        this.ptys.delete(msg.id);
        p?.emitExit({ exitCode: msg.exitCode, error: msg.error });
        break;
      }
    }
  }

  private onClose(sock: net.Socket) {
    if (this.sock !== sock) return;
    this.sock = null;
    for (const resolve of this.attaching.values()) resolve(undefined);
    this.attaching.clear();
    if (this.leaving) return;
    // The host died (killed, crashed). From here on terminals run in-process.
    const lost = [...this.ptys.values()];
    this.ptys.clear();
    this.onLost();
    for (const p of lost) p.emitExit({ exitCode: -1, lost: true });
  }

  /** Connects and says hello with the saved token. Undefined if no host answers. */
  private hello(): Promise<{ sock: net.Socket; version: number; sessions: string[] } | undefined> {
    let token: string;
    try {
      token = JSON.parse(readFileSync(this.infoPath, 'utf8')).token;
    } catch {
      return Promise.resolve(undefined);
    }
    return new Promise((resolve) => {
      const sock = net.createConnection(this.socketPath);
      let settled = false;
      const done = (v?: { sock: net.Socket; version: number; sessions: string[] }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        sock.removeAllListeners('data');
        if (!v) sock.destroy();
        resolve(v);
      };
      const timer = setTimeout(() => done(), 3000);
      sock.on('error', () => done());
      sock.on('close', () => done());
      sock.on('connect', () => sock.write(frame({ t: 'hello', token })));
      readMessages(sock, (msg: FromHost) => {
        if (msg.t === 'ready') done({ sock, version: msg.version, sessions: Array.isArray(msg.sessions) ? msg.sessions : [] });
      });
    });
  }

  /** Starts a host, detached so that it outlives this process and never sees its Ctrl+C. */
  private startHost() {
    writeFileSync(this.infoPath, JSON.stringify({ token: randomBytes(24).toString('hex') }), { mode: 0o600 });
    const here = fileURLToPath(import.meta.url);
    // Under tsx this is ptyhost.ts, run with the same loader flags; built, it's ptyhost.js.
    const script = path.join(path.dirname(here), `ptyhost${path.extname(here)}`);
    const flags = process.execArgv.filter((a) => !/^--(inspect|debug)/.test(a));
    const log = openSync(path.join(this.dataDir, 'pty-host.log'), 'w', 0o600);
    try {
      const child = spawnProcess(process.execPath, [...flags, script, this.socketPath, this.infoPath], {
        detached: true,
        stdio: ['ignore', 'ignore', log],
        // Where the office's own code is, so a loader flag (`--import tsx`) resolves from its
        // node_modules and not from whichever project this floor is.
        cwd: path.dirname(here),
      });
      child.unref();
    } finally {
      closeSync(log);
    }
  }
}

function frame(msg: ToHost): string {
  return `${JSON.stringify(msg)}\n`;
}
