// The client half of the office mind (see server/mind.ts): asks /api/mind for a chat script while
// two wanderers walk to their rendezvous, hands each its lines when the chat starts, and reports
// back what was said so the mind remembers. The procedural lines in wander.ts cover any miss.
import { personaFor } from '../../../shared/personas';
import type { WorkerInfo } from '../../../shared/protocol';
import type { Traits } from '../../../shared/traits';
import { store } from '../../state';

interface MindRoamer {
  id: string;
  traits: Traits;
  desk: { def: { id: string } };
}

interface Script {
  aId: string;
  a: string[];
  b: string[];
}

export class MindChats {
  /** Scripts on their way or in hand, per pair. */
  private readonly minds = new Map<string, { script?: Script | null }>();
  /** Affinity updates waiting for their one batched save. */
  private readonly pendingAffinity = new Map<string, number>();
  private affinityTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private worker: (id: string) => WorkerInfo | undefined,
    private floor: () => string,
  ) {}

  private key(a: string, b: string) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  /** What the mind is told about a worker: who it is, how it sounds, and what it remembers (the server keeps that). */
  private actor(c: MindRoamer) {
    const w = this.worker(c.id);
    const persona = w?.kind === 'agent' ? personaFor(store.project?.dir, c.desk.def.id) : undefined;
    return {
      id: c.id,
      persona: persona?.name,
      tone: c.traits.tone,
      quirk: c.traits.quirk,
      sociability: c.traits.sociability,
      energy: c.traits.energy,
      mischief: c.traits.mischief,
      task: w?.prompt?.slice(0, 200),
      memory: [],
    };
  }

  /** Asks for this pair's script; the first caller wins, and a later chat gets a fresh ask. */
  ask(a: MindRoamer, b: MindRoamer, turns: number) {
    const k = this.key(a.id, b.id);
    if (this.minds.has(k)) return;
    const rec: { script?: Script | null } = {};
    this.minds.set(k, rec);
    fetch('/api/mind', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ floor: this.floor(), op: 'chat', turns, a: this.actor(a), b: this.actor(b) }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        rec.script = j && Array.isArray(j.a) && Array.isArray(j.b) ? { aId: a.id, a: j.a as string[], b: j.b as string[] } : null;
      })
      .catch(() => {
        rec.script = null;
      });
  }

  /** The pair's script once it lands: `aId` says whose lines `a` are. Undefined while it's still being written. */
  script(aId: string, bId: string): Script | null | undefined {
    return this.minds.get(this.key(aId, bId))?.script;
  }

  /** A worker finished a task: the mind writes down what it took away (fire-and-forget). */
  learn(c: MindRoamer, task: string) {
    fetch('/api/mind', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ floor: this.floor(), op: 'learn', a: this.actor(c), task }),
    }).catch(() => {});
  }

  /** Tells the mind what was said, so it remembers them next time (fire-and-forget). */
  reflect(c: MindRoamer, p: MindRoamer, saidA: string[], saidB: string[]) {
    if (!saidA.length && !saidB.length) return;
    fetch('/api/mind', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ floor: this.floor(), op: 'reflect', a: this.actor(c), b: this.actor(p), saidA, saidB }),
    }).catch(() => {});
  }

  /** The floor's remembered affinities, once — relationships survive restarts and visitors. */
  loadAffinity(): Promise<Record<string, number> | null> {
    return fetch('/api/mind', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ floor: this.floor(), op: 'affinity' }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j && typeof j.affinity === 'object' && j.affinity ? (j.affinity as Record<string, number>) : null))
      .catch(() => null);
  }

  /** Fetch the floor's remembered affinities into `into`: relationships survive restarts and visitors. */
  primeAffinity(into: Map<string, number>) {
    void this.loadAffinity().then((saved) => {
      if (!saved) return;
      for (const [k, v] of Object.entries(saved)) {
        if (typeof v === 'number' && Number.isFinite(v)) into.set(k, Math.max(-1, Math.min(1, v)));
      }
    });
  }

  /** Queue affinity updates; they go up in one request a few seconds later, and go back in the queue if it's lost. */
  saveAffinity(pairs: Record<string, number>) {
    for (const [k, v] of Object.entries(pairs)) this.pendingAffinity.set(k, v);
    if (this.affinityTimer) return;
    this.affinityTimer = setTimeout(() => {
      this.affinityTimer = undefined;
      if (!this.pendingAffinity.size) return;
      const pairs = Object.fromEntries(this.pendingAffinity);
      this.pendingAffinity.clear();
      fetch('/api/mind', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ floor: this.floor(), op: 'affinity', pairs }),
      }).catch(() => {
        for (const [k, v] of Object.entries(pairs)) this.pendingAffinity.set(k, v);
      });
    }, 4000);
  }

  /** A pair's script is done being useful; the next chat asks for a new one. */
  forget(aId: string, bId: string) {
    setTimeout(() => this.minds.delete(this.key(aId, bId)), 30_000);
  }
}

