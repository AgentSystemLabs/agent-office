// Speech to text with the recognizer the browser comes with (the Web Speech API), for dictating a
// prompt (see dictate.ts). Chrome, Edge and Safari have one; Firefox doesn't. Nothing is installed
// and the office never gets the audio: the browser listens and hands back words. Chrome and Edge
// send what they hear to their maker's speech service, unless the on-device model for your language
// is already there, and then it's used instead.

// The parts of the Web Speech API used here (TypeScript's DOM types leave it out).
interface RecAlternative {
  transcript: string;
}
interface RecResult {
  isFinal: boolean;
  [i: number]: RecAlternative | undefined;
}
export interface RecResults {
  length: number;
  [i: number]: RecResult | undefined;
}
export interface Recognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  onresult: ((e: { results: RecResults }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type RecognizerCtor = (new () => Recognizer) & {
  /** Whether a language can be recognized, here on the device with `processLocally` (Chrome 139+). */
  available?(opts: { langs: string[]; processLocally: boolean }): Promise<string>;
};

/** The browser's recognizer, if it has one (Chrome and Safari still call it by its prefixed name). */
export function recognizer(): RecognizerCtor | undefined {
  const w = globalThis as { SpeechRecognition?: RecognizerCtor; webkitSpeechRecognition?: RecognizerCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/** Whether this browser can take dictation: `insecure` is a page over plain http, where no browser hands out the mic. */
export function speechSupport(): 'ok' | 'insecure' | 'none' {
  if (!recognizer()) return 'none';
  return globalThis.isSecureContext === false ? 'insecure' : 'ok';
}

/** The language to listen for: the browser's. */
export function speechLang(): string {
  return (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
}

/** Whether the on-device model for a language is installed, once the browser has said (it's asked once). */
const onDevice = new Map<string, boolean>();
/** Asks ahead of time, so starting to listen never waits on the answer. */
export function checkOnDevice(lang = speechLang(), Ctor = recognizer()) {
  if (onDevice.has(lang) || !Ctor?.available) return;
  onDevice.set(lang, false);
  Ctor.available({ langs: [lang], processLocally: true })
    .then((s) => onDevice.set(lang, s === 'available'))
    .catch(() => undefined);
}

/** What was said, as plain text on one line: nothing a terminal would take for a key. */
export function cleanSpoken(text: string): string {
  return text
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Puts what was said into a field's text in place of its selection, with a space on either side
 * where words would otherwise run together. Returns the new text and where the cursor goes.
 */
export function spliceSpoken(value: string, start: number, end: number, spoken: string): { value: string; caret: number } {
  const text = cleanSpoken(spoken);
  if (!text) return { value, caret: start };
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = before && !/[\s([{"'“‘/-]$/.test(before) && !/^[.,!?;:)\]}%]/.test(text) ? ' ' : '';
  const trail = after && !/^[\s.,!?;:)\]}]/.test(after) ? ' ' : '';
  const put = lead + text + trail;
  return { value: before + put + after, caret: before.length + put.length };
}

/**
 * Follows a recognizer's results as it listens. Each event lists everything heard so far: the
 * phrases it has settled on (final) and, after them, what it's still working out. `take` hands back
 * the phrases that settled since the last call, each once, and the words still up in the air.
 */
export class Transcript {
  /** How many results have been handed out as said. */
  private done = 0;

  take(results: RecResults): { said: string[]; interim: string } {
    const said: string[] = [];
    while (this.done < results.length && results[this.done]?.isFinal) {
      const text = cleanSpoken(results[this.done]?.[0]?.transcript ?? '');
      if (text) said.push(text);
      this.done++;
    }
    let interim = '';
    for (let i = this.done; i < results.length; i++) interim += results[i]?.[0]?.transcript ?? '';
    return { said, interim: cleanSpoken(interim) };
  }
}

/** Why listening stopped when it wasn't asked to, in words for a toast. Nothing when it was only cut off (by another window listening, say). */
export function speechProblem(code: string, lang: string): string | undefined {
  switch (code) {
    case 'aborted':
      return undefined;
    case 'not-allowed':
      return 'Dictation needs the microphone: allow it for this page in the address bar, then try again.';
    case 'audio-capture':
      return 'Dictation found no microphone to listen to.';
    case 'network':
    case 'service-not-allowed':
      return "This browser's speech service didn't answer, so there's nothing to take dictation. Chrome, Edge and Safari have one; Brave and some others come without it.";
    case 'language-not-supported':
      return `This browser can't take dictation in ${lang}.`;
    default:
      return `Dictation stopped: ${code}.`;
  }
}

export interface Listening {
  /** Stops listening and hands over what it has heard so far. */
  stop(): void;
  /** Stops listening and throws away what it hasn't handed over yet. */
  abort(): void;
}

export interface ListenHandlers {
  /** The words it's still working out, as they change. */
  interim(text: string): void;
  /** A phrase it has settled on. */
  said(text: string): void;
  /** It's over, with what went wrong if something did (see speechProblem). */
  end(problem?: string): void;
}

/** A browser's recognizer gives up after a while of silence: it's started again, until it has heard nothing for this long. */
export const QUIET_MS = 60_000;
/** A recognizer that ends this soon after starting isn't started again: it would only end again. */
const TOO_SOON_MS = 1000;

/**
 * Listens until told to stop, handing over each phrase as the recognizer settles on it. `end` is
 * called once, whoever ends it.
 */
export function listen(on: ListenHandlers, opts: { Ctor?: RecognizerCtor; lang?: string; now?: () => number; phone?: boolean } = {}): Listening {
  const Ctor = opts.Ctor ?? recognizer();
  const lang = opts.lang ?? speechLang();
  const now = opts.now ?? Date.now;
  if (!Ctor) {
    on.end('This browser has no speech recognition built in. Chrome, Edge and Safari do.');
    return { stop() {}, abort() {} };
  }
  const rec = new Ctor();
  rec.lang = lang;
  // Chrome on Android repeats itself when it listens on and on, and calls its guesses final: there
  // it's a phrase at a time, started again after each (see onend), and only what it settled on.
  const phone = opts.phone ?? (typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent));
  rec.continuous = !phone;
  rec.interimResults = !phone;
  if (onDevice.get(lang)) rec.processLocally = true;

  let transcript = new Transcript();
  let over = false;
  /** Asked to stop: what ends it now is the end. */
  let stopping = false;
  let problem: string | undefined;
  let startedAt = now();
  let heardAt = startedAt;
  /** The words it was still working out when last heard from. */
  let pending = '';
  const finish = () => {
    if (over) return;
    over = true;
    rec.onresult = rec.onerror = rec.onend = null;
    on.end(problem);
  };
  const begin = (): boolean => {
    try {
      rec.start();
      return true;
    } catch (err) {
      problem ??= `Dictation couldn't start: ${(err as Error).message}`;
      return false;
    }
  };

  rec.onresult = (e) => {
    if (over) return;
    heardAt = now();
    const { said, interim } = transcript.take(e.results);
    for (const text of said) on.said(text);
    pending = interim;
    on.interim(interim);
  };
  rec.onerror = (e) => {
    // A pause, which ends it: it's started again below while you still want it.
    if (e.error === 'no-speech') return;
    problem ??= speechProblem(e.error, lang);
    stopping = true;
  };
  rec.onend = () => {
    if (over) return;
    // Ended before it settled on its last words: they're what it heard, so they count.
    if (pending) on.said(pending);
    pending = '';
    on.interim('');
    const t = now();
    // It gave up on its own (a pause, or its service's time limit) while you still want it.
    if (!stopping && t - startedAt >= TOO_SOON_MS && t - heardAt < QUIET_MS) {
      startedAt = t;
      // Its results count from nothing again.
      transcript = new Transcript();
      if (begin()) return;
    }
    finish();
  };

  if (!begin()) finish();
  return {
    stop() {
      if (over || stopping) return;
      stopping = true;
      try {
        rec.stop();
      } catch {
        finish();
      }
    },
    abort() {
      if (over) return;
      stopping = true;
      // Nothing more is wanted from it, not even the phrase it was in the middle of.
      rec.onresult = null;
      try {
        rec.abort();
      } catch {
        // already stopped
      }
      finish();
    },
  };
}

/** A press this long is a hold: letting go ends it. A shorter one is a tap, which leaves it on until the next press. */
export const HOLD_MS = 350;

/**
 * Push to talk, for a button and a key alike: pressing starts listening, and letting go of a hold
 * stops it. A quick tap leaves it listening, hands free, until the next press.
 */
export class PushToTalk {
  private held = false;
  /** This press is the one that started it. */
  private mine = false;
  private downAt = 0;

  constructor(private io: { live(): boolean; start(): void; stop(): void; now?: () => number }) {}

  private now() {
    return (this.io.now ?? Date.now)();
  }

  get down() {
    return this.held;
  }

  press() {
    if (this.held) return;
    this.held = true;
    this.mine = !this.io.live();
    this.downAt = this.now();
    if (this.mine) this.io.start();
  }

  release() {
    if (!this.held) return;
    this.held = false;
    if (!this.mine || this.now() - this.downAt >= HOLD_MS) this.io.stop();
  }
}
