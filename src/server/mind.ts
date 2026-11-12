// The office's small local mind: an Ollama model that gives idle workers a voice of their own in
// hallway chats and keeps a note of who they talked to. It only ever writes a line or two — it
// never touches code, tools or the repo, and the procedural chatter in features/workers/wander.ts
// covers for it whenever Ollama isn't there.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const OLLAMA = (process.env.OFFICE_MIND_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
const MODEL = process.env.OFFICE_MIND_MODEL ?? 'llama3.2:3b';
const EMBED = process.env.OFFICE_MIND_EMBED ?? 'nomic-embed-text';
const GENERATE_MS = 90_000;

/** The trait values as the model should read them (the traits themselves stay English). */
const TONE_ES: Record<string, string> = { dry: 'seca', warm: 'cálida', hyper: 'hiperactiva', gloomy: 'sombría', formal: 'formal', chaotic: 'caótica' };
const QUIRK_ES: Record<string, string> = { hummer: 'tararea', muttering: 'murmura', stretcher: 'se estira', cheerleader: 'porrista', sigher: 'se suspira', none: 'ninguna' };
const TAGS_MS = 800;

/** One worker's side of a chat, as the client describes it (see features/workers/wander.ts). */
export interface MindActor {
  id: string;
  /** Its persona's name, when the desk has one. */
  persona?: string;
  tone: string;
  quirk: string;
  sociability: number;
  energy: number;
  mischief: number;
  /** The task it last worked on, if any — what its memory gets retrieved against. */
  task?: string;
  /** What it remembers from earlier chats (the mind's own notes, newest last). */
  memory: string[];
}

/** A memory note, when it was written, and — when the embed model is around — its vector for relevance retrieval. */
interface Note {
  text: string;
  at?: number;
  vec?: number[];
}

interface Memory {
  notes: Note[];
}

/** What the office as a whole has learned, per floor: things worth everyone knowing. */
type FloorNotes = Record<string, Note[]>;

/** A worker's memory across chats, kept on disk so it survives restarts. */
export class Mind {
  private memories = new Map<string, Memory>();
  private floors: FloorNotes = {};
  private file: string;
  private up = false;
  private checked = 0;
  private dirty = false;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'minds.json');
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as { workers?: Record<string, Memory>; floors?: FloorNotes } | Record<string, Memory>;
      // The file used to be just the workers map; it grew a floors section for shared knowledge.
      const workers = 'workers' in saved ? saved.workers ?? {} : (saved as Record<string, Memory>);
      const toNote = (n: unknown): Note | null => {
        if (typeof n === 'string') return { text: n, at: Date.now() };
        const note = n as Note | undefined;
        return note && typeof note.text === 'string' ? { ...note, at: note.at ?? Date.now() } : null;
      };
      for (const [k, v] of Object.entries(workers)) {
        // Notes were plain strings once; they're {text, at, vec?} now.
        const notes = (Array.isArray(v?.notes) ? v.notes : []).map(toNote).filter((n: Note | null): n is Note => !!n).slice(-12);
        this.memories.set(k, { notes });
      }
      if ('floors' in saved && saved.floors && typeof saved.floors === 'object') {
        this.floors = Object.fromEntries(
          Object.entries(saved.floors as Record<string, unknown[]>).map(([f, list]) => [
            f,
            (Array.isArray(list) ? list : []).map(toNote).filter((n: Note | null): n is Note => !!n).slice(-15),
          ]),
        );
      }
    } catch {
      // No memories yet (or a corrupt file): start clean.
    }
    // Load the model into memory soon after the office starts, so the first chat isn't a cold start.
    setTimeout(() => {
      void fetch(`${OLLAMA}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, prompt: '', stream: false, keep_alive: '30m', options: { num_predict: 1 } }),
      }).catch(() => {});
    }, 3000);
  }

  private key(floor: string, id: string) {
    return `${floor}:${id}`;
  }

  private notes(floor: string, id: string): string[] {
    return (this.memories.get(this.key(floor, id))?.notes ?? []).map((n) => n.text);
  }

  /** Whether Ollama answers right now (checked at most every few seconds). */
  private async available(): Promise<boolean> {
    if (this.up && Date.now() - this.checked < 15_000) return true;
    this.checked = Date.now();
    try {
      const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(TAGS_MS) });
      this.up = res.ok;
      if (this.up) {
        const tags = (await res.json()) as { models?: { name: string }[] };
        this.up = (tags.models ?? []).some((m) => m.name === MODEL || m.name.startsWith(`${MODEL}:`));
      }
    } catch {
      this.up = false;
    }
    return this.up;
  }

  /** One completion from the local model, or null when it's not up or takes too long. */
  private async ask(prompt: string): Promise<string | null> {
    if (!(await this.available())) return null;
    try {
      const res = await fetch(`${OLLAMA}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // keep_alive: chats are sporadic — leave the model warm so the next one isn't a cold start.
        body: JSON.stringify({ model: MODEL, prompt, stream: false, keep_alive: '30m', options: { temperature: 0.9, num_predict: 380, num_ctx: 2048 } }),
        signal: AbortSignal.timeout(GENERATE_MS),
      });
      if (!res.ok) {
        this.up = false;
        return null;
      }
      const out = (await res.json()) as { response?: string };
      return out.response?.trim() || null;
    } catch {
      return null;
    }
  }

  /** An embedding for `text`, or null when the embed model isn't there (memory then falls back to recency). */
  private async embed(text: string): Promise<number[] | null> {
    if (this.embedDead) return null;
    try {
      const res = await fetch(`${OLLAMA}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: EMBED, input: text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        this.embedDead = true;
        return null;
      }
      const out = (await res.json()) as { embeddings?: number[][] };
      return out.embeddings?.[0] ?? null;
    } catch {
      this.embedDead = true;
      return null;
    }
  }

  private embedDead = false;

  private cosine(a: number[], b: number[]): number {
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

  /** Old notes fade: a week-old memory counts half as much as a fresh one when picking what to recall. */
  private ageWeight(at?: number): number {
    if (!at) return 0.5;
    const days = (Date.now() - at) / 86_400_000;
    return Math.pow(0.5, Math.max(0, days) / 7);
  }

  /** An embedding lands on the note whenever it lands; nothing waits on it. */
  private vectorize(note: Note) {
    void this.embed(note.text).then((vec) => {
      if (vec) {
        note.vec = vec;
        this.dirty = true;
        this.flush();
      }
    });
  }

  /**
   * The notes worth bringing into this chat: the ones most similar to what the two are about
   * (the partner's persona, its last task), weighted down as they age, plus the newest one for
   * continuity. Without the embed model it's just the latest few.
   */
  private async recall(floor: string, a: MindActor, b: MindActor): Promise<{ a: string[]; b: string[] }> {
    const pick = async (actor: MindActor, other: MindActor): Promise<string[]> => {
      const items = this.memories.get(this.key(floor, actor.id))?.notes ?? [];
      if (!items.length) return [];
      const vecs = items.filter((n) => n.vec).length;
      if (!vecs) return items.slice(-4).map((n) => n.text);
      const q = await this.embed(`${other.persona ?? ''} ${other.task ?? ''} ${actor.persona ?? ''}`);
      if (!q) return items.slice(-4).map((n) => n.text);
      const scored = items
        .map((n, i) => ({ n, s: n.vec ? this.cosine(n.vec, q) * this.ageWeight(n.at) : -1, i }))
        .sort((x, y) => y.s - x.s || y.i - x.i);
      const top = scored.slice(0, 3).map((x) => x.n.text);
      const newest = items[items.length - 1].text;
      return [...new Set([...top, newest])].slice(0, 4);
    };
    const [ma, mb] = await Promise.all([pick(a, b), pick(b, a)]);
    return { a: ma, b: mb };
  }

  /**
   * The floor's shared notes worth surfacing in this chat: the ones most similar to what the pair
   * is about, aged the same way. Falls back to the latest few without the embed model.
   */
  private async shared(floor: string, a: MindActor, b: MindActor): Promise<string[]> {
    const items = this.floors[floor] ?? [];
    if (!items.length) return [];
    if (!items.some((n) => n.vec)) return items.slice(-6).map((n) => n.text);
    const q = await this.embed(`${a.persona ?? ''} ${a.task ?? ''} ${b.persona ?? ''} ${b.task ?? ''}`);
    if (!q) return items.slice(-6).map((n) => n.text);
    const scored = items
      .map((n, i) => ({ n, s: n.vec ? this.cosine(n.vec, q) * this.ageWeight(n.at) : -1, i }))
      .sort((x, y) => y.s - x.s || y.i - x.i);
    const top = scored.slice(0, 4).map((x) => x.n.text);
    const newest = items[items.length - 1].text;
    return [...new Set([...top, newest])].slice(0, 6);
  }

  private actorPrompt(a: MindActor, who: string, memory?: string[]): string {
    const mem = memory?.length ? `\n  recuerda: ${memory.join('; ')}` : a.memory.length ? `\n  recuerda: ${a.memory.slice(-4).join('; ')}` : '';
    return `  ${who}: persona "${a.persona ?? 'ninguna'}", voz ${TONE_ES[a.tone] ?? a.tone}, manía ${QUIRK_ES[a.quirk] ?? a.quirk ?? 'ninguna'}, sociabilidad ${a.sociability.toFixed(1)}, energía ${a.energy.toFixed(1)}, travesura ${a.mischief.toFixed(1)}${mem}`;
  }

  /**
   * A hallway chat between two workers: `turns` lines each, alternating, as two JSON arrays.
   * Null when the mind is away — the caller falls back to its procedural lines.
   */
  async chat(floor: string, a: MindActor, b: MindActor, turns: number): Promise<{ a: string[]; b: string[] } | null> {
    if (!(await this.available())) return null;
    // A local 3B on CPU takes ~30s for a full script: four lines each is the sweet spot — the
    // client's procedural lines cover whichever turns the script doesn't reach in time.
    const n = Math.min(turns, 4);
    const mem = await this.recall(floor, a, b);
    const shared = await this.shared(floor, a, b);
    const prompt = [
      'Dos compañeros de IA charlan en la cocina de la oficina. Escribe su conversación.',
      this.actorPrompt(a, 'A', mem.a),
      this.actorPrompt(b, 'B', mem.b),
      // What the office has learned lately: they can pick it up, the way coworkers do.
      ...(shared.length ? ['Lo que la oficina sabe últimamente:', ...shared.map((s) => `  - ${s}`)] : []),
      `Reglas: exactamente ${n} líneas cortas cada uno, máximo 10 palabras, en personaje, sobre plática de oficina (código, bugs, deadlines, café). En español. Sin nombres, sin comillas, sin narración.`,
      'Format: one line per utterance, alternating, each starting with "A:" or "B:". Nothing else.',
    ].join('\n');
    const text = await this.ask(prompt);
    const sa: string[] = [];
    const sb: string[] = [];
    for (const raw of (text ?? '').split('\n')) {
      const m = /^\s*([AB])\s*:\s*(.+?)\s*$/.exec(raw);
      if (!m) continue;
      (m[1] === 'A' ? sa : sb).push(m[2].replace(/^["']|["']$/g, '').slice(0, 90));
    }
    if (!sa.length && !sb.length) return null;
    return { a: sa.slice(0, n), b: sb.slice(0, n) };
  }

  /**
   * After a chat, a note about what mattered — kept in its memory for next time, plus an
   * "OFICINA:" line for anything the whole floor should know. Fire-and-forget; never blocks.
   */
  reflect(floor: string, a: MindActor, b: MindActor, saidA: string[], saidB: string[]) {
    void this.available().then(async (up) => {
      if (!up) return;
      const transcript = [...saidA.map((l) => `A: ${l}`), ...saidB.map((l) => `B: ${l}`)].join('\n');
      const prompt = [
        'Un compañero de IA acaba de terminar una charla en el pasillo. Escribe dos líneas en español:',
        '1. En UNA frase corta (máximo 15 palabras): qué debe recordar — cómo se siente del otro trabajador, o un tema para la próxima vez.',
        '2. Si la charla reveló algo útil para TODA la oficina (un bug, una convención, un aviso, un cumpleaños), otra frase empezando con "OFICINA:". Si no hay nada, omítela.',
        'Sin preámbulos, sin comillas.',
        this.actorPrompt(a, 'Él'),
        `El otro: persona "${b.persona ?? 'ninguna'}", voz ${TONE_ES[b.tone] ?? b.tone}.`,
        `La charla:\n${transcript}`,
      ].join('\n');
      const out = await this.ask(prompt);
      if (!out) return;
      for (const raw of out.split('\n')) {
        const line = raw.replace(/^[\s\-*\d.)]+/, '').replace(/^["']|["'.\s]+$/g, '').trim().slice(0, 140);
        if (!line) continue;
        if (/^OFICINA:/i.test(line)) {
          const fact = line.replace(/^OFICINA:\s*/i, '');
          if (fact) this.share(floor, fact);
          continue;
        }
        this.remember(floor, a.id, line);
      }
      this.maybeConsolidate(floor, a.id);
    });
  }

  /**
   * A worker finished a task: one line about what it learned or did worth remembering — personal
   * memory, and shared with the floor when it's the kind of thing everyone should know.
   */
  learn(floor: string, a: MindActor, task: string) {
    void this.available().then(async (up) => {
      if (!up || !task.trim()) return;
      const prompt = [
        `Un compañero de IA acaba de terminar una tarea: "${task.slice(0, 200)}".`,
        'Escribe en español, sin preámbulos:',
        '1. En UNA frase corta (máximo 15 palabras): qué aprendió o logró que valga recordar.',
        '2. Si es algo útil para TODA la oficina (un bug encontrado, una convención, un aviso), otra frase empezando con "OFICINA:". Si no, omítela.',
      ].join('\n');
      const out = await this.ask(prompt);
      if (!out) return;
      for (const raw of out.split('\n')) {
        const line = raw.replace(/^[\s\-*\d.)]+/, '').replace(/^["']|["'.\s]+$/g, '').trim().slice(0, 140);
        if (!line) continue;
        if (/^OFICINA:/i.test(line)) {
          const fact = line.replace(/^OFICINA:\s*/i, '');
          if (fact) this.share(floor, fact);
          continue;
        }
        this.remember(floor, a.id, line);
      }
      this.maybeConsolidate(floor, a.id);
    });
  }

  /** One durable note into a worker's memory, with its vector when the embed model is around. */
  private remember(floor: string, id: string, note: string) {
    const k = this.key(floor, id);
    const m = this.memories.get(k) ?? { notes: [] };
    const item: Note = { text: note, at: Date.now() };
    m.notes.push(item);
    if (m.notes.length > 12) m.notes.splice(0, m.notes.length - 12);
    this.memories.set(k, m);
    this.dirty = true;
    this.flush();
    this.vectorize(item);
  }

  /** A fact the whole floor can pick up in conversation. */
  private share(floor: string, fact: string) {
    const list = (this.floors[floor] ??= []);
    if (list.some((n) => n.text === fact)) return;
    const item: Note = { text: fact, at: Date.now() };
    list.push(item);
    if (list.length > 15) list.splice(0, list.length - 15);
    this.dirty = true;
    this.flush();
    this.vectorize(item);
  }

  /**
   * Memory isn't just appended forever: once a worker has a pile of notes, the mind consolidates
   * them into the few things that actually matter, so what it carries into the next chat is
   * wisdom, not a log.
   */
  private maybeConsolidate(floor: string, id: string) {
    const m = this.memories.get(this.key(floor, id));
    if (!m || m.notes.length < 9) return;
    const notes = m.notes.slice();
    void this.ask([
      'Un compañero de IA ha vivido muchas charlas en la oficina. Destila sus notas en las 5 cosas que de verdad debe recordar (en español, una por línea, sin numerar ni viñetas):',
      ...notes.map((n) => `- ${n.text}`),
    ].join('\n')).then((out) => {
      if (!out) return;
      const distilled = out.split('\n').map((l) => l.replace(/^[\s\-*\d.)]+/, '').trim().slice(0, 140)).filter((l) => l.length > 8).slice(0, 5);
      if (distilled.length) {
        // The distilled notes lose their old vectors and timestamps; new ones arrive as they're embedded.
        m.notes = distilled.map((text) => ({ text, at: Date.now() }));
        for (const n of m.notes) this.vectorize(n);
        this.dirty = true;
        this.flush();
      }
    });
  }

  /** Persists memories, at most once every few seconds. */
  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify({ workers: Object.fromEntries(this.memories), floors: this.floors }, null, 2), { mode: 0o600 });
    } catch {
      // A memory that can't be written is just forgotten on restart.
    }
  }

  /** The memory an actor carries into a prompt (for tests and debugging). */
  remembered(floor: string, id: string): string[] {
    return this.notes(floor, id);
  }
}
