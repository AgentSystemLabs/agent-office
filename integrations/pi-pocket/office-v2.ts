/** Agent Office: source-scoped desks, shared chat, and ephemeral presence. Dismiss only unseats a worker; it never stops or deletes a session. No Office server, shell, or provider access. */
import { randomUUID } from 'node:crypto';
import { defineDoc, defineDocFamily } from '@earendil-works/pi-durable';
import type { Host, Web, WebRequest, Person, ConversationWebRequest } from './_pocket.d.ts';
import type { PeerInfo, ChatLine } from '../../src/shared/protocol/presence.js';
import type { WorkerInfo } from '../../src/shared/protocol/workers.js';

export const pocketApi = 2;
// Mirrors builtDesks(0) in src/shared/layout.ts: 16 initial desks. No expansion, overflow, stations, or meetings.
export const DESK_IDS = Array.from({ length: 16 }, (_, n) => `desk-${n + 1}`);
type Seat = {
  workerId: string; deskId: string; actor: string; requestId: string; key: string; prompt: string;
  createdAt: number; conversationId?: number; state: 'reserved' | 'retry' | 'bound' | 'dismissed';
};
// A mapped JSON record keeps the Office interface compatible with Durable's JsonObject constraint.
type StoredChat = { [K in keyof ChatLine]: ChatLine[K] };
type OfficeData = { seats: Record<string, Seat>; chat: StoredChat[]; chatKeys: string[] };
const Office = defineDoc<OfficeData>({
  kind: 'x.office-v2.office', version: 1, scope: 'conversation', history: 'latest', fork: 'initial',
  initial: () => ({ seats: {}, chat: [], chatKeys: [] }),
});
// Session scope means app-wide, not conversation-owned. Each person's family key is server-selected.
type Avatar = { color: string; look: { skin: number; hair: number; style: number } };
const Profiles = defineDocFamily<{ color?: string; look?: Avatar['look'] }, null>({
  kind: 'x.office-v2.profiles', version: 1, scope: 'session', family: true, initial: () => ({}),
});
// Mirrors avatar.ts: SKIN_TONES.length=8, HAIR_COLORS.length=10, HAIR_STYLES.length=7.
const AVATAR_COUNTS = { skin: 8, hair: 10, style: 7 } as const;
function defaultAvatar(id: string): Avatar {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  hash >>>= 0;
  const colors = ['#7c83ff', '#52b788', '#e9c46a', '#e76f51', '#4ea8de', '#c77dff'];
  return { color: colors[hash % colors.length], look: {
    skin: hash % AVATAR_COUNTS.skin, hair: (hash >>> 3) % AVATAR_COUNTS.hair, style: (hash >>> 7) % AVATAR_COUNTS.style,
  } };
}
export interface OfficeProfileResponse {
  person: Person;
  profile: Avatar & { name: string };
}
export interface OfficeSnapshot extends OfficeProfileResponse {
  source: number; title: string; cwd: string; model?: string; you: string;
  peers: PeerInfo[]; chat: ChatLine[]; workers: WorkerInfo[];
  bindings: { workerId: string; conversationId: number }[];
  pending: { workerId: string; deskId: string; requestId: string; prompt: string; recoverable: boolean }[];
}

export default function officeV2(_host: Host, web: Web) {
  if (typeof web.conversationRoute !== 'function') throw new Error('Agent Office needs Pi Pocket 0.19.0 or later.');
  web.client('office-v2-client', { access: 'steer' });
  // Explicitly ephemeral. Nothing here is an authority for a desk or a session.
  const presence = new Map<string, { source: number; peer: PeerInfo; expires: number }>();
  const active = new Set<string>(); // Local duplicate suppression; durable reservations survive reloads.
  const prune = () => { for (const [key, entry] of presence) if (entry.expires <= Date.now()) presence.delete(key); };
  const timer = setInterval(prune, 5_000);
  timer.unref?.();
  web.onDispose(() => { clearInterval(timer); presence.clear(); });
  const fail = (message: string): never => { throw web.error(400, message); };
  const text = (value: unknown, max: number, label: string) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return fail(`Invalid ${label}`);
    return value.trim();
  };
  const client = (value: unknown) => {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return fail('clientId must be a UUID');
    return value.toLowerCase();
  };
  const fields = (body: Readonly<Record<string, unknown>>, allowed: string[]) => {
    if (Object.keys(body).some(key => !allowed.includes(key))) fail('Unsupported request field');
  };
  const validateColor = (value: unknown): string => {
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) return fail('Invalid color');
    return value.toLowerCase();
  };
  const validateLook = (value: unknown): Avatar['look'] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('Invalid look');
    const look = value as Record<string, unknown>;
    fields(look, ['skin', 'hair', 'style']);
    for (const key of ['skin', 'hair', 'style'] as const) {
      if (!Number.isInteger(look[key]) || Number(look[key]) < 0 || Number(look[key]) >= AVATAR_COUNTS[key]) fail('Invalid look');
    }
    return { skin: Number(look.skin), hair: Number(look.hair), style: Number(look.style) };
  };
  const profile = async (req: WebRequest): Promise<OfficeProfileResponse> => {
    const saved = await req.snapshot(Profiles, req.user.id, req.context);
    const defaults = defaultAvatar(req.user.id);
    return { person: { id: req.user.id, name: req.user.name, role: req.user.role },
      profile: { name: req.user.name, color: saved?.color ?? defaults.color, look: saved?.look ?? defaults.look } };
  };
  // Ordinary routes deliberately have no conversation binding, source model, turn, or spend admission requirement.
  web.route('GET', 'profile', req => profile(req), { access: 'steer' });
  web.route('POST', 'profile', async req => {
    fields(req.body, ['color', 'look']);
    if (!Object.keys(req.body).length) fail('Provide color or look');
    const color = 'color' in req.body ? validateColor(req.body.color) : undefined;
    const look = 'look' in req.body ? validateLook(req.body.look) : undefined;
    await req.commit(async tx => {
      const saved = await tx.doc(Profiles, req.user.id, null);
      if (color !== undefined) saved.color = color;
      if (look !== undefined) saved.look = look;
    });
    const result = await profile(req);
    // Existing tabs share this user's saved avatar. Presence remains ephemeral and does not become an authority.
    for (const entry of presence.values()) if (entry.peer.id.startsWith(`${req.user.id}:`)) {
      entry.peer = { ...entry.peer, ...result.profile };
    }
    return result;
  }, { access: 'steer' });
  const identity = (req: ConversationWebRequest, id: string) => `${req.user.id}:${id}`;
  const read = async (req: ConversationWebRequest) => await req.snapshot(Office, req.conversation.id, req.context) ?? { seats: {}, chat: [], chatKeys: [] };
  const snapshot = async (req: ConversationWebRequest, id: string): Promise<OfficeSnapshot> => {
    prune();
    const data = await read(req);
    const visible = new Map((await req.linkedSessions.list()).filter(s =>
      typeof s.title === 'string' && typeof s.cwd === 'string' && typeof s.busy === 'boolean',
    ).map(s => [Number(s.conversationId), s]));
    const workers: WorkerInfo[] = [];
    const bindings: OfficeSnapshot['bindings'] = [];
    const pending: OfficeSnapshot['pending'] = [];
    for (const seat of Object.values(data.seats)) {
      if (seat.conversationId === undefined && seat.actor === req.user.id) pending.push({
        workerId: seat.workerId, deskId: seat.deskId, requestId: seat.requestId, prompt: seat.prompt,
        recoverable: !active.has(`${req.conversation.id}:${seat.deskId}`),
      });
      const linked = seat.conversationId === undefined ? undefined : visible.get(seat.conversationId);
      if (!linked) continue;
      const workerId = seat.workerId;
      workers.push({ id: workerId, kind: 'agent', deskId: seat.deskId, name: linked.title!,
        title: linked.title, color: '#7c83ff', status: linked.busy ? 'working' : 'idle', acked: true,
        createdBy: seat.actor, createdAt: seat.createdAt, cols: 80, rows: 24, viewers: [], viewerIds: [],
      });
      bindings.push({ workerId, conversationId: seat.conversationId! });
    }
    const model = req.conversation.model;
    return { ...await profile(req), source: Number(req.conversation.id), title: req.conversation.title, cwd: req.conversation.cwd,
      ...(model ? { model: `${model.provider}/${model.modelId}` } : {}), you: identity(req, id),
      peers: [...presence.values()].filter(p => p.source === Number(req.conversation.id)).map(p => p.peer),
      chat: data.chat, workers, bindings, pending };
  };
  const options = { conversation: 'source', access: 'steer' as const };
  web.conversationRoute('GET', 'state/:source', async req => {
    const id = client(req.query.get('clientId'));
    const raw = req.query.get('presence');
    if (raw !== null) {
      if (raw.length > 2048) fail('Presence is too large');
      let p: Record<string, unknown>;
      try { p = JSON.parse(raw); } catch { return fail('Invalid presence JSON'); }
      if (!p || typeof p !== 'object' || Array.isArray(p)) fail('Invalid presence');
      fields(p, ['name', 'color', 'look', 'x', 'y', 'z', 'rotY', 'moving', 'lite']);
      const coordinate = (key: string, max: number) => {
        const value = p[key] ?? 0;
        if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > max) return fail(`Invalid ${key}`);
        return value;
      };
      // Compatibility profile fields are validated but never override the saved per-person profile.
      if (p.color !== undefined) validateColor(p.color);
      if (p.look !== undefined) validateLook(p.look);
      const avatar = (await profile(req)).profile;
      if (p.moving !== undefined && typeof p.moving !== 'boolean') fail('Invalid moving');
      if (p.lite !== undefined && typeof p.lite !== 'boolean') fail('Invalid lite');
      prune();
      const key = `${req.conversation.id}:${identity(req, id)}`;
      if (!presence.has(key) && presence.size >= 1000) throw web.error(429, 'Presence capacity reached');
      presence.set(key, { source: Number(req.conversation.id), expires: Date.now() + 15_000, peer: {
        id: identity(req, id), ...avatar,
        x: coordinate('x', 200), y: coordinate('y', 100), z: coordinate('z', 200), rotY: coordinate('rotY', 100),
        moving: p.moving === true, lite: p.lite === true, voice: false, muted: true, sharing: false, floor: 'pocket',
      } });
    }
    return snapshot(req, id);
  }, options);
  // Office chat is durable shared data, not a human message to a model. The source turn is required.
  web.conversationRoute('POST', 'state/:source', async req => {
    fields(req.body, ['clientId', 'action', 'text', 'requestId']);
    const id = client(req.body.clientId);
    if (req.body.action !== 'chat') fail('Only chat is a durable state action');
    const message = text(req.body.text, 2000, 'chat');
    const key = `${req.user.id}:${text(req.body.requestId, 128, 'requestId')}`;
    const avatar = (await profile(req)).profile;
    await req.commit(async tx => {
      const data = await tx.doc(Office, req.conversation.id);
      if (data.chatKeys.includes(key)) return;
      data.chat.push({ from: identity(req, id), name: req.user.name, color: avatar.color, text: message, at: Date.now(), account: true });
      data.chat = data.chat.slice(-100);
      data.chatKeys = [...data.chatKeys, key].slice(-200);
    });
    return snapshot(req, id);
  }, options);
  web.conversationRoute('POST', 'hire/:source', async req => {
    fields(req.body, ['clientId', 'deskId', 'prompt', 'requestId']);
    const id = client(req.body.clientId);
    const deskId = text(req.body.deskId, 24, 'deskId');
    if (!DESK_IDS.includes(deskId)) fail('Unknown desk');
    const prompt = text(req.body.prompt, 8000, 'prompt');
    const requestId = text(req.body.requestId, 128, 'requestId');
    const lock = `${req.conversation.id}:${deskId}`;
    if (active.has(lock)) throw web.error(409, 'This desk hire is in progress; retry the same request');
    active.add(lock);
    try {
      const seat = await req.commit(async tx => {
        const data = await tx.doc(Office, req.conversation.id);
        const existing = data.seats[deskId];
        if (existing) {
          if (existing.actor !== req.user.id || existing.requestId !== requestId || existing.prompt !== prompt) throw web.error(409, 'Desk is occupied or reserved; recover the original hire or dismiss it');
          return { ...existing };
        }
        // Reserve atomically before starting work. Keep this key through failure and process interruption.
        const value: Seat = { workerId: `pocket-${randomUUID().replaceAll('-', '').slice(0, 24)}`, deskId, actor: req.user.id, requestId, prompt,
          key: `x.office-v2.hire:${req.conversation.id}:${req.user.id}:${deskId}:${requestId}`,
          state: 'reserved', createdAt: Date.now() };
        data.seats[deskId] = value;
        return { ...value };
      });
      if (seat.conversationId === undefined) {
        try {
          // No model, thinking, cwd, shell, or worktree override. Pocket inherits and authorizes all settings.
          const started = await req.linkedSessions.start({ title: `Office ${deskId}`, message: seat.prompt }, seat.key);
          await req.commit(async tx => {
            const current = (await tx.doc(Office, req.conversation.id)).seats[deskId];
            if (current?.workerId !== seat.workerId) throw web.error(409, 'Desk reservation changed');
            // A dismiss during uncertain admission retains the reservation. Receipt recovery releases it,
            // leaving the admitted session ordinary and unseated, never stopped or deleted.
            if (current.state === 'dismissed') delete (await tx.doc(Office, req.conversation.id)).seats[deskId];
            else {
              current.conversationId = Number(started.session);
              current.state = 'bound';
            }
          });
        } catch (error) {
          // A failed/uncertain start is retryable with its original receipt, and dismissible. Never invent a new key.
          try { await req.commit(async tx => {
            const current = (await tx.doc(Office, req.conversation.id)).seats[deskId];
            if (current?.workerId === seat.workerId && current.conversationId === undefined && current.state !== 'dismissed') current.state = 'retry';
          }); } catch { /* Request capabilities can already have expired. The reservation still permits recovery. */ }
          throw error;
        }
      }
      return snapshot(req, id);
    } finally { active.delete(lock); }
  }, options);
  web.conversationRoute('POST', 'dismiss/:source', async req => {
    fields(req.body, ['clientId', 'workerId']);
    const id = client(req.body.clientId);
    const workerId = text(req.body.workerId, 31, 'workerId');
    if (!/^pocket-[0-9a-f]{24}$/.test(workerId)) fail('Invalid workerId');
    await req.commit(async tx => {
      const data = await tx.doc(Office, req.conversation.id);
      const seat = Object.values(data.seats).find(s => s.workerId === workerId);
      if (!seat) throw web.error(409, 'Worker generation no longer occupies a desk');
      if (seat.conversationId === undefined) {
        // An admission can have succeeded even when no binding commit is visible. Do not free this desk
        // until the original actor recovers that receipt. Never expose another actor\'s prompt or key.
        seat.state = 'dismissed';
      } else delete data.seats[seat.deskId];
    });
    return snapshot(req, id);
  }, options);
}
