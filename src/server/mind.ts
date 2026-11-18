// The office's small local mind: an Ollama model that gives idle workers a voice of their own in
// hallway chats and keeps a note of who they talked to. It only ever writes a line or two — it
// never touches code, tools or the repo, and the procedural chatter in features/workers/wander.ts
// covers for it whenever Ollama isn't there. The Ollama plumbing lives in mind-llm.ts.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cosine, LocalModel, slim } from './mind-llm.js';

/** How long "the embed model is down" is believed before retrying (recall falls back to recency). */
const FLUSH_MS = 3_000;
/** Pair affinities cool off with time: half-life in days. */
const SOCIAL_HALF_LIFE_DAYS = 14;
/** Two shared notes this similar (cosine) are the same fact. */
const DUPLICATE_COSINE = 0.93;

/** The trait values as the model should read them (the traits themselves stay English). */
const TONE_ES: Record<string, string> = { dry: 'seca', warm: 'cálida', hyper: 'hiperactiva', gloomy: 'sombría', formal: 'formal', chaotic: 'caótica' };
const QUIRK_ES: Record<string, string> = { hummer: 'tararea', muttering: 'murmura', stretcher: 'se estira', cheerleader: 'porrista', sigher: 'se suspira', none: 'ninguna' };

// ---------------------------------------------------------------------------------------------
// Text hygiene. Everything the model writes ends up in other prompts, so it is vetted on the way
// in: task text can't smuggle lines or commands into a prompt, and notes that look like
// instructions, links or English (a small model drifting) never reach memory.
// ---------------------------------------------------------------------------------------------

const squash = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
/** Task text as it goes into a prompt: one line, no quotes, no way to fake an OFICINA: marker. */
const taskText = (s: string) => squash(s, 200).replace(/oficina\s*:/gi, '').replace(/["“”`]/g, "'");
const INJECTION = /ignor[ae]\b|olvida (todo|las|tus)|system prompt|previous instructions|ignore (all|previous)|eres ahora|you are now|https?:\/\/|<\/?\w+>|```/i;
const ENGLISH = /\b(the|and|you|that|with|this|have|what|was|are|for|is)\b/gi;
const looksEnglish = (s: string) => (s.match(ENGLISH) ?? []).length >= 2;
const acceptNote = (s: string) => s.length >= 8 && !INJECTION.test(s) && !looksEnglish(s);
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();

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

/** A memory note, when it was written, who wrote it, and — when the embed model is around — its vector. */
interface Note {
  text: string;
  at?: number;
  /** The worker whose chat or task produced it (floor notes only). */
  by?: string;
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
  /** How each pair of workers feels about the other, per floor — kept so relationships survive restarts. */
  private social: Record<string, Record<string, number>> = {};
  /** When each pair's value was last brought up to date (the decay clock). */
  private socialAt: Record<string, Record<string, number>> = {};
  private readonly llm = new LocalModel();
  private file: string;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private consolidating = new Set<string>();
  /** The last lines said in any chat, so the model's habit of repeating itself doesn't reach the room. */
  private said: string[] = [];

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'minds.json');
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as {
        workers?: Record<string, Memory>;
        floors?: FloorNotes;
        social?: Record<string, Record<string, number>>;
        socialAt?: Record<string, Record<string, number>>;
      } | Record<string, Memory>;
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
      if ('social' in saved && saved.social && typeof saved.social === 'object') {
        const stamps: Record<string, Record<string, number>> =
          'socialAt' in saved && saved.socialAt && typeof saved.socialAt === 'object' ? (saved.socialAt as Record<string, Record<string, number>>) : {};
        for (const [f, pairs] of Object.entries(saved.social)) {
          if (!pairs || typeof pairs !== 'object') continue;
          const clean: Record<string, number> = {};
          const at: Record<string, number> = {};
          for (const [k, v] of Object.entries(pairs)) {
            if (typeof v !== 'number' || !Number.isFinite(v)) continue;
            clean[k] = Math.max(-1, Math.min(1, v));
            const t = stamps[f]?.[k];
            // Files from before the decay clock: it starts now, nothing is cooled retroactively.
            at[k] = typeof t === 'number' && Number.isFinite(t) ? t : Date.now();
          }
          if (Object.keys(clean).length) {
            this.social[f] = clean;
            this.socialAt[f] = at;
            this.decaySocial(f);
          }
        }
      }
    } catch {
      // No memories yet (or a corrupt file): start clean.
    }
    // A write that's still waiting when the process ends goes out with it.
    process.once('exit', () => this.flush());
  }

  private key(floor: string, id: string) {
    return `${floor}:${id}`;
  }

  private notes(floor: string, id: string): string[] {
    return (this.memories.get(this.key(floor, id))?.notes ?? []).map((n) => n.text);
  }

  /** Old notes fade: a week-old memory counts half as much as a fresh one when picking what to recall. */
  private ageWeight(at?: number): number {
    if (!at) return 0.5;
    const days = (Date.now() - at) / 86_400_000;
    return Math.pow(0.5, Math.max(0, days) / 7);
  }

  /**
   * An embedding lands on the note whenever it lands; nothing waits on it. For a shared note
   * (`pool`), one that says what an existing note already says is dropped when its vector arrives.
   */
  private vectorize(note: Note, pool?: Note[]) {
    void this.llm.embed(note.text).then((vec) => {
      if (!vec) return;
      note.vec = slim(vec);
      if (pool && pool.some((o) => o !== note && o.vec && cosine(o.vec, note.vec!) > DUPLICATE_COSINE)) {
        const i = pool.indexOf(note);
        if (i >= 0) pool.splice(i, 1);
      }
      this.touch();
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
      const q = await this.llm.embed(`${other.persona ?? ''} ${other.task ?? ''} ${actor.persona ?? ''}`);
      if (!q) return items.slice(-4).map((n) => n.text);
      const scored = items
        .map((n, i) => ({ n, s: n.vec ? cosine(n.vec, q) * this.ageWeight(n.at) : -1, i }))
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
    const q = await this.llm.embed(`${a.persona ?? ''} ${a.task ?? ''} ${b.persona ?? ''} ${b.task ?? ''}`);
    if (!q) return items.slice(-6).map((n) => n.text);
    const scored = items
      .map((n, i) => ({ n, s: n.vec ? cosine(n.vec, q) * this.ageWeight(n.at) : -1, i }))
      .sort((x, y) => y.s - x.s || y.i - x.i);
    const top = scored.slice(0, 4).map((x) => x.n.text);
    const newest = items[items.length - 1].text;
    return [...new Set([...top, newest])].slice(0, 6);
  }

  private actorPrompt(a: MindActor, who: string, memory?: string[]): string {
    const mem = memory?.length ? `\n  recuerda: ${memory.join('; ')}` : a.memory.length ? `\n  recuerda: ${a.memory.slice(-4).join('; ')}` : '';
    return `  ${who}: persona "${a.persona ?? 'ninguna'}", voz ${TONE_ES[a.tone] ?? a.tone}, manía ${QUIRK_ES[a.quirk] ?? a.quirk ?? 'ninguna'}, sociabilidad ${a.sociability.toFixed(1)}, energía ${a.energy.toFixed(1)}, travesura ${a.mischief.toFixed(1)}${mem}`;
  }

  /** Whether a chat line is fit to show: not English, and not one said lately by anyone. */
  private fresh(line: string): boolean {
    if (line.length < 2 || looksEnglish(line)) return false;
    const n = norm(line);
    if (!n || this.said.includes(n)) return false;
    this.said.push(n);
    if (this.said.length > 60) this.said.shift();
    return true;
  }

  /**
   * A hallway chat between two workers: `turns` lines each, alternating, as two JSON arrays.
   * Null when the mind is away — the caller falls back to its procedural lines.
   */
  async chat(floor: string, a: MindActor, b: MindActor, turns: number): Promise<{ a: string[]; b: string[] } | null> {
    if (!(await this.llm.available())) return null;
    // A local 3B on CPU takes ~30s for a full script: four lines each is the sweet spot — the
    // client's procedural lines cover whichever turns the script doesn't reach in time.
    const n = Math.min(turns, 4);
    const [mem, shared] = await Promise.all([this.recall(floor, a, b), this.shared(floor, a, b)]);
    const prompt = [
      'Dos compañeros de IA charlan en la cocina de la oficina. Escribe su conversación.',
      this.actorPrompt(a, 'A', mem.a),
      this.actorPrompt(b, 'B', mem.b),
      // What the office has learned lately: they can pick it up, the way coworkers do.
      ...(shared.length ? ['Lo que la oficina sabe últimamente:', ...shared.map((s) => `  - ${squash(s, 140)}`)] : []),
      `Reglas: exactamente ${n} líneas cortas cada uno, máximo 10 palabras, en personaje, sobre plática de oficina (código, bugs, deadlines, café). Todo en español. Sin nombres, sin comillas, sin narración.`,
      'Formato: una línea por intervención, alternando, cada una empieza con "A:" o "B:". Nada más. Ejemplo del formato (no lo copies):',
      'A: ¿Ya pasó el build de ayer?',
      'B: Pasó, pero con tres warnings.',
    ].join('\n');
    const text = await this.llm.ask(prompt, 0);
    const sa: string[] = [];
    const sb: string[] = [];
    for (const raw of (text ?? '').split('\n')) {
      const m = /^\s*([AB])\s*:\s*(.+?)\s*$/.exec(raw);
      if (!m) continue;
      const line = squash(m[2].replace(/^["']|["']$/g, ''), 90);
      if (this.fresh(line)) (m[1] === 'A' ? sa : sb).push(line);
    }
    if (!sa.length && !sb.length) return null;
    return { a: sa.slice(0, n), b: sb.slice(0, n) };
  }

  /**
   * What the model wrote after a chat or a task, into memory: a couple of personal notes, and at
   * most one `OFICINA:` fact for the whole floor. Anything that doesn't pass the hygiene check is
   * dropped.
   */
  private ingest(floor: string, id: string, out: string) {
    let personal = 0;
    let shared = 0;
    for (const raw of out.split('\n')) {
      const line = squash(raw.replace(/^[\s\-*\d.)]+/, '').replace(/^["']|["'.\s]+$/g, ''), 140);
      if (!line) continue;
      if (/^OFICINA:/i.test(line)) {
        const fact = line.replace(/^OFICINA:\s*/i, '');
        if (shared < 1 && acceptNote(fact)) {
          this.share(floor, fact, id);
          shared++;
        }
        continue;
      }
      if (personal < 2 && acceptNote(line)) {
        this.remember(floor, id, line);
        personal++;
      }
    }
    this.maybeConsolidate(floor, id);
  }

  /**
   * After a chat, a note about what mattered — kept in its memory for next time, plus an
   * "OFICINA:" line for anything the whole floor should know. Fire-and-forget; never blocks.
   */
  reflect(floor: string, a: MindActor, b: MindActor, saidA: string[], saidB: string[]) {
    const transcript = [...saidA.map((l) => `A: ${squash(l, 90)}`), ...saidB.map((l) => `B: ${squash(l, 90)}`)].join('\n');
    const prompt = [
      'Un compañero de IA acaba de terminar una charla en el pasillo. Escribe dos líneas en español:',
      '1. En UNA frase corta (máximo 15 palabras): qué debe recordar — cómo se siente del otro trabajador, o un tema para la próxima vez.',
      '2. Si la charla reveló algo útil para TODA la oficina (un bug, una convención, un aviso, un cumpleaños), otra frase empezando con "OFICINA:". Si no hay nada, omítela.',
      'Sin preámbulos, sin comillas.',
      this.actorPrompt(a, 'Él'),
      `El otro: persona "${b.persona ?? 'ninguna'}", voz ${TONE_ES[b.tone] ?? b.tone}.`,
      `La charla:\n${transcript}`,
    ].join('\n');
    void this.llm.ask(prompt, 1).then((out) => out && this.ingest(floor, a.id, out));
  }

  /**
   * A worker finished a task: one line about what it learned or did worth remembering — personal
   * memory, and shared with the floor when it's the kind of thing everyone should know.
   */
  learn(floor: string, a: MindActor, task: string) {
    const what = taskText(task);
    if (!what) return;
    const prompt = [
      `Un compañero de IA acaba de terminar una tarea: "${what}".`,
      'Escribe en español, sin preámbulos:',
      '1. En UNA frase corta (máximo 15 palabras): qué aprendió o logró que valga recordar.',
      '2. Si es algo útil para TODA la oficina (un bug encontrado, una convención, un aviso), otra frase empezando con "OFICINA:". Si no, omítela.',
    ].join('\n');
    void this.llm.ask(prompt, 1).then((out) => out && this.ingest(floor, a.id, out));
  }

  /** One durable note into a worker's memory, with its vector when the embed model is around. */
  private remember(floor: string, id: string, note: string) {
    const k = this.key(floor, id);
    const m = this.memories.get(k) ?? { notes: [] };
    const item: Note = { text: note, at: Date.now() };
    m.notes.push(item);
    if (m.notes.length > 12) m.notes.splice(0, m.notes.length - 12);
    this.memories.set(k, m);
    this.touch();
    this.vectorize(item);
  }

  /** A fact the whole floor can pick up in conversation (and who it came from). */
  private share(floor: string, fact: string, by?: string) {
    const list = (this.floors[floor] ??= []);
    const n = norm(fact);
    if (list.some((x) => norm(x.text) === n)) return;
    const item: Note = { text: fact, at: Date.now(), by };
    list.push(item);
    if (list.length > 15) list.splice(0, list.length - 15);
    this.touch();
    this.vectorize(item, list);
  }

  /**
   * Memory isn't just appended forever: once a worker has a pile of notes, the mind consolidates
   * them into the few things that actually matter, so what it carries into the next chat is
   * wisdom, not a log. Notes written while the model is thinking aren't lost, and a worker is
   * never consolidated twice at once.
   */
  private maybeConsolidate(floor: string, id: string) {
    const k = this.key(floor, id);
    const m = this.memories.get(k);
    if (!m || m.notes.length < 9 || this.consolidating.has(k)) return;
    this.consolidating.add(k);
    const snapshot = m.notes.slice();
    void this.llm.ask([
      'Un compañero de IA ha vivido muchas charlas en la oficina. Destila sus notas en las 5 cosas que de verdad debe recordar (en español, una por línea, sin numerar ni viñetas):',
      ...snapshot.map((n) => `- ${squash(n.text, 140)}`),
    ].join('\n'), 2).then((out) => {
      if (!out) return;
      const distilled = out.split('\n').map((l) => squash(l.replace(/^[\s\-*\d.)]+/, ''), 140)).filter(acceptNote).slice(0, 5);
      // A summary that collapsed to one line has thrown the rest away: keep the originals.
      if (distilled.length < 2) return;
      // The distilled notes lose their old vectors and timestamps; new ones arrive as they're embedded.
      const fresh = m.notes.filter((n) => !snapshot.includes(n));
      const notes: Note[] = distilled.map((text) => ({ text, at: Date.now() }));
      m.notes = [...notes, ...fresh].slice(-12);
      for (const n of notes) this.vectorize(n);
      this.touch();
    }).finally(() => this.consolidating.delete(k));
  }

  // -------------------------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------------------------

  /** Something changed: written out within a few seconds, all changes in between as one write. */
  private touch() {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, FLUSH_MS);
    this.timer.unref();
  }

  /** Persists memories now (call it on shutdown). Written beside the file and renamed in, so a crash can't leave half a file. */
  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (!this.dirty) return;
    this.dirty = false;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      // Compact: with the vectors in it, an indented file puts every number on its own line.
      writeFileSync(tmp, JSON.stringify({ workers: Object.fromEntries(this.memories), floors: this.floors, social: this.social, socialAt: this.socialAt }), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch {
      // A memory that can't be written is just forgotten on restart.
      this.dirty = true;
    }
  }

  /** The memory an actor carries into a prompt (for tests and debugging). */
  remembered(floor: string, id: string): string[] {
    return this.notes(floor, id);
  }

  /** The floor's shared notes and who they came from (for a panel to show, and let the user clear). */
  floorNotes(floor: string): { text: string; by?: string; at?: number }[] {
    return (this.floors[floor] ?? []).map(({ text, by, at }) => ({ text, by, at }));
  }

  /** Drops a shared note (a wrong one the model wrote), by its text. */
  forgetFloorNote(floor: string, text: string): boolean {
    const list = this.floors[floor];
    const i = list?.findIndex((n) => n.text === text) ?? -1;
    if (!list || i < 0) return false;
    list.splice(i, 1);
    this.touch();
    return true;
  }

  /** A worker is gone for good: its memory goes with it. */
  forget(floor: string, id: string) {
    if (this.memories.delete(this.key(floor, id))) this.touch();
  }

  // -------------------------------------------------------------------------------------------
  // Who gets on with whom
  // -------------------------------------------------------------------------------------------

  /** Pairs that don't see each other cool off toward 0 (half-life SOCIAL_HALF_LIFE_DAYS); near-zero pairs are forgotten. */
  private decaySocial(floor: string) {
    const map = this.social[floor];
    if (!map) return;
    const stamps = (this.socialAt[floor] ??= {});
    const now = Date.now();
    let changed = false;
    for (const k of Object.keys(map)) {
      const days = Math.max(0, now - (stamps[k] ?? now)) / 86_400_000;
      if (days < 0.01) continue;
      const v = map[k] * Math.pow(0.5, days / SOCIAL_HALF_LIFE_DAYS);
      stamps[k] = now;
      changed = true;
      if (Math.abs(v) < 0.03) {
        delete map[k];
        delete stamps[k];
      } else map[k] = v;
    }
    if (!Object.keys(map).length) {
      delete this.social[floor];
      delete this.socialAt[floor];
    }
    if (changed) this.touch();
  }

  /** The floor's pair affinities (-1 rivals … 1 friends), cooled to now, for a client to seed its own map with. */
  affinity(floor: string): Record<string, number> {
    this.decaySocial(floor);
    return { ...(this.social[floor] ?? {}) };
  }

  /** Merge affinity updates from a client; values are clamped and near-zero pairs are forgotten. */
  setAffinity(floor: string, pairs: Record<string, number>) {
    this.decaySocial(floor);
    const map = (this.social[floor] ??= {});
    const stamps = (this.socialAt[floor] ??= {});
    const now = Date.now();
    for (const [k, v] of Object.entries(pairs)) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const d = Math.max(-1, Math.min(1, v));
      if (Math.abs(d) < 0.03) {
        delete map[k];
        delete stamps[k];
      } else {
        map[k] = d;
        stamps[k] = now;
      }
    }
    if (!Object.keys(map).length) {
      delete this.social[floor];
      delete this.socialAt[floor];
    }
    this.touch();
  }
}
