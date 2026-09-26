import http from 'node:http';
import https from 'node:https';
import { randomBytes } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type { Config } from './config.js';
import { Auth } from './auth.js';
import { WorkerManager } from './workers.js';
import { GitHub } from './github.js';
import { Team } from './team.js';
import { Upgrader } from './upgrade.js';
import type { ChatLine, ClientMsg, PeerInfo, ProjectInfo, ServerMsg } from '../shared/protocol.js';
import { SPAWN } from '../shared/layout.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};

interface Client {
  id: string;
  ws: WebSocket;
  peer: PeerInfo;
  attached: Set<string>;
  /** Terminals whose output was skipped because this client fell behind; re-snapshotted later. */
  stale: Set<string>;
  lastMoveAt: number;
}

const SLOW_CLIENT_BYTES = 8 * 1024 * 1024;

function findPublicDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, '../../public'), path.resolve(here, '../../dist/public')];
  for (const c of candidates) if (existsSync(path.join(c, 'index.html'))) return c;
  throw new Error(`Client bundle not found (looked in ${candidates.join(', ')}). Run \`npm run build\`.`);
}

function projectInfo(cfg: Config): ProjectInfo {
  const git = (args: string[]) => {
    try {
      return execFileSync('git', args, { cwd: cfg.dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return undefined;
    }
  };
  return {
    name: path.basename(cfg.dir),
    dir: cfg.dir,
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    remote: git(['remote', 'get-url', 'origin']),
    agentCmd: [cfg.agentCmd, ...cfg.agentArgs].join(' '),
  };
}

function clientIp(req: http.IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    // The rightmost hop is the one our proxy appended; anything left of it is client-controlled.
    if (typeof fwd === 'string' && fwd) return fwd.split(',').pop()!.trim();
  }
  return req.socket.remoteAddress ?? '?';
}

function isSecure(req: http.IncomingMessage, cfg: Config): boolean {
  if (cfg.tls) return true;
  return cfg.trustProxy && req.headers['x-forwarded-proto'] === 'https';
}

function readBody(req: http.IncomingMessage, limit = 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(json);
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export async function startServer(cfg: Config) {
  const publicDir = findPublicDir();
  const auth = new Auth(cfg.verifier, cfg.salt, cfg.secret);
  const clients = new Map<string, Client>();
  const chat: ChatLine[] = [];
  const project = projectInfo(cfg);

  const sendTo = (c: Client, msg: ServerMsg) => {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
  };
  const broadcast = (msg: ServerMsg, except?: string, droppable = false) => {
    const json = JSON.stringify(msg);
    for (const c of clients.values()) {
      if (c.id === except || c.ws.readyState !== WebSocket.OPEN) continue;
      if (droppable && c.ws.bufferedAmount > 4 * 1024 * 1024) continue;
      c.ws.send(json);
    }
  };

  // --- Loopback-only endpoint that Claude Code hooks POST to --------------------------------
  let workers!: WorkerManager;
  const hookServer = http.createServer(async (req, res) => {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://127.0.0.1');
    } catch {
      return send(res, 400, {});
    }
    if (req.method !== 'POST' || url.pathname !== '/hooks/claude') return send(res, 404, { ok: false });
    let payload: unknown = {};
    try {
      const body = await readBody(req);
      payload = body ? JSON.parse(body) : {};
    } catch {
      // permissive: a bad payload still counts as the event
    }
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const ok = workers.handleHook(url.searchParams.get('worker') ?? '', token, url.searchParams.get('event') ?? '', payload);
    send(res, ok ? 200 : 401, {});
  });
  await new Promise<void>((resolve) => hookServer.listen(0, '127.0.0.1', resolve));
  const hookPort = (hookServer.address() as { port: number }).port;

  workers = new WorkerManager(
    cfg.dir,
    cfg.dataDir,
    cfg.agentCmd,
    cfg.agentArgs,
    { url: `http://127.0.0.1:${hookPort}`, token: '' },
    {
      update: (worker) => broadcast({ t: 'worker.update', worker }),
      remove: (workerId) => broadcast({ t: 'worker.remove', workerId }),
      data: (workerId, data, viewers) => {
        const json = JSON.stringify({ t: 'term.data', workerId, data } satisfies ServerMsg);
        for (const id of viewers) {
          const c = clients.get(id);
          if (!c || c.ws.readyState !== WebSocket.OPEN) continue;
          // A viewer on a slow link skips output and gets a fresh snapshot once it catches up,
          // instead of queueing unbounded data in server memory.
          if (c.stale.has(workerId) || c.ws.bufferedAmount > SLOW_CLIENT_BYTES) c.stale.add(workerId);
          else c.ws.send(json);
        }
      },
      screen: (workerId, frame) => broadcast({ t: 'screen', workerId, ...frame }, undefined, true),
      toast: (text, level) => broadcast({ t: 'toast', text, level }),
    },
  );

  const github = new GitHub(
    cfg.dir,
    (state) => broadcast({ t: 'gh.issues', state }),
    (state) => broadcast({ t: 'gh.pulls', state }),
  );
  github.start();

  const team = new Team(cfg.publicHost, cfg.port);

  const upgrader = new Upgrader(
    (state) => broadcast({ t: 'upgrade', state }),
    () => {
      // cli.ts shuts down gracefully; systemd (Restart=always) then starts the new version.
      workers.wakeAfterRestart();
      process.kill(process.pid, 'SIGTERM');
    },
  );

  // --- HTTP ------------------------------------------------------------------------------------
  const serveFile = (res: http.ServerResponse, file: string, cache: boolean) => {
    const ext = path.extname(file);
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': cache ? 'public, max-age=31536000, immutable' : 'no-store',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
    });
    createReadStream(file).pipe(res);
  };

  const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
      let p: string;
      try {
        p = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
      } catch {
        return send(res, 400, { error: 'Bad request' });
      }
      if (p === '/api/login' && req.method === 'POST') {
        const ip = clientIp(req, cfg.trustProxy);
        // Counted before the body is read, so parallel guesses can't all slip under the limit.
        if (!auth.allowAttempt(ip)) return send(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
        let pw = '';
        try {
          pw = str(JSON.parse(await readBody(req, 4096)).password, 512);
        } catch {
          return send(res, 400, { error: 'Bad request' });
        }
        if (!(await auth.checkPassword(pw))) return send(res, 401, { error: 'Wrong password' });
        auth.recordSuccess(ip);
        return send(res, 200, { ok: true }, { 'set-cookie': auth.cookie(req, auth.issue(), isSecure(req, cfg)) });
      }
      // One-time reveal of the generated password. After this the plaintext is gone for good.
      const claimable = !!cfg.claimToken && !cfg.claimed && !!cfg.password;
      if (p === '/api/claim' && req.method === 'GET') return send(res, 200, { claimable });
      if (p === '/api/claim' && req.method === 'POST') {
        const ip = clientIp(req, cfg.trustProxy);
        if (!auth.allowAttempt(ip)) return send(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
        let token = '';
        try {
          token = str(JSON.parse(await readBody(req, 4096)).token, 256);
        } catch {
          return send(res, 400, { error: 'Bad request' });
        }
        if (!claimable) return send(res, 410, { error: 'This office has already been claimed. Sign in with the password you saved.' });
        if (!auth.checkToken(token, cfg.claimToken!)) return send(res, 403, { error: 'That claim link is not valid.' });
        const password = cfg.password!;
        cfg.markClaimed();
        auth.recordSuccess(ip);
        console.log('  the office password was claimed — it will not be shown again');
        return send(res, 200, { password }, { 'set-cookie': auth.cookie(req, auth.issue(), isSecure(req, cfg)) });
      }
      if (p === '/api/logout' && req.method === 'POST') {
        return send(res, 200, { ok: true }, { 'set-cookie': auth.clearCookie(req) });
      }
      if (p === '/api/health') return send(res, 200, { ok: true });

      if (p.startsWith('/assets/')) {
        const file = path.join(publicDir, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
        if (file.startsWith(publicDir) && existsSync(file) && statSync(file).isFile()) return serveFile(res, file, true);
        res.writeHead(404).end();
        return;
      }
      if (p === '/login' || p === '/login.html') return serveFile(res, path.join(publicDir, 'login.html'), false);
      if (p === '/claim' || p === '/claim.html') return serveFile(res, path.join(publicDir, 'claim.html'), false);
      if (p === '/favicon.svg') return serveFile(res, path.join(publicDir, 'favicon.svg'), false);

      if (!auth.fromRequest(req)) {
        if (p.startsWith('/api/')) return send(res, 401, { error: 'Not logged in' });
        res.writeHead(302, { location: '/login' }).end();
        return;
      }
      if (p === '/api/whoami') return send(res, 200, { ok: true });
      if (p === '/' || p === '/index.html') return serveFile(res, path.join(publicDir, 'index.html'), false);
      const file = path.join(publicDir, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
      if (file.startsWith(publicDir + path.sep) && existsSync(file) && statSync(file).isFile()) return serveFile(res, file, false);
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    } catch (err) {
      console.error(err);
      if (!res.headersSent) send(res, 500, { error: 'Internal error' });
    }
  };

  const server = cfg.tls ? https.createServer({ cert: cfg.tls.cert, key: cfg.tls.key }, handler) : http.createServer(handler);

  // --- WebSocket -------------------------------------------------------------------------------
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://x');
    } catch {
      socket.destroy();
      return;
    }
    const origin = req.headers.origin;
    const host = (cfg.trustProxy && (req.headers['x-forwarded-host'] as string)) || req.headers.host;
    let sameOrigin = false;
    try {
      sameOrigin = !!origin && new URL(origin).host === host;
    } catch {
      sameOrigin = false;
    }
    if (url.pathname !== '/ws' || !auth.fromRequest(req) || !sameOrigin) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, url));
  });

  const onConnection = (ws: WebSocket, url: URL) => {
    const id = randomBytes(5).toString('hex');
    const name = str(url.searchParams.get('name'), 24).trim() || `Guest ${id.slice(0, 3)}`;
    const colorParam = url.searchParams.get('color') ?? '';
    const client: Client = {
      id,
      ws,
      attached: new Set(),
      stale: new Set(),
      lastMoveAt: 0,
      peer: {
        id,
        name,
        color: COLOR_RE.test(colorParam) ? colorParam : '#4f86f7',
        x: SPAWN.x + (Math.random() - 0.5) * 3,
        y: 0,
        z: SPAWN.z + (Math.random() - 0.5) * 2,
        rotY: Math.PI,
        moving: false,
        voice: false,
        muted: true,
        sharing: false,
      },
    };
    clients.set(id, client);
    (ws as any).isAlive = true;
    ws.on('pong', () => ((ws as any).isAlive = true));

    sendTo(client, {
      t: 'welcome',
      you: id,
      peers: [...clients.values()].map((c) => c.peer),
      workers: workers.list(),
      project,
      issues: github.issues,
      pulls: github.pulls,
      ice: cfg.iceServers,
      chat: chat.slice(-50),
      invites: team.available,
      version: upgrader.version,
      upgrade: upgrader.state,
    });
    for (const { workerId, frame } of workers.fullScreens()) sendTo(client, { t: 'screen', workerId, ...frame, full: true });
    broadcast({ t: 'peer.join', peer: client.peer }, id);

    ws.on('message', (raw) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      handleMessage(client, msg);
    });
    ws.on('close', () => {
      clients.delete(id);
      workers.detachAll(id);
      broadcast({ t: 'peer.leave', id });
    });
    ws.on('error', () => ws.terminate());
  };

  const handleMessage = (c: Client, msg: ClientMsg) => {
    const who = c.peer.name;
    switch (msg.t) {
      case 'move': {
        const p = c.peer;
        p.x = num(msg.x);
        p.y = num(msg.y);
        p.z = num(msg.z);
        p.rotY = num(msg.rotY);
        p.moving = !!msg.moving;
        broadcast({ t: 'peer.move', id: c.id, x: p.x, y: p.y, z: p.z, rotY: p.rotY, moving: p.moving }, c.id, true);
        break;
      }
      case 'profile': {
        const name = str(msg.name, 24).trim();
        if (name) c.peer.name = name;
        if (COLOR_RE.test(msg.color)) c.peer.color = msg.color;
        broadcast({ t: 'peer.update', peer: c.peer });
        break;
      }
      case 'voice':
        c.peer.voice = !!msg.voice;
        c.peer.muted = !!msg.muted;
        c.peer.sharing = !!msg.sharing;
        broadcast({ t: 'peer.update', peer: c.peer });
        break;
      case 'rtc': {
        const target = clients.get(str(msg.to, 32));
        if (target) sendTo(target, { t: 'rtc', from: c.id, data: msg.data });
        break;
      }
      case 'chat': {
        const text = str(msg.text, 500).trim();
        if (!text) break;
        const line: ChatLine = { from: c.id, name: who, color: c.peer.color, text, at: Date.now() };
        chat.push(line);
        if (chat.length > 200) chat.splice(0, chat.length - 200);
        broadcast({ t: 'chat', ...line });
        break;
      }
      case 'worker.spawn': {
        const kind = msg.kind === 'shell' ? 'shell' : 'agent';
        const r = workers.spawn(str(msg.deskId, 32), who, str(msg.prompt, 20000) || undefined, msg.worktree === true, kind);
        if (typeof r === 'string') sendTo(c, { t: 'toast', text: r, level: 'warn' });
        else broadcast({ t: 'toast', text: kind === 'shell' ? `${who} opened a shell at a desk` : `${who} hired ${r.name}${r.prompt ? ' with a task' : ''}`, level: 'info' });
        break;
      }
      case 'worker.resume': {
        const err = workers.resume(str(msg.workerId, 32));
        if (err) sendTo(c, { t: 'toast', text: err, level: 'warn' });
        break;
      }
      case 'worker.kill': {
        const w = workers.get(str(msg.workerId, 32));
        if (w) {
          workers.kill(w.id);
          broadcast({ t: 'toast', text: `${who} sent ${w.name} home`, level: 'info' });
        }
        break;
      }
      case 'worker.attach': {
        const wid = str(msg.workerId, 32);
        const snap = workers.attach(wid, c.id, who);
        if (snap) {
          c.attached.add(wid);
          sendTo(c, { t: 'term.snapshot', workerId: wid, ...snap });
        }
        break;
      }
      case 'worker.detach': {
        const wid = str(msg.workerId, 32);
        c.attached.delete(wid);
        workers.detach(wid, c.id);
        break;
      }
      case 'worker.prompt': {
        const err = workers.prompt(str(msg.workerId, 32), str(msg.prompt, 20000));
        if (err) sendTo(c, { t: 'toast', text: err, level: 'warn' });
        break;
      }
      case 'term.input':
        if (c.attached.has(msg.workerId)) workers.write(msg.workerId, str(msg.data, 64 * 1024));
        break;
      case 'term.resize':
        if (c.attached.has(msg.workerId)) workers.resize(msg.workerId, num(msg.cols), num(msg.rows));
        break;
      case 'gh.refresh':
        void github.refresh();
        break;
      case 'upgrade.check':
        void upgrader.check();
        break;
      case 'upgrade.start':
        void upgrader.start(who).then((err) => {
          if (err) sendTo(c, { t: 'toast', text: err, level: 'warn' });
          else broadcast({ t: 'toast', text: `${who} is upgrading the office — it restarts when the new version is built`, level: 'info' });
        });
        break;
      case 'team.get':
        void team.state().then((state) => sendTo(c, { t: 'team', state }));
        break;
      case 'team.invite': {
        const github = str(msg.github, 64);
        void team.invite(github).then(async (r) => {
          sendTo(c, { t: 'team.invited', github, ...r });
          if ('error' in r) return;
          broadcast({ t: 'toast', text: `${who} invited ${r.name} to the office`, level: 'info' });
          broadcast({ t: 'team', state: await team.state() });
        });
        break;
      }
      case 'team.remove': {
        const name = str(msg.name, 64);
        void team.remove(name).then(async (err) => {
          if (err) return sendTo(c, { t: 'toast', text: err, level: 'warn' });
          broadcast({ t: 'toast', text: `${who} removed ${name}'s access`, level: 'info' });
          broadcast({ t: 'team', state: await team.state() });
        });
        break;
      }
      case 'ping':
        sendTo(c, { t: 'pong', at: num(msg.at) });
        break;
    }
  };

  const resync = setInterval(() => {
    for (const c of clients.values()) {
      if (!c.stale.size || c.ws.bufferedAmount > SLOW_CLIENT_BYTES / 8) continue;
      for (const wid of c.stale) {
        const snap = c.attached.has(wid) ? workers.attach(wid, c.id, c.peer.name) : undefined;
        if (snap) sendTo(c, { t: 'term.snapshot', workerId: wid, ...snap });
      }
      c.stale.clear();
    }
  }, 1000);

  // Drop dead connections so ghosts don't linger in the office.
  const heartbeat = setInterval(() => {
    for (const c of clients.values()) {
      if ((c.ws as any).isAlive === false) {
        c.ws.terminate();
        continue;
      }
      (c.ws as any).isAlive = false;
      c.ws.ping();
    }
  }, 20_000);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(cfg.port, cfg.host, () => resolve());
  });

  const shutdown = () => {
    clearInterval(heartbeat);
    clearInterval(resync);
    github.stop();
    upgrader.stop();
    workers.shutdown();
    for (const c of clients.values()) c.ws.close();
    server.close();
    hookServer.close();
  };

  return { server, shutdown, workers, publicDir, hookPort };
}
