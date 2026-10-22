import type { ClientMsg, ServerMsg } from '../../../shared/protocol';
import { pocketChannel } from './runtime';
import { pocketMe, type PocketBootstrap } from './bootstrap';
import { registerPocketCustomize } from './native';
import { pocketUpdates, pocketWelcome, type PocketSnapshot } from './wire';

export type PocketOp = 'connect' | 'poll' | 'move' | 'chat' | 'hire' | 'open' | 'dismiss' | 'customize';
export interface PocketRequest {
  type: 'office-v2:request'; channel: string; id: string; op: PocketOp; payload: Record<string, unknown>;
}
export interface PocketReply {
  type: 'office-v2:reply'; channel: string; id: string; result?: unknown; error?: string;
}

export function verifiedReply(event: MessageEvent, parent: Window, origin: string, channel: string): event is MessageEvent<PocketReply> {
  const m = event.data;
  return event.source === parent && event.origin === origin && !!channel && m?.type === 'office-v2:reply'
    && m.channel === channel && typeof m.id === 'string';
}

/** The iframe has no Office socket, credentials, or runtime authority. */
export class PocketTransport {
  private pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private snapshot?: PocketSnapshot;
  private polling?: ReturnType<typeof setInterval>;
  private moving?: ReturnType<typeof setTimeout>;
  private move?: Extract<ClientMsg, { t: 'move' }>;
  private active = false;
  private syncing = false;
  private channel: string;
  private origin: string;
  private bootstrap?: PocketBootstrap;
  private stopCustomize?: () => void;

  constructor(private emit: (msg: ServerMsg) => void, private status: (up: boolean) => void) {
    this.channel = pocketChannel();
    // about:srcdoc can report a null location origin; baseURI inherits the parent URL.
    this.origin = new URL(document.baseURI).origin;
  }

  private receive = (event: MessageEvent) => {
    if (!verifiedReply(event, window.parent, this.origin, this.channel)) return;
    const waiting = this.pending.get(event.data.id);
    if (!waiting) return;
    this.pending.delete(event.data.id);
    clearTimeout(waiting.timer);
    if (typeof event.data.error === 'string') waiting.reject(new Error(event.data.error));
    else waiting.resolve(event.data.result);
  };

  private request(op: PocketOp, payload: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.active) return Promise.reject(new Error('Pocket transport is not connected'));
    if (!this.channel || window.parent === window) return Promise.reject(new Error('Pocket parent channel is unavailable'));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Pocket ${op} request timed out`));
      }, 15_000);
      this.pending.set(id, { resolve, reject, timer });
      const message: PocketRequest = { type: 'office-v2:request', channel: this.channel, id, op, payload };
      window.parent.postMessage(message, this.origin);
    });
  }

  private failure(error: unknown) {
    this.emit({ t: 'toast', level: 'error', text: error instanceof Error ? error.message : String(error) });
  }

  private apply(value: unknown) {
    const s = value as PocketSnapshot;
    if (!s || !Number.isSafeInteger(s.source) || typeof s.you !== 'string' || typeof s.title !== 'string' || typeof s.cwd !== 'string'
      || !Array.isArray(s.peers) || !Array.isArray(s.workers) || !Array.isArray(s.chat)) throw new Error('Invalid Pocket snapshot');
    if (this.snapshot && s.source !== this.snapshot.source) throw new Error('Pocket source changed; reopen the Office panel');
    if (!this.active) return;
    const welcome = () => ({ ...pocketWelcome(s), ...(this.bootstrap ? { me: pocketMe(this.bootstrap) } : {}) });
    const messages = this.snapshot ? pocketUpdates(this.snapshot, s) : [welcome()];
    this.snapshot = s;
    for (const message of messages) this.emit(message);
    this.status(true);
  }

  connect(profile: unknown, bootstrap?: PocketBootstrap) {
    if (this.active) return;
    this.active = true;
    this.bootstrap = bootstrap;
    this.stopCustomize = registerPocketCustomize(() => { void this.action('customize', {}); });
    window.addEventListener('message', this.receive);
    window.addEventListener('pagehide', this.dispose, { once: true });
    if (bootstrap) this.apply(bootstrap.snapshot);
    void this.request('connect', { profile }).then((s) => this.apply(s)).catch((e) => { this.status(false); this.failure(e); });
    this.polling = setInterval(() => { void this.poll(); }, 1000);
  }

  private async poll() {
    if (this.syncing) return;
    this.syncing = true;
    try { this.apply(await this.request('poll')); }
    catch (e) { this.status(false); this.failure(e); }
    finally { this.syncing = false; }
  }

  private async action(op: PocketOp, payload: Record<string, unknown>) {
    try {
      await this.request(op, payload);
      if (op === 'open') this.emit({ t: 'toast', level: 'info', text: payload.prompt ? 'Pocket chat opened. Review and send the draft there. Nothing was sent.' : 'Opened native Pocket chat.' });
      if (op === 'dismiss') this.emit({ t: 'toast', level: 'info', text: 'Released the desk. The Pocket session continues.' });
      if (op !== 'open' && op !== 'move' && op !== 'customize') await this.poll();
    } catch (e) { this.failure(e); }
  }

  send(msg: ClientMsg) {
    if (msg.t === 'move') {
      this.move = msg;
      this.moving ??= setTimeout(() => {
        this.moving = undefined;
        const latest = this.move;
        this.move = undefined;
        if (latest) {
          const { t: _t, ...position } = latest;
          void this.action('move', position);
        }
      }, 250);
      return;
    }
    if (msg.t === 'ping') { this.emit({ t: 'pong', at: msg.at, now: Date.now() }); return; }
    // These are local view notifications, not runtime operations.
    if (msg.t === 'doing' || msg.t === 'worker.detach' || msg.t === 'term.typing') return;
    if (msg.t === 'chat') { void this.action('chat', { text: msg.text }); return; }
    if (msg.t === 'worker.spawn') {
      if (msg.kind === 'shell') return this.unsupported('Shell workers');
      if (msg.worktree || msg.repos?.length) return this.unsupported('Office-managed worktrees and repositories');
      if ((msg.provider !== undefined && msg.provider !== 'pi') || msg.model !== undefined || msg.effort !== undefined) return this.unsupported('CLI provider, model and effort choices; Pocket inherits the source settings');
      if (!msg.prompt?.trim()) return this.unsupported('Hiring without an initial task');
      void this.action('hire', { deskId: msg.deskId, prompt: msg.prompt, key: crypto.randomUUID() });
      return;
    }
    if (msg.t === 'worker.prompt' || msg.t === 'worker.attach' || msg.t === 'worker.resume') {
      void this.action('open', { workerId: msg.workerId, ...(msg.t === 'worker.prompt' ? { prompt: msg.prompt } : {}) });
      return;
    }
    if (msg.t === 'worker.kill') {
      void this.action('dismiss', { workerId: msg.workerId, key: crypto.randomUUID() });
      return;
    }
    this.unsupported(msg.t);
  }

  private unsupported(action: string) {
    this.failure(new Error(`${action} is unsupported in Pocket. Use native Pocket chat.`));
  }

  dispose = () => {
    this.active = false;
    this.stopCustomize?.();
    this.stopCustomize = undefined;
    clearInterval(this.polling);
    clearTimeout(this.moving);
    window.removeEventListener('message', this.receive);
    window.removeEventListener('pagehide', this.dispose);
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Pocket transport closed')); }
    this.pending.clear();
    this.status(false);
  };
}
