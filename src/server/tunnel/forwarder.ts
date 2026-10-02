import http from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import type { Office } from './office.js';
import { LOOPBACK_NAME, SERVICE_HEADER, type Forward } from './wire.js';

// The listening half of `agent-office tunnel`: for every web server a worker runs, the same port
// on this computer. What arrives there goes to the office with this client's session and the port
// it's for, and the office relays it to the worker's server (relay.ts), WebSockets included. So
// http://localhost:5173 here is the worker's localhost:5173, for a browser, curl or anything else.

/** Both of this computer's own addresses, as `ssh -L` listens on: a browser may try either for "localhost". */
const ADDRESSES = ['127.0.0.1', '::1'];

/**
 * How long a port stays open once its server is off the office's list. A dev server restarting, or
 * the office missing it for one look on a busy machine, isn't the worker stopping it; meanwhile the
 * office answers for it with its "not running" page.
 */
const LINGER_MS = 10_000;

/** What the client says as ports open and close. */
export interface ForwardEvents {
  /** localhost:<port> now reaches the worker's server. */
  opened(f: Forward): void;
  /** The worker's server stopped, and so did localhost:<port>. */
  closed(f: Forward): void;
  /** The port can't be opened here: something on this computer has it, or it's one only root may open. It's tried again on every sync. */
  busy(f: Forward, why: 'taken' | 'denied'): void;
}

interface Open {
  forward: Forward;
  servers: http.Server[];
  /** When the office's list stopped having it, while it doesn't. */
  goneAt?: number;
}

/** Whether something on this computer answers on the port, on either address. */
async function taken(port: number): Promise<boolean> {
  const answers = (host: string) =>
    new Promise<boolean>((resolve) => {
      const s = net.connect(port, host);
      s.setTimeout(1000, () => s.destroy());
      s.on('connect', () => (s.destroy(), resolve(true)));
      s.on('error', () => resolve(false));
      s.on('close', () => resolve(false));
    });
  return (await Promise.all(ADDRESSES.map(answers))).some(Boolean);
}

function listen(server: http.Server, port: number, host: string): Promise<NodeJS.ErrnoException | undefined> {
  return new Promise((resolve) => {
    server.once('error', resolve);
    server.listen(port, host, () => {
      server.off('error', resolve);
      resolve(undefined);
    });
  });
}

function refuse(res: http.ServerResponse, status: number, text: string) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`${text}\n`);
}

export class Forwarder {
  private open = new Map<number, Open>();
  /** Ports that can't be opened on this computer, already said so. */
  private busy = new Set<number>();
  private closed = false;

  constructor(
    private office: Office,
    private events: ForwardEvents,
    /** Ports never to listen on: the one the office itself is reached on. */
    private skip: ReadonlySet<number> = new Set(),
    private linger = LINGER_MS,
  ) {}

  /** The ports open right now. */
  ports(): number[] {
    return [...this.open.keys()].sort((a, b) => a - b);
  }

  /** Listens on exactly these servers' ports: opens the new ones, closes the ones that stopped a while ago. */
  async sync(items: Forward[], now = Date.now()) {
    const wanted = new Map(items.filter((f) => !this.skip.has(f.port)).map((f) => [f.port, f]));
    for (const [port, o] of this.open) {
      if (wanted.has(port)) {
        o.goneAt = undefined;
        continue;
      }
      o.goneAt ??= now;
      if (now - o.goneAt < this.linger) continue;
      this.shut(o);
      this.open.delete(port);
      this.events.closed(o.forward);
    }
    for (const port of this.busy) if (!wanted.has(port)) this.busy.delete(port);
    for (const [port, forward] of wanted) {
      const cur = this.open.get(port);
      if (cur) {
        cur.forward = forward;
        continue;
      }
      const servers = await this.listen(port);
      if (typeof servers === 'string') {
        if (!this.busy.has(port)) this.events.busy(forward, servers);
        this.busy.add(port);
        continue;
      }
      if (this.closed) {
        for (const s of servers) s.close();
        return;
      }
      this.busy.delete(port);
      this.open.set(port, { forward, servers });
      this.events.opened(forward);
    }
  }

  close() {
    this.closed = true;
    for (const o of this.open.values()) this.shut(o);
    this.open.clear();
  }

  private shut(o: Open) {
    for (const s of o.servers) {
      s.close();
      s.closeAllConnections();
    }
  }

  /** Servers listening on the port, or why it can't be opened on this computer. */
  private async listen(port: number): Promise<http.Server[] | 'taken' | 'denied'> {
    // Asked first: a port taken on every address (0.0.0.0) can still be bound on one of them, and
    // then whatever was there stops getting its own visitors.
    if (await taken(port)) return 'taken';
    const servers: http.Server[] = [];
    for (const host of ADDRESSES) {
      const server = http.createServer((req, res) => this.relay(port, req, res));
      // A long upload or a stream is the worker's server's business, as it would be without the tunnel.
      server.requestTimeout = 0;
      server.on('upgrade', (req, socket, head) => this.upgrade(port, req, socket, head));
      server.on('clientError', (_err, socket) => socket.destroy());
      const err = await listen(server, port, host);
      if (!err) servers.push(server);
      // A computer without IPv6 has no ::1 to listen on, which is fine. Anything else: not ours.
      else if (err.code === 'EADDRINUSE' || err.code === 'EACCES' || host === ADDRESSES[0]) {
        for (const s of servers) s.close();
        return err.code === 'EACCES' ? 'denied' : 'taken';
      }
    }
    return servers;
  }

  /**
   * What the office gets: the request as it came, plus this client's session and the port. Only a
   * name for this computer is let through as the Host, so a page elsewhere can't point a name of
   * its own at the port and read a worker's server through it.
   */
  private headers(port: number, req: http.IncomingMessage): http.OutgoingHttpHeaders | undefined {
    if (!LOOPBACK_NAME.test(req.headers.host ?? '')) return undefined;
    const headers: http.OutgoingHttpHeaders = { ...req.headers, [SERVICE_HEADER]: String(port), cookie: this.office.cookie(req.headers.cookie) };
    // An office at an address of its own is asked for by that name; it gives the worker's server
    // localhost:<port> again. Through an SSH tunnel the Host stays what the browser sent.
    if (!this.office.local) headers.host = this.office.host;
    return headers;
  }

  private relay(port: number, req: http.IncomingMessage, res: http.ServerResponse) {
    const headers = this.headers(port, req);
    if (!headers) return refuse(res, 421, `This is localhost:${port}, forwarded by agent-office tunnel. Open it as http://localhost:${port}.`);
    const up = this.office.request(req.method, req.url, headers, (ur) => {
      res.writeHead(ur.statusCode ?? 502, ur.statusMessage, ur.headers);
      ur.pipe(res);
      // Cut off halfway (the tunnel dropped): the browser hears so, instead of waiting for the rest.
      ur.on('close', () => {
        if (!ur.complete) res.destroy();
      });
    });
    up.on('error', () => {
      if (!res.headersSent) refuse(res, 502, `agent-office tunnel couldn't reach the office at ${this.office.origin}. It keeps trying — reload in a moment.`);
      else res.destroy();
    });
    res.on('close', () => up.destroy());
    req.pipe(up);
  }

  /** WebSockets (hot reload and the like): replay the handshake to the office, then splice the sockets. */
  private upgrade(port: number, req: http.IncomingMessage, socket: Duplex, head: Buffer) {
    socket.on('error', () => socket.destroy());
    const headers = this.headers(port, req);
    if (!headers) return void socket.destroy();
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (const [k, v] of Object.entries(headers)) {
      for (const one of Array.isArray(v) ? v : [v]) if (one !== undefined) lines.push(`${k}: ${one}`);
    }
    const up = this.office.connect(() => {
      up.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    const close = () => {
      up.destroy();
      socket.destroy();
    };
    up.on('error', close);
    up.on('close', close);
    socket.on('close', close);
  }
}
