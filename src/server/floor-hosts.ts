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

  /**
   * Where a floor's upward frames go: whoever holds the `RemoteFloor` for that floor, so a hire's
   * answer settles the caller waiting on it and an event fills the office's mirror of the floor.
   * The office sets this once. Until it does, frames are parsed and dropped rather than queued,
   * because a frame nobody is waiting for is not worth holding in memory.
   */
  onUpward: (floorId: string, msg: FromFloor) => void = () => {};

  /** Told once per floor when the socket carrying it goes, so the office can hold its workers asleep. */
  onFloorGone: (floorId: string) => void = () => {};

  /** Told once per floor when a machine says it is serving it, so the elevator can show it. */
  onFloorUp: (floorId: string) => void = () => {};

  /**
   * The floors the office wants a machine to serve, taken from the building: every floor whose
   * `FloorDef.host` names it. `dir` is the path on *that* machine, which is the only place it means
   * anything — the office holds it to identify the floor and never reads it.
   */
  floorsFor: (hostId: string) => { id: string; dir: string; name: string }[] = () => [];

  constructor(private hosts: Hosts) {}

  /**
   * A machine's name, read now rather than remembered: a floor can be registered before its machine
   * has paired (the building knows the host id, not the name), so capturing it at construction would
   * leave the elevator saying "a machine" forever.
   */
  nameOf(hostId: string): string | undefined {
    return this.hosts.get(hostId)?.name;
  }

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

  /**
   * The first frame. A machine that has paired before presents its token; one pairing for the first
   * time presents the code from `agent-office hosts pair` instead. Either way the office answers with
   * `welcome`, carrying the token — which is how a first-time machine gets one without anyone
   * carrying it between machines.
   */
  private onHello(ws: WebSocket, msg: unknown): HostSocket | undefined {
    if (!isFromFloor(msg) || msg.t !== 'hello') return undefined;
    if (msg.protocol !== FLOORHOST_PROTOCOL) {
      // Refuse rather than guess: the shapes are not compatible, and a half-understood frame is worse
      // than none. The host is told what it is speaking so it can say something useful.
      ws.send(JSON.stringify({ t: 'bye', why: `This office speaks floor-host protocol ${FLOORHOST_PROTOCOL}; this machine speaks ${msg.protocol}` } satisfies ToOffice));
      return undefined;
    }
    // Pairing for the first time: swap the code for a token here, so the machine never had to be told
    // one. A spent or expired code is refused the same way a bad token is.
    let host = msg.token ? this.hosts.authenticate(msg.token) : undefined;
    let fresh: string | undefined;
    if (!host && msg.code) {
      const claimed = this.hosts.claim(msg.code, msg.name, msg.owner);
      if (typeof claimed === 'string') {
        ws.send(JSON.stringify({ t: 'bye', why: claimed } satisfies ToOffice));
        return undefined;
      }
      host = claimed.host;
      fresh = claimed.token;
    }
    if (!host || host.revokedAt) return undefined;
    // One connection per machine. A second socket from a host already connected is dropped, because
    // "which socket owns these floors" must never be ambiguous — that ambiguity is what makes
    // revocation unclear, which is why decision 6 keeps the socket the unit of trust.
    if (this.byHost.has(host.id)) return undefined;
    const entry = new HostSocket(host, ws, fresh, this.floorsFor(host.id));
    this.byHost.set(host.id, entry);
    this.hosts.seen(host.id);
    this.hosts.declare(host.id, { projectsDir: msg.projectsDir });
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
        // What the machine says about itself, kept on its record: where it keeps its checkouts, which
        // is what lets `agent-office hosts add-floor` name a path on it without guessing.
        this.hosts.declare(entry.host.id, { projectsDir: ready.projectsDir });
        this.onFloorUp(ready.floorId);
        // And on to the proxy, which is the only thing that knows what the office was told. Without
        // this the roster, the branch, the agents this machine has and which forge it reads are all
        // dropped on the floor here — an elevator that always says zero workers, a hire menu with no
        // providers, and a Bitbucket floor the office would go on treating as GitHub.
        this.onUpward(ready.floorId, msg);
        break;
      }
      case 'leave':
        // The host is saying one of its floors is gone, not the whole machine.
        if (entry.floors.delete(msg.floorId)) {
          entry.onFloorGone(msg.floorId);
          this.onFloorGone(msg.floorId);
        }
        break;
      default:
        // Everything else is the floor talking upward: an answer to a call, or something that happened
        // on it. Both go to whoever holds the RemoteFloor for that floor. A frame with no floor — the
        // connection-level refusal — has nothing to route to and is dropped here.
        if ('floorId' in msg) this.onUpward(msg.floorId, msg);
        break;
    }
  }

  private onClose(entry: HostSocket) {
    this.byHost.delete(entry.host.id);
    // Every floor this socket carried, in one pass. Nothing downstream re-adds them: the office marks
    // them unreachable and holds their workers asleep, rather than letting the first worker's `gone`
    // decide and race the rest (see PtyExit.gone in ptys.ts).
    entry.dropped = true;
    const carried = [...entry.floors.keys()];
    entry.floors.clear();
    for (const floorId of carried) {
      entry.onFloorGone(floorId);
      this.onFloorGone(floorId);
    }
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
    /** The token minted at this pairing, for a machine that has never had one. Sent in `welcome`. */
    readonly freshToken?: string,
    /** The floors the building has for this machine. The office asks for them here. */
    wanted: { id: string; dir: string; name: string }[] = [],
  ) {
    // The office asks for the floors it has for this machine; the host says `ready` for each one it
    // can actually open, and stays quiet about the rest rather than pretending.
    ws.send(
      JSON.stringify({
        t: 'welcome',
        hostId: host.id,
        token: freshToken ?? '',
        floors: wanted,
      } satisfies ToOffice),
    );
  }

  send(msg: ToOffice) {
    if (this.dropped || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  /** The roster for a floor, so the office can answer `workerFloor` without scanning. */
  workersOn(floorId: string): string[] {
    return [...(this.floors.get(floorId)?.workers ?? [])];
  }
}
