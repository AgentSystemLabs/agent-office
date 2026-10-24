// When each word of the narration is said, how long each scene's image stays up, and the burned-in
// captions (an ASS subtitle file) that follow the voice a few words at a time. Pure: no files.

import type { Scene } from './types.js';

/** A word of the narration, when it's said (seconds), and which scene it's in. */
export interface Word {
  text: string;
  start: number;
  end: number;
  scene: number;
}

/** The narration's words in order, each with the scene it belongs to. */
export function sceneWords(scenes: Scene[]): { text: string; scene: number }[] {
  return scenes.flatMap((s, scene) => s.narration.split(/\s+/).filter(Boolean).map((text) => ({ text, scene })));
}

/**
 * When each word is said, when the voice gave no timings of its own: the `duration` shared out by
 * the length of each word, with a little more after a comma and more after a full stop.
 */
export function estimateTimings(scenes: Scene[], duration: number): Word[] {
  const words = sceneWords(scenes);
  const weight = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, '').length + 2 + (/[.!?]$/.test(w) ? 4 : /[,;:—-]$/.test(w) ? 2 : 0);
  const total = words.reduce((n, w) => n + weight(w.text), 0) || 1;
  let t = 0;
  return words.map((w) => {
    const len = (weight(w.text) / total) * duration;
    const word = { ...w, start: t, end: t + len };
    t += len;
    return word;
  });
}

/**
 * The words from character timings (ElevenLabs' alignment: a start and an end for every character
 * of the text it read), matched back to the scenes' words. The text read is the narrations joined
 * by single spaces, which is what produce() sends.
 */
export function wordsFromAlignment(scenes: Scene[], chars: string[], starts: number[], ends: number[]): Word[] {
  const words = sceneWords(scenes);
  const out: Word[] = [];
  let c = 0;
  for (const w of words) {
    while (c < chars.length && /\s/.test(chars[c])) c++;
    const first = c;
    c = Math.min(chars.length, c + w.text.length);
    const last = Math.max(first, c - 1);
    out.push({ ...w, start: starts[first] ?? out.at(-1)?.end ?? 0, end: ends[last] ?? starts[first] ?? 0 });
  }
  return out;
}

/**
 * How long each scene's image is on screen: from its first word to the next scene's first word, the
 * first from 0 and the last to the end of the audio, so the images cover it with no gap.
 */
export function sceneDurations(words: Word[], sceneCount: number, total: number): number[] {
  const startOf = (i: number) => (i === 0 ? 0 : words.find((w) => w.scene === i)?.start);
  const starts: number[] = [];
  for (let i = 0; i < sceneCount; i++) starts.push(startOf(i) ?? starts.at(-1) ?? 0);
  return starts.map((s, i) => Math.max(0.5, (i + 1 < sceneCount ? starts[i + 1] : total) - s));
}

/** Words shown together on screen, a line at a time. */
export function captionChunks(words: Word[], perChunk = 3): Word[] {
  const out: Word[] = [];
  let group: Word[] = [];
  const flush = () => {
    if (!group.length) return;
    out.push({ text: group.map((w) => w.text).join(' '), start: group[0].start, end: group.at(-1)!.end, scene: group[0].scene });
    group = [];
  };
  for (const w of words) {
    group.push(w);
    // A sentence ends its line, so a line never runs across two.
    if (group.length >= perChunk || /[.!?,;:]$/.test(w.text)) flush();
  }
  flush();
  // Each line stays up until the next one comes.
  for (let i = 0; i + 1 < out.length; i++) out[i].end = out[i + 1].start;
  return out;
}

/** h:mm:ss.cc, as ASS writes a time. */
export function assTime(s: number): string {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

/** Text safe inside an ASS dialogue line: no override blocks, no line breaks. */
const assText = (s: string) => s.replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();

/**
 * The captions as an ASS file for a 1080×1920 video: big, bold, white with a thick black outline,
 * a little below the middle where the platforms' buttons don't cover them.
 */
export function assCaptions(words: Word[], font = 'Arial'): string {
  const lines = captionChunks(words).map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Caption,,0,0,0,,${assText(c.text)}`);
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    'WrapStyle: 0',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Caption,${font},92,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,7,3,2,80,80,700,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...lines,
    '',
  ].join('\n');
}
