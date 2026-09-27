// Emotes: a quick reaction (a wave, a thumbs up…) your character does for everyone on your floor.
// Server and client share the list, so an emote is just its id on the wire.

export const EMOTES = [
  { id: 'wave', emoji: '👋', label: 'Wave', seconds: 2.2 },
  { id: 'thumbs', emoji: '👍', label: 'Thumbs up', seconds: 1.8 },
  { id: 'clap', emoji: '👏', label: 'Clap', seconds: 2.2 },
  { id: 'dance', emoji: '🕺', label: 'Dance', seconds: 4 },
  { id: 'point', emoji: '👉', label: 'Point', seconds: 2 },
  { id: 'facepalm', emoji: '🤦', label: 'Facepalm', seconds: 2.4 },
] as const;

export type Emote = (typeof EMOTES)[number];
export type EmoteId = Emote['id'];

export const EMOTE_BY_ID = new Map<string, Emote>(EMOTES.map((e) => [e.id, e]));

export function isEmote(x: unknown): x is EmoteId {
  return typeof x === 'string' && EMOTE_BY_ID.has(x);
}

/** A few emotes in a row are fine; after that, one every this many milliseconds. */
export const EMOTE_BURST = 3;
export const EMOTE_EVERY = 2000;

/**
 * The emote rate limit: a bucket of EMOTE_BURST, refilled one every `every` ms. The page checks
 * before it plays one, and the server again (a little more leniently, as messages can bunch up
 * on the way) before everyone else sees it.
 */
export class EmoteBucket {
  private tokens = EMOTE_BURST;
  private at = 0;

  constructor(private every = EMOTE_EVERY) {}

  /** Uses one up if there's one left at `now` (ms); false means too soon. */
  take(now: number): boolean {
    this.tokens = Math.min(EMOTE_BURST, this.tokens + (now - this.at) / this.every);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
