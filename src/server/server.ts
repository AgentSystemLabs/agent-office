import http from 'node:http';
import https from 'node:https';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import type { Config } from './config.js';
import type { Session } from './auth.js';
import { MAX_REPOS, childEnv, resolveCommand, type RepoSource } from './workers.js';
import { OPEN_CODE_MODEL_MAX } from './agents.js';
import { MAX_WORKER_LIMIT, parseWorkerLimit } from './machine.js';
import { notLeaving } from './leave-on-merge.js';
import { findWorker, readHireRequest, readHomeRequest, workerRow, type PullsView } from './office-workers.js';
import { relayUpgrade, tunneledPort } from './relay.js';
import type { ChatLine, ClientMsg, MeetingRequest, ServerMsg, SignInKind, WorkerInfo } from '../shared/protocol.js';
import { GH_COMMENT_MAX, GH_LABEL_MAX, isAgentEffort, isAgentProvider } from '../shared/protocol.js';
import { DESK_BY_ID, elevatorSpot, nextFreeSeat } from '../shared/layout.js';
import { OFFICE_MAP, seatHereOn } from '../shared/maps/index.js';
import { STREAM } from '../shared/jukebox.js';
import { checkFrame } from '../shared/cabinet.js';
import { lookFromSeed, sanitizeLook } from '../shared/avatar.js';
import { isEmote } from '../shared/emotes.js';
import { isThemePick } from '../shared/theme.js';
import { PROMPTS, PROMPT_MAX, isPromptId } from '../shared/prompts.js';
import { ROOF, isDrink } from '../shared/rooftop.js';
import { isBarGame, tossOk, type BarGame } from '../shared/bargames.js';
import type { Floor } from './floor.js';
import type { Ctx } from './office/context.js';
import { SLOW_CLIENT_BYTES, newClient, throttle, type Client } from './office/client.js';
import { COLOR_RE, arrivalSpot, issueNumber, num, repoOf, spotFrom, str } from './office/input.js';
import { messaging } from './office/messaging.js';
import { createCore } from './office/core.js';
import { floorHelpers, openFloors } from './office/floors.js';
import { createLateServices, createServices } from './office/services.js';
import { people } from './office/people.js';
import { navigation } from './office/navigation.js';
import { gates } from './office/gates.js';
import { findPublicDir } from './http/static.js';
import { readBody, sameOrigin, send } from './http/util.js';
import { requestHandler } from './http/router.js';
import { routes } from './http/routes/index.js';
import { floorView, roofView, screensOf } from './office/views.js';
import { cabinetChanged, cabinetPlayer, cabinetState, stopPlaying } from './ws/handlers/cabinet.js';
import { drawingChanged } from './ws/handlers/whiteboard.js';
import { ballChanged } from './ws/handlers/ball.js';
import { carsChanged } from './ws/handlers/car.js';

const CLEANUPS = new Set(['keep', 'worktree', 'all']);

/** The least time between two 'term.typing' notes from one person in one terminal. */
const TYPING_GAP_MS = 500;
/** The quickest anyone throws one dart after another, or one axe (ms): a page's own wait is longer. */
const TOSS_EVERY: Record<BarGame, number> = { darts: 250, axe: 700 };

function refuseUpgrade(socket: Duplex) {
  socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
  socket.destroy();
}

/** What a test can set about how the office starts: the client bundle it serves, instead of the built one. */
export interface StartOptions {
  publicDir?: string;
}

export async function startServer(cfg: Config, opts: StartOptions = {}) {
  const publicDir = opts.publicDir ?? findPublicDir();
  // Everything the office's parts share (see office/context.ts), filled in a stage at a time in the
  // order the office has always started up in.
  const ctx = {} as Ctx;
  Object.assign(ctx, messaging(ctx), floorHelpers(ctx), people(ctx), navigation(ctx), gates(ctx));
  Object.assign(ctx, createCore(ctx, cfg, publicDir));
  const { sendTo, broadcast, toastAll, toFloor, toastFloor, toNeighbors, warn, floorOf, workerFloor, floorInfos, floorsChanged, arrivalFloor, closeFloor } = ctx;
  const { meOf, onlineAccounts, accountsChanged, stillIn, goToFloor, goToRoof, takeIssue, withSignIn, withFreshBase, withGitHub, claudeFor } = ctx;
  const { accounts, auth, clients, chat, arcade, building, floors } = ctx;

  // --- Loopback-only endpoint for authenticated agent events -------------------------------
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
      const err = floor.queue.remove(url.searchParams.get('task') ?? '');
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
    const err = floor.queue.add(str(body?.prompt, 20000), agent.name, str(body?.title, 200) || undefined, issue, undefined, undefined, undefined, floor.workers.ownerOf(agent.id));
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
    const view: PullsView = { pulls: floor.github.pulls.items, tasks: floor.queue.state().tasks, pullsOf: (id) => floors.get(id)?.github.pulls.items };
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
        leaveOnMerge: ctx.leaveOnMerge.on,
        providers: floor.project.agentProviders,
        defaultProvider: floor.workers.officeDefault.provider,
        freeDesk: free?.id ?? null,
        ...(ctx.ledger.hiringPaused ? { hiringPaused: ctx.ledger.hiringPaused } : {}),
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
      let err = floor.workers.prompt(w.id, text, who);
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
    const r = floor.workers.spawn(desk, who, ask.prompt, worktree, 'agent', provider, ask.model, ask.effort, undefined, owner);
    if (typeof r === 'string') return send(res, 400, { error: r });
    toastFloor(floor, `${who} hired ${r.name}${ask.issue ? ` for issue #${ask.issue}` : ' with a task'}`);
    if (ask.issue) {
      const n = ask.issue;
      floor.queue.dropIssue(n);
      const as = owner ? ctx.signins.ghAs(owner) : undefined;
      if (typeof as === 'string') toastFloor(floor, `Couldn't assign issue #${n} on GitHub: ${as}`, 'warn');
      else void floor.github.claim(n, as).then((e) => e && toastFloor(floor, `Couldn't assign issue #${n} on GitHub: ${e}`, 'warn'));
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

  Object.assign(ctx, createServices(ctx));
  const { themes, maps, prompts, leaveOnMerge, ledger, signins, accountLimits, webhook, machine, limitsOf, pumpQueues } = ctx;
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
  Object.assign(ctx, await openFloors(ctx, hookPort));
  const { openFloor } = ctx;

  Object.assign(ctx, createLateServices(ctx));
  const { team, services, upgrader } = ctx;

  // --- HTTP ------------------------------------------------------------------------------------
  const handler = requestHandler(ctx, routes);

  const server = cfg.tls ? https.createServer({ cert: cfg.tls.cert, key: cfg.tls.key }, handler) : http.createServer(handler);

  // --- WebSocket -------------------------------------------------------------------------------
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    const tunneled = tunneledPort(req, cfg.port, cfg.tailnet);
    const svc = tunneled ? services.lookup(tunneled) : undefined;
    if (tunneled && svc) {
      if (svc !== 'gone' && auth.fromAnyCookie(req)) return relayUpgrade(req, socket, head, svc);
      return refuseUpgrade(socket);
    }
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://x');
    } catch {
      socket.destroy();
      return;
    }
    const session = url.pathname === '/ws' && sameOrigin(req, cfg) ? auth.fromRequest(req) : undefined;
    if (!session) return refuseUpgrade(socket);
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, url, session));
  });

  const onConnection = (ws: WebSocket, url: URL, session: Session) => {
    const id = randomBytes(5).toString('hex');
    // Back on the floor they were on before a reload, a restart or closing the tab, else the first floor.
    const wanted = url.searchParams.get('floor');
    // Their floor's gone since (taken off the building, or its checkout deleted): up to the roof instead.
    const gone = !!wanted && wanted !== ROOF && !floors.has(wanted);
    // Up on the roof, as long as there's a building under it.
    const onRoof = (wanted === ROOF || gone) && floors.size > 0;
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
    const client = newClient(id, ws, { accountId: account?.id, admin: me.admin }, {
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
    });
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
      sky: ctx.sky.state,
      theme: themes.state(),
      map: maps.state(),
      prompts: prompts.state(),
      leaveOnMerge: leaveOnMerge.state(),
      ...(onRoof ? roofView(ctx) : floorView(ctx, floor)),
    });
    screensOf(ctx, client, floor);
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
      if (client.whiteboard) drawingChanged(ctx, floorOf(client));
      stopPlaying(ctx, client);
      for (const f of floors.values()) {
        f.workers.detachAll(id);
        f.changes.unwatchAll(id);
        if (f.court.left(id)) ballChanged(ctx, f);
        if (f.garage.leave(id)) carsChanged(ctx, f);
      }
      broadcast({ t: 'peer.leave', id });
      if (account) accountsChanged();
      floorsChanged();
    });
    ws.on('error', () => ws.terminate());
  };

  const decorChanged = (floor: Floor) => toFloor(floor, { t: 'decor', items: floor.decor.list() });
  /** The floor's signs or back office changed: its people see it, and everyone sees the building's outside change. */
  const planChanged = (floor: Floor) => {
    toFloor(floor, { t: 'plan', plan: floor.plan.state() });
    floorsChanged();
  };
  const jukeboxChanged = (floor: Floor) => toFloor(floor, { t: 'jukebox', state: floor.jukebox.state() });
  const teamState = async () => ({ ...(await team.state()), deploy: cfg.deployScript });
  const teamChanged = async () => broadcast({ t: 'team', state: await teamState() });

  const handleMessage = (c: Client, msg: ClientMsg) => {
    const who = c.peer.name;
    /** The floor `c` is on, or a note to them that they have to be on one. */
    const here = (): Floor | undefined => {
      const f = floorOf(c);
      if (!f) warn(c, 'Take the elevator to a floor first');
      return f;
    };
    /** A worker by id, with the floor it sits on. */
    const worker = (id: unknown) => {
      const wid = str(id, 32);
      const floor = workerFloor(wid);
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
        if (!throttle(c, 'act', 100)) break;
        toNeighbors(c, { t: 'peer.act', id: c.id }, true);
        break;
      }
      case 'golf': {
        const [yaw, loft, power] = [num(msg.yaw), num(msg.loft), num(msg.power)];
        if (!c.peer.golfing || Math.abs(yaw) > 2 || loft < 0 || loft > 1.6 || power < 0 || power > 1 || !throttle(c, 'golf', 800)) break;
        toNeighbors(c, { t: 'golf', id: c.id, yaw, loft, power });
        break;
      }
      case 'toss': {
        // Only at the line they stepped up to, and no quicker than anyone throws.
        const toss: { game: unknown; u: unknown; v: unknown; n: unknown } = { game: msg.game, u: msg.u, v: msg.v, n: msg.n };
        if (!tossOk(toss) || c.peer.throwing !== toss.game || !throttle(c, 'toss', TOSS_EVERY[toss.game])) break;
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
          if (floors.size) goToRoof(c);
          else warn(c, 'There is no building to go up on yet');
          break;
        }
        const floor = floors.get(str(msg.floor, 64));
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
        if (changed) ballChanged(ctx, floor);
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
      case 'car.drive': {
        const floor = floorOf(c);
        const car = Math.trunc(num(msg.car));
        const now = floor?.garage.drive(c.id, car, { x: num(msg.x), z: num(msg.z), rotY: num(msg.rotY), speed: num(msg.speed), steer: num(msg.steer) });
        if (now) toNeighbors(c, { t: 'car.move', car, ...now }, true);
        break;
      }
      case 'car.honk': {
        const car = floorOf(c)?.garage.honk(c.id);
        if (car !== undefined) toNeighbors(c, { t: 'car.honk', car });
        break;
      }
      case 'dog.pet':
        floorOf(c)?.dog.pet(c.peer);
        break;
      case 'dog.name': {
        const floor = here();
        if (!floor) break;
        const name = floor.dog.rename(str(msg.name, 200));
        toastFloor(floor, `🐶 ${who} named the dog ${name}`);
        break;
      }
      case 'worker.spawn': {
        const floor = here();
        if (!floor) break;
        const kind = msg.kind === 'shell' ? 'shell' : 'agent';
        if (kind === 'agent' && msg.provider !== undefined && (!isAgentProvider(msg.provider) || !floor.project.agentProviders.includes(msg.provider))) {
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
        const hire = () => {
          const r = floor.workers.spawn(str(msg.deskId, 32), who, str(msg.prompt, 20000) || undefined, msg.worktree === true, kind, msg.provider, model, effort, undefined, c.accountId, repos, msg.via === 'herald' ? 'herald' : undefined);
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
        warn(c, w ? w.floor.workers.resume(w.wid) : 'No such worker');
        break;
      }
      case 'worker.kill': {
        const w = worker(msg.workerId);
        if (!w) break;
        const { floor, info } = w;
        // The worker leaves right away; its worktree is dealt with after that, and the outcome follows.
        const done = floor.sendHome(info.id, CLEANUPS.has(String(msg.cleanup)) ? msg.cleanup : undefined);
        toastFloor(floor, `${who} sent ${info.name} home`);
        void done.then(({ note, error }) => {
          if (note) toastFloor(floor, note);
          if (error) toastFloor(floor, error, 'warn');
        });
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
        const snap = w?.floor.workers.attach(w.wid, c.id, who);
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
        workerFloor(wid)?.workers.detach(wid, c.id);
        break;
      }
      case 'worker.prompt': {
        const w = worker(msg.workerId);
        const err = w ? w.floor.workers.prompt(w.wid, str(msg.prompt, 20000), who) : 'No such worker';
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
        withSignIn(c, hires ? claudeFor(floor.workers.officeDefault.provider) : undefined, () => {
          const r = floor.workers.station(deskId, who, str(msg.prompt, 20000), c.accountId);
          if (typeof r === 'string') warn(c, r);
          else if (r.hired) toastFloor(floor, `${who} asked the ${r.info.name} something`);
        });
        break;
      }
      case 'worker.pr': {
        const w = worker(msg.workerId);
        if (!w) break;
        const { floor, wid } = w;
        withGitHub(c, (as) => void floor.workers.openPr(wid, who, as).then((r) => {
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
          void floor.github.refresh().then(() => {
            if (own && !floor.github.pulls.items.some((p) => p.number === own.number)) setTimeout(() => void floor.github.refresh(), 3000);
          });
          for (const x of info?.repos ?? []) void floors.get(x.floor)?.github.refresh();
        }));
        break;
      }
      case 'term.input':
        if (c.attached.has(msg.workerId)) workerFloor(msg.workerId)?.workers.write(msg.workerId, str(msg.data, 64 * 1024), who);
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
        if (c.attached.has(msg.workerId)) workerFloor(msg.workerId)?.workers.resize(msg.workerId, num(msg.cols), num(msg.rows));
        break;
      case 'gh.refresh':
        void floorOf(c)?.github.refresh();
        break;
      case 'gh.merge': {
        const floor = here();
        const n = num(msg.number);
        const method = (['squash', 'merge', 'rebase'] as const).find((m) => m === msg.method);
        if (!floor || !Number.isSafeInteger(n) || n <= 0 || !method) break;
        withGitHub(
          c,
          (as) =>
            void floor.github.merge(n, method, msg.deleteBranch === true, msg.auto === true, as).then((error) => {
              sendTo(c, { t: 'gh.merged', number: n, error });
              if (error) return;
              toastFloor(floor, msg.auto ? `${who} set PR #${n} to merge once its checks pass` : `🎉 ${who} merged PR #${n}`);
              // An auto-merge rings once GitHub gets round to it and the boards see it merged.
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
        const invalid = !body.trim() ? 'The comment is empty' : body.length > GH_COMMENT_MAX ? `GitHub takes comments of up to ${GH_COMMENT_MAX} characters` : '';
        if (invalid) {
          sendTo(c, { t: 'gh.commented', kind, number: n, error: invalid });
          break;
        }
        withGitHub(
          c,
          (as) =>
            void floor.github.comment(kind, n, body, as).then((r) => {
              sendTo(c, { t: 'gh.commented', kind, number: n, ...r });
              if (r.comment) toastFloor(floor, `💬 ${who} commented on ${kind === 'pull' ? 'PR' : 'issue'} #${n}`);
            }),
          (error) => sendTo(c, { t: 'gh.commented', kind, number: n, error }),
        );
        break;
      }
      case 'gong': {
        const floor = floorOf(c);
        if (!floor || !throttle(c, 'gong', 500)) break;
        toFloor(floor, { t: 'gong', why: 'hit', by: who });
        break;
      }
      case 'horn': {
        if (c.peer.floor !== ROOF || !throttle(c, 'horn', 1500)) break;
        for (const o of clients.values()) if (o.peer.floor === ROOF) sendTo(o, { t: 'horn', by: who });
        break;
      }
      case 'gh.close': {
        const floor = here();
        const n = num(msg.number);
        const kind = msg.kind === 'issue' || msg.kind === 'pull' ? msg.kind : undefined;
        if (!floor || !Number.isSafeInteger(n) || n <= 0 || !kind) break;
        const reason = msg.reason === 'not planned' ? 'not planned' : 'completed';
        withGitHub(
          c,
          (as) =>
            void floor.github.close(kind, n, { comment: str(msg.comment, 20000).trim() || undefined, reason, deleteBranch: msg.deleteBranch === true }, as).then((error) => {
              sendTo(c, { t: 'gh.closed', kind, number: n, error });
              if (error) return;
              if (kind === 'pull') return toastFloor(floor, `${who} closed PR #${n} without merging`);
              // Nobody should be seated for an issue that's closed.
              const dropped = floor.queue.dropIssue(n);
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
        withGitHub(
          c,
          (as) =>
            void floor.github.setLabels(kind, n, add, remove, as).then((r) => {
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
        if (msg.provider !== undefined && (!isAgentProvider(msg.provider) || !floor.project.agentProviders.includes(msg.provider))) {
          warn(c, 'Unknown agent provider');
          break;
        }
        const issue = Number.isInteger(msg.issue) && (msg.issue as number) > 0 ? (msg.issue as number) : undefined;
        const model = msg.model === undefined ? undefined : str(msg.model, OPEN_CODE_MODEL_MAX + 1);
        const effort = isAgentEffort(msg.effort) ? msg.effort : undefined;
        // Its worker runs on the sign-ins of whoever queued it, whenever it gets a desk.
        withSignIn(c, claudeFor(msg.provider ?? floor.workers.officeDefault.provider), () => {
          const err = floor.queue.add(str(msg.prompt, 20000), who, str(msg.title, 200), issue, msg.provider, model, effort, c.accountId);
          if (err) warn(c, err);
          else toastFloor(floor, `📋 ${who} queued ${issue !== undefined ? `issue #${issue}` : 'a task'}`);
        });
        break;
      }
      case 'queue.remove': {
        const floor = here();
        if (floor) warn(c, floor.queue.remove(str(msg.taskId, 32)));
        break;
      }
      case 'queue.move':
        floorOf(c)?.queue.move(str(msg.taskId, 32), num(msg.delta) < 0 ? -1 : 1);
        break;
      case 'queue.retry': {
        const floor = here();
        if (floor) warn(c, floor.queue.retry(str(msg.taskId, 32)));
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
        if (msg.provider !== undefined && (!isAgentProvider(msg.provider) || !floor.project.agentProviders.includes(msg.provider))) {
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
        withSignIn(c, claudeFor(request.provider ?? floor.workers.officeDefault.provider), () => withFreshBase(c, floor, () => warn(c, floor.meetings.start(request, who, c.accountId))));
        break;
      }
      case 'meeting.stop': {
        const floor = here();
        if (floor) warn(c, floor.meetings.stop(who));
        break;
      }
      case 'meeting.clear': {
        const floor = here();
        if (floor) warn(c, floor.meetings.clear(who));
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
              : msg.pick === 'off'
                ? `${who} took the holiday decorations down`
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
        // Committed as whoever pressed it: their GitHub name and email, once they've signed in to it.
        const env = c.accountId ? signins.apply(c.accountId, childEnv(), [], 'github') : undefined;
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
        if (w) withGitHub(c, (as) => void w.floor.changes.pullRequest(w.wid, str(msg.title, 300), str(msg.body, 20000), who, as?.env, repoOf(msg.repo)).then((err) => warn(c, err)));
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
        const d = floor.decor.add(msg.decor, who);
        if (typeof d === 'string') return warn(c, d);
        decorChanged(floor);
        toastFloor(floor, `🖼️ ${who} hung ${d.title ? `“${d.title}”` : 'a picture'}`);
        break;
      }
      case 'decor.update': {
        const floor = here();
        if (!floor) break;
        const d = floor.decor.update(str(msg.id, 32), msg.decor);
        if (typeof d === 'string') return warn(c, d);
        decorChanged(floor);
        break;
      }
      case 'decor.remove': {
        const floor = here();
        if (!floor) break;
        const d = floor.decor.remove(str(msg.id, 32));
        if (!d) break;
        decorChanged(floor);
        toastFloor(floor, `${who} took down ${d.title ? `“${d.title}”` : 'a picture'}`);
        break;
      }
      case 'desk.label': {
        const floor = here();
        if (!floor) break;
        const deskId = str(msg.deskId, 32);
        const r = floor.plan.label(deskId, msg.text, msg.color, who);
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
        const r = floor.plan.expand();
        if (typeof r === 'string') return warn(c, r);
        planChanged(floor);
        toastFloor(floor, `🔨 ${who} knocked out the back wall: ${r.map((id) => DESK_BY_ID.get(id)?.label).join(' and ')} are ready for workers`);
        break;
      }
      case 'floor.shrink': {
        const floor = here();
        if (!floor) break;
        const r = floor.plan.shrink((id) => floor.workers.deskOccupied(id));
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
        drawingChanged(ctx, floor);
        break;
      }
      case 'wb.update': {
        const floor = here();
        if (!floor) break;
        const { accepted, error } = floor.whiteboard.apply(msg.elements);
        if (accepted.length) toNeighbors(c, { t: 'wb.update', elements: accepted });
        warn(c, error);
        break;
      }
      case 'wb.pointer': {
        if (!c.whiteboard || !throttle(c, 'wb.pointer', 25)) break;
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
        const r = floor.jukebox.play({ track: msg.track, url: msg.url }, who);
        if ('error' in r) return warn(c, r.error);
        if (!r.changed) break;
        jukeboxChanged(floor);
        toastFloor(floor, floor.jukebox.state().track === STREAM ? `📻 ${who} tuned the jukebox to ${floor.jukebox.title()}` : `🎵 ${who} put on “${floor.jukebox.title()}”`);
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
        const at = cabinetPlayer(ctx, floor);
        if (at && at !== c) {
          warn(c, `${at.peer.name} is on the arcade — press E there to watch`);
          sendTo(c, { t: 'cabinet', state: cabinetState(ctx, floor) });
          break;
        }
        // Already at it: that game's over, and this is the next one.
        if (c.playing) arcade.leave(c.game, floor.id);
        c.game = arcade.start({ owner: c.accountId ? `account:${c.accountId}` : `name:${who}`, name: who, color: c.peer.color, connection: c.id }, msg.game);
        if (c.game !== msg.game && !arcade.counts(c.game)) warn(c, "🕹️ That's a lot of new games in a row, so this one won't go on the high-score table");
        c.playing = true;
        c.frame = undefined;
        cabinetChanged(ctx, floor);
        break;
      }
      case 'cabinet.leave':
        stopPlaying(ctx, c);
        break;
      case 'cabinet.frame': {
        const floor = floorOf(c);
        const frame = checkFrame(msg.frame);
        if (!c.playing || !floor || !frame) break;
        // Every frame counts towards the score, even one that comes too soon after the last to pass on.
        if (arcade.frame(c.game, frame, floor.id) === 'void') warn(c, "🕹️ The office couldn't follow this game, so its score won't go on the high-score table");
        c.frame = frame;
        if (!throttle(c, 'cabinet.frame', 40)) break;
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

  const resync = setInterval(() => {
    for (const c of clients.values()) {
      if (!c.stale.size || c.ws.bufferedAmount > SLOW_CLIENT_BYTES / 8) continue;
      for (const wid of c.stale) {
        const snap = c.attached.has(wid) ? workerFloor(wid)?.workers.attach(wid, c.id, c.peer.name) : undefined;
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
  ctx.tailnet.start(() => services.list().map((s) => s.port));

  /** With `keep` (a restart), workers' terminals keep running for the next office to pick up. */
  const shutdown = (keep = false) => {
    clearInterval(heartbeat);
    clearInterval(resync);
    ctx.cancelFloorsChanged();
    arcade.flush();
    upgrader.stop();
    services.stop();
    ctx.tailnet.stop();
    webhook.stop();
    machine.stop();
    ctx.sky.stop();
    ctx.themes.stop();
    for (const f of floors.values()) f.shutdown(keep);
    ledger.flush();
    ctx.limits.close();
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
