// The Ollama plumbing behind the office mind (see mind.ts): health probes remembered both ways,
// a one-at-a-time request queue with priorities (a 3B on CPU gains nothing from parallel ones and
// each would eat the others' time budget), embeddings, and the vector math memory runs on.
const OLLAMA = (process.env.OFFICE_MIND_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
const MODEL = process.env.OFFICE_MIND_MODEL ?? 'llama3.2:3b';
/** Chats are on a clock (the pair stops talking after a few turns), so they go to a smaller, faster model when there is one. */
const FAST = process.env.OFFICE_MIND_FAST_MODEL ?? 'llama3.2:1b';
const EMBED = process.env.OFFICE_MIND_EMBED ?? 'nomic-embed-text';
const GENERATE_MS = 90_000;
const TAGS_MS = 800;
/** How long "Ollama is down" is believed before probing again (so a chat doesn't pay the probe every time). */
const DOWN_MS = 10_000;
const UP_MS = 15_000;
/** After an embed failure, embeddings are skipped this long (memory falls back to recency meanwhile). */
const EMBED_RETRY_MS = 60_000;
/** A chat script that has waited this long in the queue is too late to matter: the client has moved on. */
const CHAT_WAIT_MS = 25_000;
const BACKGROUND_WAIT_MS = 180_000;
/** Background jobs (reflect, learn, consolidate) queued beyond this are dropped: the chat voice comes first. */
const MAX_BACKGROUND = 6;

/** 0 is a chat script (someone is waiting on it), 1 a note, 2 a memory consolidation. */
export type Prio = 0 | 1 | 2;
interface Job {
  prio: Prio;
  expires: number;
  run: () => Promise<void>;
  drop: () => void;
}

export class LocalModel {
  private up = false;
  private checked = 0;
  private fastOk = false;
  private probing: Promise<boolean> | null = null;
  private embedDownUntil = 0;
  private queue: Job[] = [];
  private busy = false;

  constructor() {
    // Load the models into memory soon after the office starts, so the first chat isn't a cold start.
    setTimeout(() => {
      for (const model of new Set([MODEL, FAST])) {
        void fetch(`${OLLAMA}/api/generate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model, prompt: '', stream: false, keep_alive: '30m', options: { num_predict: 1 } }),
        }).catch(() => {});
      }
    }, 3000).unref();
  }

  /** Whether Ollama answers right now. Both answers are remembered for a while: no probe per call. */
  available(): Promise<boolean> {
    const now = Date.now();
    if (this.up && now - this.checked < UP_MS) return Promise.resolve(true);
    if (!this.up && this.checked && now - this.checked < DOWN_MS) return Promise.resolve(false);
    this.probing ??= this.probe().finally(() => {
      this.probing = null;
    });
    return this.probing;
  }

  private async probe(): Promise<boolean> {
    this.checked = Date.now();
    try {
      const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(TAGS_MS) });
      this.up = res.ok;
      if (this.up) {
        const tags = (await res.json()) as { models?: { name: string }[] };
        const names = (tags.models ?? []).map((m) => m.name);
        this.up = names.some((m) => m === MODEL || m.startsWith(`${MODEL}:`));
        this.fastOk = names.some((m) => m === FAST || m.startsWith(`${FAST}:`));
      }
    } catch {
      this.up = false;
    }
    return this.up;
  }

  /**
   * One completion from the local model, or null when it's not up, takes too long, or the queue
   * is full. One request at a time; chat scripts go before background notes.
   */
  ask(prompt: string, prio: Prio = 1): Promise<string | null> {
    return new Promise((resolve) => {
      if (prio > 0 && this.queue.filter((j) => j.prio > 0).length >= MAX_BACKGROUND) return resolve(null);
      const wait = prio === 0 ? CHAT_WAIT_MS : BACKGROUND_WAIT_MS;
      this.queue.push({ prio, expires: Date.now() + wait, run: async () => resolve(await this.generate(prompt, prio)), drop: () => resolve(null) });
      this.queue.sort((a, b) => a.prio - b.prio);
      void this.pump();
    });
  }

  private async pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (let job = this.queue.shift(); job; job = this.queue.shift()) {
        if (Date.now() > job.expires) job.drop();
        else await job.run();
      }
    } finally {
      this.busy = false;
    }
  }

  private async generate(prompt: string, prio: Prio): Promise<string | null> {
    if (!(await this.available())) return null;
    // A chat script goes to the fast model when the office has one; a missing or failing fast
    // model falls back to the main one rather than counting as Ollama being down.
    const model = prio === 0 && this.fastOk && FAST !== MODEL ? FAST : MODEL;
    const out = await this.complete(model, prompt);
    if (out === undefined && model !== MODEL) return (await this.complete(MODEL, prompt)) ?? null;
    return out ?? null;
  }

  /** One /api/generate call. Undefined when the request itself failed (the caller may retry on the other model). */
  private async complete(model: string, prompt: string): Promise<string | null | undefined> {
    try {
      const res = await fetch(`${OLLAMA}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // keep_alive: chats are sporadic — leave the model warm so the next one isn't a cold start.
        body: JSON.stringify({ model, prompt, stream: false, keep_alive: '30m', options: { temperature: 0.9, num_predict: 380, num_ctx: 2048 } }),
        signal: AbortSignal.timeout(GENERATE_MS),
      });
      if (!res.ok) {
        if (res.status === 404) return undefined;
        this.up = false;
        this.checked = Date.now();
        return null;
      }
      const out = (await res.json()) as { response?: string };
      return out.response?.trim() || null;
    } catch {
      return undefined;
    }
  }

  /** An embedding for `text`, or null while the embed model is down (retrieval falls back to recency). */
  async embed(text: string): Promise<number[] | null> {
    if (Date.now() < this.embedDownUntil) return null;
    try {
      const res = await fetch(`${OLLAMA}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: EMBED, input: text.slice(0, 1000) }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        this.embedDownUntil = Date.now() + EMBED_RETRY_MS;
        return null;
      }
      const out = (await res.json()) as { embeddings?: number[][] };
      return out.embeddings?.[0] ?? null;
    } catch {
      // Not for good: a model pulled a minute later, or a hiccup, shouldn't cost embeddings until restart.
      this.embedDownUntil = Date.now() + EMBED_RETRY_MS;
      return null;
    }
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Vectors are stored to 5 decimals: plenty for ranking, and a quarter of the bytes. */
export const slim = (v: number[]) => v.map((x) => Math.round(x * 1e5) / 1e5);
