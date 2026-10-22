import type { Settings } from '../../state';

/** Quiet original electric-piano loop. Its context exists only while a ride is on screen. */
export class ElevatorMusic {
  private audio: AudioContext | null = null;
  private bus: GainNode | null = null;
  private timer = 0;
  private step = 0;
  start(settings: () => Settings) {
    try {
      this.audio = new AudioContext();
      this.bus = this.audio.createGain();
      this.bus.connect(this.audio.destination);
      void this.audio.resume().catch(() => {});
      const play = () => {
        const a = this.audio, bus = this.bus;
        if (!a || !bus) return;
        const s = settings();
        bus.gain.value = document.hidden || s.muted || s.musicMuted ? 0 : s.volume * s.music * 0.08;
        const notes = [261.63, 329.63, 392, 329.63, 220, 293.66, 349.23, 293.66];
        const oscillator = a.createOscillator(), envelope = a.createGain();
        oscillator.type = 'sine'; oscillator.frequency.value = notes[this.step++ % notes.length];
        envelope.gain.setValueAtTime(0, a.currentTime);
        envelope.gain.linearRampToValueAtTime(0.65, a.currentTime + 0.015);
        envelope.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.65);
        oscillator.connect(envelope); envelope.connect(bus);
        oscillator.start(); oscillator.stop(a.currentTime + 0.7);
        oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
      };
      play(); this.timer = window.setInterval(play, 420);
    } catch { this.stop(); }
  }
  stop() {
    clearInterval(this.timer);
    if (this.audio) void this.audio.close().catch(() => {});
    this.audio = null; this.bus = null;
  }
}
