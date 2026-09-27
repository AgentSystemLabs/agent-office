import type { ClientMsg, ServerMsg } from '../shared/protocol';
import { lastFloor, store, type Profile } from './state';

type Handler = (msg: ServerMsg) => void;

export class Net {
  private ws: WebSocket | null = null;
  private handlers: Handler[] = [];
  private statusHandlers: ((up: boolean) => void)[] = [];
  private retry = 0;
  private closedByUs = false;
  /** The server is restarting on purpose: retry every second instead of backing off. */
  private restartExpected = false;
  up = false;

  constructor(private profile: () => Profile) {}

  onMessage(h: Handler) {
    this.handlers.push(h);
  }

  onStatus(h: (up: boolean) => void) {
    this.statusHandlers.push(h);
  }

  connect() {
    const { name, color, look } = this.profile();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const q = new URLSearchParams({ name, color, skin: String(look.skin), hair: String(look.hair), style: String(look.style) });
    // Back to the floor you were on (after a reload or a restart).
    const floor = store.floor ?? lastFloor();
    if (floor) q.set('floor', floor);
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
          location.href = '/login';
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
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
