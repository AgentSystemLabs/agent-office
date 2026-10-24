// Making a scripted reel into a video: the voice, an image a scene, the captions timed to the voice,
// then ffmpeg. Each reel is made in a work folder of its own, kept until it's posted so a reel
// can be rendered again (with new music, say) without paying for its voice and images twice.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assCaptions, estimateTimings, sceneDurations } from './captions.js';
import { imageBatch, imagePrompt, mediaKeys, picture, placeholderColor, speak, type MediaKeys } from './media.js';
import { probeDuration, render, type Shot } from './render.js';
import type { ReelsStore } from './store.js';
import type { Reel, Series } from './types.js';

/** A breath of quiet after the last word, before the reel loops. */
const TAIL = 0.6;
export interface ProduceOptions {
  keys?: MediaKeys;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
}

/** Makes `reel` into a video under the studio's out folder; resolves to its file and length. */
export async function produce(reel: Reel, series: Series, store: ReelsStore, opts: ProduceOptions = {}): Promise<{ video: string; duration: number }> {
  const scenes = reel.scenes;
  if (!scenes?.length) throw new Error('It has no script yet');
  const keys = opts.keys ?? mediaKeys(opts.env);
  const env = opts.env ?? process.env;
  const fetchImpl = opts.fetch ?? fetch;
  const work = path.join(store.folder('work'), reel.id);
  // A script that changed since the last time means new voice and images: what's there is stale.
  const stamp = JSON.stringify({ scenes, style: series.style, voice: series.voice, tone: series.tone, keys });
  const stampFile = path.join(work, 'script.json');
  const fresh = existsSync(stampFile) && readFileSync(stampFile, 'utf8') === stamp;
  if (!fresh) rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  writeFileSync(stampFile, stamp);

  const timingsFile = path.join(work, 'words.json');
  let words: ReturnType<typeof estimateTimings> | undefined;
  let duration: number | undefined;
  /** The voice's file name in the work folder: none for the placeholder's silence. */
  let voiceFile: string | undefined;
  if (fresh && existsSync(timingsFile)) {
    ({ words, duration, voiceFile } = JSON.parse(readFileSync(timingsFile, 'utf8')));
  } else {
    const voice = await speak(scenes, series, work, keys, env, fetchImpl);
    voiceFile = voice.file;
    duration = voice.duration ?? (await probeDuration(voiceFile!, work));
    words = voice.words ?? estimateTimings(scenes, duration);
    writeFileSync(timingsFile, JSON.stringify({ words, duration, voiceFile }));
  }
  const total = Math.min(90, (duration ?? 0) + TAIL);

  const shots: Shot[] = [];
  const seconds = sceneDurations(words!, scenes.length, total);
  // Images already made for this script, by scene: scene-3.jpg is scene 3's.
  const made = new Map<number, string>();
  for (const f of readdirSync(work)) {
    const m = /^scene-(\d+)\.(jpg|png|webp)$/.exec(f);
    if (m) made.set(Number(m[1]), f);
  }
  const batchSize = imageBatch(keys);
  for (let i = 0; i < scenes.length; i += batchSize) {
    const batch = scenes.slice(i, i + batchSize).map(async (scene, j) => {
      const n = i + j;
      const file = made.get(n) ?? (await picture(imagePrompt(scene, series), path.join(work, `scene-${n}`), keys, env, fetchImpl));
      shots[n] = file ? { image: file, seconds: seconds[n] } : { color: placeholderColor(n), seconds: seconds[n] };
    });
    await Promise.all(batch);
  }

  writeFileSync(path.join(work, 'captions.ass'), assCaptions(words!, env.REELS_CAPTION_FONT || 'Arial'));
  const music = series.music ? path.join(store.folder('music'), series.music) : undefined;
  if (music && !existsSync(music)) throw new Error(`The series' music, ${series.music}, isn't in ${store.folder('music')}`);
  const video = path.join(store.folder('out'), `${reel.id}.mp4`);
  await render({ shots, voice: voiceFile, music, captions: 'captions.ass', total, out: video }, work);
  return { video, duration: total };
}

/** Clears out a posted reel's work folder: its voice and images aren't needed again. */
export function tidy(reel: Reel, store: ReelsStore) {
  rmSync(path.join(store.dir, 'work', reel.id), { recursive: true, force: true });
}
