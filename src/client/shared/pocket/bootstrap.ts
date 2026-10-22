import type { Me, PeerInfo, WorkerInfo } from '../../../shared/protocol';
import { HAIR_COLORS, HAIR_STYLES, SKIN_TONES } from '../../../shared/avatar';
import type { Profile } from '../../state/persist';
import type { PocketSnapshot } from './wire';
import { pocketRuntime } from './runtime';

export interface PocketBootstrap {
  person: { id: string; name: string; role: 'owner' | 'guest' | 'viewer' };
  profile: Profile;
  snapshot: PocketSnapshot;
}

type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
function look(v: unknown): boolean {
  if (!object(v)) return false;
  return [v.skin, v.hair, v.style].every((n, i) => Number.isInteger(n) && Number(n) >= 0 && Number(n) < [SKIN_TONES.length, HAIR_COLORS.length, HAIR_STYLES.length][i]);
}
function peer(v: unknown): v is PeerInfo {
  return object(v) && text(v.id) && text(v.name) && typeof v.color === 'string' && look(v.look)
    && [v.x, v.y, v.z, v.rotY].every(finite) && [v.moving, v.voice, v.muted, v.sharing].every((n) => typeof n === 'boolean');
}
function worker(v: unknown): v is WorkerInfo {
  return object(v) && text(v.id) && text(v.deskId) && text(v.name) && typeof v.color === 'string'
    && v.kind === 'agent' && ['working', 'idle', 'offline'].includes(String(v.status)) && finite(v.createdAt)
    && typeof v.createdBy === 'string' && typeof v.acked === 'boolean' && finite(v.cols) && finite(v.rows)
    && Array.isArray(v.viewers) && v.viewers.every((n) => typeof n === 'string')
    && Array.isArray(v.viewerIds) && v.viewerIds.every((n) => typeof n === 'string');
}

/** Reject invalid startup data. Never fall back to standalone login or a random character. */
export function parsePocketBootstrap(encoded: string): PocketBootstrap {
  let b: unknown;
  try { b = JSON.parse(decodeURIComponent(encoded)); }
  catch { throw new Error('Invalid Pocket bootstrap encoding'); }
  if (!object(b) || !object(b.person) || !text(b.person.id) || !text(b.person.name)
    || !['owner', 'guest', 'viewer'].includes(String(b.person.role)) || !object(b.profile)
    || !text(b.profile.name) || typeof b.profile.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(b.profile.color) || !look(b.profile.look)
    || !object(b.snapshot)) throw new Error('Invalid Pocket bootstrap identity or profile');
  const s = b.snapshot;
  if (!Number.isSafeInteger(s.source) || Number(s.source) <= 0 || typeof s.title !== 'string' || !text(s.cwd) || !text(s.you)
    || (s.model !== undefined && typeof s.model !== 'string') || !Array.isArray(s.peers) || !s.peers.every(peer)
    || !s.peers.some((p) => p.id === s.you) || !Array.isArray(s.workers) || !s.workers.every(worker)
    || !Array.isArray(s.chat) || !s.chat.every((c) => object(c) && text(c.from) && typeof c.name === 'string'
      && typeof c.color === 'string' && typeof c.text === 'string' && finite(c.at))) throw new Error('Invalid Pocket bootstrap source snapshot');
  // The authenticated person's name, not a browser's old display name, is authoritative.
  b.profile.name = b.person.name;
  return b as unknown as PocketBootstrap;
}

const documents = new WeakMap<Document, PocketBootstrap | Error>();
export function readPocketBootstrap(): PocketBootstrap | null {
  if (!pocketRuntime()) return null;
  const saved = documents.get(document);
  if (saved instanceof Error) throw saved;
  if (saved) return saved;
  try {
    const encoded = document.querySelector('meta[name="pocket-bootstrap"]')?.getAttribute('content');
    if (!encoded) throw new Error('Pocket bootstrap is missing. Reopen the Office panel.');
    const b = parsePocketBootstrap(encoded);
    documents.set(document, b);
    return b;
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    documents.set(document, error);
    throw error;
  }
}

export function pocketMe(b: PocketBootstrap): Me {
  // Office account administration is never enabled, including for the Pocket owner.
  return { admin: false, account: { name: b.person.name, role: 'member' } };
}

interface BootDeps {
  net: { onMessage(fn: (msg: { t: string }) => void): () => void; connect(): void };
  loading: { until(steps: { say: string; done: Promise<unknown> }[]): void };
  startFrames(): void;
}

/** One startup lifecycle. Readiness means a source welcome was applied and a frame was rendered. */
export class PocketLifecycle {
  readonly ready: Promise<void>;
  private sourceReady: Promise<void>;
  private sourceDone!: () => void;
  private frameDone!: () => void;
  private welcomed = false;
  private started = false;
  constructor(readonly data: PocketBootstrap) {
    this.sourceReady = new Promise<void>((resolve) => { this.sourceDone = resolve; });
    const frameReady = new Promise<void>((resolve) => { this.frameDone = resolve; });
    this.ready = Promise.all([this.sourceReady, frameReady]).then(() => {});
  }
  drew() { if (this.welcomed) this.frameDone(); }
  start(deps: BootDeps): Promise<void> {
    if (this.started) return this.ready;
    this.started = true;
    const off = deps.net.onMessage((msg) => {
      if (msg.t !== 'welcome') return;
      off();
      this.welcomed = true;
      this.sourceDone();
    });
    deps.loading.until([{ say: 'Opening Pocket source', done: this.sourceReady }]);
    deps.net.connect();
    deps.startFrames();
    return this.ready;
  }
}

/** Called before createCtx/createScene/makeMe. Does not read standalone profile or position. */
export function initPocketBootstrap(target: { profile: Profile; me: Me }): PocketLifecycle | null {
  try {
    const b = readPocketBootstrap();
    if (!b) return null;
    target.profile = { ...b.profile, look: { ...b.profile.look } };
    target.me = pocketMe(b);
    return new PocketLifecycle(b);
  } catch (error) {
    if (typeof document !== 'undefined' && document.body) {
      const alert = document.createElement('div');
      alert.setAttribute('role', 'alert');
      alert.style.cssText = 'position:fixed;inset:0;z-index:100000;background:#18202b;color:white;padding:2rem;font:18px system-ui';
      alert.textContent = `${error instanceof Error ? error.message : error}. Reopen the Office panel.`;
      document.body.append(alert);
    }
    throw error;
  }
}
