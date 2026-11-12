// The local mind's HTTP face: the wanderers ask it for a hallway chat's script, and report back
// what to remember (see ../../mind.ts).
import { Mind, type MindActor } from '../../mind.js';
import { readBody, send } from '../util.js';
import type { Route } from '../router.js';

let mind: Mind | undefined;
const getMind = (ctx: { cfg: { dataDir: string } }) => (mind ??= new Mind(ctx.cfg.dataDir));

const actor = (v: unknown): MindActor | null => {
  const a = v as Partial<MindActor> | undefined;
  if (!a || typeof a.id !== 'string' || typeof a.tone !== 'string') return null;
  return {
    id: a.id.slice(0, 80),
    persona: typeof a.persona === 'string' ? a.persona.slice(0, 80) : undefined,
    tone: a.tone.slice(0, 24),
    quirk: typeof a.quirk === 'string' ? a.quirk.slice(0, 24) : '',
    sociability: typeof a.sociability === 'number' ? a.sociability : 0.5,
    energy: typeof a.energy === 'number' ? a.energy : 0.5,
    mischief: typeof a.mischief === 'number' ? a.mischief : 0.5,
    task: typeof a.task === 'string' ? a.task.slice(0, 200) : undefined,
    memory: Array.isArray(a.memory) ? a.memory.filter((x): x is string => typeof x === 'string').slice(-8).map((x) => x.slice(0, 140)) : [],
  };
};

export const mindRoutes = {
  /** POST /api/mind — { floor, op: 'chat', a, b, turns } or { floor, op: 'reflect', a, b, saidA, saidB } */
  mind: {
    method: 'POST',
    path: '/api/mind',
    auth: 'session',
    async handle(ctx, { res, req }) {
      let body: { floor?: unknown; op?: unknown; a?: unknown; b?: unknown; turns?: unknown; saidA?: unknown; saidB?: unknown; task?: unknown };
      try {
        body = JSON.parse(await readBody(req, 64 * 1024));
      } catch {
        return send(res, 400, { error: 'Bad request' });
      }
      const floor = typeof body.floor === 'string' ? body.floor.slice(0, 200) : 'office';
      const a = actor(body.a);
      const b = actor(body.b);
      const m = getMind(ctx);
      if (body.op === 'learn') {
        // A worker finished a task: it writes down what it took away (fire-and-forget).
        if (a && typeof body.task === 'string') m.learn(floor, a, body.task.slice(0, 300));
        return send(res, 202, { ok: true });
      }
      if (!a || !b) return send(res, 400, { error: 'Bad actors' });
      if (body.op === 'reflect') {
        const lines = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 12).map((x) => x.slice(0, 120)) : []);
        m.reflect(floor, a, b, lines(body.saidA), lines(body.saidB));
        return send(res, 202, { ok: true });
      }
      const turns = typeof body.turns === 'number' ? Math.max(2, Math.min(8, Math.floor(body.turns))) : 4;
      const script = await m.chat(floor, { ...a, memory: m.remembered(floor, a.id) }, { ...b, memory: m.remembered(floor, b.id) }, turns);
      if (!script) return send(res, 503, { error: 'The office mind is away (is Ollama running?)' });
      return send(res, 200, script);
    },
  },
} satisfies Record<string, Route>;
