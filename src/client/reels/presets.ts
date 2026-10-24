// What the "new series" steps offer to pick from: niches, art styles, voices and how often to post.
// Each is only a starting point the studio's fields are filled in from; everything stays editable.

export interface Niche {
  id: string;
  emoji: string;
  name: string;
  /** What the scout and writer go by. */
  niche: string;
  /** The art style it suits. */
  style: string;
  hashtags: string;
  cta: string;
  tone: string;
}

export const NICHES: Niche[] = [
  { id: 'scary', emoji: '👻', name: 'Scary stories', niche: 'original short horror stories with a twist ending, told in first person', style: 'dark-fantasy', hashtags: 'scarystories horror creepy', cta: 'Follow for tomorrow’s story… if you dare', tone: 'low, slow, unsettling' },
  { id: 'history', emoji: '🏛️', name: 'Dark history', niche: 'true, little-known dark stories from history, told as mysteries', style: 'oil-painting', hashtags: 'history mystery truestory', cta: 'Follow for tomorrow’s story', tone: 'calm, low, suspenseful' },
  { id: 'myths', emoji: '⚡', name: 'Mythology', niche: 'myths and legends from Greek, Norse and Egyptian mythology, retold as gripping stories', style: 'epic-painting', hashtags: 'mythology greekmythology legends', cta: 'Follow for the next legend', tone: 'grand, dramatic storyteller' },
  { id: 'mystery', emoji: '🔍', name: 'Unsolved mysteries', niche: 'real unsolved mysteries and strange disappearances, told carefully and factually', style: 'noir', hashtags: 'unsolved mystery truecrime', cta: 'What do you think happened? Comment below', tone: 'measured, curious' },
  { id: 'facts', emoji: '🧠', name: 'Mind-blowing facts', niche: 'surprising, true science and nature facts explained as a short story', style: 'cinematic', hashtags: 'facts science didyouknow', cta: 'Follow for a fact a day', tone: 'upbeat, amazed' },
  { id: 'motivation', emoji: '🔥', name: 'Motivation', niche: 'short true stories of people who failed many times before succeeding, with one lesson each', style: 'cinematic', hashtags: 'motivation success mindset', cta: 'Follow for your daily push', tone: 'warm, rising, inspiring' },
  { id: 'heists', emoji: '💎', name: 'Famous heists', niche: 'true stories of famous heists and cons, told like a thriller', style: 'comic', hashtags: 'heist truecrime story', cta: 'Follow for the next heist', tone: 'quick, playful, tense' },
  { id: 'kindness', emoji: '💛', name: 'Acts of kindness', niche: 'heartwarming original stories about small acts of kindness with a twist', style: 'storybook', hashtags: 'kindness wholesome story', cta: 'Follow for more good news', tone: 'gentle, warm' },
];

export interface ArtStyle {
  id: string;
  name: string;
  /** What's added to every image prompt. */
  prompt: string;
  /** The tile's colors, since there's no picture to show for it. */
  swatch: string;
  emoji: string;
}

export const STYLES: ArtStyle[] = [
  { id: 'oil-painting', name: 'Oil painting', prompt: 'moody oil painting, candlelight, deep shadows, visible brush strokes', swatch: 'linear-gradient(135deg,#3b2414,#9a5b2a 55%,#e8b26a)', emoji: '🖼️' },
  { id: 'dark-fantasy', name: 'Dark fantasy', prompt: 'dark fantasy digital art, fog, eerie green and blue light, highly detailed', swatch: 'linear-gradient(135deg,#0b1320,#1f4d4a 55%,#7fd1b9)', emoji: '🌑' },
  { id: 'cinematic', name: 'Cinematic', prompt: 'cinematic photograph, 35mm film, dramatic lighting, shallow depth of field', swatch: 'linear-gradient(135deg,#101820,#2c5364 55%,#f4a261)', emoji: '🎬' },
  { id: 'anime', name: 'Anime', prompt: 'anime illustration, vibrant colors, clean line art, studio quality background', swatch: 'linear-gradient(135deg,#ff6fb5,#8b5cf6 55%,#60a5fa)', emoji: '🌸' },
  { id: 'comic', name: 'Comic book', prompt: 'bold comic book illustration, ink outlines, halftone shading, dynamic angles', swatch: 'linear-gradient(135deg,#ffd166,#ef476f 55%,#118ab2)', emoji: '💥' },
  { id: 'epic-painting', name: 'Epic painting', prompt: 'epic classical painting, golden light, dramatic sky, renaissance style', swatch: 'linear-gradient(135deg,#2a1b3d,#a4508b 55%,#f9c74f)', emoji: '⚡' },
  { id: 'noir', name: 'Film noir', prompt: 'black and white film noir, hard shadows, rain, 1940s', swatch: 'linear-gradient(135deg,#0d0d0d,#4a4a4a 55%,#d9d9d9)', emoji: '🕵️' },
  { id: 'storybook', name: 'Storybook', prompt: 'soft watercolor storybook illustration, warm pastel colors, gentle light', swatch: 'linear-gradient(135deg,#fde2e4,#cddafd 55%,#bee1e6)', emoji: '📖' },
  { id: '3d', name: '3D cartoon', prompt: 'cute 3D cartoon render, soft lighting, bright colors, clay style', swatch: 'linear-gradient(135deg,#a0e7e5,#b4f8c8 55%,#fbe7c6)', emoji: '🧸' },
];

export const styleFor = (id: string) => STYLES.find((s) => s.id === id) ?? STYLES[0];

/** The free Kokoro voices worth offering, and what each sounds like. */
export const VOICES: { id: string; name: string; what: string }[] = [
  { id: 'am_michael', name: 'Michael', what: 'Deep, calm storyteller (US)' },
  { id: 'am_adam', name: 'Adam', what: 'Clear, energetic (US)' },
  { id: 'af_heart', name: 'Heart', what: 'Warm, expressive (US)' },
  { id: 'af_bella', name: 'Bella', what: 'Bright, friendly (US)' },
  { id: 'bm_george', name: 'George', what: 'Classic British narrator' },
  { id: 'bf_emma', name: 'Emma', what: 'Soft British voice' },
];

export const FREQUENCIES: { perDay: number; label: string; what: string }[] = [
  { perDay: 0.5, label: 'Every 2 days', what: 'Easy start' },
  { perDay: 1, label: 'Once a day', what: 'Recommended' },
  { perDay: 2, label: 'Twice a day', what: 'Grow faster' },
  { perDay: 3, label: '3 a day', what: 'For established pages' },
];
