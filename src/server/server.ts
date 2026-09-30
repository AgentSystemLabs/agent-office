import http from 'node:http';
import https from 'node:https';
import { randomBytes } from 'node:crypto';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import type { Config } from './config.js';
import type { Session } from './auth.js';
import { resolveCommand } from './workers.js';
import { relayUpgrade, tunneledPort } from './relay.js';
import type { ChatLine, ClientMsg } from '../shared/protocol.js';
import { elevatorSpot } from '../shared/layout.js';
import { seatHereOn } from '../shared/maps/index.js';
import { lookFromSeed, sanitizeLook } from '../shared/avatar.js';
import { isEmote } from '../shared/emotes.js';
import { ROOF, isDrink } from '../shared/rooftop.js';
import { isBarGame } from '../shared/bargames.js';
import type { Floor } from './floor.js';
import type { Ctx } from './office/context.js';
import { SLOW_CLIENT_BYTES, newClient, throttle, type Client } from './office/client.js';
import { COLOR_RE, issueNumber, num, spotFrom, str } from './office/input.js';
import { messaging } from './office/messaging.js';
import { createCore } from './office/core.js';
import { floorHelpers, openFloors } from './office/floors.js';
import { createLateServices, createServices } from './office/services.js';
import { people } from './office/people.js';
import { navigation } from './office/navigation.js';
import { gates } from './office/gates.js';
import { findPublicDir } from './http/static.js';
import { sameOrigin } from './http/util.js';
import { requestHandler } from './http/router.js';
import { routes } from './http/routes/index.js';
import { startHookServer } from './hooks/server.js';
import { floorView, roofView, screensOf } from './office/views.js';
import { dispatch } from './ws/dispatch.js';
import { features } from './ws/handlers/index.js';
import { mapNews } from './ws/handlers/settings.js';

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
  const { sendTo, broadcast, toNeighbors, warn, floorOf, workerFloor, floorInfos, floorsChanged, arrivalFloor } = ctx;
  const { meOf, accountsChanged, stillIn } = ctx;
  const { accounts, auth, clients, chat, arcade, building, floors } = ctx;

  const { hookServer, hookPort } = await startHookServer(ctx);

  Object.assign(ctx, createServices(ctx));
  const { themes, maps, prompts, leaveOnMerge, ledger, signins, accountLimits, webhook, machine, limitsOf } = ctx;
  Object.assign(ctx, await openFloors(ctx, hookPort));

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
    if (maps.reload()) mapNews(ctx, mapWas);
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
      // Each feature lets go of what they had (see FeatureHooks), then of what they had on each floor.
      for (const f of features) f.closed?.(ctx, client);
      for (const floor of floors.values()) for (const f of features) f.closedOn?.(ctx, client, floor);
      broadcast({ t: 'peer.leave', id });
      if (account) accountsChanged();
      floorsChanged();
    });
    ws.on('error', () => ws.terminate());
  };


  const handleMessage = (c: Client, msg: ClientMsg) => {
    if (dispatch(ctx, c, msg)) return;
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
      case 'ping':
        sendTo(c, { t: 'pong', at: num(msg.at), now: Date.now() });
        break;
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
