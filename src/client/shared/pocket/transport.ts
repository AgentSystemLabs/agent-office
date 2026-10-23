import { uuid } from '../../../shared/uuid';
import type { ClientMsg, ServerMsg } from '../../../shared/protocol';
import { pocketChannel } from './runtime';
import { pocketMe, type PocketBootstrap } from './bootstrap';
import { registerPocketCustomize, registerPocketWorkspace, registerPocketFloors, pocketOverlay, publishPocketSnapshot } from './native';
import { parsePocketFloors, pocketFloorSource, pocketFloorViews, type PocketFloor } from './floors';
import { validPocketMaster, pocketEventCursor, pocketUpdates, pocketWelcome, type PocketSnapshot } from './wire';

export type PocketOp = 'connect' | 'poll' | 'move' | 'chat' | 'hire' | 'open' | 'dismiss' | 'customize' | 'presence' | 'workspace' | 'floors' | 'switch';
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

export function verifiedOverlay(event: MessageEvent, parent: Window, origin: string, channel: string): event is MessageEvent<{ type: 'office-v2:overlay'; channel: string; open: boolean }> {
  const m = event.data;
  return event.source === parent && event.origin === origin && !!channel && m?.type === 'office-v2:overlay'
    && m.channel === channel && typeof m.open === 'boolean';
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
  private stopWorkspace?: () => void;
  private stopFloors?: () => void;
  private floors: PocketFloor[] = [];
  private switching = false;
  private eventCursor = 0;

  constructor(private emit: (msg: ServerMsg) => void, private status: (up: boolean) => void,
    private overlay: Pick<typeof pocketOverlay, 'set' | 'close'> = pocketOverlay) {
    this.channel = pocketChannel();
    // about:srcdoc can report a null location origin; baseURI inherits the parent URL.
    this.origin = new URL(document.baseURI).origin;
  }

  private receive = (event: MessageEvent) => {
    if (verifiedOverlay(event, window.parent, this.origin, this.channel)) {
      if (this.active && !this.switching) this.overlay.set(event.data.open);
      return;
    }
    if (!verifiedReply(event, window.parent, this.origin, this.channel)) return;
    const waiting = this.pending.get(event.data.id);
    if (!waiting) return;
    this.pending.delete(event.data.id);
    clearTimeout(waiting.timer);
    if (typeof event.data.error === 'string') waiting.reject(new Error(event.data.error));
    else waiting.resolve(event.data.result);
  };

  private request(op: PocketOp, payload: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.active || (this.switching && op !== 'switch')) return Promise.reject(new Error('Pocket transport is not connected'));
    if (!this.channel || window.parent === window) return Promise.reject(new Error('Pocket parent channel is unavailable'));
    const id = uuid();
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
      || !Array.isArray(s.peers) || !Array.isArray(s.workers) || !Array.isArray(s.chat) || !validPocketMaster(s)) throw new Error('Invalid Pocket snapshot');
    if (this.snapshot && s.source !== this.snapshot.source) throw new Error('Pocket source changed; reopen the Office panel');
    if (!this.active || this.switching) return;
    if (!this.floors.length) this.floors = [{ id: s.source, title: s.title, cwd: s.cwd, busy: false, archived: false }];
    const welcome = () => ({ ...pocketWelcome(s, this.floors), ...(this.bootstrap ? { me: pocketMe(this.bootstrap) } : {}) });
    const messages = this.snapshot ? pocketUpdates(this.snapshot, s, this.eventCursor) : [welcome()];
    this.eventCursor = Math.max(this.eventCursor, pocketEventCursor(s));
    this.snapshot = s;
    publishPocketSnapshot(s);
    for (const message of messages) this.emit(message);
    this.status(true);
  }

  connect(profile: unknown, bootstrap?: PocketBootstrap) {
    if (this.active) return;
    this.active = true;
    this.bootstrap = bootstrap;
    this.floors = bootstrap?.floors ?? [];
    this.switching = false;
    this.stopFloors = registerPocketFloors({ list: () => this.listFloors(), switch: source => this.switchFloor(source) });
    this.stopCustomize = registerPocketCustomize(() => { void this.action('customize', {}); });
    this.stopWorkspace = registerPocketWorkspace(() => { void this.action('workspace', {}); });
    window.addEventListener('message', this.receive);
    window.addEventListener('pagehide', this.dispose, { once: true });
    if (bootstrap) this.apply(bootstrap.snapshot);
    void this.request('connect', { profile }).then((s) => this.apply(s)).catch((e) => {
      if (this.active && !this.switching) { this.status(false); this.failure(e); }
    });
    this.polling = setInterval(() => { void this.poll(); }, 1000);
  }

  private async poll() {
    if (this.syncing || !this.active || this.switching) return;
    this.syncing = true;
    try { this.apply(await this.request('poll')); }
    catch (e) { if (this.active && !this.switching) { this.status(false); this.failure(e); } }
    finally { this.syncing = false; }
  }

  private async action(op: PocketOp, payload: Record<string, unknown>) {
    try {
      const result = await this.request(op, payload);
      if (!this.active || this.switching) return;
      if (op === 'presence') this.apply(result);
      if (op === 'open' && this.active && !this.switching) this.emit({ t: 'toast', level: 'info', text: payload.prompt ? 'Worker inspector opened. Review the unsent draft there.' : 'Opened worker inspector.' });
      if (op === 'dismiss') this.emit({ t: 'toast', level: 'info', text: 'Released the desk. The Pocket session continues.' });
      if (!['open', 'move', 'customize', 'presence', 'workspace'].includes(op)) await this.poll();
    } catch (e) { if (this.active && !this.switching) this.failure(e); }
  }

  private async listFloors(): Promise<PocketFloor[]> {
    const floors = parsePocketFloors(await this.request('floors'));
    if (!this.active || this.switching) throw new Error('Pocket floor request was cancelled');
    this.floors = floors;
    if (this.snapshot) this.emit({ t: 'floors', floors: pocketFloorViews(floors, this.snapshot) });
    return floors;
  }

  private async switchFloor(source: number): Promise<void> {
    if (!this.active || this.switching) throw new Error('Pocket floor switch is unavailable');
    if (!this.floors.some(f => f.id === source)) throw new Error('This chat is not an available floor');
    if (source === this.snapshot?.source) return;
    this.switching = true;
    clearTimeout(this.moving);
    this.moving = undefined;
    this.move = undefined;
    this.cancelPending('Pocket floor changed');
    try {
      const reply = await this.request('switch', { source }) as { switching?: boolean; source?: number };
      if (reply?.switching !== true || reply.source !== source) throw new Error('Pocket did not confirm the floor switch');
      // The parent replaces this iframe. Never apply another floor's snapshot to the old scene.
    } catch (error) {
      if (this.active) this.switching = false;
      throw error;
    }
  }

  private cancelPending(message: string) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(message)); }
    this.pending.clear();
  }

  send(msg: ClientMsg | { t: 'floor.switch'; floor: string }) {
    if (!this.active || this.switching) return;
    if (msg.t === 'floor.go' || msg.t === 'floor.switch') {
      const source = pocketFloorSource(msg.floor);
      if (source === null) return this.unsupported('Non-chat floors');
      void this.switchFloor(source).catch(e => { if (this.active) this.failure(e); });
      return;
    }
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
    if (msg.t === 'act' || msg.t === 'emote' || msg.t === 'sit' || msg.t === 'doing') {
      void this.action('presence', { action: msg });
      return;
    }
    // These are local view notifications, not runtime operations.
    if (msg.t === 'worker.detach' || msg.t === 'term.typing') return;
    if (msg.t === 'chat') { void this.action('chat', { text: msg.text }); return; }
    if (msg.t === 'worker.spawn') {
      if (msg.deskId?.startsWith('pocket-master-')) return this.unsupported('Hiring at the Master desk');
      if (msg.kind === 'shell') return this.unsupported('Shell workers');
      if (msg.worktree || msg.repos?.length) return this.unsupported('Office-managed worktrees and repositories');
      if ((msg.provider !== undefined && msg.provider !== 'pi') || msg.model !== undefined || msg.effort !== undefined) return this.unsupported('CLI provider, model and effort choices; Pocket inherits the source settings');
      if (!msg.prompt?.trim()) return this.unsupported('Hiring without an initial task');
      void this.action('hire', { deskId: msg.deskId, prompt: msg.prompt, key: uuid() });
      return;
    }
    if (msg.t === 'worker.prompt' || msg.t === 'worker.attach' || msg.t === 'worker.resume') {
      void this.action('open', { workerId: msg.workerId, ...(msg.t === 'worker.prompt' ? { prompt: msg.prompt } : {}) });
      return;
    }
    if (msg.t === 'worker.kill') {
      if (msg.workerId.startsWith('pocket-master-')) return this.unsupported('Dismissing the root conversation');
      void this.action('dismiss', { workerId: msg.workerId, key: uuid() });
      return;
    }
    this.unsupported(msg.t);
  }

  private unsupported(action: string) {
    this.failure(new Error(`${action} is unsupported in Pocket. Use native Pocket chat.`));
  }

  dispose = () => {
    this.active = false;
    this.overlay.close();
    this.stopCustomize?.();
    this.stopCustomize = undefined;
    this.stopWorkspace?.();
    this.stopWorkspace = undefined;
    this.stopFloors?.();
    this.stopFloors = undefined;
    clearInterval(this.polling);
    clearTimeout(this.moving);
    window.removeEventListener('message', this.receive);
    window.removeEventListener('pagehide', this.dispose);
    this.move = undefined;
    this.cancelPending('Pocket transport closed');
    this.status(false);
  };
}
