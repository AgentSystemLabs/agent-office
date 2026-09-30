import type { Duplex } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { FLOORHOST_MAX_FRAME, FLOORHOST_PROTOCOL, isFromFloor, isToOffice, type FromFloor, type FloorReady, type ToOffice } from '../shared/floorhost.js';
import { Hosts, type Host } from './hosts.js';

/** One floor a connected machine is serving, with the roster it last announced. */
export interface LiveFloor {
  id: string;
  name: string;
  seats: number;
  accepting: boolean;
  /** The worker's own ids, so the office can index them without the workerFloor scan (server.ts:256). */
  workers: Set<string>;
  ready: FloorReady | undefined;
}

/**
 * The machines connected to this office, and the floors each is serving.
 *
 * One socket carries N floors (decision 6), so the socket — not the floor — is the unit of trust and
 * of failure. That is the whole reason this class exists in this shape: when a socket drops, every
 * floor it carried has to be marked unreachable **in one pass**, before any per-worker exit is
 * handled. Letting the first worker's `gone` decide would mark the host back reachable while the rest
 * are still settling.
 *
 * Nothing here is a permission check. A paired machine may seat anyone in the office onto its own
 * floors, which is the permission model; this only answers what is connected and what to tell it.
 */
export class HostRegistry {
  private wss = new WebSocketServer({ noServer: true, maxPayload: FLOORHOST_MAX_FRAME });
  private byHost = new Map<string, HostSocket>();

  constructor(private hosts: Hosts) {}

  /** How many floors a connected machine is serving, for ⚙️ Settings. */
  floorsOf(hostId: string): number {
    return this.byHost.get(hostId)?.floors.size ?? 0;
  }

  /** What ⚙️ Settings shows: floor counts by machine, for the browser. */
  counts(): Map<string, number> {
    return new Map([...this.byHost].map(([id, s]) => [id, s.floors.size]));
  }

  /** Whether a floor is currently served by a connected machine, and by which. */
  serves(floorId: string): HostSocket | undefined {
    for (const socket of this.byHost.values()) if (socket.floors.has(floorId)) return socket;
    return undefined;
  }

  isReachable(floorId: string): boolean {
    return this.serves(floorId) !== undefined;
  }

  /**
   * Handles an upgrade for `/floor-host`. Returns false when the path is not ours, so the caller can
   * carry on with its own routing; returns true having either taken the socket or refused it.
   *
   * Branched before the session gate on purpose: a floor host has no browser cookie, and it must
   * never be mistaken for a visitor. Its credential is the token in its first frame.
   */
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, path: string): boolean {
    if (path !== '/floor-host') return false;
    socket.on('error', () => socket.destroy());
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws));
    return true;
  }

  private onConnection(ws: WebSocket) {
    // Nothing is trusted until the first frame says hello with a token we recognise. A socket that
    // never does is dropped by the handshake timer below.
    let entry: HostSocket | undefined;
    const timer = setTimeout(() => {
      if (!entry) ws.close(1002, 'no hello');
    }, 10_000);

    ws.on('message', (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!entry) {
        const opened = this.onHello(ws, msg);
        if (!opened) {
          clearTimeout(timer);
          ws.close(1008, 'refused');
          return;
        }
        entry = opened;
        clearTimeout(timer);
        return;
      }
      this.onFrame(entry, msg);
    });

    ws.on('close', () => {
      clearTimeout(timer);
      if (entry) this.onClose(entry);
    });
    ws.on('error', () => ws.close());
  }

  /** The first frame: a token, a protocol version, and which floors this machine intends to serve. */
  private onHello(ws: WebSocket, msg: unknown): HostSocket | undefined {
    if (!isToOffice(msg) || msg.t !== 'hello') return undefined;
    const host = this.hosts.authenticate(msg.token);
    if (!host) return undefined;
    if (msg.protocol !== FLOORHOST_PROTOCOL) {
      // Refuse rather than guess: the shapes are not compatible, and a half-understood frame is worse
      // than none. The host is told what it is speaking so it can say something useful.
      ws.send(JSON.stringify({ t: 'refused', why: `This office speaks floor-host protocol ${FLOORHOST_PROTOCOL}` } satisfies Partial<FromFloor>));
      return undefined;
    }
    // One connection per machine. A second socket from a host already connected is dropped, because
    // "which socket owns these floors" must never be ambiguous — that ambiguity is what makes
    // revocation unclear, which is why decision 6 keeps the socket the unit of trust.
    if (this.byHost.has(host.id)) return undefined;
    const entry = new HostSocket(host, ws);
    this.byHost.set(host.id, entry);
    this.hosts.seen(host.id);
    return entry;
  }

  private onFrame(entry: HostSocket, msg: unknown) {
    if (!isFromFloor(msg)) return;
    switch (msg.t) {
      case 'ready': {
        // `ready` is per floor, so a disconnect can mark them all in one pass.
        const ready = msg.floor;
        entry.floors.set(ready.floorId, {
          id: ready.floorId,
          name: ready.name || ready.floorId,
          seats: ready.seats,
          accepting: ready.accepting === true,
          workers: new Set((ready.workers ?? []).map((w) => w.id)),
          ready,
        });
        entry.workerFloor.set(ready.floorId, ready.floorId);
        break;
      }
      case 'leave':
        // The host is saying one of its floors is gone, not the whole machine.
        entry.floors.delete(msg.floorId);
        break;
      default:
        // Everything else is the floor talking upward, and is delivered by whoever owns the
        // connection. Routing those is Phase B task 10 (RemoteFloor); this is the plumbing it needs.
        entry.upward(msg);
        break;
    }
  }

  private onClose(entry: HostSocket) {
    this.byHost.delete(entry.host.id);
    // Every floor this socket carried, in one pass. Nothing downstream re-adds them.
    entry.dropped = true;
    for (const floorId of entry.floors.keys()) entry.onFloorGone(floorId);
    entry.floors.clear();
  }

  /** Drops every machine. Used when the office is shutting down. */
  closeAll() {
    for (const entry of this.byHost.values()) entry.ws.close(1001, 'the office is going down');
    this.byHost.clear();
  }
}

/** One machine's socket, and the floors on it. */
export class HostSocket {
  readonly floors = new Map<string, LiveFloor>();
  /** Reserved for the worker→host index; keyed by worker id. */
  readonly workerFloor = new Map<string, string>();
  /** Set once, when the socket closes, so no later frame can revive the floors it carried. */
  dropped = false;
  /** How the office delivers a floor's events upward. Phase B task 10 supplies the real one. */
  onFloorGone: (floorId: string) => void = () => {};
  upward: (msg: FromFloor) => void = () => {};

  constructor(
    readonly host: Host,
    readonly ws: WebSocket,
  ) {}

  send(msg: ToOffice) {
    if (this.dropped || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  /** The roster for a floor, so the office can answer `workerFloor` without scanning. */
  workersOn(floorId: string): string[] {
    return [...(this.floors.get(floorId)?.workers ?? [])];
  }
}
