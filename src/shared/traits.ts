/*
 * Per-worker character: a seed (floor + desk + the worker's own id) deals every hire its own
 * temperament, tone of voice, favourite haunts and quirk, so no two workers behave or talk alike
 * and a fresh hire is reshuffled every time. Pure functions only (no three.js, no store): the
 * same seed always gives the same Traits, and everything random after that comes from the
 * character's own seeded generator.
 */

export type SpotKind = 'couch' | 'tv' | 'jukebox' | 'arcade' | 'board' | 'shelf' | 'elevator' | 'dj';
export const SPOT_KINDS: SpotKind[] = ['couch', 'tv', 'jukebox', 'arcade', 'board', 'shelf', 'elevator', 'dj'];

export type Tone = 'dry' | 'warm' | 'hyper' | 'gloomy' | 'formal' | 'chaotic';
const TONES: Tone[] = ['dry', 'warm', 'hyper', 'gloomy', 'formal', 'chaotic'];

export type Quirk = 'hummer' | 'muttering' | 'stretcher' | 'cheerleader' | 'sigher' | 'none';
const QUIRKS: Quirk[] = ['hummer', 'muttering', 'stretcher', 'cheerleader', 'sigher', 'none'];

export type Rng = () => number;

/** FNV-1a: a string to a 32-bit seed. */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: a small, fast, seedable generator returning [0, 1). */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length) % xs.length];
const range = (rng: Rng, lo: number, hi: number) => lo + rng() * (hi - lo);

export interface Traits {
  seed: number;
  /** 0–1 each. */
  sociability: number;
  energy: number;
  curiosity: number;
  patience: number;
  mischief: number;
  /** Walking-speed multiplier (0.85–1.2). */
  pace: number;
  tone: Tone;
  quirk: Quirk;
  /** How much it likes each kind of spot (0.2–2). */
  taste: Record<SpotKind, number>;
}

/** The same seed always deals the same character. */
export function traitsFor(seedStr: string): Traits {
  const seed = hashSeed(seedStr);
  const r = makeRng(seed);
  const taste = {} as Record<SpotKind, number>;
  // Everyone gets a couple of favourites and a couple of places they avoid.
  for (const k of SPOT_KINDS) taste[k] = 0.2 + r() * 0.8;
  for (let i = 0; i < 2; i++) taste[pick(r, SPOT_KINDS)] = 1.4 + r() * 0.6;
  return {
    seed,
    sociability: r(),
    energy: r(),
    curiosity: r(),
    patience: r(),
    mischief: r(),
    pace: range(r, 0.85, 1.2),
    tone: pick(r, TONES),
    quirk: pick(r, QUIRKS),
    taste,
  };
}

/** What a worker feels like doing: each creeps up over time and is eased by the right spot. */
export interface Needs {
  fun: number;
  social: number;
  calm: number;
}
export const freshNeeds = (r: Rng): Needs => ({ fun: r() * 0.5, social: r() * 0.5, calm: r() * 0.5 });

/** What visiting each kind of spot does to the needs (negative = eased). */
const EFFECT: Record<SpotKind, Partial<Needs>> = {
  couch: { calm: -0.5, social: -0.1 },
  tv: { calm: -0.3, fun: -0.3 },
  jukebox: { fun: -0.5 },
  arcade: { fun: -0.7 },
  board: { calm: -0.1, fun: -0.2 },
  shelf: { calm: -0.5 },
  elevator: { social: -0.3 },
  dj: { fun: -0.6, social: -0.2 },
};
/** Which need a spot answers (what makes a worker want it). */
const WANTS: Record<SpotKind, Partial<Needs>> = {
  couch: { calm: 1 },
  tv: { calm: 0.5, fun: 0.5 },
  jukebox: { fun: 1 },
  arcade: { fun: 1.2 },
  board: { fun: 0.3, calm: 0.3 },
  shelf: { calm: 1 },
  elevator: { social: 1 },
  dj: { fun: 0.8, social: 0.6 },
};

export function applyVisit(n: Needs, kind: SpotKind) {
  const e = EFFECT[kind];
  n.fun = Math.max(0, n.fun + (e.fun ?? 0));
  n.social = Math.max(0, n.social + (e.social ?? 0));
  n.calm = Math.max(0, n.calm + (e.calm ?? 0));
}

/** Needs creep up; sociable workers want company sooner, energetic ones want fun sooner. */
export function tickNeeds(n: Needs, t: Traits, dt: number) {
  n.fun = Math.min(1.5, n.fun + dt * 0.012 * (0.5 + t.energy));
  n.social = Math.min(1.5, n.social + dt * 0.012 * (0.4 + t.sociability));
  n.calm = Math.min(1.5, n.calm + dt * 0.01 * (0.4 + (1 - t.energy)));
}

/** A weighted pick of where to go: needs × taste × a little chance. */
export function pickKind(t: Traits, n: Needs, r: Rng, avoid: SpotKind | null, available: readonly SpotKind[]): SpotKind | null {
  let total = 0;
  const w = available.map((k) => {
    const want = WANTS[k];
    let score = 0.15 + (want.fun ?? 0) * n.fun + (want.social ?? 0) * n.social + (want.calm ?? 0) * n.calm;
    score *= t.taste[k] * (0.7 + 0.6 * r());
    if (k === avoid) score *= 0.15;
    total += score;
    return score;
  });
  if (!available.length) return null;
  let x = r() * total;
  for (let i = 0; i < available.length; i++) if ((x -= w[i]) <= 0) return available[i];
  return available[available.length - 1];
}

// ---------------------------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------------------------

const SPOT_LINES: Record<SpotKind, string[]> = {
  couch: ['este sofá ha visto cosas', 'cinco minutos, máximo', 'podría vivir aquí', '¿quién dejó migas aquí?', 'mi espalda agradece el sofá'],
  tv: ['¿esto es una repetición?', '¿quién tiene el control?', 'hoy la imagen está nítida', 'solo miro por la trama', 'sube un punto'],
  jukebox: ['esta es un clásico', '¿quién eligió esta canción?', 'pongan algo con ritmo', 'el bajo está trabajando', 'me sé cada palabra'],
  arcade: ['una ronda más', 'yo tenía el récord', 'el joystick está pegajoso', 'echa moneda, echa coraje', 'ese jefe está haciendo trampa'],
  board: ['el plan se ve más claro aquí', 'alguien manchó el roadmap', 'cajas y flechas, siempre', 'este diagrama necesita un diagrama', 'solo borraré mi parte'],
  shelf: ['tantos lomos sin leer', 'este huele a código viejo', 'un capítulo no hace daño', '¿quién sigue archivando esto mal?', 'conocimiento, alfabetizado'],
  elevator: ['algún día subiré', '¿en qué piso quedé?', 'el lobby está infravalorado', 'escuchando el ding', 'otros pisos, otras oficinas'],
  dj: ['suelta el beat', 'un poco de reverb no hace daño', 'ahora soy el DJ', 'transiciones suaves, gente', 'este set no va a ningún lado, en buen sentido'],
};

const GREET = {
  stranger: ['hola, no nos conocemos mucho', '¿nuevo por aquí? creo', '¿en qué escritorio estás?', 'hola, vecino'],
  friend: ['¡otra vez! ¿lo de siempre?', 'ahí estás', 'me debes una historia', 'justo a tiempo'],
  rival: ['oh. tú.', 'sigues con eso, eh', 'procura no romper nada', 'qué atrevido aparecérsete'],
};

const SMALL_TALK = [
  '¿pasó el build?', 'refactoricé una cosa', 'el linter tiene opiniones hoy', 'ese merge se veía peligroso',
  'el café sabe mejor aquí', '¿leíste el changelog?', 'mi última tarea fue un laberinto', 'alguien debería renombrar ese archivo',
  'los tests fallaron de nuevo', 'escribí un comentario del que me arrepiento', 'los logs son una forma de poesía', 'ese bug era una feature',
  'el deadline es una sugerencia', 'me encanta un diff limpio', '¿quién borró mi rama?', 'la demo salió bien, casi',
];

const REPLIES = ['ja, vale', 'yo igual', 'no way', 'cuéntame más', 'no estoy de acuerdo, con respeto', 'anotado', 'tiene sentido', 'qué locura'];
const FAREWELL = ['de vuelta al trabajo', 'nos vemos', 'mi escritorio me extraña', 'el deber llama, en voz baja'];

const MUTTER = {
  hummer: ['mmm mmm mmm~', 'la la la~', '♪ ♪ ♪', 'du bi du~'],
  muttering: ['¿dónde estaba?', 'espera, ¿qué era?', 'claro, claro', 'ok ok ok'],
  stretcher: ['*se estira*', '*bosteza*', '*cruje el cuello*'],
  cheerleader: ['¡podemos!', '¡vamos equipo!', 'gran día hoy'],
  sigher: ['*suspiro*', 'bueno, qué se le va a hacer', 'ah, la vida'],
  none: [] as string[],
};

/** Wraps a line in the speaker's tone, so the same sentence sounds different from each worker. */
export function styled(t: Traits, text: string, r: Rng): string {
  switch (t.tone) {
    case 'dry': return text.toLowerCase().replace(/[!?]+$/, '') + '.';
    case 'warm': return pick(r, ['oye, ', 'la verdad, ', 'amigo, ', '']) + text;
    case 'hyper': return text.replace(/[.?!]*$/, '') + pick(r, ['!!', '!', '!!!']);
    case 'gloomy': return text.replace(/[.?!]*$/, '') + pick(r, ['...', '... probablemente', '. lo que sea']);
    case 'formal': return pick(r, ['En mi opinión, ', 'Francamente, ', 'Estrictamente hablando, ']) + text.charAt(0).toLowerCase() + text.slice(1);
    case 'chaotic': return text + pick(r, [' (o no)', ' jaja', ' ??', ' (escúchame)']);
  }
}

/** A line said to nobody at a spot. */
export function spotLine(t: Traits, kind: SpotKind, r: Rng): string {
  return styled(t, pick(r, SPOT_LINES[kind]), r);
}

/** An idle aside from its quirk (null if it has none or doesn't feel like it). */
export function mutter(t: Traits, r: Rng): string | null {
  const pool = MUTTER[t.quirk];
  return pool.length ? pick(r, pool) : null;
}

export type Relation = 'stranger' | 'friend' | 'rival';
export const relation = (affinity: number): Relation => (affinity > 0.35 ? 'friend' : affinity < -0.25 ? 'rival' : 'stranger');

/**
 * Turn `turn` of a chat (0 = greeting, last = farewell), in this speaker's voice. `persona` is its
 * persona's own lines (personas.ts), mixed in so a Skeptic still sounds like a Skeptic.
 */
export function chatLine(t: Traits, rel: Relation, turn: number, last: boolean, r: Rng, persona: readonly string[]): string {
  let base: string;
  if (turn === 0) base = pick(r, GREET[rel]);
  else if (last) base = pick(r, FAREWELL);
  else {
    const roll = r();
    if (persona.length && roll < 0.4 + 0.2 * t.mischief) base = pick(r, persona);
    else if (roll < 0.75) base = pick(r, SMALL_TALK);
    else base = pick(r, REPLIES);
  }
  return styled(t, base, r);
}

/** How a chat went: friends grow closer, clashing tones and mischief can sour it. */
export function chatOutcome(a: Traits, b: Traits, r: Rng): number {
  const same = a.tone === b.tone ? 0.12 : 0;
  const spark = (a.sociability + b.sociability) / 2 - 0.4;
  const clash = (a.mischief * b.mischief) * (r() - 0.5);
  return 0.15 + same + spark * 0.2 + clash * 0.4;
}
