import type http from 'node:http';
import type https from 'node:https';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { relayUpgrade, tunneledPort } from '../relay.js';
import { sameOrigin } from '../http/util.js';
import type { Ctx } from '../office/context.js';
import { onConnection } from './connection.js';

function refuseUpgrade(socket: Duplex) {
  socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
  socket.destroy();
}

/**
 * Takes the WebSockets opened on `server`: a service tunnel's are relayed to that worker's server,
 * and the office's own /ws needs a session, from a page that is the office itself.
 */
export function acceptWebSockets(ctx: Ctx, server: http.Server | https.Server) {
  const { cfg, auth } = ctx;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    const tunneled = tunneledPort(req, cfg.port, cfg.tailnet);
    const svc = tunneled ? ctx.services.lookup(tunneled) : undefined;
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
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ctx, ws, url, session));
  });
}
