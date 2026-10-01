import http from 'node:http';
import https from 'node:https';
import { randomBytes } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type { Config } from './config.js';
import { Auth, type Session } from './auth.js';
import { Accounts } from './accounts.js';
import { MAX_REPOS, childEnv, resolveCommand, type RepoSource } from './workers.js';
import { SignIns, type ForgeAs } from './signins.js';
import { agentProviders, configuredProvider, OPEN_CODE_MODEL_MAX } from './agents.js';
import { createGrokModelCatalogue, createOpenCodeModelCatalogue } from './models.js';
import { Tailnet } from './tailnet.js';
import { Team } from './team.js';
import { Upgrader } from './upgrade.js';
import { Services } from './services.js';
import { ImageProxy } from './decor.js';
import { Ledger } from './usage.js';
import { PlanLimitsReader } from './limits.js';
import { Webhook } from './webhook.js';
import { MAX_WORKER_LIMIT, Machine, parseWorkerLimit } from './machine.js';
import { Building, type FloorDef } from './building.js';
import { Floor, type FloorContext } from './floor.js';
import { Hosts } from './hosts.js';
import { HostRegistry } from './floor-hosts.js';
import { RemoteFloor } from './remote-floor.js';
import type { FloorActions } from './floor-actions.js';
import { Sky } from './sky.js';
import { Themes } from './theme.js';
import { Maps } from './maps.js';
import { OfficePrompts } from './prompts.js';
import { LeaveOnMerge, notLeaving } from './leave-on-merge.js';
import { findWorker, readHireRequest, readHomeRequest, workerRow, type PullsView } from './office-workers.js';
import { RELAY_LOGIN, relayRequest, relayUpgrade, signInPage, stoppedPage, tunneledPort } from './relay.js';
import { ChatLog } from './history.js';
import { Arcade, HighScores } from './cabinet.js';
import type { ChatLine, ClientMsg, ForgeKind, FloorInfo, FloorView, Me, MeetingRequest, PeerInfo, SearchResults, ServerMsg, ServicesState, SignInKind, WorkerInfo } from '../shared/protocol.js';
import { FORGE_COMMENT_MAX, FORGE_LABEL, GH_LABEL_MAX, isAgentEffort, isAgentProvider } from '../shared/protocol.js';
import { DESK_BY_ID, elevatorSpot, nextFreeSeat, streetBelow } from '../shared/layout.js';
import { OFFICE_MAP, seatHereOn } from '../shared/maps/index.js';
import { EMPTY_PLAN } from '../shared/floorplan.js';
import { JUKEBOX_TUNES, isStreamTrack } from '../shared/jukebox.js';
import { TV_OFF } from '../shared/tv.js';
import { checkFrame, scoreText, type CabinetFrame, type CabinetState } from '../shared/cabinet.js';
import { SEARCH_MAX, SEARCH_MIN, searchKey } from '../shared/search.js';
import { WB_MAX_FILE_BYTES } from '../shared/whiteboard.js';
import { DROP_MAX_BYTES } from '../shared/drops.js';
import { MAX_FLOORS } from '../shared/floors.js';
import { lookFromSeed, sanitizeLook } from '../shared/avatar.js';
import { EMOTE_EVERY, EmoteBucket, isEmote } from '../shared/emotes.js';
import { isThemePick } from '../shared/theme.js';
import { PROMPTS, PROMPT_MAX, isPromptId } from '../shared/prompts.js';
import { ROOF, isDrink } from '../shared/rooftop.js';
import { isBarGame, tossOk, type BarGame } from '../shared/bargames.js';

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
  '.glb': 'model/gltf-binary',
};

const CLEANUPS = new Set(['keep', 'worktree', 'all']);

type ToastLevel = Extract<ServerMsg, { t: 'toast' }>['level'];

interface Client {
  id: string;
  ws: WebSocket;
  peer: PeerInfo;
  /** Signed in with this account; none means the shared office password. */
  accountId?: string;
  /** Whether this person was last told they're an admin (see `me`). */
  admin: boolean;
  /** Signed out while connected; whatever it still sends is dropped until the socket closes. */
  out?: boolean;
  attached: Set<string>;
  /** Terminals whose output was skipped because this client fell behind; re-snapshotted later. */
  stale: Set<string>;
  lastMoveAt: number;
  lastActAt: number;
  lastGongAt: number;
  /** When they last hit a golf ball off the balcony. */
  lastGolfAt: number;
  /** When they last blew the DJ's air horn on the roof. */
  lastHornAt: number;
  /** When they last threw a dart or an axe up there. */
  lastTossAt: number;
  emotes: EmoteBucket;
  /** Has the floor's whiteboard open. */
  whiteboard: boolean;
  lastWbPointerAt: number;
  /** At the arcade cabinet on their floor, playing `game` (see Arcade); `frame` is it as it looks now. */
  playing: boolean;
  game?: string;
  frame?: CabinetFrame;
  lastFrameAt: number;
  /** When this client last said it was typing, per terminal (see 'term.typing'). */
  typingAt: Map<string, number>;
  /** Cleared at each heartbeat ping and set again by the pong; still clear at the next one means gone. */
  isAlive: boolean;
}

const SLOW_CLIENT_BYTES = 8 * 1024 * 1024;
/** The least time between two 'term.typing' notes from one person in one terminal. */
const TYPING_GAP_MS = 500;
/** The quickest anyone throws one dart after another, or one axe (ms): a page's own wait is longer. */
const TOSS_EVERY: Record<BarGame, number> = { darts: 250, axe: 700 };

function findPublicDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, '../../public'), path.resolve(here, '../../dist/public')];
  for (const c of candidates) if (existsSync(path.join(c, 'index.html'))) return c;
  throw new Error(`Client bundle not found (looked in ${candidates.join(', ')}). Run \`npm run build\`.`);
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
  return readBytes(req, limit).then((b) => b.toString('utf8'));
}

function readBytes(req: http.IncomingMessage, limit: number): Promise<Buffer> {
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
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Whether the page asking is the office itself, so another site can't open a socket with a visitor's cookie. */
function sameOrigin(req: http.IncomingMessage, cfg: Config): boolean {
  const origin = req.headers.origin;
  const host = (cfg.trustProxy && (req.headers['x-forwarded-host'] as string)) || req.headers.host;
  try {
    return !!origin && new URL(origin).host === host;
  } catch {
    return false;
  }
}

function refuseUpgrade(socket: Duplex) {
  socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
  socket.destroy();
}

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(json);
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
/** Which of a worker's repositories a Changes message is about: another floor's (see WorkerInfo.repos), or none for its own. */
const repoOf = (v: unknown) => str(v, 64) || undefined;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
/** Where someone going to another floor says they arrive (see `floor.go`): on the grounds, or nowhere (the elevator). */
function arrivalSpot(at: unknown): { x: number; y: number; z: number; rotY: number } | undefined {
  if (!at || typeof at !== 'object') return undefined;
  const a = at as Record<string, unknown>;
  const clamp = (v: unknown, lo: number, hi: number) => Math.min(hi, Math.max(lo, num(v)));
  // Down on the street from a floor high up, the street is a long way down.
  return { x: clamp(a.x, -60, 60), y: clamp(a.y, streetBelow(MAX_FLOORS - 1), 10), z: clamp(a.z, -60, 60), rotY: num(a.rotY) };
}
/** The spot someone coming back in says they were standing in (see Net.connect), if they say. */
function spotFrom(q: URLSearchParams): ReturnType<typeof arrivalSpot> {
  const n = (k: string) => (q.get(k) ? Number(q.get(k)) : NaN);
  const [x, y, z, rotY] = ['x', 'y', 'z', 'rotY'].map(n);
  return Number.isFinite(x) && Number.isFinite(z) ? arrivalSpot({ x, y, z, rotY }) : undefined;
}
const issueNumber = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : undefined);
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const TOO_MANY_ATTEMPTS = 'Too many attempts. Try again in a few minutes.';
/** WebSocket close code for a session that stopped counting: the account was revoked, or the shared password switched off. */
const SIGNED_OUT = 4001;
/** The most chat lines, and lines per worker's terminal, a search answers with. */
const SEARCH_CHAT_HITS = 50;
const SEARCH_TERMINAL_HITS = 25;

export async function startServer(cfg: Config) {
  const publicDir = findPublicDir();
  const accounts = new Accounts(cfg.dataDir);
  const auth = new Auth(cfg.verifier, cfg.salt, cfg.secret, accounts);
  /** The machines allowed to host floors here, and the ones currently connected (see floor-hosts.ts). */
  const hosts = new Hosts(cfg.dataDir);
  const registry = new HostRegistry(hosts);
  const clients = new Map<string, Client>();
  // Kept on disk, so a restart doesn't wipe it.
  const chat = new ChatLog(cfg.dataDir);
  // The arcade's high scores: one table for the whole building, on every floor's cabinet. The office
  // follows every game and puts the scores up itself (see Arcade).
  const highScores = new HighScores(cfg.dataDir);
  const arcade = new Arcade(highScores, (first) => {
    for (const f of floors.values()) cabinetChanged(f);
    if (first) toastFloor(anyFloor(first.floor), `🏆 ${first.score.name} set a new arcade high score: ${scoreText(first.score.score)}`);
  });
  /** What the office is called where it has no project of its own to go by (webhooks, invites). */
  const officeName = cfg.project ? path.basename(cfg.project) : 'the office';
  const modelCommand = configuredProvider(cfg.agentCmd) === 'opencode' ? cfg.agentCmd : 'opencode';
  const openCodeModels = createOpenCodeModelCatalogue(
    modelCommand.includes('/') ? path.resolve(modelCommand) : modelCommand,
    cfg.dir,
  );
  const grokCommand = configuredProvider(cfg.agentCmd) === 'grok' ? cfg.agentCmd : 'grok';
  const grokModels = createGrokModelCatalogue(
    grokCommand.includes('/') ? path.resolve(grokCommand) : grokCommand,
    cfg.dir,
  );

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
  const toastAll = (text: string, level: ToastLevel = 'info') => broadcast({ t: 'toast', text, level });

  // --- The building: a floor per project, each with its own workers, boards and queue -----------
  const building = new Building(cfg.dataDir, cfg.projectsDir);
  if (cfg.projects) {
    const err = building.setProjectsDir(cfg.projects, 'the command line');
    if (err) console.error(`agent-office: --projects: ${err}`);
  }
  const floors = new Map<string, Floor>();
  /**
   * Floors that run on someone else's machine, by id. Kept apart from `floors` because everything in
   * `floors` is a real `Floor` on this disk — its checkout, its workers, its own data directory — and
   * a hosted one has none of that here. What the two share is the surface `server.ts` calls on them
   * (see floor-actions.ts), which is what makes the swap something the office does not notice.
   */
  const remoteFloors = new Map<string, RemoteFloor>();
  /**
   * A floor **someone can be on**, wherever it runs. A hosted floor is a real place with real people
   * in it — it is just running on another machine — so the elevator, the roof and anything else that
   * moves a person has to be able to find one.
   *
   * The counterpart is `floors`, which stays the floors whose checkout is on this disk. Anything that
   * would *touch* a checkout — a worktree base, a cross-floor repo, a clone — keeps using that one,
   * because a floor on someone else's disk is not this office's to read (finding 9). Getting this
   * backwards is the bug that made a hosted floor visible but not enterable: `floor.go` looked in
   * `floors`, found nothing, and refused with "No such floor".
   */
  const anyFloor = (id: string | undefined | null): FloorActions | undefined =>
    (id ? floors.get(id) ?? remoteFloors.get(id) : undefined);
  /**
   * The same floor as a local `Floor`, when it is one — and `undefined` when it is not.
   *
   * This is the only door to the whiteboard, the dog and the docs, and it is deliberately locked from
   * the other side: a hosted floor's id is not in `floors`, so there is nothing here to open. Those
   * three are files in a checkout this office has no business reading, and a floor on someone else's
   * machine answers `refuses(...)` with the machine's name instead.
   */
  const asLocal = (f: FloorActions | undefined): Floor | undefined => (f ? floors.get(f.id) : undefined);
  /** Every floor a person could be on, in the order the panel shows them. */
  const anyFloors = (): FloorActions[] => [...floors.values(), ...remoteFloors.values()];
  /** How many floors the building has, counting the ones running on somebody else's machine. */
  const floorCount = (): number => floors.size + remoteFloors.size;
  const floorOf = (c: Client): FloorActions | undefined => anyFloor(c.peer.floor);
  /**
   * The floor a worker sits on, among the ones whose checkout is **this** office's.
   *
   * Deliberately local, and the distinction is the whole of decision 7: a hook arrives on a loopback
   * port on the machine that started the agent, so a hosted floor's agent is already talking to its
   * host, and routing that here would mean the office reaching into a checkout on someone else's
   * disk. Worker ids are unique across the building, so a hosted floor's worker simply is not found.
   */
  const workerFloor = (workerId: string): Floor | undefined => {
    for (const f of floors.values()) if (f.workers.get(workerId)) return f;
    return undefined;
  };
  /**
   * The same, but across every floor — for the people acting on a worker from the browser. A worker on
   * a hosted floor can be prompted, resumed, watched and sent home from here, because all of those go
   * over that machine's socket rather than touching a disk.
   */
  const anyWorkerFloor = (workerId: string): FloorActions | undefined => {
    for (const f of anyFloors()) if (f.workers.get(workerId)) return f;
    return undefined;
  };
  /** To everyone on one floor. */
  const toFloor = (floor: FloorActions, msg: ServerMsg, droppable = false) => {
    const json = JSON.stringify(msg);
    for (const c of clients.values()) {
      if (c.peer.floor !== floor.id || c.ws.readyState !== WebSocket.OPEN) continue;
      if (droppable && c.ws.bufferedAmount > 4 * 1024 * 1024) continue;
      c.ws.send(json);
    }
  };
  const toastFloor = (floor: FloorActions | undefined, text: string, level: ToastLevel = 'info') => {
    if (floor) toFloor(floor, { t: 'toast', text, level });
  };
  const floorInfos = (): FloorInfo[] => [
    ...[...floors.values()].map((f) => ({ ...f.info(), ...(building.isLocal(f.id) ? { local: true } : {}) })),
    // Floors that run on someone else's machine. They are on the panel like any other, and each one
    // says whose machine it is and whether that machine is answering right now — so nobody has to ride
    // up to an empty floor to find out its owner's laptop is shut.
    ...[...remoteFloors.values()].map((f) => f.info()),
    ...building.pending().map((d) => ({ id: d.id, name: d.name, repo: d.repo, dir: d.dir, palette: d.palette, addedBy: d.addedBy, addedAt: d.addedAt, cloning: true, workers: 0, busy: 0, waiting: 0, people: 0, wing: 0 })),
  ];
  // The elevator's counts change with every worker update; tell everyone at most a few times a second.
  let floorsSent = '';
  let floorsTimer: NodeJS.Timeout | undefined;
  const floorsChanged = () => {
    floorsTimer ??= setTimeout(() => {
      floorsTimer = undefined;
      const list = floorInfos();
      const json = JSON.stringify(list);
      if (json === floorsSent) return;
      floorsSent = json;
      broadcast({ t: 'floors', floors: list });
    }, 250);
  };
  /** Tells just this person why their request didn't happen; nothing when there's no error. */
  const warn = (c: Client, error: string | undefined) => {
    if (error) sendTo(c, { t: 'toast', text: error, level: 'warn' });
  };

  // --- Loopback-only endpoint for authenticated agent events -------------------------------
  let webhook!: Webhook;
  const hookServer = http.createServer(async (req, res) => {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://127.0.0.1');
    } catch {
      return send(res, 400, {});
    }
    if (url.pathname === '/office/queue') return officeQueue(req, res, url);
    if (url.pathname === '/office/workers' || url.pathname.startsWith('/office/workers/')) return officeWorkers(req, res, url);
    if (req.method !== 'POST' || !['/hooks/claude', '/hooks/opencode', '/hooks/codex', '/hooks/grok', '/hooks/muse'].includes(url.pathname)) return send(res, 404, { ok: false });
    let payload: unknown = {};
    try {
      const body = await readBody(req);
      payload = body ? JSON.parse(body) : {};
    } catch {
      if (url.pathname !== '/hooks/claude') return send(res, 400, { ok: false });
      // permissive: a bad payload still counts as the event
    }
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const workerId = url.searchParams.get('worker') ?? '';
    const workers = workerFloor(workerId)?.workers;
    if (!workers) return send(res, 401, {});
    const event = url.searchParams.get('event') ?? '';
    const ok = url.pathname === '/hooks/opencode'
      ? workers.handleOpenCodeHook(workerId, token, payload)
      : url.pathname === '/hooks/codex'
        ? workers.handleCodexHook(workerId, token, event, payload)
        : url.pathname === '/hooks/grok'
          ? workers.handleGrokHook(workerId, token, event, payload)
          : url.pathname === '/hooks/muse'
            ? workers.handleMuseHook(workerId, token, event, payload)
            : workers.handleHook(workerId, token, event, payload);
    send(res, ok ? 200 : 401, {});
  });
  /**
   * The task queue, for the board agents (see stations.ts, which tells them how): GET lists it, POST
   * adds a task, DELETE with ?task= takes a waiting one off. The agent's own hook token says who's asking.
   */
  const officeQueue = async (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => {
    const workerId = url.searchParams.get('worker') ?? '';
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const floor = workerFloor(workerId);
    const agent = floor?.workers.authenticate(workerId, token);
    if (!floor || !agent) return send(res, 401, { error: 'Send your own AGENT_OFFICE_WORKER_ID as ?worker= and AGENT_OFFICE_HOOK_TOKEN as the bearer token' });
    if (!DESK_BY_ID.get(agent.deskId)?.station) return send(res, 403, { error: 'Only the agents standing by the boards can use the queue' });
    const view = () => {
      const q = floor.queue.state();
      return {
        maxWorkers: q.maxWorkers,
        tasks: q.tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, outcome: t.outcome, issue: t.issue, addedBy: t.addedBy, worker: t.workerName, branch: t.branch, pr: t.pr, error: t.error })),
      };
    };
    if (req.method === 'GET') return send(res, 200, view());
    if (req.method === 'DELETE') {
      const err = await floor.queue.remove(url.searchParams.get('task') ?? '');
      return err ? send(res, 400, { error: err }) : send(res, 200, view());
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'GET, POST or DELETE' });
    let body: { prompt?: unknown; title?: unknown; issue?: unknown };
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return send(res, 400, { error: 'Send JSON: {"title": "…", "prompt": "…", "issue": 12}' });
    }
    const issue = Number.isInteger(body?.issue) && (body.issue as number) > 0 ? (body.issue as number) : undefined;
    // Its tasks run as whoever the board agent runs as.
    const err = floor.queue.add(str(body?.prompt, 20000), agent.name, str(body?.title, 200) || undefined, issue, undefined, undefined, undefined, await floor.workers.ownerOf(agent.id));
    if (err) return send(res, 400, { error: err });
    const task = floor.queue.state().tasks.at(-1)!;
    toastFloor(floor, `📋 The ${agent.name} queued ${issue !== undefined ? `issue #${issue}` : `“${task.title}”`}`);
    send(res, 200, { ok: true, task: { id: task.id, title: task.title, status: task.status } });
  };
  /**
   * The floor's workers, for any worker on it (see office-workers.ts, and bin/office-workers.js, the
   * command and MCP server that call it): GET lists them, POST hires one, POST /home sends some home
   * (its worktree and branch go too, unless they hold work), POST /tell types a prompt to one. The
   * worker's own hook token says who's asking, and the floor hears who did what, as from anyone.
   */
  const officeWorkers = async (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => {
    const workerId = url.searchParams.get('worker') ?? '';
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const floor = workerFloor(workerId);
    const me = floor?.workers.authenticate(workerId, token);
    if (!floor || !me) return send(res, 401, { error: 'Send your own AGENT_OFFICE_WORKER_ID as ?worker= and AGENT_OFFICE_HOOK_TOKEN as the bearer token' });
    const who = me.name;
    const view: PullsView = { pulls: floor.forge.pulls.items, tasks: floor.queue.state().tasks, pullsOf: (id) => anyFloor(id)?.forge.pulls.items };
    const row = (id: string) => {
      const w = floor.workers.get(id);
      return w && workerRow(w, view, me.id);
    };
    const action = url.pathname.slice('/office/workers'.length);
    if (req.method === 'GET' && !action) {
      const list = floor.workers.list();
      const free = nextFreeSeat((id) => floor.workers.deskOccupied(id), floor.plan.wing);
      return send(res, 200, {
        floor: { id: floor.id, name: floor.def.name, repo: floor.def.repo, branch: floor.project.branch },
        you: me.id,
        leaveOnMerge: leaveOnMerge.on,
        providers: floor.project.agentProviders,
        defaultProvider: floor.workers.officeDefault.provider,
        freeDesk: free?.id ?? null,
        ...(ledger.hiringPaused ? { hiringPaused: ledger.hiringPaused } : {}),
        workers: list.map((w) => workerRow(w, view, me.id)),
      });
    }
    if (req.method !== 'POST' || !['', '/home', '/tell'].includes(action)) return send(res, 405, { error: 'GET /office/workers, or POST to /office/workers, /office/workers/home or /office/workers/tell' });
    let body: unknown;
    try {
      body = JSON.parse((await readBody(req)) || '{}');
    } catch {
      return send(res, 400, { error: 'Send JSON' });
    }

    if (action === '/home') {
      const ask = readHomeRequest(body);
      if (typeof ask === 'string') return send(res, 400, { error: ask });
      type Outcome = { worker: string; id?: string; went?: boolean; note?: string; error?: string; skipped?: string };
      const results: Outcome[] = [];
      const going: { w: WorkerInfo; why?: string }[] = [];
      if (ask.merged) {
        for (const w of floor.workers.list()) {
          const landed = floor.landed(w);
          if (!landed) continue;
          const why = landed.prs?.length ? `its pull requests merged (${landed.prs.join(', ')})` : `PR #${landed.pr} merged`;
          const staying = w.id === me.id ? "that's you" : notLeaving(w);
          if (staying) results.push({ worker: w.name, id: w.id, skipped: `${why}, but it's ${staying}` });
          else going.push({ w, why });
        }
      } else {
        for (const key of ask.workers) {
          const w = findWorker(floor.workers.list(), key);
          if (typeof w === 'string') results.push({ worker: key, error: w });
          else if (w.id === me.id) results.push({ worker: w.name, id: w.id, error: "That's you: someone else has to send you home" });
          else if (!going.some((g) => g.w === w)) going.push({ w });
        }
      }
      // One at a time: git takes a lock on the repository's refs to delete a branch.
      for (const { w, why } of going) {
        if (floor.workers.get(w.id) !== w) {
          results.push({ worker: w.name, id: w.id, skipped: 'it had already gone' });
          continue;
        }
        toastFloor(floor, why ? `🏠 ${who} sent ${w.name} home: ${why}` : `${who} sent ${w.name} home`);
        const { note, error } = await floor.sendHome(w.id, ask.cleanup);
        if (note) toastFloor(floor, note);
        if (error) toastFloor(floor, error, 'warn');
        results.push({ worker: w.name, id: w.id, went: true, ...(note ? { note } : {}), ...(error ? { error } : {}) });
      }
      return send(res, 200, { results });
    }

    if (action === '/tell') {
      const b = (body ?? {}) as { worker?: unknown; prompt?: unknown };
      const w = findWorker(floor.workers.list(), str(b.worker, 64));
      if (typeof w === 'string') return send(res, 404, { error: w });
      if (w.id === me.id) return send(res, 400, { error: "That's you" });
      // A shell would run it as a command, in someone's terminal.
      if (w.kind !== 'agent') return send(res, 400, { error: `${w.name} is a shell, not an agent` });
      const text = str(b.prompt, 20000).replace(/\r\n?/g, '\n').trim();
      if (!text) return send(res, 400, { error: 'Say what to tell it: prompt' });
      let err = await floor.workers.prompt(w.id, text, who);
      // Stopped or asleep: it wakes up with this as its next message.
      if (err === 'Worker is not running') err = floor.workers.resume(w.id, text);
      if (err) return send(res, 400, { error: err });
      return send(res, 200, { ok: true, worker: row(w.id) });
    }

    const ask = readHireRequest(body, floor.project.agentProviders);
    if (typeof ask === 'string') return send(res, 400, { error: ask });
    const desk = ask.desk ?? nextFreeSeat((id) => floor.workers.deskOccupied(id), floor.plan.wing)?.id;
    if (!desk) return send(res, 409, { error: 'Every desk and bean bag is taken: send someone home first' });
    // A model or effort is the office's default worker's unless it says whose.
    const provider = ask.provider ?? (ask.model || ask.effort ? floor.workers.officeDefault.provider : undefined);
    const worktree = ask.worktree ?? !!floor.project.branch;
    // Its worktree starts from what's on GitHub now, like one hired from a desk.
    if (worktree) await floor.workers.fetchBase();
    if (!floors.has(floor.id)) return send(res, 410, { error: 'This floor closed' });
    // It runs as whoever the asking worker runs as.
    const owner = floor.workers.ownerOf(me.id);
    const r = await floor.workers.spawn(desk, who, ask.prompt, worktree, 'agent', provider, ask.model, ask.effort, undefined, owner);
    if (typeof r === 'string') return send(res, 400, { error: r });
    toastFloor(floor, `${who} hired ${r.name}${ask.issue ? ` for issue #${ask.issue}` : ' with a task'}`);
    if (ask.issue) {
      const n = ask.issue;
      floor.queue.dropIssue(n);
      const as = owner ? signins.forgeAs(owner, floor.forge.kind) : undefined;
      if (typeof as === 'string') toastFloor(floor, `Couldn't assign issue #${n} on ${FORGE_LABEL[floor.forge.kind]}: ${as}`, 'warn');
      else void floor.forge.claim(n, as).then((e) => e && toastFloor(floor, `Couldn't assign issue #${n} on ${FORGE_LABEL[floor.forge.kind]}: ${e}`, 'warn'));
    }
    send(res, 200, { ok: true, worker: row(r.id) });
  };
  // Workers' terminals outlive a restart of the office (see ptys.ts) with this address in their
  // environment, so listen where the last office did when that port is free.
  const hookPortPath = path.join(cfg.dataDir, 'hook-port');
  const listenHooks = (port: number) =>
    new Promise<void>((resolve, reject) => {
      hookServer.once('error', reject);
      hookServer.listen(port, '127.0.0.1', () => {
        hookServer.off('error', reject);
        resolve();
      });
    });
  let lastHookPort = 0;
  try {
    lastHookPort = Number(readFileSync(hookPortPath, 'utf8')) || 0;
  } catch {
    // first start
  }
  await listenHooks(lastHookPort).catch(() => listenHooks(0));
  const hookPort = (hookServer.address() as { port: number }).port;
  writeFileSync(hookPortPath, String(hookPort), { mode: 0o600 });

  // Day, night and the weather outside the windows, the same for everyone.
  const sky = new Sky({ city: cfg.city, weather: cfg.weather }, (state) => broadcast({ t: 'sky', state }));
  sky.start();
  // Halloween or Christmas all over the building, the same for everyone (⚙️ Settings). On 'auto' it
  // goes by the calendar at the office, the sky's clock.
  const themes = new Themes(cfg.dataDir, () => sky.state.utcOffset, (state) => broadcast({ t: 'theme', state }));
  themes.start();
  // What the building looks like inside: the office, the castle, or a map of your own (⚙️ Settings).
  const maps = new Maps(cfg.dataDir);
  /**
   * Tells everyone about the maps, after a pick or a read of the folder. When the map everyone's on
   * changed (`was` before), everyone's off their seats (each browser forgets them too, see the
   * client's 'map'), and hears what it is now: `who` picked it, or a map of your own broke or came back.
   */
  const mapNews = (was: string, who?: string) => {
    const now = maps.pick();
    if (now !== was) for (const other of clients.values()) delete other.peer.seat;
    broadcast({ t: 'map', state: maps.state() });
    if (now === was) return;
    const plan = maps.plan();
    // Without a pick, a map of your own broke (back to the office) or was fixed (back to it).
    const why = now === OFFICE_MAP ? `: the map "${was}" won't load (see ⚙️ Settings)` : ': it loads again';
    toastAll(who ? `${who} changed the building's map to ${plan.icon} ${plan.name}` : `The building's map is ${plan.icon} ${plan.name} now${why}`);
  };
  // The prompts the office writes for workers by itself, and the worker everyone starts on (⚙️ Settings).
  const configured = configuredProvider(cfg.agentCmd);
  const prompts = new OfficePrompts(cfg.dataDir, { list: agentProviders(configured), configured }, (state) => broadcast({ t: 'prompts', state }));
  // Whether a worker whose pull request merged goes home by itself, on every floor (⚙️ Settings).
  const leaveOnMerge = new LeaveOnMerge(cfg.dataDir, (state) => broadcast({ t: 'leaveOnMerge', state }));

  // What the workers spend, all time and today, with the optional daily budget.
  const ledger = new Ledger(
    cfg.dataDir,
    { budget: cfg.budget, pauseHiring: cfg.budgetPause },
    (state) => broadcast({ t: 'usage', state }),
    toastAll,
  );

  const claudeBin = configuredProvider(cfg.agentCmd) === 'claude' ? resolveCommand(cfg.agentCmd) : resolveCommand('claude');
  // Everyone with an account runs on their own Claude, GitHub and Bitbucket sign-ins (see
  // signins.ts). On the shared password, with no accounts, the office's own are used, as they were.
  const signins = new SignIns(
    cfg.dataDir,
    claudeBin,
    resolveCommand('gh'),
    resolveCommand('bb'),
    childEnv,
    (id) => accounts.get(id)?.role === 'admin',
    (id) => {
      for (const c of clients.values()) if (c.accountId === id && !c.out) sendTo(c, { t: 'signins', state: signins.state(id) });
    },
  );
  // Accounts revoked from the terminal while the office was closed leave their sign-ins behind.
  if (!accounts.unreadableFile) signins.prune(new Set(accounts.state(new Set()).accounts.map((a) => a.id)));

  // The Claude plan's 5-hour and weekly limits, for the meter under the workers: the office's own
  // plan, and each account's own once it runs on a Claude sign-in of its own.
  const limits = new PlanLimitsReader(
    claudeBin,
    childEnv(),
    () => [...clients.values()].some((c) => limitsOf(c) === limits),
    (state) => {
      for (const c of clients.values()) if (limitsOf(c) === limits) sendTo(c, { t: 'limits', state });
    },
  );
  const accountLimits = new Map<string, { key: string; reader: PlanLimitsReader }>();
  /** Whose plan `c` sees: their own, on an account with its own Claude sign-in; else the office's. */
  const limitsOf = (c: Client): PlanLimitsReader => {
    const id = c.accountId;
    const key = id && signins.claudeKey(id);
    if (!id || !key) return limits;
    let a = accountLimits.get(id);
    if (a?.key !== key) {
      a?.reader.close();
      const reader = new PlanLimitsReader(
        claudeBin,
        signins.apply(id, childEnv(), [], 'claude'),
        () => [...clients.values()].some((o) => o.accountId === id),
        (state) => {
          for (const o of clients.values()) if (o.accountId === id) sendTo(o, { t: 'limits', state });
        },
      );
      a = { key, reader };
      accountLimits.set(id, a);
    }
    return a.reader;
  };

  // Slack / Discord pings for workers that need input or finish (set from ⚙️ Settings or --webhook).
  webhook = new Webhook(cfg.dataDir, (workerId) => (workerId && workerFloor(workerId)?.def.name) || officeName, (state) => broadcast({ t: 'notify', state }));
  if (cfg.webhook !== undefined) {
    const err = webhook.set(cfg.webhook, 'the command line');
    if (err) console.error(`agent-office: --webhook: ${err}`);
  }

  // The machine's CPU and memory, for the monitor on the wall and a warning before hiring, and the
  // most workers the office runs at once, across every floor (--max-workers, or ⚙️ Settings).
  const machine = new Machine(
    cfg.dataDir,
    cfg.maxWorkers,
    () => {
      let n = 0;
      for (const f of floors.values()) n += f.workers.list().length;
      return n;
    },
    (state) => broadcast({ t: 'machine', state }),
  );
  machine.start();
  /** Queues everywhere may be waiting for room under the worker limit: let them look again. */
  const pumpQueues = (except?: Floor) => {
    if (machine.limit === undefined) return;
    // Not right now: whoever freed the seat (a queue making room for its next task) takes it first.
    setImmediate(() => {
      for (const f of floors.values()) if (f !== except) f.queue.pump();
    });
  };

  const floorContext: FloorContext = {
    agentCmd: cfg.agentCmd,
    agentArgs: cfg.agentArgs,
    dshProfile: cfg.dshProfile,
    hook: { url: `http://127.0.0.1:${hookPort}`, token: '' },
    ledger,
    capacity: machine,
    prompts,
    emit: toFloor,
    toast: toastFloor,
    termData: (workerId, data, viewers) => {
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
    changes: (state, ids) => {
      for (const id of ids) {
        const c = clients.get(id);
        if (c) sendTo(c, { t: 'changes', state });
      }
    },
    workerChanged: (floor, w) => {
      if (typeof w === 'string') {
        webhook.onWorkerGone(w);
        pumpQueues(floor);
      } else webhook.onWorker(w);
      machine.workersChanged();
      floorsChanged();
    },
    people: (floor) => {
      let n = 0;
      for (const c of clients.values()) if (c.peer.floor === floor.id) n++;
      return n;
    },
    peers: (floor) => [...clients.values()].filter((c) => c.peer.floor === floor.id).map((c) => c.peer),
    leaveOnMerge: () => leaveOnMerge.on,
    floor: (id) => floors.get(id),
    pullsChanged: (floor) => {
      for (const f of floors.values()) if (f !== floor && worksIn(f, floor)) f.sendLandedHome();
    },
    lent: (floor) => [...floors.values()].some((f) => f !== floor && worksIn(f, floor)),
    locksUp: () => !!maps.plan().sendHome?.keeps,
    runAs: signins,
    forgeAs: (owner, kind) => (owner ? signins.forgeAs(owner, kind) : undefined),
  };
  /** Whether a worker on `from` works in `on`'s project too (see WorkerInfo.repos). */
  const worksIn = (from: Floor, on: Floor) => from.workers.list().some((w) => w.repos?.some((r) => r.floor === on.id));
  const openFloor = (def: FloorDef): Floor | undefined => {
    // A hosted floor's `dir` is a path on the machine that runs it, so it is not ours to check: asking
    // existsSync here would ask the wrong machine and keep the floor closed forever. Instead it is
    // registered as a proxy, and it opens when its machine connects and says `ready` (finding 9).
    if (def.host) {
      const machine = hosts.get(def.host);
      remoteFloors.set(
        def.id,
        new RemoteFloor(
          def.id,
          machine?.name ?? 'a machine',
          def.host,
          registry,
          { id: def.id, name: def.name, dir: def.dir, repo: def.repo, palette: def.palette, addedBy: def.addedBy, addedAt: def.addedAt },
        ),
      );
      return undefined;
    }
    if (!existsSync(def.dir)) {
      console.error(`agent-office: the ${def.name} floor's checkout is gone (${def.dir}) — it stays closed until it's back`);
      return undefined;
    }
    try {
      const floor = new Floor(def, floorContext);
      floors.set(def.id, floor);
      return floor;
    } catch (err) {
      console.error(`agent-office: couldn't open the ${def.name} floor: ${(err as Error).message}`);
      return undefined;
    }
  };
  // Started in a project: it's a floor too (the one it has always been).
  if (cfg.project) building.ensureLocal(cfg.project, 'the office');
  for (const def of building.list()) openFloor(def);
  // What the office asks a machine for: every floor whose `FloorDef.host` names it, with the path on
  // *that* machine. The office holds those paths to identify the floors and never reads them.
  registry.floorsFor = (hostId) =>
    building
      .list()
      .filter((d) => d.host === hostId)
      .map((d) => ({ id: d.id, dir: d.dir, name: d.name }));
  // Where a machine's answers and events go: the proxy for the floor they are about. A machine tells
  // us a floor is gone through `leave`, and the socket closing is handled per floor by the registry.
  registry.onUpward = (floorId, msg) => {
    const floor = remoteFloors.get(floorId);
    if (!floor) return;
    floor.deliver(msg);
    if (msg.t === 'term.data') {
      const viewers = [...clients.values()].filter((c) => c.peer.floor === floorId && c.attached.has(msg.workerId)).map((c) => c.id);
      floorContext.termData(msg.workerId, msg.data, viewers);
    } else if (msg.t === 'event') {
      const event = msg.msg as ServerMsg;
      if (!event || typeof event.t !== 'string') return;
      if (event.t === 'changes') {
        if (Array.isArray(msg.clients)) floorContext.changes(event.state, msg.clients.filter((id) => clients.get(id)?.peer.floor === floorId));
        return;
      }
      // Room snapshots use `state` on the host wire; browser messages name their payloads.
      const body = msg.msg as { state?: unknown };
      const fields: Record<string, string> = { plan: 'plan', decor: 'items', ball: 'ball', cars: 'cars' };
      const field = fields[event.t];
      const outward = field && body.state !== undefined ? { t: event.t, [field]: body.state } as ServerMsg : event;
      toFloor(floor, outward, msg.droppable);
      if (event.t === 'worker.update' || event.t === 'worker.remove') floorsChanged();
    }
  };
  // A machine arriving or leaving changes what the elevator shows, so the panel is refreshed the same
  // way a worker coming or going refreshes it.
  registry.onFloorGone = (floorId) => {
    // The proxy stops answering at once, so the elevator says offline rather than letting a call wait
    // out its timeout to find out. Its workers stay on the panel, asleep, until someone resumes them.
    remoteFloors.get(floorId)?.onGone(floorId);
    floorsChanged();
  };
  registry.onFloorUp = () => floorsChanged();
  // Workers still running from the last office are back at their desks before anyone walks in.
  await Promise.all([...floors.values()].map((f) => f.ready));

  const team = new Team(cfg.publicHost, cfg.port, cfg.tailnet);
  const tailnet = new Tailnet(cfg.tailnet);

  // Web servers the workers start, for the Services board and service tunnels (see relay.ts).
  // One scan covers every floor; each floor's board lists its own workers' servers.
  const servicesState = (floor: FloorActions | undefined, items = services.list()): ServicesState => ({
    items: floor ? items.filter((s) => floor.workers.get(s.workerId)) : [],
    port: cfg.port,
    deploy: cfg.deployScript,
    ssh: team.ssh,
    tailnet: cfg.tailnet,
  });
  const services = new Services(
    () => [...floors.values()].flatMap((f) => f.workers.owners()),
    (items) => {
      for (const c of clients.values()) sendTo(c, { t: 'services', state: servicesState(floorOf(c), items) });
      tailnet.sync(items.map((s) => s.port));
    },
  );

  /** Who has a floor's whiteboard open. */
  const drawing = (floor: FloorActions): string[] => [...clients.values()].filter((c) => c.whiteboard && c.peer.floor === floor.id).map((c) => c.id);
  const drawingChanged = (floor: FloorActions | undefined) => {
    if (floor) toFloor(floor, { t: 'wb.people', people: drawing(floor) });
  };

  /** Who's playing the arcade cabinet on a floor. */
  const cabinetPlayer = (floor: FloorActions): Client | undefined => [...clients.values()].find((c) => c.playing && c.peer.floor === floor.id);
  const cabinetState = (floor: FloorActions | undefined): CabinetState => {
    const p = floor && cabinetPlayer(floor);
    return { player: p ? { id: p.id, name: p.peer.name, game: p.game ?? '' } : null, scores: highScores.top() };
  };
  const cabinetChanged = (floor: FloorActions | undefined) => {
    if (floor) toFloor(floor, { t: 'cabinet', state: cabinetState(floor) });
  };
  /** `c` stepped away from the cabinet (or left the floor, or the office): their game waits, with its score so far on the table. */
  const stopPlaying = (c: Client, floor = floorOf(c)) => {
    if (!c.playing) return;
    if (floor) arcade.leave(c.game, floor.id);
    c.playing = false;
    c.game = undefined;
    c.frame = undefined;
    cabinetChanged(floor);
  };

  /** Everything on a floor, for whoever just arrived there. */
  const floorView = (floor: FloorActions | undefined): FloorView => {
    // The dog and the whiteboard are files in the floor's own data directory, so they are not on the
    // shared surface and a hosted floor is not asked for them. A floor running on someone else's
    // machine simply arrives without either, which is true rather than a gap someone has to be told.
    const local = asLocal(floor);
    return {
    floor: floor?.id ?? null,
    project: floor?.project ?? null,
    workers: floor?.workers.list() ?? [],
    issues: floor?.forge.issues.state ?? { items: [], fetchedAt: 0, loading: false },
    pulls: floor?.forge.pulls.state ?? { items: [], fetchedAt: 0, loading: false },
    queue: floor?.queue.state() ?? { tasks: [], maxWorkers: 0 },
    decor: floor?.decor.list() ?? [],
    plan: floor?.plan.state() ?? EMPTY_PLAN,
    services: servicesState(floor),
    dog: local?.dog.view() ?? null,
    ball: floor?.court.state() ?? {},
    cars: floor?.garage.state() ?? [],
    jail: floor?.jail.state() ?? { prisoners: [], bones: 0 },
    jukebox: floor?.jukebox.state() ?? { on: false, track: JUKEBOX_TUNES[0].id, startedAt: Date.now(), elapsed: 0 },
    tv: floor?.tv.state() ?? TV_OFF,
    whiteboard: { elements: local?.whiteboard.scene() ?? [], people: local ? drawing(local) : [] },
    meeting: floor?.meetings.state() ?? { current: null, past: [] },
    cabinet: { ...cabinetState(floor), frame: (floor && cabinetPlayer(floor)?.frame) ?? null },
    };
  };
  /** The rooftop bar: nobody works up there, so it has none of a floor's things. */
  const roofView = (): FloorView => ({ ...floorView(undefined), floor: ROOF });
  const screensOf = (c: Client, floor: FloorActions | undefined) => {
    for (const { workerId, frame } of floor?.workers.fullScreens() ?? []) sendTo(c, { t: 'screen', workerId, ...frame, full: true });
  };
  /** Where someone arriving goes: the floor they asked for, else the first one there is. */
  const arrivalFloor = (wanted: string | null): FloorActions | undefined => anyFloor(wanted) || anyFloors()[0];

  const images = new ImageProxy();

  const upgrader = new Upgrader(
    (state) => broadcast({ t: 'upgrade', state }),
    () => {
      // cli.ts shuts down gracefully, leaving the workers running in their terminal host; systemd
      // (Restart=always) then starts the new version, which picks them back up.
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

  /** A file of the client bundle, or undefined when it's missing, a folder, or outside the bundle. */
  const publicFile = (p: string): string | undefined => {
    const file = path.join(publicDir, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    return file.startsWith(publicDir + path.sep) && existsSync(file) && statSync(file).isFile() ? file : undefined;
  };

  /**
   * A password, claim-token or invite guess: counts it against the IP, then reads the small JSON
   * body. Undefined once it has already answered (rate limited, or a bad body).
   */
  const readGuess = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<{ ip: string; body: Record<string, unknown> } | undefined> => {
    const ip = clientIp(req, cfg.trustProxy);
    // Counted before the body is read, so parallel guesses can't all slip under the limit.
    if (!auth.allowAttempt(ip)) return void send(res, 429, { error: TOO_MANY_ATTEMPTS });
    try {
      const body = JSON.parse(await readBody(req, 4096));
      if (body && typeof body === 'object') return { ip, body };
    } catch {
      // answered below
    }
    send(res, 400, { error: 'Bad request' });
  };
  const signedIn = (req: http.IncomingMessage, accountId?: string) => ({ 'set-cookie': auth.cookie(req, auth.issue(accountId), isSecure(req, cfg)) });

  /** With a name, that person's own account; without one, the shared office password (while it's on). */
  const login = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const guess = await readGuess(req, res);
    if (!guess) return;
    const name = str(guess.body.name, 64).trim();
    const password = str(guess.body.password, 512);
    if (name) {
      const account = await accounts.check(name, password);
      if (!account) return send(res, 401, { error: 'Wrong name or password' });
      auth.recordSuccess(guess.ip);
      return send(res, 200, { ok: true }, signedIn(req, account.id));
    }
    if (!accounts.sharedPassword) return send(res, 401, { error: 'Sign in with your name and your own password' });
    if (!(await auth.checkPassword(password))) {
      return send(res, 401, { error: accounts.any ? 'Wrong password. With an account of your own, type your name too.' : 'Wrong password' });
    }
    auth.recordSuccess(guess.ip);
    return send(res, 200, { ok: true }, signedIn(req));
  };
  /** Which fields the sign-in forms ask for. */
  const loginOptions = () => ({ accounts: accounts.any, shared: accounts.sharedPassword });

  /**
   * An invite link: `peek` says who it's for; otherwise it makes the account and signs it in.
   * Counted like a password guess, since the token is one.
   */
  const join = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const guess = await readGuess(req, res);
    if (!guess) return;
    const token = str(guess.body.token, 128);
    const invite = accounts.findInvite(token);
    if (!invite) return send(res, 410, { error: 'This invite link has expired or was already used. Ask whoever sent it for a new one.' });
    auth.recordSuccess(guess.ip);
    if (guess.body.peek === true) return send(res, 200, { name: invite.name, role: invite.role, by: invite.createdBy, project: officeName });
    const r = await accounts.join(token, str(guess.body.name, 64), str(guess.body.password, 1024));
    if (typeof r === 'string') return send(res, 400, { error: r });
    console.log(`  ${r.name} joined the office with an invite from ${r.createdBy}`);
    accountsChanged();
    return send(res, 200, { ok: true, name: r.name }, signedIn(req, r.id));
  };

  /** The 🔎 search: chat lines, and lines of the terminals of every worker on that floor, with the words in them. */
  const search = async (q: string, floor: FloorActions | undefined): Promise<SearchResults> => {
    q = q.slice(0, SEARCH_MAX);
    const needle = searchKey(q);
    if (needle.length < SEARCH_MIN) return { q, chat: [], terminals: [], more: false };
    const said = chat.search(needle, SEARCH_CHAT_HITS);
    // Awaited for the same reason: a hosted floor's terminals are on the other machine, and its
    // search answer comes back over the socket.
    const shown = (await floor?.workers.search(needle, SEARCH_TERMINAL_HITS)) ?? { hits: [], more: false };
    return { q, chat: said.hits, terminals: shown.hits, more: said.more || shown.more };
  };

  const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
      // A service tunnel (localhost:5173 -> the office): relay to that worker's server.
      const tunneled = tunneledPort(req, cfg.port, cfg.tailnet);
      const svc = tunneled ? services.lookup(tunneled) : undefined;
      if (tunneled && svc) {
        if (req.method === 'POST' && req.url === RELAY_LOGIN) return await login(req, res);
        if (!auth.fromAnyCookie(req)) return signInPage(res, tunneled, loginOptions());
        if (svc === 'gone') return stoppedPage(res, tunneled);
        return relayRequest(req, res, svc);
      }
      let url: URL;
      let p: string;
      try {
        url = new URL(req.url ?? '/', 'http://x');
        p = decodeURIComponent(url.pathname);
      } catch {
        return send(res, 400, { error: 'Bad request' });
      }
      if (p === '/api/login' && req.method === 'POST') return await login(req, res);
      if (p === '/api/login' && req.method === 'GET') return send(res, 200, loginOptions());
      if (p === '/api/join' && req.method === 'POST') return await join(req, res);
      // One-time reveal of the generated password. After this the plaintext is gone for good.
      const claimable = !!cfg.claimToken && !cfg.claimed && !!cfg.password;
      if (p === '/api/claim' && req.method === 'GET') return send(res, 200, { claimable });
      if (p === '/api/claim' && req.method === 'POST') {
        const guess = await readGuess(req, res);
        if (!guess) return;
        if (!claimable) return send(res, 410, { error: 'This office has already been claimed. Sign in with the password you saved.' });
        if (!auth.checkToken(str(guess.body.token, 256), cfg.claimToken!)) return send(res, 403, { error: 'That claim link is not valid.' });
        const password = cfg.password!;
        cfg.markClaimed();
        auth.recordSuccess(guess.ip);
        console.log('  the office password was claimed — it will not be shown again');
        return send(res, 200, { password }, signedIn(req));
      }
      // A sign-in link the office printed in its terminal (/login#key=…), traded for a session once.
      if (p === '/api/link' && req.method === 'POST') {
        const guess = await readGuess(req, res);
        if (!guess) return;
        if (!accounts.sharedPassword || !auth.useLinkKey(str(guess.body.key, 128))) {
          return send(res, 410, { error: 'That sign-in link was already used. Sign in with the office password.' });
        }
        auth.recordSuccess(guess.ip);
        return send(res, 200, { ok: true }, signedIn(req));
      }
      if (p === '/api/logout' && req.method === 'POST') {
        return send(res, 200, { ok: true }, { 'set-cookie': auth.clearCookie(req) });
      }
      if (p === '/api/health') return send(res, 200, { ok: true });

      if (p.startsWith('/assets/')) {
        const file = publicFile(p);
        if (file) return serveFile(res, file, true);
        res.writeHead(404).end();
        return;
      }
      if (p === '/login' || p === '/login.html') return serveFile(res, path.join(publicDir, 'login.html'), false);
      if (p === '/claim' || p === '/claim.html') return serveFile(res, path.join(publicDir, 'claim.html'), false);
      if (p === '/join' || p === '/join.html') return serveFile(res, path.join(publicDir, 'join.html'), false);
      if (p === '/favicon.svg') return serveFile(res, path.join(publicDir, 'favicon.svg'), false);

      const session = auth.fromRequest(req);
      if (!session) {
        if (p.startsWith('/api/')) return send(res, 401, { error: 'Not logged in' });
        // Back to the 2D view after signing in, if that's where they were going.
        res.writeHead(302, { location: p === '/lite' ? '/login?next=/lite' : '/login' }).end();
        return;
      }
      if (p === '/api/whoami') return send(res, 200, { ok: true, me: meOf(session.account?.id) });
      if (p === '/api/agents/opencode/models' && req.method === 'GET') {
        try {
          return send(res, 200, { models: await openCodeModels.get() });
        } catch {
          return send(res, 502, { error: 'Could not load OpenCode models' });
        }
      }
      if (p === '/api/agents/grok/models' && req.method === 'GET') {
        try {
          return send(res, 200, { models: await grokModels.get() });
        } catch {
          return send(res, 502, { error: 'Could not load Grok models' });
        }
      }
      if (p === '/api/image' && req.method === 'GET') {
        // A picture on the wall, fetched by the office so the 3D view can draw it (see decor.ts).
        const r = await images.get(url.searchParams.get('url') ?? '');
        if ('error' in r) return send(res, r.status, { error: r.error });
        res.writeHead(200, {
          'content-type': r.type,
          'content-length': String(r.body.length),
          'cache-control': 'private, max-age=3600',
          'x-content-type-options': 'nosniff',
          // Opened on its own (an SVG, say), it still can't run anything on the office's origin.
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          'cross-origin-resource-policy': 'same-origin',
        });
        res.end(r.body);
        return;
      }
      // Which floor a request is about: its boards and its workers.
      const floor = floors.get(url.searchParams.get('floor') ?? '');
      if (p === '/api/whiteboard/file') {
        // Pictures on the whiteboard. Their ids are hashes of what's in them, so they never change.
        if (!floor) return send(res, 404, { error: 'No such floor' });
        if (req.method === 'GET') {
          const f = floor.whiteboard.file(url.searchParams.get('id') ?? '');
          if (!f) return send(res, 404, { error: 'No such picture' });
          return send(res, 200, f, { 'cache-control': 'private, max-age=31536000, immutable' });
        }
        if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
        if (!sameOrigin(req, cfg)) return send(res, 403, { error: 'Forbidden' });
        let body: unknown;
        try {
          body = JSON.parse(await readBody(req, WB_MAX_FILE_BYTES + 4096));
        } catch (err) {
          if ((err as Error).message === 'too large') return send(res, 413, { error: 'That picture is too big for the whiteboard' });
          return send(res, 400, { error: 'Bad request' });
        }
        const error = floor.whiteboard.addFile(body);
        return error ? send(res, 400, { error }) : send(res, 200, { ok: true });
      }
      if (p === '/api/term/drop') {
        // A file dropped or pasted into a worker's terminal, kept on this machine for the terminal to type its path.
        if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
        if (!sameOrigin(req, cfg)) return send(res, 403, { error: 'Forbidden' });
        if (!floor) return send(res, 404, { error: 'No such floor' });
        const workerId = str(url.searchParams.get('worker'), 32);
        if (!floor.workers.get(workerId)) return send(res, 404, { error: 'No such worker' });
        const tooBig = `That file is too big to drop into a terminal (${DROP_MAX_BYTES / 1024 / 1024} MB at most)`;
        if (Number(req.headers['content-length']) > DROP_MAX_BYTES) return send(res, 413, { error: tooBig });
        let body: Buffer;
        try {
          body = await readBytes(req, DROP_MAX_BYTES);
        } catch (err) {
          return (err as Error).message === 'too large' ? send(res, 413, { error: tooBig }) : send(res, 400, { error: 'Bad request' });
        }
        const file = floor.workers.drop(workerId, str(url.searchParams.get('name'), 256), str(req.headers['content-type'], 128), body);
        return file ? send(res, 200, { path: file }) : send(res, 500, { error: 'The office could not keep that file' });
      }
      if (p === '/api/changes/file') {
        // A changed picture in the Changes window at a desk: before (old) or after (new) the worker's edits.
        if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
        const workerId = str(url.searchParams.get('worker'), 32);
        const file = str(url.searchParams.get('path'), 4096);
        const side = url.searchParams.get('side');
        if (!workerId || !file || (side !== 'old' && side !== 'new')) return send(res, 400, { error: 'Bad request' });
        if (!floor) return send(res, 404, { error: 'No such floor' });
        if (!floor.workers.get(workerId)) return send(res, 404, { error: 'No such worker' });
        const r = await floor.changes.file(workerId, file, side, repoOf(url.searchParams.get('repo')));
        if ('error' in r) return send(res, r.status, { error: r.error });
        res.writeHead(200, {
          'content-type': r.type,
          'content-length': String(r.body.length),
          // The worker may change it again any moment.
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          'cross-origin-resource-policy': 'same-origin',
        });
        res.end(r.body);
        return;
      }
      if (p.startsWith('/api/docs') && req.method === 'GET') {
        // The bookshelf: the project's Markdown files, one to read, and the pictures in it (see docs.ts).
        if (!floor) return send(res, 404, { error: 'No such floor' });
        if (p === '/api/docs') return send(res, 200, await floor.docs.list());
        const file = str(url.searchParams.get('path'), 4096);
        if (!file) return send(res, 400, { error: 'Bad request' });
        if (p === '/api/docs/file') {
          const r = await floor.docs.read(file);
          return 'error' in r ? send(res, r.status, { error: r.error }) : send(res, 200, r);
        }
        if (p === '/api/docs/picture') {
          const r = await floor.docs.picture(file);
          if ('error' in r) return send(res, r.status, { error: r.error });
          res.writeHead(200, {
            'content-type': r.type,
            'content-length': String(r.body.length),
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
            'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
            'cross-origin-resource-policy': 'same-origin',
          });
          res.end(r.body);
          return;
        }
        return send(res, 404, { error: 'Not found' });
      }
      if (p === '/api/search' && req.method === 'GET') return send(res, 200, await search(url.searchParams.get('q') ?? '', floor));
      // The boards' own API: what the issue and PR windows show beyond the board cards, read from
      // whichever forge the floor is on (see forge.ts). Kept at /api/gh/ since it predates Bitbucket.
      if (p.startsWith('/api/gh/') && req.method === 'GET') {
        const n = Number(url.searchParams.get('number'));
        // The repo's labels (for the label picker) are the one thing not about a single issue or PR.
        if (p !== '/api/gh/labels' && (!Number.isSafeInteger(n) || n <= 0)) return send(res, 400, { error: 'Bad number' });
        if (!floor) return send(res, 404, { error: 'No such floor' });
        const forge = floor.forge;
        try {
          // "You" on comments is your own login on that forge, once you've signed in to it.
          const me = session.account ? signins.forgeLogin(session.account.id, forge.kind) : undefined;
          if (p === '/api/gh/pull') return send(res, 200, await forge.pullDetail(n, me));
          if (p === '/api/gh/issue') return send(res, 200, await forge.issueDetail(n, me));
          if (p === '/api/gh/labels') return send(res, 200, await forge.repoLabels());
          if (p === '/api/gh/pull/diff') {
            const diff = await forge.pullDiff(n);
            res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
            res.end(diff);
            return;
          }
        } catch (err) {
          return send(res, 502, { error: (err as Error).message });
        }
        return send(res, 404, { error: 'Not found' });
      }
      if (p === '/' || p === '/index.html') return serveFile(res, path.join(publicDir, 'index.html'), false);
      // The 2D view: the workers, their terminals and the boards, without the 3D office (lite.ts).
      if (p === '/lite' || p === '/lite.html') return serveFile(res, path.join(publicDir, 'lite.html'), false);
      const file = publicFile(p);
      if (file) return serveFile(res, file, false);
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
    // A floor host has no browser cookie and is never a visitor, so it is branched BEFORE the session
    // gate below — which only ever looked at '/ws', so an unrouted /floor-host would have fallen
    // through to the 401. Its credential is the token in its first frame, not a cookie.
    if (url.pathname === '/floor-host') {
      registry.upgrade(req, socket, head, url.pathname);
      return;
    }
    const tunneled = tunneledPort(req, cfg.port, cfg.tailnet);
    const svc = tunneled ? services.lookup(tunneled) : undefined;
    if (tunneled && svc) {
      if (svc !== 'gone' && auth.fromAnyCookie(req)) return relayUpgrade(req, socket, head, svc);
      return refuseUpgrade(socket);
    }
    const session = url.pathname === '/ws' && sameOrigin(req, cfg) ? auth.fromRequest(req) : undefined;
    if (!session) return refuseUpgrade(socket);
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, url, session));
  });

  /** Who a connection is: its account's current name and role, or an admin guest on the shared password. */
  const meOf = (accountId: string | undefined): Me => {
    const a = accounts.get(accountId);
    return a ? { account: { name: a.name, role: a.role }, admin: a.role === 'admin' } : { admin: !accountId };
  };
  /** Still signed in: the account wasn't revoked, and the shared password wasn't switched off. */
  const stillIn = (c: Client) => (c.accountId ? !!accounts.get(c.accountId) : accounts.sharedPassword);
  const signOut = (c: Client) => {
    c.out = true;
    c.ws.close(SIGNED_OUT, 'Signed out');
  };
  const onlineAccounts = () => new Set([...clients.values()].map((c) => c.accountId).filter((id): id is string => !!id));
  /** Tells each admin what the accounts are now, and everyone whether they're (still) an admin. */
  const accountsChanged = () => {
    let state: ReturnType<Accounts['state']> | undefined;
    for (const c of clients.values()) {
      if (c.out) continue;
      if (!stillIn(c)) {
        signOut(c);
        continue;
      }
      const me = meOf(c.accountId);
      if (me.admin !== c.admin) {
        c.admin = me.admin;
        sendTo(c, { t: 'me', me });
      }
      if (me.admin) sendTo(c, { t: 'accounts', state: (state ??= accounts.state(onlineAccounts())) });
    }
  };

  const onConnection = (ws: WebSocket, url: URL, session: Session) => {
    const id = randomBytes(5).toString('hex');
    // Back on the floor they were on before a reload, a restart or closing the tab, else the first floor.
    const wanted = url.searchParams.get('floor');
    // Their floor's gone since (taken off the building, or its checkout deleted): up to the roof instead.
    const gone = !!wanted && wanted !== ROOF && !floors.has(wanted);
    // Up on the roof, as long as there's a building under it.
    const onRoof = (wanted === ROOF || gone) && floorCount() > 0;
    const floor = onRoof ? undefined : arrivalFloor(wanted);
    // Back where they were standing on it too; anywhere else, they arrive by elevator.
    const back = !gone && wanted !== null && (onRoof || floor?.id === wanted);
    const spot = (back && spotFrom(url.searchParams)) || { ...elevatorSpot(), y: 0, rotY: 0 };
    const account = session.account;
    // An account's name is its own; on the shared password people pick one.
    const name = account?.name ?? (str(url.searchParams.get('name'), 24).trim() || `Guest ${id.slice(0, 3)}`);
    const colorParam = url.searchParams.get('color') ?? '';
    const intParam = (k: string) => (url.searchParams.get(k) ? Number(url.searchParams.get(k)) : undefined);
    const me = meOf(account?.id);
    const client: Client = {
      id,
      ws,
      accountId: account?.id,
      admin: me.admin,
      attached: new Set(),
      stale: new Set(),
      lastMoveAt: 0,
      lastActAt: 0,
      lastGongAt: 0,
      lastGolfAt: 0,
      lastHornAt: 0,
      lastTossAt: 0,
      // A little more lenient than the page's own, so emotes it let through aren't dropped for arriving bunched up.
      emotes: new EmoteBucket(EMOTE_EVERY * 0.8),
      whiteboard: false,
      lastWbPointerAt: 0,
      playing: false,
      lastFrameAt: 0,
      typingAt: new Map(),
      isAlive: true,
      peer: {
        id,
        name,
        color: COLOR_RE.test(colorParam) ? colorParam : '#4f86f7',
        look: sanitizeLook({ skin: intParam('skin'), hair: intParam('hair'), style: intParam('style') }, lookFromSeed(id)),
        x: spot.x,
        y: spot.y,
        z: spot.z,
        // The way they were facing, or out through the elevator's doors.
        rotY: spot.rotY,
        moving: false,
        voice: false,
        muted: true,
        sharing: false,
        ...(account ? { account: true } : {}),
        ...(url.searchParams.get('lite') === '1' ? { lite: true } : {}),
        ...(onRoof ? { floor: ROOF } : floor ? { floor: floor.id } : {}),
      },
    };
    // Maps of your own may have been added or edited since: everyone already in hears first.
    const mapWas = maps.pick();
    if (maps.reload()) mapNews(mapWas);
    clients.set(id, client);
    if (account) accounts.seen(account.id);
    ws.on('pong', () => (client.isAlive = true));

    sendTo(client, {
      t: 'welcome',
      you: id,
      peers: [...clients.values()].map((c) => c.peer),
      floors: floorInfos(),
      projectsDir: building.projectsDirState(),
      ice: cfg.iceServers,
      chat: chat.recent(50),
      invites: team.available || !!cfg.tailnet,
      version: upgrader.version,
      upgrade: upgrader.state,
      usage: ledger.state(),
      limits: limitsOf(client).state,
      me,
      notify: webhook.state(),
      machine: machine.state(),
      sky: sky.state,
      theme: themes.state(),
      map: maps.state(),
      prompts: prompts.state(),
      leaveOnMerge: leaveOnMerge.state(),
      ...(onRoof ? roofView() : floorView(floor)),
    });
    screensOf(client, floor);
    broadcast({ t: 'peer.join', peer: client.peer }, id);
    if (account) accountsChanged(); // now online
    floorsChanged();
    if (floor) {
      floor.arrived();
      // Anyone whose process ended since (exited, or failed to resume) gets up as you walk in.
      floor.workers.wakeAll();
    }
    limitsOf(client).refresh();
    if (account) {
      sendTo(client, { t: 'signins', state: signins.state(account.id) });
      void signins.look(account.id);
    }

    ws.on('message', (raw) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object' || client.out) return;
      handleMessage(client, msg);
    });
    ws.on('close', () => {
      clients.delete(id);
      if (client.whiteboard) drawingChanged(floorOf(client));
      stopPlaying(client);
      for (const f of floors.values()) {
        f.workers.detachAll(id);
        f.changes.unwatchAll(id);
        if (f.court.left(id)) ballChanged(f);
        if (f.garage.leave(id)) carsChanged(f);
      }
      broadcast({ t: 'peer.leave', id });
      if (account) accountsChanged();
      floorsChanged();
    });
    ws.on('error', () => ws.terminate());
  };

  const decorChanged = (floor: FloorActions) => toFloor(floor, { t: 'decor', items: floor.decor.list() });
  /** The floor's signs or back office changed: its people see it, and everyone sees the building's outside change. */
  const planChanged = (floor: FloorActions) => {
    toFloor(floor, { t: 'plan', plan: floor.plan.state() });
    floorsChanged();
  };
  const ballChanged = (floor: FloorActions) => toFloor(floor, { t: 'ball', ball: floor.court.state() });
  const carsChanged = (floor: FloorActions) => toFloor(floor, { t: 'cars', cars: floor.garage.state() });
  const jukeboxChanged = (floor: FloorActions) => toFloor(floor, { t: 'jukebox', state: floor.jukebox.state() });
  const tvChanged = (floor: FloorActions) => toFloor(floor, { t: 'tv', state: floor.tv.state() });
  const teamState = async () => ({ ...(await team.state()), deploy: cfg.deployScript });
  const teamChanged = async () => broadcast({ t: 'team', state: await teamState() });

  /** To everyone else on the same floor as `c`: nobody on another floor can see them. */
  const toNeighbors = (c: Client, msg: ServerMsg, droppable = false) => {
    if (!c.peer.floor) return;
    const json = JSON.stringify(msg);
    for (const o of clients.values()) {
      if (o.id === c.id || o.peer.floor !== c.peer.floor || o.ws.readyState !== WebSocket.OPEN) continue;
      if (droppable && o.ws.bufferedAmount > 4 * 1024 * 1024) continue;
      o.ws.send(json);
    }
  };

  /**
   * Takes `c` to another floor: everyone sees them leave and arrive, and they get the new floor's
   * everything. They arrive in the elevator, or `at` the spot they came by.
   */
  const goToFloor = (c: Client, floor: FloorActions, at?: { x: number; y: number; z: number; rotY: number }) => {
    if (c.peer.floor === floor.id) return;
    const left = leave(c, at);
    Object.assign(c.peer, { floor: floor.id });
    sendTo(c, { t: 'floor.enter', peers: [...clients.values()].map((o) => o.peer), ...floorView(floor) });
    screensOf(c, floor);
    arrived(c, left);
    floor.arrived();
    floor.workers.wakeAll();
    floorsChanged();
  };

  /** Up to the rooftop bar, by elevator. */
  const goToRoof = (c: Client) => {
    if (c.peer.floor === ROOF) return;
    const left = leave(c);
    c.peer.floor = ROOF;
    sendTo(c, { t: 'floor.enter', peers: [...clients.values()].map((o) => o.peer), ...roofView() });
    arrived(c, left);
    floorsChanged();
  };

  /** Out to the lobby, where the elevator has nowhere to go: the building's last floor was taken off. */
  const toLobby = (c: Client) => {
    const left = leave(c);
    delete c.peer.floor;
    sendTo(c, { t: 'floor.enter', peers: [...clients.values()].map((o) => o.peer), ...floorView(undefined) });
    arrived(c, left);
  };

  /**
   * Takes `floor` off the building (already out of floors.json): everyone on it rides the elevator to
   * the next floor, or out to the lobby if it was the last (the roof goes with it), and its workers stop.
   */
  const closeFloor = (floor: Floor, who: string) => {
    const name = floor.def.name;
    const next = [...floors.values()].find((f) => f !== floor);
    // The list without it first, so nobody arrives somewhere (the lobby's panel) that still shows it.
    const list = floorInfos().filter((f) => f.id !== floor.id);
    floorsSent = JSON.stringify(list);
    broadcast({ t: 'floors', floors: list });
    for (const c of clients.values()) {
      if (c.peer.floor === floor.id || (!next && c.peer.floor === ROOF)) {
        if (next) goToFloor(c, next);
        else toLobby(c);
        sendTo(c, { t: 'toast', text: next ? `🛗 ${who} took ${name} off the building, so you rode the elevator to ${next.def.name}` : `🛗 ${who} took ${name}, the last floor, off the building`, level: 'warn' });
      } else sendTo(c, { t: 'toast', text: `🛗 ${who} took ${name} off the building`, level: 'info' });
    }
    floors.delete(floor.id);
    floor.shutdown();
    floorsChanged();
    // Its workers made room under the worker limit.
    pumpQueues();
  };

  /** Off the floor (or the roof) `c` was on, to `at` on the next one, or into its elevator car. */
  const leave = (c: Client, at?: { x: number; y: number; z: number; rotY: number }) => {
    const was = floorOf(c);
    if (was) {
      was.workers.detachAll(c.id);
      was.changes.unwatchAll(c.id);
    }
    // The ball stays on its floor, back under the hoop. That floor hears so once they're off it (see
    // arrived), or their own page would put it down before it knew they'd gone.
    const ballLeft = !!was?.court.left(c.id);
    // So does a car they were in, parked where they left it.
    const carLeft = !!was?.garage.leave(c.id);
    c.attached.clear();
    c.typingAt.clear();
    c.stale.clear();
    // The whiteboard downstairs stays downstairs, and so does the arcade.
    const wasDrawing = c.whiteboard;
    c.whiteboard = false;
    stopPlaying(c, was);
    const spot = at ?? { ...elevatorSpot(), y: 0, rotY: 0 };
    Object.assign(c.peer, { x: spot.x, y: spot.y, z: spot.z, rotY: spot.rotY, moving: false });
    delete c.peer.seat;
    delete c.peer.golfing;
    delete c.peer.throwing;
    // An issue card belongs to the board it came off, which is on the floor they left; a drink stays at the bar.
    delete c.peer.carrying;
    delete c.peer.drink;
    return { was, wasDrawing, ballLeft, carLeft };
  };

  const arrived = (c: Client, left: ReturnType<typeof leave>) => {
    broadcast({ t: 'peer.update', peer: c.peer }, c.id);
    if (left.wasDrawing) drawingChanged(left.was);
    if (left.ballLeft && left.was) ballChanged(left.was);
    if (left.carLeft && left.was) carsChanged(left.was);
  };

  /**
   * A worker took on GitHub issue `n` (an issue card dropped on its desk): assign it on GitHub, which
   * moves it to In progress on the board, and take it off the queue so nobody else is seated for it.
   */
  const takeIssue = (c: Client, floor: FloorActions, n: number) => {
    floor.queue.dropIssue(n);
    const as = c.accountId ? signins.forgeAs(c.accountId, floor.forge.kind) : undefined;
    if (typeof as === 'string') return warn(c, `Couldn't assign issue #${n} on ${FORGE_LABEL[floor.forge.kind]}: ${as}`);
    void Promise.resolve(floor.forge.claim(n, as)).then((err) => warn(c, err && `Couldn't assign issue #${n} on ${FORGE_LABEL[floor.forge.kind]}: ${err}`));
  };

  /**
   * Runs `go` once `c` has a sign-in of their own to `which` (only accounts need one: on the shared
   * password it's the office's own). Without one it looks again, since they may have just signed
   * in from a shell, and otherwise tells them why (`refused`, else a toast) and opens their sign-ins.
   */
  // `go` may be async: a hosted floor answers a hire over the socket, so the callback that reacts to
  // it has to be able to wait. Callers ignore the result either way.
  const withSignIn = (c: Client, which: SignInKind | undefined, go: () => void | Promise<void>, refused?: (why: string) => void) => {
    const id = c.accountId;
    const ready = (a: string) => (which ? signins.ready(a, which) : true);
    if (!which || !id || ready(id)) return go();
    void signins.look(id, true).then(() => {
      if (c.out || c.ws.readyState !== WebSocket.OPEN) return;
      if (ready(id)) return go();
      const why = signins.why(which);
      if (refused) refused(why);
      else warn(c, why);
      sendTo(c, { t: 'signins.needed', which, why });
    });
  };
  /**
   * Runs `go` once a worktree made on `floor` would start from what's on GitHub now (see
   * Worktrees.fetch): right away when that was just fetched, else after a fetch, if `c` and the floor
   * are still there.
   */
  const withFreshBase = (c: Client, floor: FloorActions | FloorActions[], go: () => void) => {
    const all = Array.isArray(floor) ? floor : [floor];
    // Only the floors whose checkout is on this machine. A hosted floor's base is fetched by the host,
    // as part of the `worker.spawn` it is already being sent — fetching it here would mean running git
    // against a path on someone else's disk, which is the one thing this feature never does.
    const local = all.map((f) => floors.get(f.id)).filter((f): f is Floor => f !== undefined);
    const fetching = local.map((f) => f.workers.fetchBase()).filter((p) => p !== undefined);
    if (!fetching.length) return go();
    void Promise.all(fetching).then(() => {
      if (c.out || c.ws.readyState !== WebSocket.OPEN || local.some((f) => floors.get(f.id) !== f)) return;
      go();
    });
  };
  /**
   * Runs `go` with how the office acts on `floor`'s forge for `c`: as them, or as itself (no
   * account, or an admin's choice). Someone signed in to GitHub but standing on a Bitbucket floor is
   * asked for their Bitbucket sign-in, which is the one that floor acts with.
   */
  const withForge = (c: Client, floor: { forge: { kind: ForgeKind } }, go: (as: ForgeAs | undefined) => void | Promise<void>, refused?: (why: string) => void) =>
    withSignIn(
      c,
      floor.forge.kind,
      () => {
        const as = c.accountId ? signins.forgeAs(c.accountId, floor.forge.kind) : undefined;
        if (typeof as !== 'string') return go(as);
        if (refused) refused(as);
        else warn(c, as);
      },
      refused,
    );
  /** Needs a Claude sign-in of its own when the worker it starts runs Claude. */
  const claudeFor = (provider: string | undefined): SignInKind | undefined => (provider === 'claude' ? 'claude' : undefined);

  // Async because a hosted floor answers some of these over a socket: a write whose result the office
// branches on (a hire, a queue add, a merge) has to be awaited, and a floor running here returns its
// value directly instead. Awaiting a value that is not a promise is a no-op, so an office-side floor
// costs nothing for it. The caller does not await this, so a refusal still reaches the browser the
// same way: through the socket, when it resolves.
const handleMessage = async (c: Client, msg: ClientMsg) => {
    const who = c.peer.name;
    /** The floor `c` is on, or a note to them that they have to be on one. */
    const here = (): FloorActions | undefined => {
      const f = floorOf(c);
      if (!f) warn(c, 'Take the elevator to a floor first');
      return f;
    };
    /** A worker by id, with the floor it sits on. */
    const worker = (id: unknown) => {
      const wid = str(id, 32);
      const floor = anyWorkerFloor(wid);
      return floor ? { wid, floor, info: floor.workers.get(wid)! } : undefined;
    };
    switch (msg.t) {
      case 'move': {
        const p = c.peer;
        p.x = num(msg.x);
        p.y = num(msg.y);
        p.z = num(msg.z);
        p.rotY = num(msg.rotY);
        p.moving = !!msg.moving;
        toNeighbors(c, { t: 'peer.move', id: c.id, x: p.x, y: p.y, z: p.z, rotY: p.rotY, moving: p.moving }, true);
        break;
      }
      case 'act': {
        if (msg.drink !== undefined) {
          // A drink from the rooftop bar, which stays up there.
          const drink = isDrink(msg.drink) && c.peer.floor === ROOF ? msg.drink : undefined;
          if (drink === c.peer.drink) break;
          if (drink) c.peer.drink = drink;
          else delete c.peer.drink;
          broadcast({ t: 'peer.act', id: c.id, drink: drink ?? null }, c.id, true);
          break;
        }
        if (typeof msg.smoke === 'boolean') {
          if (msg.smoke === !!c.peer.smoking) break;
          c.peer.smoking = msg.smoke;
          broadcast({ t: 'peer.act', id: c.id, smoke: msg.smoke }, c.id, true);
          break;
        }
        if (typeof msg.golf === 'boolean') {
          // The tee's on an office floor's balcony; there's none up on the roof.
          const golf = msg.golf && c.peer.floor !== ROOF;
          if (golf === !!c.peer.golfing) break;
          if (golf) c.peer.golfing = true;
          else delete c.peer.golfing;
          broadcast({ t: 'peer.act', id: c.id, golf }, c.id, true);
          break;
        }
        if (msg.throwing !== undefined) {
          // The dart board and the axe lane are up on the roof.
          const game = isBarGame(msg.throwing) && c.peer.floor === ROOF ? msg.throwing : undefined;
          if (game === c.peer.throwing) break;
          if (game) c.peer.throwing = game;
          else delete c.peer.throwing;
          broadcast({ t: 'peer.act', id: c.id, throwing: game ?? null }, c.id, true);
          break;
        }
        if (typeof msg.faint === 'boolean') {
          // Out cold on the ground, wherever they are.
          if (msg.faint === !!c.peer.fainted) break;
          if (msg.faint) c.peer.fainted = true;
          else delete c.peer.fainted;
          broadcast({ t: 'peer.act', id: c.id, faint: msg.faint }, c.id, true);
          break;
        }
        const now = Date.now();
        if (now - c.lastActAt < 100) break;
        c.lastActAt = now;
        toNeighbors(c, { t: 'peer.act', id: c.id }, true);
        break;
      }
      case 'golf': {
        const now = Date.now();
        const [yaw, loft, power] = [num(msg.yaw), num(msg.loft), num(msg.power)];
        if (!c.peer.golfing || now - c.lastGolfAt < 800 || Math.abs(yaw) > 2 || loft < 0 || loft > 1.6 || power < 0 || power > 1) break;
        c.lastGolfAt = now;
        toNeighbors(c, { t: 'golf', id: c.id, yaw, loft, power });
        break;
      }
      case 'toss': {
        // Only at the line they stepped up to, and no quicker than anyone throws.
        const now = Date.now();
        const toss: { game: unknown; u: unknown; v: unknown; n: unknown } = { game: msg.game, u: msg.u, v: msg.v, n: msg.n };
        if (!tossOk(toss) || c.peer.throwing !== toss.game || now - c.lastTossAt < TOSS_EVERY[toss.game]) break;
        c.lastTossAt = now;
        toNeighbors(c, { t: 'toss', id: c.id, game: toss.game, u: toss.u, v: toss.v, n: toss.n, stick: msg.stick === true });
        break;
      }
      case 'emote':
        if (isEmote(msg.emote) && c.emotes.take(Date.now())) toNeighbors(c, { t: 'peer.emote', id: c.id, emote: msg.emote }, true);
        break;
      case 'sit': {
        // Everyone sees them sit down (or get up), and anyone who comes in later finds them sitting.
        // Only on a seat where they are: the roof's up on the roof, the office's on a floor.
        const key = str(msg.seat, 40);
        const seat = seatHereOn(maps.plan(), key, c.peer.floor === ROOF) ? key : undefined;
        if (seat === c.peer.seat) break;
        // Somebody on the floor got there first (two people arriving at an empty throne at once).
        // (Not yourself, on a connection that hasn't timed out yet after a reconnect.)
        const same = (o: typeof c) => o.peer.name === c.peer.name || (!!o.accountId && o.accountId === c.accountId);
        const there = seat && [...clients.values()].find((o) => o !== c && !same(o) && o.peer.seat === seat && o.peer.floor === c.peer.floor);
        if (there) {
          sendTo(c, { t: 'sit.refused', seat: key, by: there.peer.name });
          break;
        }
        if (seat) c.peer.seat = seat;
        else delete c.peer.seat;
        broadcast({ t: 'peer.update', peer: c.peer }, c.id);
        break;
      }
      case 'carry': {
        // Everyone on the floor sees the issue card in their hands, and whoever comes in later too.
        const issue = issueNumber(msg.issue);
        if (issue === c.peer.carrying?.issue) break;
        if (issue !== undefined) c.peer.carrying = { issue, title: str(msg.title, 200) };
        else delete c.peer.carrying;
        broadcast({ t: 'peer.update', peer: c.peer }, c.id);
        break;
      }
      case 'profile': {
        const name = str(msg.name, 24).trim();
        if (name && !c.accountId) c.peer.name = name;
        if (COLOR_RE.test(msg.color)) c.peer.color = msg.color;
        c.peer.look = sanitizeLook(msg.look, c.peer.look);
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
        const line: ChatLine = { from: c.id, name: who, color: c.peer.color, text, at: Date.now(), ...(c.accountId ? { account: true } : {}) };
        chat.add(line);
        broadcast({ t: 'chat', ...line });
        break;
      }
      case 'floor.go': {
        if (msg.floor === ROOF) {
          if (floorCount()) goToRoof(c);
          else warn(c, 'There is no building to go up on yet');
          break;
        }
        // `anyFloor`, not `floors`: a hosted floor is somewhere you can ride to, and the elevator
        // panel has already promised the row is rideable by not disabling it.
        const floor = anyFloor(str(msg.floor, 64));
        if (!floor) warn(c, building.pending().some((d) => d.id === msg.floor) ? "That floor is still being cloned — it'll be ready in a moment" : 'No such floor');
        else goToFloor(c, floor, arrivalSpot(msg.at));
        break;
      }
      case 'floor.repos':
        void building.repos(msg.refresh === true).then(
          (repos) => sendTo(c, { t: 'floor.repos', repos }),
          (err: Error) => sendTo(c, { t: 'floor.repos', repos: [], error: `Couldn't list your repositories with gh: ${err.message}` }),
        );
        break;
      case 'floor.add': {
        const repo = str(msg.repo, 200);
        void building
          .add(repo, who, (def) => {
            floorsChanged();
            toastAll(`🛗 ${who} is adding a floor for ${def.repo ?? def.name}…`);
          })
          .then((r) => {
            floorsChanged();
            if (typeof r === 'string') return sendTo(c, { t: 'floor.added', repo, error: r });
            const floor = openFloor(r);
            if (!floor) return sendTo(c, { t: 'floor.added', repo, error: `Cloned ${r.repo}, but couldn't open its floor — see the office's log` });
            console.log(`  ${who} added a floor for ${r.repo} (${r.dir})`);
            toastAll(`🛗 New floor: ${r.name}, added by ${who}`);
            sendTo(c, { t: 'floor.added', repo, floor: floor.id });
          });
        break;
      }
      case 'floor.remove': {
        // Everyone's workers on it stop: admins do it.
        if (!meOf(c.accountId).admin) return warn(c, 'Only admins can take a floor off the building');
        const id = str(msg.floor, 64);
        const r = building.remove(id, who);
        if (typeof r === 'string') return warn(c, r);
        console.log(`  ${who} took the ${r.name} floor off the building (${r.dir} stays where it is)`);
        const floor = floors.get(id);
        if (floor) closeFloor(floor, who);
        else floorsChanged();
        break;
      }
      case 'floor.projectsDir': {
        // It's a folder on the office's machine that `gh` writes into: admins pick it.
        const err = meOf(c.accountId).admin ? building.setProjectsDir(str(msg.dir, 1024), who) : 'Only admins can move the workspace folder';
        warn(c, err);
        if (err) break;
        const state = building.projectsDirState();
        broadcast({ t: 'projectsDir', state });
        toastAll(state.custom ? `📁 ${who} moved the workspace folder to ${state.dir}` : `📁 ${who} put the workspace folder back to ${state.dir}`);
        break;
      }
      case 'ball.take':
      case 'ball.throw': {
        const floor = floorOf(c);
        if (!floor) break;
        const changed = msg.t === 'ball.take' ? floor.court.take(c.id) : floor.court.throw(c.id, { x: num(msg.x), y: num(msg.y), z: num(msg.z), vx: num(msg.vx), vy: num(msg.vy), vz: num(msg.vz) });
        // Whoever didn't get it (someone else caught it first) is told where it really is.
        if (changed) ballChanged(floor);
        else sendTo(c, { t: 'ball', ball: floor.court.state() });
        break;
      }
      case 'car.enter':
      case 'car.leave': {
        const floor = floorOf(c);
        if (!floor) break;
        const changed = msg.t === 'car.enter' ? floor.garage.enter(c.id, Math.trunc(num(msg.car)), msg.seat) : floor.garage.leave(c.id);
        // They hear back either way: someone who didn't get in (someone beat them to the seat) learns who did.
        if (changed) toNeighbors(c, { t: 'cars', cars: floor.garage.state() });
        sendTo(c, { t: 'cars', cars: floor.garage.state(), answer: true });
        break;
      }
      // Driving and honking are awaited because a hosted floor has to ask the machine that owns the
      // garage where the car ended up. A car in this process answers with the value directly, and
      // awaiting a value that is not a promise is a no-op, so an office-side floor pays nothing.
      case 'car.drive': {
        const floor = floorOf(c);
        const car = Math.trunc(num(msg.car));
        const now = await floor?.garage.drive(c.id, car, { x: num(msg.x), z: num(msg.z), rotY: num(msg.rotY), speed: num(msg.speed), steer: num(msg.steer) });
        if (now) toNeighbors(c, { t: 'car.move', car, ...now }, true);
        break;
      }
      case 'car.honk': {
        const car = await floorOf(c)?.garage.honk(c.id);
        if (car !== undefined) toNeighbors(c, { t: 'car.honk', car });
        break;
      }
      case 'dog.pet': {
        const floor = floorOf(c);
        const local = asLocal(floor);
        if (local) local.dog.pet(c.peer);
        // The dog is a file on the floor's own disk, so a hosted floor has none. Saying whose machine
        // it is on beats a dog that simply did not react.
        else if (floor) warn(c, floor.refuses('the dog'));
        break;
      }
      case 'dog.name': {
        const floor = here();
        if (!floor) break;
        const local = asLocal(floor);
        if (!local) return warn(c, floor.refuses('the dog'));
        const name = local.dog.rename(str(msg.name, 200));
        toastFloor(floor, `🐶 ${who} named the dog ${name}`);
        break;
      }
      case 'worker.spawn': {
        const floor = here();
        if (!floor) break;
        const kind = msg.kind === 'shell' ? 'shell' : 'agent';
        if (kind === 'agent' && msg.provider !== undefined && (!isAgentProvider(msg.provider) || !floor.project?.agentProviders.includes(msg.provider))) {
          warn(c, 'Unknown agent provider');
          break;
        }
        const model = msg.model === undefined ? undefined : str(msg.model, OPEN_CODE_MODEL_MAX + 1);
        const effort = isAgentEffort(msg.effort) ? msg.effort : undefined;
        // Other floors' projects to work in too, each in a worktree of its own.
        const repos: RepoSource[] = [];
        for (const id of Array.isArray(msg.repos) ? [...new Set(msg.repos.slice(0, MAX_REPOS + 1).map((x) => str(x, 64)))] : []) {
          const other = floors.get(id);
          if (!other || other === floor) return warn(c, other ? "The worker's own floor's project is already in its workspace" : 'That project is no longer in the building');
          repos.push({ floor: other.id, name: other.def.name, repo: other.def.repo, dir: other.dir });
        }
        // A shell is theirs too: `claude auth login` or `gh auth login` typed there signs them in.
        const hire = async () => {
          const r = await floor.workers.spawn(str(msg.deskId, 32), who, str(msg.prompt, 20000) || undefined, msg.worktree === true, kind, msg.provider, model, effort, undefined, c.accountId, repos, msg.via === 'herald' ? 'herald' : undefined);
          const issue = kind === 'agent' ? issueNumber(msg.issue) : undefined;
          const across = repos.length ? ` across ${[floor.def.name, ...repos.map((x) => x.name)].join(' + ')}` : '';
          if (typeof r === 'string') warn(c, r);
          else toastFloor(floor, kind === 'shell' ? `${who} opened a shell at a desk` : `${who} hired ${r.name}${issue ? ` for issue #${issue}` : r.prompt ? ' with a task' : ''}${across}`);
          if (typeof r !== 'string' && issue) takeIssue(c, floor, issue);
        };
        // Every project it gets a worktree of starts from what's on GitHub.
        const fresh = [floor, ...repos.map((x) => floors.get(x.floor)!)];
        withSignIn(c, kind === 'agent' ? claudeFor(msg.provider ?? floor.workers.officeDefault.provider) : undefined, () => (msg.worktree === true ? withFreshBase(c, fresh, hire) : hire()));
        break;
      }
      case 'worker.resume': {
        const w = worker(msg.workerId);
        warn(c, w ? await w.floor.workers.resume(w.wid) : 'No such worker');
        break;
      }
      case 'worker.kill': {
        const w = worker(msg.workerId);
        if (!w) { warn(c, 'No such worker — refresh the floor and try again'); break; }
        const { floor, info } = w;
        // The worker leaves right away; its worktree is dealt with after that, and the outcome follows.
        try {
          const { note, error } = await floor.sendHome(info.id, CLEANUPS.has(String(msg.cleanup)) ? msg.cleanup : undefined);
          if (!error) toastFloor(floor, `${who} sent ${info.name} home`);
          if (note) toastFloor(floor, note);
          if (error) warn(c, error);
        } catch (err) {
          warn(c, `Could not send ${info.name} home: ${(err as Error).message}`);
        }
        break;
      }
      case 'worker.worktree': {
        const w = worker(msg.workerId);
        if (!w) break;
        void w.floor.workers.inspectWorktree(w.wid).then((state) => {
          if (state) sendTo(c, { t: 'worker.worktree', workerId: w.wid, state });
        });
        break;
      }
      case 'worker.rebuild': {
        const w = worker(msg.workerId);
        if (!w) break;
        const { floor } = w;
        // With `all`, every worker on the floor whose worktree was deleted, this one first.
        const ids = [w.wid, ...(msg.all === true ? floor.workers.list().filter((x) => x.lost && x.id !== w.wid).map((x) => x.id) : [])];
        void (async () => {
          const names: string[] = [];
          const notes: string[] = [];
          for (const id of ids) {
            const info = floor.workers.get(id);
            // Sent home meanwhile, or back already with one before it (the rest of a meeting's table).
            if (!info || (id !== w.wid && !info.lost)) continue;
            const r = await floor.workers.rebuild(id);
            if (r.error) warn(c, r.error);
            else if (!r.rebuilt) sendTo(c, { t: 'toast', text: r.note ?? `${info.name}'s worktree is already there`, level: 'info' });
            else {
              names.push(info.name);
              if (r.note) notes.push(r.note);
            }
          }
          if (!names.length) return;
          const whose = names.length === 1 ? `${names[0]}'s worktree` : `the worktrees of ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
          toastFloor(floor, `🌿 ${who} rebuilt ${whose}${notes.length ? ` — ${notes.join('; ')}` : ''}`);
        })();
        break;
      }
      case 'worker.attach': {
        const w = worker(msg.workerId);
        // Awaited: a hosted floor answers this over the socket, so an un-awaited result is a Promise
        // and the terminal would open blank.
        const snap = await w?.floor.workers.attach(w.wid, c.id, who);
        if (w && snap) {
          c.attached.add(w.wid);
          sendTo(c, { t: 'term.snapshot', workerId: w.wid, ...snap });
        }
        break;
      }
      case 'worker.detach': {
        const wid = str(msg.workerId, 32);
        c.attached.delete(wid);
        c.typingAt.delete(wid);
        anyWorkerFloor(wid)?.workers.detach(wid, c.id);
        break;
      }
      case 'worker.prompt': {
        const w = worker(msg.workerId);
        const err = w ? await w.floor.workers.prompt(w.wid, str(msg.prompt, 20000), who) : 'No such worker';
        warn(c, err);
        const issue = w?.info.kind === 'agent' ? issueNumber(msg.issue) : undefined;
        if (w && !err && issue) {
          toastFloor(w.floor, `${who} handed issue #${issue} to ${w.info.name}`);
          takeIssue(c, w.floor, issue);
        }
        break;
      }
      case 'station.prompt': {
        const floor = here();
        if (!floor) break;
        const deskId = str(msg.deskId, 32);
        // Nobody there yet: whoever asks first hires it, on their own sign-ins.
        const hires = !floor.workers.deskOccupied(deskId);
        withSignIn(c, hires ? claudeFor(floor.workers.officeDefault.provider) : undefined, async () => {
          const r = await floor.workers.station(deskId, who, str(msg.prompt, 20000), c.accountId);
          if (typeof r === 'string') warn(c, r);
          else if (r.hired) toastFloor(floor, `${who} asked the ${r.info.name} something`);
        });
        break;
      }
      case 'worker.pr': {
        const w = worker(msg.workerId);
        if (!w) break;
        const { floor, wid } = w;
        withForge(c, floor, (as) => void floor.workers.openPr(wid, who, as).then((r) => {
          if (typeof r === 'string') return warn(c, r);
          const info = floor.workers.get(wid);
          const name = info?.name ?? 'the worker';
          const [one] = r.prs;
          if (r.prs.length === 1 && !one.repo) toastFloor(floor, one.existed ? `${name}'s branch already has PR #${one.number}` : `${who} opened PR #${one.number} for ${name}`);
          else {
            // Across repositories: one line for them all.
            const list = r.prs.map((p) => `${p.repo} #${p.number}`).join(', ');
            toastFloor(floor, r.prs.every((p) => p.existed) ? `${name}'s pull requests are already open: ${list}` : `${who} opened ${name}'s pull requests: ${list}`);
          }
          const dirty = r.prs.filter((p) => p.dirty);
          if (dirty.length) warn(c, `${name} still has uncommitted changes in ${dirty.some((p) => p.repo) ? `its worktree${dirty.length > 1 ? 's' : ''} of ${dirty.map((p) => p.repo).join(', ')}` : 'its worktree'} — they are not in the PR`);
          for (const f of r.failed) warn(c, f);
          // Put it on the board now rather than at the next poll. A refresh already in flight
          // returns at once and can miss it, so look again shortly after.
          const own = r.prs.find((p) => !p.repo || p.repo === info?.worktree?.path.split(/[\\/]/).pop());
          void Promise.resolve(floor.forge.refresh()).then(() => {
            if (own && !floor.forge.pulls.items.some((p) => p.number === own.number)) setTimeout(() => void floor.forge.refresh(), 3000);
          });
          for (const x of info?.repos ?? []) void floors.get(x.floor)?.forge.refresh();
        }));
        break;
      }
      case 'term.input':
        if (c.attached.has(msg.workerId)) anyWorkerFloor(msg.workerId)?.workers.write(msg.workerId, str(msg.data, 64 * 1024), who);
        break;
      case 'term.typing': {
        // Everyone else in that terminal sees who's typing. A typist says so about once a second.
        const w = worker(msg.workerId);
        const now = Date.now();
        if (!w || !c.attached.has(w.wid) || now - (c.typingAt.get(w.wid) ?? 0) < TYPING_GAP_MS) break;
        c.typingAt.set(w.wid, now);
        for (const id of w.info.viewerIds) {
          const o = clients.get(id);
          if (o && o.id !== c.id) sendTo(o, { t: 'term.typing', workerId: w.wid, id: c.id });
        }
        break;
      }
      case 'doing': {
        const what = str(msg.what, 60).trim() || undefined;
        const reading = msg.reading === true || undefined;
        if (what === c.peer.doing && reading === c.peer.reading) break;
        if (what) c.peer.doing = what;
        else delete c.peer.doing;
        if (reading) c.peer.reading = true;
        else delete c.peer.reading;
        broadcast({ t: 'peer.update', peer: c.peer });
        break;
      }
      case 'term.resize':
        if (c.attached.has(msg.workerId)) anyWorkerFloor(msg.workerId)?.workers.resize(msg.workerId, num(msg.cols), num(msg.rows));
        break;
      case 'gh.refresh':
        void floorOf(c)?.forge.refresh();
        break;
      case 'gh.merge': {
        const floor = here();
        const n = num(msg.number);
        const method = (['squash', 'merge', 'rebase'] as const).find((m) => m === msg.method);
        if (!floor || !Number.isSafeInteger(n) || n <= 0 || !method) break;
        withForge(
          c,
          floor,
          (as) =>
            void Promise.resolve(floor.forge.merge(n, method, msg.deleteBranch === true, msg.auto === true, as)).then((error) => {
              sendTo(c, { t: 'gh.merged', number: n, error });
              if (error) return;
              toastFloor(floor, msg.auto ? `${who} set PR #${n} to merge once its checks pass` : `🎉 ${who} merged PR #${n}`);
              // An auto-merge rings once the forge gets round to it and the boards see it merged.
              if (!msg.auto) floor.merged(n, who);
            }),
          (error) => sendTo(c, { t: 'gh.merged', number: n, error }),
        );
        break;
      }
      case 'gh.comment': {
        const floor = here();
        const n = num(msg.number);
        const kind = msg.kind === 'pull' ? 'pull' : 'issue';
        if (!floor || !Number.isSafeInteger(n) || n <= 0) break;
        const body = typeof msg.body === 'string' ? msg.body : '';
        // Refused rather than cut short: a comment that silently lost its end would read as finished.
        const max = FORGE_COMMENT_MAX[floor.forge.kind];
        const invalid = !body.trim() ? 'The comment is empty' : body.length > max ? `${FORGE_LABEL[floor.forge.kind]} takes comments of up to ${max} characters` : '';
        if (invalid) {
          sendTo(c, { t: 'gh.commented', kind, number: n, error: invalid });
          break;
        }
        withForge(
          c,
          floor,
          (as) =>
            void Promise.resolve(floor.forge.comment(kind, n, body, as)).then((r) => {
              sendTo(c, { t: 'gh.commented', kind, number: n, ...r });
              if (r.comment) toastFloor(floor, `💬 ${who} commented on ${kind === 'pull' ? 'PR' : 'issue'} #${n}`);
            }),
          (error) => sendTo(c, { t: 'gh.commented', kind, number: n, error }),
        );
        break;
      }
      case 'gong': {
        const floor = floorOf(c);
        const now = Date.now();
        if (!floor || now - c.lastGongAt < 500) break;
        c.lastGongAt = now;
        toFloor(floor, { t: 'gong', why: 'hit', by: who });
        break;
      }
      case 'horn': {
        const now = Date.now();
        if (c.peer.floor !== ROOF || now - c.lastHornAt < 1500) break;
        c.lastHornAt = now;
        for (const o of clients.values()) if (o.peer.floor === ROOF) sendTo(o, { t: 'horn', by: who });
        break;
      }
      case 'gh.close': {
        const floor = here();
        const n = num(msg.number);
        const kind = msg.kind === 'issue' || msg.kind === 'pull' ? msg.kind : undefined;
        if (!floor || !Number.isSafeInteger(n) || n <= 0 || !kind) break;
        const reason = msg.reason === 'not planned' ? 'not planned' : 'completed';
        withForge(
          c,
          floor,
          (as) =>
            void Promise.resolve(floor.forge.close(kind, n, { comment: str(msg.comment, 20000).trim() || undefined, reason, deleteBranch: msg.deleteBranch === true }, as)).then(async (error) => {
              sendTo(c, { t: 'gh.closed', kind, number: n, error });
              if (error) return;
              if (kind === 'pull') return toastFloor(floor, `${who} closed PR #${n} without merging`);
              // Nobody should be seated for an issue that's closed.
              const dropped = await floor.queue.dropIssue(n);
              toastFloor(floor, `${who} closed issue #${n}${reason === 'not planned' ? ' as not planned' : ''}${dropped ? ' and took it off the queue' : ''}`);
            }),
          (error) => sendTo(c, { t: 'gh.closed', kind, number: n, error }),
        );
        break;
      }
      case 'gh.labels': {
        const floor = here();
        const n = num(msg.number);
        const kind = msg.kind === 'issue' || msg.kind === 'pull' ? msg.kind : undefined;
        if (!floor || !Number.isSafeInteger(n) || n <= 0 || !kind) break;
        const names = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map((l) => str(l, GH_LABEL_MAX + 1)).filter((l) => l && l.length <= GH_LABEL_MAX))].slice(0, 100);
        const add = names(msg.add);
        const remove = names(msg.remove).filter((l) => !add.includes(l));
        if (!add.length && !remove.length) {
          sendTo(c, { t: 'gh.labeled', kind, number: n, error: 'No labels to change' });
          break;
        }
        withForge(
          c,
          floor,
          (as) =>
            void Promise.resolve(floor.forge.setLabels(kind, n, add, remove, as)).then((r) => {
              sendTo(c, { t: 'gh.labeled', kind, number: n, ...r });
              if (r.labels) toastFloor(floor, `🏷️ ${who} labeled ${kind === 'pull' ? 'PR' : 'issue'} #${n}: ${[...add.map((l) => `+${l}`), ...remove.map((l) => `−${l}`)].join(' ')}`);
            }),
          (error) => sendTo(c, { t: 'gh.labeled', kind, number: n, error }),
        );
        break;
      }
      case 'queue.add': {
        const floor = here();
        if (!floor) break;
        if (msg.provider !== undefined && (!isAgentProvider(msg.provider) || !floor.project?.agentProviders.includes(msg.provider))) {
          warn(c, 'Unknown agent provider');
          break;
        }
        const issue = Number.isInteger(msg.issue) && (msg.issue as number) > 0 ? (msg.issue as number) : undefined;
        const model = msg.model === undefined ? undefined : str(msg.model, OPEN_CODE_MODEL_MAX + 1);
        const effort = isAgentEffort(msg.effort) ? msg.effort : undefined;
        // Its worker runs on the sign-ins of whoever queued it, whenever it gets a desk.
        withSignIn(c, claudeFor(msg.provider ?? floor.workers.officeDefault.provider), async () => {
          const err = await floor.queue.add(str(msg.prompt, 20000), who, str(msg.title, 200), issue, msg.provider, model, effort, c.accountId);
          if (err) warn(c, err);
          else toastFloor(floor, `📋 ${who} queued ${issue !== undefined ? `issue #${issue}` : 'a task'}`);
        });
        break;
      }
      case 'queue.remove': {
        const floor = here();
        if (floor) warn(c, await floor.queue.remove(str(msg.taskId, 32)));
        break;
      }
      case 'queue.move':
        floorOf(c)?.queue.move(str(msg.taskId, 32), num(msg.delta) < 0 ? -1 : 1);
        break;
      case 'queue.retry': {
        const floor = here();
        if (floor) warn(c, await floor.queue.retry(str(msg.taskId, 32)));
        break;
      }
      case 'queue.clear':
        floorOf(c)?.queue.clear();
        break;
      case 'queue.limit':
        floorOf(c)?.queue.setLimit(num(msg.maxWorkers));
        break;
      case 'meeting.start': {
        const floor = here();
        if (!floor) break;
        if (msg.provider !== undefined && (!isAgentProvider(msg.provider) || !floor.project?.agentProviders.includes(msg.provider))) {
          warn(c, 'Unknown agent provider');
          break;
        }
        const count = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : undefined);
        const request: MeetingRequest = {
          pattern: msg.pattern,
          prompt: str(msg.prompt, 20000),
          title: str(msg.title, 200) || undefined,
          output: str(msg.output, 300) || undefined,
          roles: Array.isArray(msg.roles) ? msg.roles.slice(0, 8).map((r) => str(r, 80)) : [],
          parts: Array.isArray(msg.parts) ? msg.parts.slice(0, 200).map((p) => str(p, 500)) : undefined,
          pr: count(msg.pr),
          issue: count(msg.issue),
          rounds: count(msg.rounds),
          budget: count(msg.budget),
          provider: msg.provider,
          model: msg.model === undefined ? undefined : str(msg.model, OPEN_CODE_MODEL_MAX + 1),
          effort: isAgentEffort(msg.effort) ? msg.effort : undefined,
        };
        withSignIn(c, claudeFor(request.provider ?? floor.workers.officeDefault.provider), () => withFreshBase(c, floor, async () => warn(c, await floor.meetings.start(request, who, c.accountId))));
        break;
      }
      case 'meeting.stop': {
        const floor = here();
        if (floor) warn(c, await floor.meetings.stop(who));
        break;
      }
      case 'meeting.clear': {
        const floor = here();
        if (floor) warn(c, await floor.meetings.clear(who));
        break;
      }
      case 'notify.webhook': {
        const url = str(msg.url, 4096).trim();
        const err = webhook.set(url, who);
        warn(c, err);
        if (!err) toastAll(url ? `📣 ${who} set up team notifications` : `${who} turned off team notifications`);
        break;
      }
      case 'notify.test':
        void webhook.test(who).then((err) => sendTo(c, { t: 'toast', text: err ?? '📣 Sent a test message', level: err ? 'warn' : 'info' }));
        break;
      case 'theme.set': {
        if (!isThemePick(msg.pick)) return;
        if (msg.pick === themes.state().pick) break;
        themes.set(msg.pick, who);
        const now = themes.state().active;
        toastAll(
          msg.pick === 'halloween'
            ? `🎃 ${who} dressed the office up for Halloween`
            : msg.pick === 'christmas'
              ? `🎄 ${who} dressed the office up for Christmas`
              : msg.pick === 'modern'
                ? `🏙️ ${who} turned the office into a modern-day office`
                : msg.pick === 'off'
                  ? `${who} took the decorations down`
                  : `📅 ${who} set the decorations to follow the calendar${now ? ` (it's ${now === 'halloween' ? 'Halloween 🎃' : 'Christmas 🎄'} season)` : ''}`,
        );
        break;
      }
      case 'map.set': {
        // Someone opened the list, or picked a map: either way the folder of maps of your own is read again first.
        const was = maps.pick();
        const reloaded = maps.reload();
        if (msg.map === undefined || !maps.set(str(msg.map, 64), who)) {
          if (reloaded) mapNews(was);
          if (msg.map !== undefined) warn(c, 'There’s no map by that name, or it won’t load: see ⚙️ Settings');
          break;
        }
        mapNews(was, who);
        break;
      }
      case 'prompts.set': {
        if (!meOf(c.accountId).admin) return warn(c, 'Only admins can change the office’s prompts');
        if (!isPromptId(msg.id) || (msg.text !== null && typeof msg.text !== 'string')) return;
        const custom = !!prompts.state().custom[msg.id];
        const err = prompts.setPrompt(msg.id, msg.text === null ? null : str(msg.text, PROMPT_MAX + 1), who);
        if (err) return warn(c, err);
        const now = !!prompts.state().custom[msg.id];
        const { label } = PROMPTS[msg.id];
        if (now) toastAll(`📝 ${who} rewrote the “${label}” prompt`);
        else if (custom) toastAll(`📝 ${who} put the default “${label}” prompt back`);
        break;
      }
      case 'prompts.agent': {
        if (!meOf(c.accountId).admin) return warn(c, 'Only admins can pick the office’s default worker');
        const ch = msg.choice;
        if (ch !== null && (!ch || typeof ch !== 'object')) return;
        const choice = ch && {
          provider: ch.provider,
          model: ch.model === undefined || ch.model === '' ? undefined : str(ch.model, OPEN_CODE_MODEL_MAX + 1),
          effort: ch.effort === undefined ? undefined : ch.effort,
        };
        const err = prompts.setAgent(choice, who);
        if (err) return warn(c, err);
        toastAll(choice ? `🤖 ${who} set the office’s default worker` : `🤖 ${who} put the office’s default worker back to ${path.basename(cfg.agentCmd)}`);
        break;
      }
      case 'leaveOnMerge.set': {
        const on = msg.on === true;
        if (on === leaveOnMerge.on) break;
        leaveOnMerge.set(on, who);
        toastAll(on ? `🏠 ${who} set workers to go home by themselves once their pull request merges` : `🪑 ${who} set workers whose pull request merged to stay until they're sent home`);
        // The ones already merged go now.
        if (on) for (const f of floors.values()) f.sendLandedHome();
        break;
      }
      case 'machine.limit': {
        if (!meOf(c.accountId).admin) return warn(c, 'Only admins can change the worker limit');
        const limit = msg.limit === null ? undefined : parseWorkerLimit(msg.limit);
        if (msg.limit !== null && limit === undefined) return warn(c, `The worker limit is a whole number from 1 to ${MAX_WORKER_LIMIT}`);
        const err = machine.setLimit(limit, who);
        if (err) return warn(c, err);
        const now = machine.limit;
        toastAll(limit !== undefined ? `⚙️ ${who} set the worker limit to ${now}` : now === undefined ? `⚙️ ${who} took the worker limit off` : `⚙️ ${who} put the worker limit back to ${now} (--max-workers)`);
        pumpQueues();
        break;
      }
      case 'changes.watch': {
        const w = worker(msg.workerId);
        if (w) w.floor.changes.watch(w.wid, c.id, repoOf(msg.repo));
        break;
      }
      case 'changes.unwatch': {
        const wid = str(msg.workerId, 32);
        // Its worker may have gone home already; stop watching wherever it was.
        for (const f of floors.values()) f.changes.unwatch(wid, c.id, repoOf(msg.repo));
        break;
      }
      case 'changes.diff': {
        const workerId = str(msg.workerId, 32);
        const file = str(msg.path, 4096);
        const repo = repoOf(msg.repo);
        const floor = workerFloor(workerId);
        if (!floor) {
          sendTo(c, { t: 'changes.diff', workerId, repo, path: file, diff: '', truncated: false, error: 'No such worker' });
          break;
        }
        void floor.changes.diff(workerId, file, repo).then((r) => {
          if (typeof r === 'string') sendTo(c, { t: 'changes.diff', workerId, repo, path: file, diff: '', truncated: false, error: r });
          else sendTo(c, { t: 'changes.diff', workerId, repo, path: file, ...r });
        });
        break;
      }
      case 'changes.commit': {
        const w = worker(msg.workerId);
        // Committed as whoever pressed it: their name and email, once they've signed in to that forge.
        const env = c.accountId ? signins.apply(c.accountId, childEnv(), [], w?.floor.forge.kind) : undefined;
        if (w) void w.floor.changes.commit(w.wid, str(msg.message, 5000), who, env, repoOf(msg.repo)).then((err) => warn(c, err));
        break;
      }
      case 'changes.discard': {
        const w = worker(msg.workerId);
        if (w) void w.floor.changes.discard(w.wid, typeof msg.path === 'string' ? str(msg.path, 4096) : undefined, who, repoOf(msg.repo)).then((err) => warn(c, err));
        break;
      }
      case 'changes.pr': {
        const w = worker(msg.workerId);
        if (w) withForge(c, w.floor, (as) => void w.floor.changes.pullRequest(w.wid, str(msg.title, 300), str(msg.body, 20000), who, as?.env, repoOf(msg.repo)).then((err) => warn(c, err)));
        break;
      }
      case 'upgrade.check':
        void upgrader.check();
        break;
      case 'upgrade.start':
        void upgrader.start(who).then((err) => {
          if (err) warn(c, err);
          else toastAll(`${who} is upgrading the office — it restarts when the new version is built`);
        });
        break;
      case 'limits.refresh':
        limitsOf(c).refresh();
        break;
      case 'team.get':
        void teamState().then((state) => sendTo(c, { t: 'team', state }));
        break;
      case 'team.invite': {
        const user = str(msg.github, 64);
        void team.invite(user).then(async (r) => {
          sendTo(c, { t: 'team.invited', github: user, ...r });
          if ('error' in r) return;
          toastAll(`${who} invited ${r.name} to the office`);
          await teamChanged();
        });
        break;
      }
      case 'team.remove': {
        const name = str(msg.name, 64);
        void team.remove(name).then(async (err) => {
          if (err) return warn(c, err);
          toastAll(`${who} removed ${name}'s access`);
          await teamChanged();
        });
        break;
      }
      case 'accounts.get':
      case 'accounts.invite':
      case 'accounts.cancel':
      case 'accounts.revoke':
      case 'accounts.role':
      case 'accounts.shared':
        handleAccounts(c, msg);
        break;
      case 'signins.get':
      case 'signins.start':
      case 'signins.code':
      case 'signins.cancel':
      case 'signins.token':
      case 'signins.office':
      case 'signins.signout':
        handleSignIns(c, msg);
        break;
      case 'decor.add': {
        const floor = here();
        if (!floor) break;
        const d = await floor.decor.add(msg.decor, who);
        if (typeof d === 'string') return warn(c, d);
        decorChanged(floor);
        toastFloor(floor, `🖼️ ${who} hung ${d.title ? `“${d.title}”` : 'a picture'}`);
        break;
      }
      case 'decor.update': {
        const floor = here();
        if (!floor) break;
        const d = await floor.decor.update(str(msg.id, 32), msg.decor);
        if (typeof d === 'string') return warn(c, d);
        decorChanged(floor);
        break;
      }
      case 'decor.remove': {
        const floor = here();
        if (!floor) break;
        const d = await floor.decor.remove(str(msg.id, 32));
        if (!d) break;
        decorChanged(floor);
        toastFloor(floor, `${who} took down ${d.title ? `“${d.title}”` : 'a picture'}`);
        break;
      }
      case 'desk.label': {
        const floor = here();
        if (!floor) break;
        const deskId = str(msg.deskId, 32);
        const r = await floor.plan.label(deskId, msg.text, msg.color, who);
        if (typeof r === 'string') return warn(c, r);
        if (!r.label && !r.old) break;
        planChanged(floor);
        const desk = DESK_BY_ID.get(deskId)?.label ?? 'a desk';
        if (r.label && r.label.text !== r.old?.text) toastFloor(floor, `🪧 ${who} hung a sign over ${desk}: “${r.label.text}”`);
        else if (!r.label) toastFloor(floor, `🪧 ${who} took the “${r.old!.text}” sign down from ${desk}`);
        break;
      }
      case 'floor.expand': {
        const floor = here();
        if (!floor) break;
        const r = await floor.plan.expand();
        if (typeof r === 'string') return warn(c, r);
        planChanged(floor);
        toastFloor(floor, `🔨 ${who} knocked out the back wall: ${r.map((id) => DESK_BY_ID.get(id)?.label).join(' and ')} are ready for workers`);
        break;
      }
      case 'floor.shrink': {
        const floor = here();
        if (!floor) break;
        const r = await floor.plan.shrink((id) => floor.workers.deskOccupied(id));
        if (typeof r === 'string') return warn(c, r);
        planChanged(floor);
        toastFloor(floor, `🧱 ${who} walled the back office back up, and ${r.map((id) => DESK_BY_ID.get(id)?.label).join(' and ')} went with it`);
        break;
      }
      case 'wb.open':
      case 'wb.close': {
        const floor = floorOf(c);
        const open = msg.t === 'wb.open' && !!floor;
        if (open === c.whiteboard) break;
        c.whiteboard = open;
        drawingChanged(floor);
        break;
      }
      case 'wb.update': {
        const floor = here();
        if (!floor) break;
        const local = asLocal(floor);
        if (!local) return warn(c, floor.refuses('the whiteboard'));
        const { accepted, error } = local.whiteboard.apply(msg.elements);
        if (accepted.length) toNeighbors(c, { t: 'wb.update', elements: accepted });
        warn(c, error);
        break;
      }
      case 'wb.pointer': {
        const now = Date.now();
        if (!c.whiteboard || now - c.lastWbPointerAt < 25) break;
        c.lastWbPointerAt = now;
        const selected = Array.isArray(msg.selected) ? msg.selected.filter((s): s is string => typeof s === 'string').slice(0, 200).map((s) => s.slice(0, 100)) : undefined;
        const pointer: ServerMsg = { t: 'wb.pointer', id: c.id, x: num(msg.x), y: num(msg.y), tool: msg.tool === 'laser' ? 'laser' : 'pointer', button: msg.button === 'down' ? 'down' : 'up', selected };
        const json = JSON.stringify(pointer);
        for (const o of clients.values()) {
          if (o.id === c.id || !o.whiteboard || o.peer.floor !== c.peer.floor || o.ws.readyState !== WebSocket.OPEN || o.ws.bufferedAmount > 1024 * 1024) continue;
          o.ws.send(json);
        }
        break;
      }
      case 'jukebox.play': {
        const floor = here();
        if (!floor) break;
        const r = await floor.jukebox.play({ track: msg.track, url: msg.url }, who);
        if ('error' in r) return warn(c, r.error);
        if (!r.changed) break;
        jukeboxChanged(floor);
        toastFloor(floor, isStreamTrack(floor.jukebox.state().track) ? `📻 ${who} tuned the jukebox to ${floor.jukebox.title()}` : `🎵 ${who} put on “${floor.jukebox.title()}”`);
        break;
      }
      case 'jukebox.skip': {
        const floor = here();
        if (!floor) break;
        floor.jukebox.skip(who);
        jukeboxChanged(floor);
        toastFloor(floor, `⏭️ ${who} skipped to “${floor.jukebox.title()}”`);
        break;
      }
      case 'cabinet.play': {
        const floor = here();
        if (!floor || (c.playing && msg.game === c.game)) break;
        const at = cabinetPlayer(floor);
        if (at && at !== c) {
          warn(c, `${at.peer.name} is on the arcade — press E there to watch`);
          sendTo(c, { t: 'cabinet', state: cabinetState(floor) });
          break;
        }
        // Already at it: that game's over, and this is the next one.
        if (c.playing) arcade.leave(c.game, floor.id);
        c.game = arcade.start({ owner: c.accountId ? `account:${c.accountId}` : `name:${who}`, name: who, color: c.peer.color, connection: c.id }, msg.game);
        if (c.game !== msg.game && !arcade.counts(c.game)) warn(c, "🕹️ That's a lot of new games in a row, so this one won't go on the high-score table");
        c.playing = true;
        c.frame = undefined;
        cabinetChanged(floor);
        break;
      }
      case 'cabinet.leave':
        stopPlaying(c);
        break;
      case 'cabinet.frame': {
        const floor = floorOf(c);
        const frame = checkFrame(msg.frame);
        if (!c.playing || !floor || !frame) break;
        // Every frame counts towards the score, even one that comes too soon after the last to pass on.
        if (arcade.frame(c.game, frame, floor.id) === 'void') warn(c, "🕹️ The office couldn't follow this game, so its score won't go on the high-score table");
        c.frame = frame;
        const now = Date.now();
        if (now - c.lastFrameAt < 40) break;
        c.lastFrameAt = now;
        toNeighbors(c, { t: 'cabinet.frame', frame }, true);
        break;
      }
      case 'jukebox.stop': {
        const floor = here();
        if (!floor || !floor.jukebox.stop(who)) break;
        jukeboxChanged(floor);
        toastFloor(floor, `🔇 ${who} turned the jukebox off`);
        break;
      }
case 'jukebox.place': {
        const floor = here();
        if (!floor) break;
        const r = floor.jukebox.place(msg.spot);
        if (typeof r === 'string') return warn(c, r);
        jukeboxChanged(floor);
        toastFloor(floor, `📻 ${who} moved the jukebox`);
        break;
      }
      case 'tv.play': {
        const floor = here();
        if (!floor) break;
        const was = floor.tv.state();
        const r = await floor.tv.play({ url: msg.url, position: msg.position }, who);
        if ('error' in r) return warn(c, r.error);
        if (!r.changed) break;
        tvChanged(floor);
        const now = floor.tv.state();
        toastFloor(floor, was.on && was.url === now.url ? `▶️ ${who} put the TV back on` : `📺 ${who} put ${floor.tv.title()} on the TV`);
        break;
      }
      case 'tv.pause': {
        const floor = here();
        if (!floor || !floor.tv.pause(msg.position, who)) break;
        tvChanged(floor);
        toastFloor(floor, `⏸️ ${who} paused the TV`);
        break;
      }
      case 'tv.seek': {
        const floor = here();
        if (!floor || !floor.tv.seek(msg.position, who)) break;
        tvChanged(floor);
        break;
      }
      case 'tv.stop': {
        const floor = here();
        if (!floor || !floor.tv.stop(who)) break;
        tvChanged(floor);
        toastFloor(floor, `📺 ${who} turned the TV off`);
        break;
      }
      case 'ping':
        sendTo(c, { t: 'pong', at: num(msg.at), now: Date.now() });
        break;
    }
  };

  /** Inviting, listing and revoking people. Admins only: an admin account, or the shared password. */
  /** Your own Claude and GitHub sign-ins (see signins.ts). Accounts only: the shared password runs on the office's. */
  const handleSignIns = (c: Client, msg: Extract<ClientMsg, { t: `signins.${string}` }>) => {
    const id = c.accountId;
    if (!id) return warn(c, "On the shared office password, workers run on the office's own sign-ins");
    const which: SignInKind = 'which' in msg && msg.which === 'github' ? 'github' : 'claude';
    switch (msg.t) {
      case 'signins.get':
        sendTo(c, { t: 'signins', state: signins.state(id) });
        void signins.look(id, true);
        break;
      case 'signins.start':
        warn(c, signins.start(id, which));
        break;
      case 'signins.code':
        warn(c, signins.code(id, str(msg.code, 4096)));
        break;
      case 'signins.cancel':
        signins.cancel(id, which);
        break;
      case 'signins.token':
        void signins.token(id, which, str(msg.token, 4096)).then((err) => warn(c, err));
        break;
      case 'signins.office':
        warn(c, signins.useOffice(id, which));
        break;
      case 'signins.signout':
        void signins.signOut(id, which);
        break;
    }
  };

  const handleAccounts = (c: Client, msg: Extract<ClientMsg, { t: `accounts.${string}` }>) => {
    const who = c.peer.name;
    if (!meOf(c.accountId).admin) return warn(c, 'Only admins can manage accounts');
    switch (msg.t) {
      case 'accounts.get':
        sendTo(c, { t: 'accounts', state: accounts.state(onlineAccounts()) });
        break;
      case 'accounts.invite': {
        const r = accounts.invite(who, msg.role === 'admin' ? 'admin' : 'member', typeof msg.name === 'string' ? msg.name : undefined);
        if (typeof r === 'string') return sendTo(c, { t: 'accounts.invited', error: r });
        sendTo(c, { t: 'accounts.invited', invite: r });
        accountsChanged();
        break;
      }
      case 'accounts.cancel':
        if (accounts.cancel(str(msg.inviteId, 32))) accountsChanged();
        break;
      case 'accounts.revoke': {
        const id = str(msg.accountId, 32);
        if (id === c.accountId) return warn(c, "You can't revoke your own account");
        const a = accounts.revoke(id);
        if (!a) break;
        console.log(`  ${who} revoked ${a.name}'s account`);
        toastAll(`${who} revoked ${a.name}'s account`);
        accountsChanged(); // signs them out everywhere
        signins.forget(a.id); // and their Claude and GitHub sign-ins go with the account
        accountLimits.get(a.id)?.reader.close();
        accountLimits.delete(a.id);
        break;
      }
      case 'accounts.role': {
        const id = str(msg.accountId, 32);
        if (id === c.accountId) return warn(c, "You can't change your own role");
        const a = accounts.setRole(id, msg.role === 'admin' ? 'admin' : 'member');
        if (!a) break;
        toastAll(a.role === 'admin' ? `${who} made ${a.name} an admin` : `${a.name} is no longer an admin`);
        accountsChanged();
        // Only admins may use the office's own sign-ins: a demoted one is back on their own.
        void signins.look(a.id, true);
        break;
      }
      case 'accounts.shared': {
        if (msg.on === accounts.sharedPassword) break;
        // Only someone who can still get in without it may switch it off.
        if (!msg.on && !c.accountId) return warn(c, 'Sign in with an admin account of your own first, or nobody could get back in');
        accounts.setSharedPassword(!!msg.on);
        console.log(`  ${who} switched the shared office password ${msg.on ? 'on' : 'off'}`);
        toastAll(msg.on ? `${who} switched the shared office password back on` : `🔑 ${who} switched off the shared office password — everyone signs in with their own account now`);
        accountsChanged(); // signs out whoever came in with it
        break;
      }
    }
  };

  const resync = setInterval(async () => {
    for (const c of clients.values()) {
      if (!c.stale.size || c.ws.bufferedAmount > SLOW_CLIENT_BYTES / 8) continue;
      // Awaited because on a hosted floor the screen comes off that machine, and a stale client
      // needs the newest one rather than the last one that happened to be here.
      for (const wid of c.stale) {
        const snap = c.attached.has(wid) ? await anyWorkerFloor(wid)?.workers.attach(wid, c.id, c.peer.name) : undefined;
        if (snap) sendTo(c, { t: 'term.snapshot', workerId: wid, ...snap });
      }
      c.stale.clear();
    }
  }, 1000);

  // Drop dead connections so ghosts don't linger in the office.
  // Also signs out anyone `agent-office accounts` revoked, and passes on role changes made there.
  const heartbeat = setInterval(() => {
    let accountsMoved = false;
    for (const c of clients.values()) {
      if (!c.isAlive) {
        c.ws.terminate();
        continue;
      }
      if (!c.out && (!stillIn(c) || c.admin !== meOf(c.accountId).admin)) accountsMoved = true;
      c.isAlive = false;
      c.ws.ping();
    }
    if (accountsMoved) accountsChanged();
  }, 20_000);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(cfg.port, cfg.host, () => resolve());
  });
  services.start();
  tailnet.start(() => services.list().map((s) => s.port));

  /** With `keep` (a restart), workers' terminals keep running for the next office to pick up. */
  const shutdown = (keep = false) => {
    clearInterval(heartbeat);
    clearInterval(resync);
    clearTimeout(floorsTimer);
    arcade.flush();
    upgrader.stop();
    services.stop();
    tailnet.stop();
    webhook.stop();
    machine.stop();
    sky.stop();
    themes.stop();
    for (const f of floors.values()) f.shutdown(keep);
    // Every machine goes at once, so no host is left believing it is still serving floors here. Its
    // own machine is what decides what happens next: a host reconnecting finds out and says so.
    registry.closeAll();
    ledger.flush();
    limits.close();
    for (const a of accountLimits.values()) a.reader.close();
    signins.shutdown();
    for (const c of clients.values()) c.ws.close();
    server.close();
    hookServer.close();
  };

  /** A link (path and fragment) that signs one browser in, once; see Auth.linkKey. */
  const signInLink = () => `/login#key=${auth.linkKey()}`;

  return { server, shutdown, accounts, publicDir, hookPort, signInLink, floors: () => [...floors.values()], projectsDir: () => building.projectsDir, resolvedAgent: resolveCommand(cfg.agentCmd) };
}
