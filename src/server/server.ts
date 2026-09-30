import http from 'node:http';
import https from 'node:https';
import type { Config } from './config.js';
import { resolveCommand } from './workers.js';
import type { Ctx } from './office/context.js';
import { messaging } from './office/messaging.js';
import { createCore } from './office/core.js';
import { floorHelpers, openFloors } from './office/floors.js';
import { createLateServices, createServices } from './office/services.js';
import { people } from './office/people.js';
import { navigation } from './office/navigation.js';
import { gates } from './office/gates.js';
import { startTimers } from './office/timers.js';
import { findPublicDir } from './http/static.js';
import { requestHandler } from './http/router.js';
import { routes } from './http/routes/index.js';
import { startHookServer } from './hooks/server.js';
import { acceptWebSockets } from './ws/upgrade.js';

/** What a test can set about how the office starts: the client bundle it serves, instead of the built one. */
export interface StartOptions {
  publicDir?: string;
}

export async function startServer(cfg: Config, opts: StartOptions = {}) {
  const publicDir = opts.publicDir ?? findPublicDir();
  // Everything the office's parts share (see office/context.ts), filled in a stage at a time in the
  // order the office has always started up in: the hook server already answers the workers still
  // running from the last office while the floors open.
  const ctx = {} as Ctx;
  Object.assign(ctx, messaging(ctx), floorHelpers(ctx), people(ctx), navigation(ctx), gates(ctx));
  Object.assign(ctx, createCore(ctx, cfg, publicDir));
  const { hookServer, hookPort } = await startHookServer(ctx);
  Object.assign(ctx, createServices(ctx));
  Object.assign(ctx, await openFloors(ctx, hookPort));
  Object.assign(ctx, createLateServices(ctx));

  // --- HTTP ------------------------------------------------------------------------------------
  const handler = requestHandler(ctx, routes);
  const server = cfg.tls ? https.createServer({ cert: cfg.tls.cert, key: cfg.tls.key }, handler) : http.createServer(handler);

  // --- WebSocket -------------------------------------------------------------------------------
  acceptWebSockets(ctx, server);
  const stopTimers = startTimers(ctx);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(cfg.port, cfg.host, () => resolve());
  });
  const { services, tailnet } = ctx;
  services.start();
  tailnet.start(() => services.list().map((s) => s.port));

  /** With `keep` (a restart), workers' terminals keep running for the next office to pick up. */
  const shutdown = (keep = false) => {
    stopTimers();
    ctx.cancelFloorsChanged();
    ctx.arcade.flush();
    ctx.upgrader.stop();
    services.stop();
    tailnet.stop();
    ctx.webhook.stop();
    ctx.machine.stop();
    ctx.sky.stop();
    ctx.themes.stop();
    for (const f of ctx.floors.values()) f.shutdown(keep);
    ctx.building.shutdown(keep);
    ctx.ledger.flush();
    ctx.limits.close();
    for (const a of ctx.accountLimits.values()) a.reader.close();
    ctx.signins.shutdown();
    for (const c of ctx.clients.values()) c.ws.close();
    server.close();
    hookServer.close();
  };

  /** A link (path and fragment) that signs one browser in, once; see Auth.linkKey. */
  const signInLink = () => `/login#key=${ctx.auth.linkKey()}`;

  return {
    server,
    shutdown,
    accounts: ctx.accounts,
    publicDir,
    hookPort,
    signInLink,
    floors: () => [...ctx.floors.values()],
    projectsDir: () => ctx.building.projectsDir,
    resolvedAgent: resolveCommand(cfg.agentCmd),
  };
}
