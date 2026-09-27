import { execFile } from 'node:child_process';
import { readFile, readlink } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import type { ServiceInfo } from '../shared/protocol.js';

// Finds the web servers workers start (npm run dev, python -m http.server, ...) so teammates can
// reach them through the office: every few seconds, list the TCP ports this user's processes
// listen on, and credit each one to the worker whose terminal started it. Servers no worker
// started (yours, from your own terminal) aren't listed.

const SCAN_MS = 4000;
/** A port that stopped listening this recently still gets a "stopped" page instead of the office. */
const GONE_MS = 24 * 60 * 60_000;
/** Listeners that aren't something to review: browsers driven by tests, their helpers. */
const NOISE = /--remote-debugging-port|--type=(?:renderer|gpu-process|utility|zygote)|crashpad/;

export interface ServiceOwner {
  workerId: string;
  /** The worker's PTY process, when it's running. */
  pid?: number;
  /** Claude itself, as opposed to a shell: its own ports (IDE, OAuth callbacks) aren't services. */
  agent: boolean;
  /** Its working directory: the project, or its own worktree. */
  cwd: string;
  /** Its floor's checkout, which everyone on that floor shares. */
  root: string;
}

interface Listener {
  pid: number;
  host: string;
  port: number;
}

interface Proc {
  ppid: number;
  args: string;
}

interface Tracked {
  info: ServiceInfo;
  /** Whether it answered HTTP; only those are published. */
  http: boolean;
  probedAt: number;
  probes: number;
  probing: boolean;
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: 'utf8', timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (_err, out) => resolve(out ?? ''));
  });
}

/** "127.0.0.1:5173", "[::1]:5173", "*:5173" -> host + port. */
function splitAddr(addr: string): { host: string; port: number } | null {
  const m = /^(.*):(\d+)$/.exec(addr.trim());
  if (!m) return null;
  let host = m[1].replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (host === '*' || host === '0.0.0.0' || host === '::' || host === '') host = '127.0.0.1';
  return { host, port: Number(m[2]) };
}

async function listeners(): Promise<Listener[]> {
  const out: Listener[] = [];
  if (process.platform === 'linux') {
    // `ss -p` shows the owning process for this user's sockets without root.
    const text = await run('ss', ['-H', '-l', '-t', '-n', '-p']);
    if (text) {
      for (const line of text.split('\n')) {
        const cols = line.trim().split(/\s+/);
        const addr = cols[3] && splitAddr(cols[3]);
        if (!addr) continue;
        for (const m of line.matchAll(/pid=(\d+)/g)) out.push({ pid: Number(m[1]), ...addr });
      }
      return out;
    }
  }
  const text = await run('lsof', ['-nP', '-a', '-iTCP', '-sTCP:LISTEN', '-u', String(process.getuid?.() ?? ''), '-Fpn']);
  let pid = 0;
  for (const line of text.split('\n')) {
    if (line[0] === 'p') pid = Number(line.slice(1));
    else if (line[0] === 'n' && pid) {
      const addr = splitAddr(line.slice(1));
      if (addr) out.push({ pid, ...addr });
    }
  }
  return out;
}

async function processes(): Promise<Map<number, Proc>> {
  const procs = new Map<number, Proc>();
  const text = await run('ps', ['-A', '-ww', '-o', 'pid=', '-o', 'ppid=', '-o', 'args=']);
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m) procs.set(Number(m[1]), { ppid: Number(m[2]), args: m[3] });
  }
  return procs;
}

/** Working directories of processes (Linux: /proc; macOS: one lsof call). */
async function cwds(pids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!pids.length) return out;
  if (process.platform === 'linux') {
    await Promise.all(pids.map(async (pid) => out.set(pid, await readlink(`/proc/${pid}/cwd`).catch(() => ''))));
    return out;
  }
  const text = await run('lsof', ['-a', '-d', 'cwd', '-p', pids.join(','), '-Fpn']);
  let pid = 0;
  for (const line of text.split('\n')) {
    if (line[0] === 'p') pid = Number(line.slice(1));
    else if (line[0] === 'n' && pid) out.set(pid, line.slice(1));
  }
  return out;
}

/** The worker a process was started by, from the env var every worker's processes inherit (Linux). */
async function workerFromEnv(pid: number): Promise<string | undefined> {
  if (process.platform !== 'linux') return undefined;
  const env = await readFile(`/proc/${pid}/environ`, 'latin1').catch(() => '');
  return /(?:^|\0)AGENT_OFFICE_WORKER_ID=([^\0]+)/.exec(env)?.[1];
}

/** "node /x/node_modules/.bin/vite --port 5173" -> "vite --port 5173" */
function shortCommand(args: string): string {
  const parts = args.split(/\s+/).filter(Boolean);
  const words = parts.map((p, i) => (p.includes('/') && !p.startsWith('--') && (i === 0 || !p.includes('=')) ? path.basename(p) : p));
  if (words.length > 1 && /^(node|nodejs|bun|deno|tsx|ts-node)$/.test(words[0])) words.shift();
  const s = words.join(' ');
  return s.length > 80 ? `${s.slice(0, 79)}…` : s;
}

function inside(dir: string, child: string): boolean {
  const rel = path.relative(dir, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Does it speak HTTP? And what's the <title> of its front page? */
function probe(host: string, port: number): Promise<{ ok: boolean; title?: string }> {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: '/', timeout: 2500, headers: { host: `localhost:${port}`, accept: 'text/html,*/*', 'user-agent': 'agent-office' } }, (res) => {
      if (!/text\/html/i.test(String(res.headers['content-type'] ?? ''))) {
        res.resume();
        return resolve({ ok: true });
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => {
        body += c;
        if (body.length > 64 * 1024 || /<\/title>/i.test(body)) res.destroy();
      });
      const done = () => {
        const t = /<title[^>]*>([^<]*)<\/title>/i.exec(body)?.[1];
        resolve({ ok: true, title: t ? decodeEntities(t).replace(/\s+/g, ' ').trim().slice(0, 100) || undefined : undefined });
      };
      res.on('end', done);
      res.on('close', done);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve({ ok: false }));
  });
}

function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39|#x27|nbsp);/g, (_, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'", nbsp: ' ' })[e] ?? '');
}

export class Services {
  private tracked = new Map<number, Tracked>();
  private gone = new Map<number, number>();
  private timer?: NodeJS.Timeout;
  private scanning = false;
  private published = '[]';

  constructor(
    private owners: () => ServiceOwner[],
    private onChange: (items: ServiceInfo[]) => void,
  ) {}

  start() {
    void this.scan();
    this.timer = setInterval(() => void this.scan(), SCAN_MS);
  }

  stop() {
    clearInterval(this.timer);
  }

  /** The web servers (listeners that answered HTTP), by port. */
  list(): ServiceInfo[] {
    return [...this.tracked.values()]
      .filter((t) => t.http)
      .map((t) => t.info)
      .sort((a, b) => a.port - b.port);
  }

  /** The service on this port, or 'gone' if one was there recently. */
  lookup(port: number): ServiceInfo | 'gone' | undefined {
    const t = this.tracked.get(port);
    if (t?.http) return t.info;
    const at = this.gone.get(port);
    return at && Date.now() - at < GONE_MS ? 'gone' : undefined;
  }

  async scan() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      await this.scanOnce();
    } catch (err) {
      console.error('services scan failed:', err);
    } finally {
      this.scanning = false;
    }
  }

  private async scanOnce() {
    const owners = this.owners();
    const [ls, procs] = await Promise.all([listeners(), processes()]);
    const byPty = new Map(owners.filter((o) => o.pid).map((o) => [o.pid!, o]));
    const byId = new Map(owners.map((o) => [o.workerId, o]));

    // One entry per port; prefer a loopback address to connect to.
    const ports = new Map<number, Listener>();
    for (const l of ls) {
      if (l.pid === process.pid) continue; // the office itself
      const cur = ports.get(l.port);
      if (!cur || (l.host === '127.0.0.1' && cur.host !== '127.0.0.1')) ports.set(l.port, l);
    }

    const found = new Map<number, { l: Listener; workerId: string; cwd?: string }>();
    const unresolved: Listener[] = [];
    for (const l of ports.values()) {
      const args = procs.get(l.pid)?.args ?? '';
      if (NOISE.test(args)) continue;
      // Walk up to the worker terminal that started it.
      let owner: ServiceOwner | undefined;
      let underOffice = false;
      for (let p = l.pid, i = 0; p > 1 && i < 64; p = procs.get(p)?.ppid ?? 0, i++) {
        owner = byPty.get(p);
        if (owner) {
          if (p === l.pid && owner.agent) owner = undefined; // Claude's own port
          else break;
        }
        if (p === process.pid) {
          underOffice = true;
          break;
        }
      }
      if (owner) found.set(l.port, { l, workerId: owner.workerId });
      else if (!underOffice) unresolved.push(l);
    }
    // Detached (nohup, daemonized) servers lost their parent: go by env, then working directory.
    const dirs = await cwds(unresolved.map((l) => l.pid));
    for (const l of unresolved) {
      const fromEnv = await workerFromEnv(l.pid);
      if (fromEnv && byId.has(fromEnv)) {
        found.set(l.port, { l, workerId: fromEnv });
        continue;
      }
      // Only a worktree says whose it is: the project root is everyone's (and yours, from your own terminal).
      const cwd = dirs.get(l.pid);
      const owner = cwd ? owners.filter((o) => o.cwd !== o.root && inside(o.cwd, cwd)).sort((a, b) => b.cwd.length - a.cwd.length)[0] : undefined;
      if (owner) found.set(l.port, { l, workerId: owner.workerId, cwd });
    }
    // Working directories for the board, for servers that are new since the last scan.
    const need = [...found].filter(([port, f]) => f.cwd === undefined && this.tracked.get(port)?.info.pid !== f.l.pid).map(([, f]) => f.l.pid);
    const more = await cwds(need);

    const now = Date.now();
    for (const [port, t] of this.tracked) {
      if (found.has(port)) continue;
      this.tracked.delete(port);
      if (t.http) this.gone.set(port, now);
    }
    for (const [port, f] of found) {
      const cwd = f.cwd ?? more.get(f.l.pid);
      const root = byId.get(f.workerId)?.root;
      const rel = cwd && root && inside(root, cwd) ? path.relative(root, cwd) : undefined;
      const fresh = { host: f.l.host, pid: f.l.pid, command: shortCommand(procs.get(f.l.pid)?.args ?? '?'), cwd: rel, since: now };
      let t = this.tracked.get(port);
      if (!t) {
        t = { info: { port, workerId: f.workerId, ...fresh }, http: false, probedAt: 0, probes: 0, probing: false };
        this.tracked.set(port, t);
        this.gone.delete(port);
      } else if (t.info.pid !== f.l.pid) {
        // Restarted on the same port (a dev server reloading its config): same row, fresh look.
        Object.assign(t.info, fresh);
        t.probedAt = 0;
        t.probes = 0;
      }
      t.info.workerId = f.workerId;
      this.maybeProbe(t, now);
    }
    this.publish();
  }

  /** New servers get probed right away and again while they boot; known web servers now and then for their title. */
  private maybeProbe(t: Tracked, now: number) {
    if (t.probing) return;
    const wait = t.http ? 60_000 : t.probes < 8 ? 3000 * 2 ** Math.max(0, t.probes - 2) : 5 * 60_000;
    if (now - t.probedAt < wait) return;
    t.probing = true;
    t.probedAt = now;
    t.probes++;
    void probe(t.info.host, t.info.port).then((r) => {
      t.probing = false;
      if (this.tracked.get(t.info.port) !== t) return;
      t.http = r.ok;
      if (r.ok) t.info.title = r.title;
      this.publish();
    });
  }

  private publish() {
    const items = this.list();
    const json = JSON.stringify(items);
    if (json === this.published) return;
    this.published = json;
    this.onChange(items);
  }
}
