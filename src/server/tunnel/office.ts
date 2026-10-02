import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { COOKIE_NAME } from '../auth.js';
import { FORWARDS_PATH, LOOPBACK_NAME, type ForwardList } from './wire.js';

const TIMEOUT_MS = 10_000;

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** The office as `agent-office tunnel` reaches it: through an SSH tunnel on localhost, or at its own address. */
export class Office {
  readonly secure: boolean;
  readonly hostname: string;
  readonly port: number;
  /** Its address as a browser has it, e.g. http://localhost:4600. */
  readonly origin: string;
  /** The Host the office expects from someone who came to it by that address. */
  readonly host: string;
  /** Whether that's this computer's own address (an SSH tunnel, or an office running here). */
  readonly local: boolean;
  /** One set of connections for everything sent to the office, kept open between requests. */
  private agent: http.Agent | https.Agent;
  /** The session this client is signed in with ('' until it is). */
  token = '';

  constructor(
    url: URL,
    /** Take a certificate nobody vouches for (an office started with --self-signed). */
    private insecure = false,
  ) {
    this.secure = url.protocol === 'https:';
    this.hostname = url.hostname.replace(/^\[|\]$/g, '');
    this.port = Number(url.port) || (this.secure ? 443 : 80);
    this.origin = url.origin;
    this.host = url.host;
    this.local = LOOPBACK_NAME.test(url.hostname);
    this.agent = this.secure ? new https.Agent({ keepAlive: true, rejectUnauthorized: !insecure }) : new http.Agent({ keepAlive: true });
  }

  /**
   * The Cookie header that signs a request in, after whatever cookies `theirs` already has. The
   * office names its cookie after its port when the Host has one, so both names go along.
   */
  cookie(theirs?: string): string {
    const mine = `${COOKIE_NAME}=${this.token}; ${COOKIE_NAME}_${this.port}=${this.token}`;
    return theirs ? `${theirs}; ${mine}` : mine;
  }

  /** A request to the office; `headers` go as they are. */
  request(method: string | undefined, path: string | undefined, headers: http.OutgoingHttpHeaders, onResponse: (res: http.IncomingMessage) => void): http.ClientRequest {
    const opts = { host: this.hostname, port: this.port, method, path, headers, agent: this.agent };
    return this.secure ? https.request(opts, onResponse) : http.request(opts, onResponse);
  }

  /** A raw connection to the office, for a WebSocket; `ready` once it can be written to. */
  connect(ready: () => void): net.Socket {
    if (!this.secure) return net.connect(this.port, this.hostname, ready);
    const servername = net.isIP(this.hostname) ? undefined : this.hostname;
    return tls.connect({ host: this.hostname, port: this.port, servername, rejectUnauthorized: !this.insecure, ALPNProtocols: ['http/1.1'] }, ready);
  }

  close() {
    this.agent.destroy();
  }

  private call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Answer> {
    return new Promise((resolve, reject) => {
      const json = body === undefined ? undefined : JSON.stringify(body);
      const headers: http.OutgoingHttpHeaders = { accept: 'application/json' };
      if (json !== undefined) Object.assign(headers, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(json) });
      if (this.token) headers.cookie = this.cookie();
      const req = this.request(method, path, headers, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }));
        res.on('error', reject);
      });
      req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('timed out')));
      req.on('error', reject);
      req.end(json);
    });
  }

  /** Whether an office answers there. */
  async up(): Promise<boolean> {
    try {
      const r = await this.call('GET', '/api/health');
      return r.status === 200 && (parse(r.body) as { ok?: unknown })?.ok === true;
    } catch {
      return false;
    }
  }

  /** Which fields its sign-in asks for: a name when there are accounts, the shared password while it's on. */
  async loginOptions(): Promise<{ accounts: boolean; shared: boolean }> {
    const o = parse((await this.call('GET', '/api/login')).body) as { accounts?: unknown; shared?: unknown } | undefined;
    return { accounts: o?.accounts === true, shared: o?.shared !== false };
  }

  /** Signs in; resolves to why it didn't work, or '' when it did (and `token` is set). */
  async signIn(name: string, password: string): Promise<string> {
    const r = await this.call('POST', '/api/login', { name, password });
    if (r.status !== 200) return (parse(r.body) as { error?: string } | undefined)?.error || `Sign-in failed (${r.status})`;
    for (const c of r.headers['set-cookie'] ?? []) {
      const m = new RegExp(`^${COOKIE_NAME}(?:_\\d+)?=([^;]+)`).exec(c);
      if (m) {
        this.token = decodeURIComponent(m[1]);
        return '';
      }
    }
    return "The office didn't answer with a session";
  }

  /**
   * The workers' web servers. 'signed-out' when the session isn't good (any more), 'old' when the
   * office is a version from before it could say; throws when it can't be reached.
   */
  async forwards(): Promise<ForwardList | 'signed-out' | 'old'> {
    const r = await this.call('GET', FORWARDS_PATH);
    if (r.status === 401 || r.status === 302) return 'signed-out';
    const list = r.status === 200 ? (parse(r.body) as Partial<ForwardList> | undefined) : undefined;
    if (!list || !Array.isArray(list.items)) {
      if (r.status === 200 || r.status === 404) return 'old';
      throw new Error(`the office answered ${r.status}`);
    }
    const items = list.items.filter((f) => Number.isInteger(f?.port) && f.port > 0 && f.port < 65536);
    return { port: Number(list.port) || 0, items };
  }
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
