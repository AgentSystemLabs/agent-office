import type { ClientMsg, ServerMsg } from '../shared/protocol';
import { lastFloor, store, type Profile, type Spot } from './state';

import { installPocketBoundary, pocketRuntime } from './shared/pocket/runtime';
import { PocketTransport } from './shared/pocket/transport';
import { readPocketBootstrap } from './shared/pocket/bootstrap';

installPocketBoundary();

type Handler = (msg: ServerMsg) => void;

/** The sign-in page, coming back to the 2D view afterwards if that's where you are (see login.ts). */
export function loginUrl(): string {
  return location.pathname === '/lite' ? '/login?next=/lite' : '/login';
}

export class Net {
  private ws: WebSocket | null = null;
  private pocket?: PocketTransport;

  /** Native Pocket chat replaces the terminal in the embedded client. */
  openPocketSession(workerId: string): boolean {
    if (!pocketRuntime()) return false;
    this.send({ t: 'worker.attach', workerId });
    return true;
  }
  private handlers: Handler[] = [];
  private statusHandlers: ((up: boolean) => void)[] = [];
  private retry = 0;
  private closedByUs = false;
  /** The server is restarting on purpose: retry every second instead of backing off. */
  private restartExpected = false;
  up = false;

  constructor(
    private profile: () => Profile,
    /** Where you are (or were, before this page), to be put back in the same spot. */
    private where: () => Spot | null,
    /** On the 2D view: in the office without standing anywhere in it (see PeerInfo.lite). */
    private lite = false,
  ) {}

  onMessage(h: Handler) {
    this.handlers.push(h);
    return () => { this.handlers = this.handlers.filter((handler) => handler !== h); };
  }

  onStatus(h: (up: boolean) => void) {
    this.statusHandlers.push(h);
  }

  connect() {
    if (pocketRuntime()) {
      this.pocket ??= new PocketTransport(
        (msg) => this.handlers.forEach((h) => h(msg)),
        (up) => { this.up = up; this.statusHandlers.forEach((h) => h(up)); },
      );
      this.pocket.connect(this.profile(), readPocketBootstrap() ?? undefined);
      return;
    }
    const { name, color, look } = this.profile();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const q = new URLSearchParams({ name, color, skin: String(look.skin), hair: String(look.hair), style: String(look.style) });
    // Back to the floor you were on (after a reload or a restart), in the spot you were in there.
    const floor = store.floor ?? lastFloor();
    if (floor) q.set('floor', floor);
    if (this.lite) q.set('lite', '1');
    const at = this.where();
    if (floor && at?.floor === floor) {
      for (const k of ['x', 'y', 'z'] as const) q.set(k, at[k].toFixed(2));
      q.set('rotY', at.facing.toFixed(3));
    }
    const ws = new WebSocket(`${proto}://${location.host}/ws?${q}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.up = true;
      this.statusHandlers.forEach((h) => h(true));
    };
    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      for (const h of this.handlers) h(msg);
    };
    ws.onclose = async () => {
      if (this.ws !== ws) return;
      this.up = false;
      this.statusHandlers.forEach((h) => h(false));
      if (this.closedByUs) return;
      // Session expired? Go back to the door.
      try {
        const res = await fetch('/api/whoami', { cache: 'no-store' });
        if (res.status === 401) {
          location.href = loginUrl();
          return;
        }
      } catch {
        // offline; keep retrying
      }
      const delay = this.restartExpected ? 1000 : Math.min(8000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }

  expectRestart() {
    this.restartExpected = true;
  }

  send(msg: ClientMsg) {
    if (pocketRuntime()) {
      if (this.pocket) this.pocket.send(msg);
      else this.handlers.forEach((h) => h({ t: 'toast', level: 'warn', text: 'Pocket is not connected yet.' }));
      return;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
