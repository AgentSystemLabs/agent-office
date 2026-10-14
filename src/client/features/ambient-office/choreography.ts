import { EMOTE_BY_ID, type EmoteId } from '../../../shared/emotes';
import type { Scene } from './scenes';

/** Behavioral choices, not biography: each coworker initiates and responds differently. */
export const MANNER: Readonly<Record<string, { speaks: EmoteId; responds: EmoteId | null }>> = {
  michael: { speaks: 'wave', responds: 'clap' }, dwight: { speaks: 'point', responds: 'point' },
  jim: { speaks: 'thumbs', responds: 'facepalm' }, pam: { speaks: 'point', responds: 'thumbs' },
  ryan: { speaks: 'point', responds: 'facepalm' }, kelly: { speaks: 'wave', responds: 'point' },
  angela: { speaks: 'point', responds: 'facepalm' }, kevin: { speaks: 'wave', responds: 'clap' },
  oscar: { speaks: 'point', responds: 'point' }, stanley: { speaks: 'point', responds: null },
  phyllis: { speaks: 'thumbs', responds: 'thumbs' }, meredith: { speaks: 'thumbs', responds: 'wave' },
  creed: { speaks: 'wave', responds: 'thumbs' }, andy: { speaks: 'wave', responds: 'clap' },
  toby: { speaks: 'point', responds: 'thumbs' }, darryl: { speaks: 'point', responds: 'thumbs' },
  erin: { speaks: 'wave', responds: 'thumbs' }, holly: { speaks: 'wave', responds: 'clap' },
  david: { speaks: 'point', responds: 'thumbs' },
};

const REPLIES: Readonly<Record<string, EmoteId | null>> = {
  'dwight:jim': 'facepalm', 'jim:dwight': 'point', 'michael:stanley': null,
  'michael:toby': 'facepalm', 'toby:michael': 'facepalm', 'ryan:kelly': 'point',
  'kelly:ryan': 'facepalm', 'pam:erin': 'thumbs', 'erin:pam': 'thumbs',
  'angela:kevin': 'facepalm', 'kevin:angela': 'facepalm', 'holly:michael': 'clap',
};

export interface GestureCue { key: string; emote: EmoteId; age: number }
export interface Performance {
  stage: 'gather' | 'dialogue' | 'reaction' | 'ensemble' | 'settle';
  speaker?: string;
  listener?: string;
  beat: number;
  cues: Readonly<Record<string, GestureCue>>;
}

export const TALK_AT = 35000;
export const BEAT_MS = 6000;
export const RESPONSE_AT = 3600;

/** One shared clock drives the whole exchange, including reloads in the middle of a gesture. */
export function perform(scene: Scene, elapsed: number, instance: number): Performance {
  const members = [...new Set(scene.beats.map(b => b.who))];
  const beat = Math.floor((elapsed - TALK_AT) / BEAT_MS);
  const cues: Record<string, GestureCue> = {};
  const cue = (who: string, emote: EmoteId | null, age: number, suffix: string) => {
    if (emote && age >= 0 && age < EMOTE_BY_ID.get(emote)!.seconds) {
      cues[who] = { key: `${instance}:${scene.id}:${suffix}:${who}`, emote, age };
    }
  };
  if (elapsed < TALK_AT) return { stage: 'gather', beat: -1, cues };
  if (beat < scene.beats.length) {
    const speaker = scene.beats[beat].who;
    const listener = [...scene.beats.slice(beat + 1), ...scene.beats.slice(0, beat)].find(b => b.who !== speaker)?.who;
    const within = (elapsed - TALK_AT) % BEAT_MS;
    const responding = within >= RESPONSE_AT;
    if (!responding) cue(speaker, MANNER[speaker].speaks, within / 1000, `${beat}:speak`);
    else if (listener) {
      const pair = `${speaker}:${listener}`;
      const reply = Object.hasOwn(REPLIES, pair) ? REPLIES[pair] : MANNER[listener].responds;
      cue(listener, reply, (within - RESPONSE_AT) / 1000, `${beat}:reply`);
    }
    return { stage: responding ? 'reaction' : 'dialogue', speaker, listener, beat, cues };
  }
  const age = (elapsed - TALK_AT - scene.beats.length * BEAT_MS) / 1000;
  if (age < 4) {
    for (const id of members) {
      const gesture = scene.id === 'music' || scene.id === 'rehearsal'
        ? (id === 'andy' ? 'dance' : MANNER[id].responds)
        : scene.id === 'dundies' ? (id === 'michael' ? 'wave' : 'clap')
        : scene.id === 'pretzels' ? (id === 'stanley' ? 'thumbs' : 'clap')
        : MANNER[id].responds;
      cue(id, gesture, age, 'ensemble');
    }
    return { stage: 'ensemble', beat, speaker: members[0], cues };
  }
  return { stage: 'settle', beat, cues };
}
