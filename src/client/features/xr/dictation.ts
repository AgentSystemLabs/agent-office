/**
 * Push-to-talk dictation in VR: hold A (or tap the keyboard / palette mic) and talk; what you said
 * is typed into the focused field, the open window's first text box, or the terminal panel. Uses the
 * browser's speech recognizer when it has one (see ui/speech.ts); otherwise records the mic and
 * posts it to /api/transcribe (OpenAI Whisper on the office server).
 */
import { notifyDictating } from '../../ui/dictate';
import { toast } from '../../ui/dom';
import { PushToTalk, listen, speechSupport, spliceSpoken, type Listening } from '../../ui/speech';
import type { KeyboardTarget } from './keyboard';
import { isTypable } from './keyboard';

export type DictateSink =
  | { kind: 'field'; el: HTMLInputElement | HTMLTextAreaElement }
  | { kind: 'term'; send: (data: string) => void };

export interface XrDictation {
  /** Hold to talk (controller A). */
  press(): void;
  release(): void;
  /** Tap to toggle (keyboard / palette mic). */
  toggle(): void;
  /** Whether it's listening right now. */
  live(): boolean;
  /** Caption of interim words, for the keyboard strip. */
  onCaption: ((text: string) => void) | null;
}

/** Builds the VR dictation controller. `sink` is asked each time listening starts. */
export function makeXrDictation(opts: { sink: () => DictateSink | null; setCaption: (text: string) => void }): XrDictation {
  let listening: Listening | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let stream: MediaStream | null = null;

  const setCaption = (text: string) => {
    opts.setCaption(text);
    api.onCaption?.(text);
  };

  const insert = (text: string) => {
    const sink = opts.sink();
    if (!sink || !text) return;
    if (sink.kind === 'term') {
      sink.send(text);
      return;
    }
    const el = sink.el;
    const start = el.selectionStart ?? el.value.length;
    const r = spliceSpoken(el.value, start, el.selectionEnd ?? start, text);
    el.value = r.value;
    el.setSelectionRange(r.caret, r.caret);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const finish = () => {
    listening = null;
    recorder = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    chunks = [];
    setCaption('');
    notifyDictating(false);
  };

  const startBrowser = () => {
    if (listening) return;
    let over = false;
    const mine = listen({
      interim: (text) => setCaption(text),
      said: (text) => insert(text),
      end: (problem) => {
        over = true;
        if (listening === mine) finish();
        if (problem) toast(problem, 'warn');
      },
    });
    if (over) return;
    listening = mine;
    setCaption('');
    notifyDictating(true);
  };

  const startWhisper = async () => {
    if (recorder) return;
    if (!window.isSecureContext) {
      toast('Dictation needs HTTPS (or localhost).', 'warn');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast('Dictation needs the microphone: allow it for this page, then try again.', 'warn');
      return;
    }
    chunks = [];
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    const rec = new MediaRecorder(stream, { mimeType: mime });
    recorder = rec;
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: mime });
      finish();
      if (blob.size < 256) return;
      void transcribe(blob).then((text) => {
        if (text) insert(text);
      });
    };
    rec.start();
    setCaption('Listening…');
    notifyDictating(true);
  };

  const start = () => {
    if (listening || recorder) return;
    if (!opts.sink()) {
      toast('Point at a text field, open a window, or open a terminal to dictate into', 'warn');
      return;
    }
    if (speechSupport() === 'ok') startBrowser();
    else if (speechSupport() === 'insecure') toast('Dictation needs HTTPS (or localhost).', 'warn');
    else void startWhisper();
  };

  const stop = () => {
    if (listening) listening.stop();
    else if (recorder && recorder.state !== 'inactive') recorder.stop();
  };

  const talk = new PushToTalk({ live: () => !!listening || !!recorder, start, stop });

  const api: XrDictation = {
    onCaption: null,
    press: () => talk.press(),
    release: () => talk.release(),
    toggle() {
      if (listening || recorder) stop();
      else start();
    },
    live: () => !!listening || !!recorder,
  };
  return api;
}

async function transcribe(blob: Blob): Promise<string | null> {
  try {
    const r = await fetch('/api/transcribe', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': blob.type || 'audio/webm' },
      body: blob,
    });
    const body = (await r.json().catch(() => ({}))) as { text?: string; error?: string };
    if (r.status === 501) {
      toast(body.error ?? 'Dictation on this browser needs OPENAI_API_KEY on the office server.', 'warn');
      return null;
    }
    if (!r.ok) {
      toast(body.error ?? 'Dictation failed.', 'warn');
      return null;
    }
    return body.text?.trim() || null;
  } catch {
    toast('Dictation couldn’t reach the office server.', 'warn');
    return null;
  }
}

/** Where dictation should go: focused field, keyboard target, first field in a modal, or terminal. */
export function resolveSink(opts: {
  keyboard: KeyboardTarget;
  termSend: ((data: string) => void) | null;
  modalEl?: HTMLElement | null;
}): DictateSink | null {
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  if (isTypable(active)) return { kind: 'field', el: active };
  if (opts.keyboard?.kind === 'field') return { kind: 'field', el: opts.keyboard.el };
  if (opts.keyboard?.kind === 'term') return { kind: 'term', send: opts.keyboard.send };
  const field = opts.modalEl?.querySelector('input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]):not([disabled]), textarea:not([disabled])') ?? null;
  if (isTypable(field)) return { kind: 'field', el: field };
  if (opts.termSend) return { kind: 'term', send: opts.termSend };
  return null;
}
