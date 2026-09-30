/** The near field and falloff shared by large room audio sources such as the jukebox and TV. */
export const ROOM_AUDIO_REF = 2.5;
export const ROOM_AUDIO_ROLLOFF = 1.3;

/**
 * Web Audio's inverse-distance curve, for media that has to stay outside Web Audio (streams and
 * iframe players). Keeping this here makes those players fade exactly like a PannerNode configured
 * with ROOM_AUDIO_REF and ROOM_AUDIO_ROLLOFF.
 */
export function roomDistanceGain(distance: number, ref = ROOM_AUDIO_REF, rolloff = ROOM_AUDIO_ROLLOFF): number {
  const d = Math.max(ref, Number.isFinite(distance) ? distance : ref);
  return Math.min(1, ref / (ref + rolloff * (d - ref)));
}

/** A 0–1 volume control shaped the same way as the jukebox's own slider. */
export function roomMediaGain(volume: number, distance: number, audible = true): number {
  if (!audible) return 0;
  const level = Math.max(0, Math.min(1, volume));
  return level * level * roomDistanceGain(distance);
}
