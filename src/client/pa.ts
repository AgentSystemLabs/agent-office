/**
 * The office PA: the voice that reads an announcement out over the room, the way the gong is the
 * room's news. Nothing is recorded and nothing is fetched — the words are turned into a run of speech
 * sounds and played out of the same Web Audio everything else in the office uses, so an announcement
 * reaches the whole floor, at your own volume, out of the `alerts` bus (see OfficeSound.announce).
 *
 * A voice is a buzz of glottal pulses through three formants — three resonant bands that say which
 * vowel it is — with a breath of noise for the hisses, a burst for each stop, and a hum for the nose
 * and the liquids. `phones()` walks the words and picks those sounds out of the spelling, which is
 * all a rule of thumb can do with English: some words come out shortened, some stretched. It is read
 * out slowly, with a pause between the sentences, and the same words go up on the board over the ring
 * (see client/world/chairs.ts) for anyone who'd rather read them.
 */

import { biquad, buffers, mtof } from './music';

/** One speech sound: what the voice does for it, and for how long (in seconds). */
interface Phone {
  /** The three formants in Hz — 0 for a sound with no voice in it. */
  f: [number, number, number];
  /** The formants it slides to, for a vowel that moves (the "oo" in "you"); the same as `f` if it doesn't. */
  to?: [number, number, number];
  /** How long it runs. */
  len: number;
  /** How much of the buzz comes through, 0–1: nothing for a hiss, less for a hum. */
  voice: number;
  /** How much breath comes through, 0–1: the sibilants, and the puff in front of a stop. */
  breath: number;
  /** A stop: how bright the burst is when the mouth opens again, 0 for everything else. */
  burst: number;
  /** How much the buzz is damped, 0–1: the nose and the liquids, which take the ring off a vowel. */
  damp: number;
}

/** A vowel: three formants, and how long it takes to say. */
const vowel = (f: [number, number, number], len = 0.115, to?: [number, number, number]): Phone => ({ f, to, len, voice: 1, breath: 0, burst: 0, damp: 0 });
/** A hum through the nose or round the tongue: a voice, but a muffled one. */
const liquid = (f: [number, number, number], len = 0.06): Phone => ({ f, len, voice: 0.7, breath: 0, burst: 0, damp: 0.7 });
/** A hiss: no voice at all, just breath through a narrow band. */
const fricative = (f: number, len = 0.085, voice = 0): Phone => ({ f: [f, f * 1.4, 0], len, voice, breath: 1, burst: 0, damp: 0 });
/** A stop: shut, then a puff as the mouth opens. */
const stop = (f: number, len = 0.075, voice = 0): Phone => ({ f: [f, f * 1.3, 0], len, voice, breath: 0.15, burst: 1, damp: 0 });
/** A gap in the talking: between words, or the beat between the sentences. */
const pause = (len = 0.075): Phone => ({ f: [0, 0, 0], len, voice: 0, breath: 0, burst: 0, damp: 0 });

/** The vowels, in the order a letter can ask for them. F1, F2, F3 are the classic Peterson–Barney values. */
const VOWELS = {
  iy: vowel([280, 2250, 2890], 0.12),
  ih: vowel([400, 1920, 2560], 0.085),
  eh: vowel([550, 1770, 2490], 0.095),
  ae: vowel([690, 1660, 2490], 0.12),
  aa: vowel([710, 1100, 2540], 0.125),
  ah: vowel([620, 1220, 2550], 0.085),
  ao: vowel([590, 900, 2540], 0.12),
  /** "oo" as in "boot": the lips round and the tongue goes back and up. */
  uw: vowel([330, 900, 2200], 0.12),
  /** "oo" as in "you": starts at "ee" and slides to that. */
  ow: vowel([490, 1000, 2400], 0.16, [330, 900, 2200]),
  er: vowel([490, 1350, 1690], 0.13),
  /** The diphthongs: a vowel that turns into another one. */
  ay: vowel([700, 1600, 2400], 0.17, [330, 2200, 2800]),
  aw: vowel([700, 1200, 2400], 0.17, [330, 800, 2200]),
  oy: vowel([570, 850, 2400], 0.17, [330, 2200, 2800]),
} as const satisfies Record<string, Phone>;

type VowelName = keyof typeof VOWELS;

/** The consonants: what each spelling asks the mouth to do. */
const SOUNDS: Record<string, Phone> = {
  s: fricative(5200, 0.085),
  z: fricative(4600, 0.075, 0.25),
  sh: fricative(2500, 0.1),
  f: fricative(1700, 0.07),
  v: fricative(1500, 0.06, 0.25),
  th: fricative(3600, 0.06),
  h: { ...fricative(1200, 0.05), breath: 0.5 },
  ch: stop(2600, 0.09),
  j: stop(2000, 0.08, 0.25),
  p: stop(900, 0.07),
  b: stop(700, 0.06, 0.25),
  t: stop(3600, 0.07),
  d: stop(2800, 0.06, 0.25),
  k: stop(2200, 0.075),
  g: stop(1700, 0.065, 0.25),
  m: liquid([280, 1100, 2200], 0.075),
  n: liquid([280, 1600, 2600], 0.065),
  ng: { ...liquid([280, 1400, 2200], 0.075), burst: 0.5 },
  l: liquid([380, 1100, 2800], 0.06),
  r: liquid([350, 1000, 1600], 0.06),
  w: { ...liquid([320, 800, 2200], 0.055), damp: 0.4 },
  y: { ...liquid([300, 2200, 2900], 0.05), damp: 0.4 },
};

/** Two letters that make one sound. The long way round first, so "sh" beats "s". */
const PAIRS: Record<string, VowelName | keyof typeof SOUNDS> = {
  sh: 'sh',
  ch: 'ch',
  th: 'th',
  ph: 'f',
  wh: 'w',
  ck: 'k',
  ng: 'ng',
  qu: 'k',
  oo: 'uw',
  ee: 'iy',
  ea: 'iy',
  ie: 'iy',
  ai: 'ay',
  ay: 'ay',
  oa: 'ow',
  ow: 'ow',
  ou: 'aw',
  oi: 'oy',
  oy: 'oy',
  au: 'ao',
  aw: 'ao',
  ar: 'aa',
  or: 'ao',
  er: 'er',
  ir: 'er',
  ur: 'er',
};

/** A single letter, when it isn't part of a pair. The silent ones get a stop that only closes. */
const SOLO: Record<string, VowelName | keyof typeof SOUNDS> = {
  a: 'ae',
  e: 'eh',
  i: 'ih',
  o: 'aa',
  u: 'ah',
  y: 'iy',
  c: 'k',
  q: 'k',
  x: 'k',
};

/** A final "e" after a vowel and a consonant stretches that vowel: "make" against "mack". */
const LONG: Record<string, VowelName> = { a: 'ay', e: 'iy', i: 'ay', o: 'ow', u: 'uw' };

/** Words read as they sound, where the spelling on its own would get them wrong. `@` is the "uh" of an "a". */
const WORDS: Record<string, string> = {
  the: 'dh@', a: '@', to: 'tu', of: 'ahv', one: 'wahn', said: 'sehd', says: 'sehz', are: 'ahr', were: 'wur', you: 'yu', your: 'yor', our: 'owr', eye: 'ai',
  attention: 'aten shun', everyone: 'evriwun', musical: 'myu zik al', chairs: 'chairz', game: 'gaym', is: 'iz', starting: 'star ting', please: 'pleez', gather: 'gadh er',
  living: 'liv ing', room: 'ruwm', ready: 'red ee', play: 'play', music: 'myu zik', on: 'awn', dance: 'dans', while: 'wail', can: 'kan', off: 'awf', grab: 'grab',
  no: 'noh', for: 'fur', this: 'dh is', time: 'taim', back: 'bak', then: 'dhen', wins: 'winz', out: 'owt', there: 'dher', has: 'haz', last: 'last', left: 'left',
  standing: 'stan ding', gathered: 'gadh erd', round: 'row nd', wait: 'wayt', who: 'hu', gets: 'getz', every: 'ev ri', bot: 'bot', beats: 'beets', shoes: 'shuwz',
  will: 'wil', tonight: 'tu nait', build: 'bild', next: 'nekst',
};

/** Numbers, said the way a PA says them. */
const FIGURES: Record<string, string> = { '0': 'zair oh', '1': 'wun', '2': 'too', '3': 'tree', '4': 'for', '5': 'fyv', '6': 'siks', '7': 'sevn', '8': 'ayt', '9': 'nyn' };

/** What one written letter or pair of them comes to, or undefined if it isn't one we know. */
function soundOf(spelled: string): Phone | undefined {
  if (spelled === 'dh') return SOUNDS.th;
  const name = PAIRS[spelled] ?? SOLO[spelled] ?? (SOUNDS[spelled] ? spelled : undefined);
  return name ? VOWELS[name as VowelName] ?? SOUNDS[name as keyof typeof SOUNDS] : undefined;
}

/** What one word comes to: its sounds, in order, with the long vowels where they belong. */
function word(text: string): Phone[] {
  const letters = (WORDS[text] ?? text).toLowerCase().replace(/[^a-z@]/g, '');
  // A vowel, a consonant and a final "e" makes that vowel long: "make", not "mack".
  const magic = /([aeiouy])[^aeiouy]e$/.exec(letters);
  const long = magic ? magic.index : -1;
  const out: Phone[] = [];
  let i = 0;
  while (i < letters.length) {
    if (letters[i] === '@') {
      out.push({ ...VOWELS.ah, len: 0.05 });
      i++;
      continue;
    }
    if (letters.slice(i, i + 2) === 'qu') {
      out.push(SOUNDS.k, SOUNDS.w);
      i += 2;
      continue;
    }
    const spelled = PAIRS[letters.slice(i, i + 2)] ? letters.slice(i, i + 2) : letters[i];
    const p = soundOf(spelled);
    if (!p) {
      i++;
      continue;
    }
    // The "e" that stretched the vowel isn't said itself.
    if (i === letters.length - 1 && letters[i] === 'e' && long >= 0) break;
    out.push(i === long && LONG[letters[i]] ? { ...VOWELS[LONG[letters[i]] as VowelName], len: p.len * 1.4 } : { ...p });
    i += spelled.length;
  }
  if (!out.length) out.push({ ...VOWELS.ah });
  return out;
}

/** How fast the PA talks: quicker than the phones are written out, so a whole announcement fits in a gathering. */
const RATE = 1.75;

/**
 * What an announcement comes to as speech sounds: the words, with a breath between them and a longer
 * one at the end of a sentence. Nobody to hear it needs the punctuation read out — a "!" and a "?" are
 * the same sounds at a different pitch.
 */
export function phones(text: string): Phone[] {
  const out: Phone[] = [];
  for (const [n, sentence] of text.split(/(?<=[.!?])\s+/).entries()) {
    for (const [m, w] of sentence.split(/\s+/).entries()) {
      if (!w) continue;
      if (n || m) out.push(pause(n ? 0.3 : 0.07));
      for (const ch of w) {
        const figure = FIGURES[ch];
        if (figure) out.push(...word(figure));
      }
      if (!/[0-9]/.test(w)) out.push(...word(w.toLowerCase()));
    }
  }
  return out.map((p) => ({ ...p, len: p.len / RATE }));
}

/** How long `text` takes to say, in seconds (see speak). */
export function speechTime(text: string): number {
  return phones(text).reduce((n, p) => n + p.len, 0);
}

/** The PA's two-note chime, before it starts talking. */
export function chime(ctx: BaseAudioContext, out: AudioNode, when: number) {
  for (const [i, f] of [880, 1174].entries()) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = ctx.createGain();
    const w = when + i * 0.16;
    g.gain.setValueAtTime(0.0001, w);
    g.gain.exponentialRampToValueAtTime(0.16, w + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, w + 0.3);
    o.connect(g).connect(out);
    o.start(w);
    o.stop(w + 0.35);
  }
}

/**
 * Says `text` into `out` starting at `when` (on the audio clock), and says how many seconds it took,
 * which is the time the office leaves before anything else happens. `level` is how hard to say it.
 */
export function speak(ctx: BaseAudioContext, out: AudioNode, text: string, when: number, level = 1): number {
  const ps = phones(text);
  if (!ps.length) return 0;
  // The buzz: one glottal pulse train for the whole line, the pitch of a voice talking in a big room.
  const buzz = ctx.createOscillator();
  buzz.type = 'sawtooth';
  const breath = ctx.createBufferSource();
  breath.buffer = buffers(ctx).noise;
  breath.loop = true;
  // The formants: three resonant bands in parallel off the buzz, which is most of what a vowel is,
  // and a little of the buzz itself for the chest of it.
  const buzzGain = ctx.createGain();
  const breathGain = ctx.createGain();
  buzzGain.gain.value = 0;
  breathGain.gain.value = 0;
  const mix = ctx.createGain();
  const Q = [6, 7, 8];
  const formants = [1, 0.55, 0.3].map((g, i) => {
    const f = biquad(ctx, 'bandpass', [500, 1500, 2500][i], Q[i]);
    const gain = ctx.createGain();
    gain.gain.value = g;
    buzz.connect(f).connect(gain).connect(mix);
    return f;
  });
  const body = biquad(ctx, 'lowpass', 700, 0.7);
  const bodyGain = ctx.createGain();
  bodyGain.gain.value = 0.35;
  buzz.connect(body).connect(bodyGain).connect(mix);
  // A touch of a lipspeaker on it: a little grit, a band from 300 to 3.4k, and the room it fills.
  const grit = ctx.createWaveShaper();
  grit.curve = gritCurve(1.6);
  const band = biquad(ctx, 'bandpass', 1600, 0.6);
  const level0 = ctx.createGain();
  level0.gain.value = level;
  mix.connect(buzzGain).connect(grit);
  breath.connect(breathGain).connect(grit);
  grit.connect(band).connect(level0).connect(out);

  // The pitch: it starts up and settles as the line goes on, the way someone reading out does.
  let at = when;
  const total = ps.reduce((n, p) => n + p.len, 0);
  ps.forEach((p, i) => {
    const said = (at - when) / Math.max(0.001, total);
    // High and bright at the start, settling a tone or two below by the end of the line.
    buzz.frequency.setTargetAtTime(mtof(58 - Math.min(9, said * 11) + (i < 3 ? 2 : 0)), at, 0.05);
    // The vowel of each sound slides into the next one, so the voice never jumps.
    const next = ps[Math.min(ps.length - 1, i + 1)];
    for (const [k, f] of formants.entries()) {
      const target = p.to?.[k] ?? p.f[k];
      f.frequency.setTargetAtTime(target || 0.001, at, p.len * 0.35);
      if (p.to && next.f[k]) f.frequency.setTargetAtTime(next.f[k], at + p.len * 0.6, p.len * 0.3);
    }
    const open = Math.min(0.035, p.len * 0.3);
    const end = at + p.len;
    // A stop is shut until the burst, and the burst is a flick of breath at the end of it.
    const closed = p.burst > 0 ? end - 0.014 : end;
    buzzGain.gain.setValueAtTime(0.0001, at);
    if (p.voice) {
      buzzGain.gain.setTargetAtTime(0.55 * p.voice, at, open);
      buzzGain.gain.setTargetAtTime(0.0001, Math.max(at + open, closed), 0.02);
    } else buzzGain.gain.setTargetAtTime(0.0001, at, 0.01);
    breathGain.gain.setValueAtTime(0.0001, at);
    if (p.breath) {
      breathGain.gain.setTargetAtTime(0.5 * p.breath, at, open);
      breathGain.gain.setTargetAtTime(0.0001, closed, 0.02);
    } else breathGain.gain.setTargetAtTime(0.0001, at, 0.01);
    if (p.burst) breathGain.gain.setTargetAtTime(0.35 * p.burst, closed, 0.004);
    // A hum is a vowel with the ring taken off it.
    for (const [k, f] of formants.entries()) f.Q.setTargetAtTime(Q[k] / (p.damp ? 1.9 : 1), at, 0.02);
    at = end;
  });

  buzz.start(when);
  buzz.stop(at + 0.2);
  breath.start(when);
  breath.stop(at + 0.2);
  // A click as the PA comes on, so the first word isn't just there.
  const click = ctx.createBufferSource();
  click.buffer = buffers(ctx).noise;
  const clickGain = ctx.createGain();
  clickGain.gain.setValueAtTime(0.14 * level, when);
  clickGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.03);
  click.connect(biquad(ctx, 'highpass', 2000, 0.7)).connect(clickGain).connect(out);
  click.start(when);
  click.stop(when + 0.04);
  return at - when;
}

/** A soft curve that rounds the buzz off, for a PA that's a bit worn in. */
function gritCurve(k: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}
