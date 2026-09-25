import type { ClientMsg, ServerMsg } from '../shared/protocol';

type Handler = (msg: ServerMsg) => void;

export class Net {
  private ws: WebSocket | null = null;
  private handlers: Handler[] = [];
  private statusHandlers: ((up: boolean) => void)[] = [];
  private retry = 0;
  private closedByUs = false;
  up = false;

  constructor(private profile: () => { name: string; color: string }) {}

  onMessage(h: Handler) {
    this.handlers.push(h);
  }

  onStatus(h: (up: boolean) => void) {
    this.statusHandlers.push(h);
  }

  connect() {
    const { name, color } = this.profile();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?name=${encodeURIComponent(name)}&color=${encodeURIComponent(color)}`);
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
      const delay = Math.min(8000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }

  send(msg: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
