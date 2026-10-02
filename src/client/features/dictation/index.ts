/**
 * Dictating a prompt (the 🎤 in ui/dictate.ts) while you're in voice with an open mic: the office
 * mutes you for as long as it listens, so the others don't hear you talk to a worker.
 */
import type { Ctx } from '../../core/context';
import { onDictating } from '../../ui/dictate';

export function installDictation(ctx: Ctx) {
  const { voice } = ctx;
  /** Dictation muted you, so it's the one to unmute you. */
  let muted = false;
  onDictating((on) => {
    if (on) {
      if (!voice.inVoice || voice.muted) return;
      voice.setMuted(true);
      muted = true;
    } else if (muted) {
      muted = false;
      if (voice.inVoice && voice.muted) voice.setMuted(false);
    }
  });
}
