// The voice and the pictures a reel is made of. Free by default: Kokoro reads the narration on the
// office's own machine, and Pollinations draws the images. A paid service takes over by itself once
// its key is in the office's environment (ElevenLabs or OpenAI for the voice, fal or OpenAI for the
// images), and REELS_VOICE / REELS_IMAGES pick one outright. REELS_MEDIA=placeholder makes silence
// and plain colors, for trying the pipeline out. Keys never leave the office's environment.

import { execFile } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { binScript } from '../workers/process.js';
import { estimateTimings, wordsFromAlignment, type Word } from './captions.js';
import type { Scene, Series } from './types.js';

type Env = Record<string, string | undefined>;

export const VOICES = ['kokoro', 'elevenlabs', 'openai', 'placeholder'] as const;
export const IMAGES = ['pollinations', 'fal', 'openai', 'placeholder'] as const;

export interface MediaKeys {
  voice: (typeof VOICES)[number];
  images: (typeof IMAGES)[number];
}

/** Where Kokoro is set up: its Python environment and its model files (see docs/reels.md). */
export function kokoroSetup(env: Env = process.env) {
  const dir = env.REELS_KOKORO_DIR || path.join(os.homedir(), '.agent-office', 'kokoro');
  const python = env.REELS_KOKORO_PYTHON || path.join(dir, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const model = ['kokoro-v1.0.int8.onnx', 'kokoro-v1.0.onnx'].map((f) => path.join(dir, f)).find((f) => existsSync(f));
  const voices = path.join(dir, 'voices-v1.0.bin');
  return { dir, python, model, voices, ready: !!model && existsSync(voices) && existsSync(python) };
}

/**
 * Which services make the voice and the images. REELS_VOICE and REELS_IMAGES pick one; otherwise
 * a paid service whose key is set, else the free one (Kokoro once it's set up, Pollinations).
 */
export function mediaKeys(env: Env = process.env): MediaKeys {
  if (env.REELS_MEDIA === 'placeholder') return { voice: 'placeholder', images: 'placeholder' };
  const pick = <T extends string>(v: string | undefined, all: readonly T[]) => (all.includes(v as T) ? (v as T) : undefined);
  return {
    voice: pick(env.REELS_VOICE, VOICES) ?? (env.ELEVENLABS_API_KEY ? 'elevenlabs' : env.OPENAI_API_KEY ? 'openai' : kokoroSetup(env).ready ? 'kokoro' : 'placeholder'),
    images: pick(env.REELS_IMAGES, IMAGES) ?? (env.FAL_KEY ? 'fal' : env.OPENAI_API_KEY ? 'openai' : 'pollinations'),
  };
}

/** The narration as one text, as it's read out: the scenes' narrations, a space between each. */
export const narrationText = (scenes: Scene[]) => scenes.map((s) => s.narration).join(' ');

/** About how long a narration takes to read, for the placeholder voice: 2.6 words a second. */
export const readingTime = (scenes: Scene[]) => Math.max(3, narrationText(scenes).split(/\s+/).length / 2.6);

/** What a service said when it turned a request down, in a line. */
async function failed(what: string, res: Response): Promise<Error> {
  const body = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
  return new Error(`${what} failed (${res.status})${body ? `: ${body}` : ''}`);
}

export interface Voice {
  /** The audio's file name in the work folder, or undefined for the placeholder (silence is made by ffmpeg). */
  file?: string;
  /** When each word is said, if the service said; else estimated once the length is known. */
  words?: Word[];
  /** Seconds, if known without probing the file. */
  duration?: number;
}

/** Kokoro's voice for a series: its own voice when it names a Kokoro one (am_michael, af_heart…). */
const kokoroVoice = (series: Series, env: Env) => (/^[a-z][fm]_[a-z]+$/.test(series.voice) ? series.voice : env.REELS_KOKORO_VOICE || 'am_michael');

/** Reads the narration with Kokoro, on this machine; it takes a few minutes for a minute of speech on a CPU. */
function kokoro(text: string, series: Series, out: string, env: Env): Promise<number> {
  const k = kokoroSetup(env);
  const script = binScript('reels-kokoro.py');
  if (!k.ready || !script) return Promise.reject(new Error(`Kokoro isn't set up in ${k.dir} (see docs/reels.md)`));
  return new Promise((resolve, reject) => {
    const child = execFile(k.python, ['-I', script], { timeout: 30 * 60_000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`Kokoro failed: ${(stderr || err.message).trim().split('\n').slice(-3).join(' ')}`));
      try {
        resolve((JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as { seconds: number }).seconds);
      } catch {
        reject(new Error(`Kokoro said something unexpected: ${stdout.slice(0, 200)}`));
      }
    });
    child.stdin?.end(JSON.stringify({ text, voice: kokoroVoice(series, env), speed: Number(env.REELS_KOKORO_SPEED) || 1, out, model: k.model, voices: k.voices }));
  });
}

/**
 * Reads the narration out into the work folder `dir`. ElevenLabs says when each character is said,
 * so the captions follow the voice exactly; the others' are estimated from the audio's length.
 */
export async function speak(scenes: Scene[], series: Series, dir: string, keys: MediaKeys, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<Voice> {
  const text = narrationText(scenes);
  if (keys.voice === 'placeholder') {
    const duration = readingTime(scenes);
    return { duration, words: estimateTimings(scenes, duration) };
  }
  if (keys.voice === 'kokoro') {
    const duration = (await kokoro(text, series, path.join(dir, 'voice.wav'), env)) + 0.2;
    return { file: 'voice.wav', duration };
  }
  const file = 'voice.mp3';
  if (keys.voice === 'elevenlabs') {
    // An OpenAI or Kokoro voice name means nobody picked an ElevenLabs one: use the office's default.
    const voice = /^[A-Za-z0-9]{20}$/.test(series.voice) ? series.voice : env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB';
    const res = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': env.ELEVENLABS_API_KEY ?? '', 'content-type': 'application/json' },
      body: JSON.stringify({ text, model_id: env.ELEVENLABS_MODEL || 'eleven_multilingual_v2' }),
    });
    if (!res.ok) throw await failed('ElevenLabs', res);
    const out = (await res.json()) as { audio_base64: string; alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] } };
    writeFileSync(path.join(dir, file), Buffer.from(out.audio_base64, 'base64'));
    const a = out.alignment;
    if (!a?.characters?.length) return { file };
    const words = wordsFromAlignment(scenes, a.characters, a.character_start_times_seconds, a.character_end_times_seconds);
    return { file, words, duration: (a.character_end_times_seconds.at(-1) ?? 0) + 0.4 };
  }
  const res = await fetchImpl('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: env.REELS_TTS_MODEL || 'gpt-4o-mini-tts',
      voice: /^[a-z]+$/.test(series.voice) ? series.voice : 'onyx',
      input: text,
      response_format: 'mp3',
      ...(series.tone ? { instructions: series.tone } : {}),
    }),
  });
  if (!res.ok) throw await failed('OpenAI speech', res);
  writeFileSync(path.join(dir, file), Buffer.from(await res.arrayBuffer()));
  return { file };
}

/** The full image prompt for a scene: what's in it, the series' look, and what to leave out. */
export function imagePrompt(scene: Scene, series: Series): string {
  return `${scene.visual}. Style: ${series.style}. Vertical 9:16 frame, no text, no letters, no watermark, no logos.`;
}

/** An image's file extension, from its first bytes (ffmpeg goes by the name to read a still). */
export function imageExt(b: Buffer): 'jpg' | 'png' | 'webp' {
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (b[0] === 0x89 && b[1] === 0x50) return 'png';
  if (b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  throw new Error("The image service sent something that isn't an image");
}

/** Writes an image as `base` plus the extension its bytes say; returns the file's name. */
function keep(bytes: Buffer, base: string): string {
  const file = `${base}.${imageExt(bytes)}`;
  writeFileSync(file, bytes);
  return path.basename(file);
}

/** How many images a service is asked for at once: Pollinations' free tier takes one at a time. */
export const imageBatch = (keys: MediaKeys) => (keys.images === 'pollinations' ? 1 : 3);

/** Pollinations' free tier draws one image every 45 seconds for each address; a token lifts that. */
export const POLLINATIONS_GAP_MS = 46_000;
let lastPollinations = 0;

/** How long Pollinations asked to be left alone for, from its refusal ("Retry after 40s"), in ms. */
export const retryAfter = (body: string, fallback: number) => {
  const s = /retry after (\d+)\s*s/i.exec(body)?.[1];
  return s ? (Number(s) + 2) * 1000 : fallback;
};

/** One image from Pollinations: on the free tier, spaced out as it asks, and tried again when it says it's too soon. */
async function pollinations(prompt: string, env: Env, fetchImpl: typeof fetch, wait = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<Buffer> {
  const q = new URLSearchParams({ width: '1080', height: '1920', model: env.REELS_POLLINATIONS_MODEL || 'flux', seed: String(Math.floor(Math.random() * 1e9)), nologo: 'true', private: 'true' });
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${q}`;
  const token = env.POLLINATIONS_TOKEN;
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  for (let attempt = 0; ; attempt++) {
    if (!token) await wait(Math.max(0, lastPollinations + POLLINATIONS_GAP_MS - Date.now()));
    lastPollinations = Date.now();
    const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(180_000) });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    // 402 is its free tier's limit, 429 too many at once.
    const busy = res.status === 402 || res.status === 429 || res.status >= 500;
    const body = await res.text().catch(() => '');
    if (attempt >= 4 || !busy) throw new Error(`Pollinations failed (${res.status}): ${body.replace(/\s+/g, ' ').slice(0, 300)}`);
    await wait(retryAfter(body, POLLINATIONS_GAP_MS));
  }
}

/** Makes one scene's image as `base` plus its extension; returns its file name, or undefined for a placeholder color. */
export async function picture(prompt: string, base: string, keys: MediaKeys, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<string | undefined> {
  if (keys.images === 'placeholder') return undefined;
  if (keys.images === 'pollinations') return keep(await pollinations(prompt, env, fetchImpl), base);
  if (keys.images === 'fal') {
    const res = await fetchImpl(`https://fal.run/${env.REELS_FAL_MODEL || 'fal-ai/flux/schnell'}`, {
      method: 'POST',
      headers: { authorization: `Key ${env.FAL_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, image_size: 'portrait_16_9', num_images: 1, enable_safety_checker: true }),
    });
    if (!res.ok) throw await failed('fal', res);
    const out = (await res.json()) as { images?: { url: string }[] };
    const url = out.images?.[0]?.url;
    if (!url) throw new Error('fal sent no image');
    const img = await fetchImpl(url);
    if (!img.ok) throw await failed('Downloading the image', img);
    return keep(Buffer.from(await img.arrayBuffer()), base);
  }
  const res = await fetchImpl('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.REELS_IMAGE_MODEL || 'gpt-image-1', prompt, size: '1024x1536', quality: env.REELS_IMAGE_QUALITY || 'low', n: 1 }),
  });
  if (!res.ok) throw await failed('OpenAI images', res);
  const out = (await res.json()) as { data?: { b64_json?: string }[] };
  const b64 = out.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI sent no image');
  return keep(Buffer.from(b64, 'base64'), base);
}

/** A placeholder scene's color: dark, and different for each scene. */
export function placeholderColor(i: number): string {
  const palette = ['1b2a49', '3a1c4a', '1f3d36', '4a2a1c', '2b2b40', '402020', '203a4a'];
  return `0x${palette[i % palette.length]}`;
}
