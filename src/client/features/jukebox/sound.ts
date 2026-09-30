import { JUKEBOX } from '../../../shared/layout';
import { STREAM } from '../../../shared/jukebox';
import type { AudioCore } from '../../sound/core';
import { biquad, rms } from '../../sound/dsp';
import { TunePlayer } from '../../sound/music';

// ---- The jukebox ------------------------------------------------------------------------------

/** What the jukebox on your floor plays: a tune or a stream, and when it started on performance.now()'s clock. */
export interface JukeboxPlay {
  track: string;
  url?: string;
  /** When it started on the office's clock, which tells one play of a track from the next. */
  startedAt: number;
  since: number;
}

/** How the jukebox fades with distance: the same curve for its tunes (a panner) and a stream (by hand). */
const MUSIC_REF = 2.5;
const MUSIC_ROLLOFF = 1.3;

/** The jukebox on your floor: a tune or a stream, muffled from across the room, at your own volume. */
export class Jukebox {
  // From the cabinet, through a filter that muffles it from across the room, to your own volume.
  private musicIn!: PannerNode;
  private musicTone!: BiquadFilterNode;
  private musicCutoff = 16000;
  /** Your music volume, which the DJ on the roof plays through too. */
  musicBus!: GainNode;
  private musicMeter!: AnalyserNode;
  private musicVolume = 0.5;
  private musicMuted = false;
  private jukebox: JukeboxPlay | null = null;
  private tune: TunePlayer | null = null;
  private stream: HTMLAudioElement | null = null;
  private musicTimer = 0;

  /** `onError` hears about a stream that won't play here. */
  constructor(
    private readonly a: AudioCore,
    private readonly onError: (text: string) => void,
  ) {}

  /** Once there's audio: the jukebox's part of the graph. */
  connect(ctx: AudioContext) {
    // The jukebox skips the master (it has its own volume) and keeps playing while the tab is hidden.
    this.musicIn = this.a.panner(JUKEBOX, MUSIC_REF, MUSIC_ROLLOFF);
    this.musicTone = biquad(ctx, 'lowpass', 16000, 0.5);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0;
    this.musicMeter = ctx.createAnalyser();
    this.musicMeter.fftSize = 2048;
    this.musicIn.connect(this.musicTone).connect(this.musicBus).connect(ctx.destination);
    this.musicBus.connect(this.musicMeter);
  }

  /** Audio was already going and the page was touched again. */
  touched() {
    // A ding can start audio before you've touched the page, when a stream isn't allowed to play yet.
    if (this.stream?.paused) void this.stream.play().catch(() => {});
  }

  /** The jukebox's level (RMS) where you stand, after your music volume. A stream doesn't show here. */
  musicLevel(): number {
    return this.a.ctx ? rms(this.musicMeter) : 0;
  }

  /** What the jukebox on your floor plays, or null for nothing. It starts once the browser allows audio. */
  setJukebox(play: JukeboxPlay | null) {
    const was = this.jukebox;
    this.jukebox = play;
    // The same play, sent again after a reconnect or timed better once the clocks are compared: carry on
    // (a tune lines itself up again as it goes; an audio file jumps to the right spot).
    if (was && play && was.startedAt === play.startedAt && was.track === play.track && was.url === play.url) {
      if (this.stream && Math.abs(was.since - play.since) > 250) this.seekStream(this.stream);
      return;
    }
    this.applyJukebox(true);
  }

  /** Your own jukebox volume, 0–1, apart from the office sounds'. */
  setMusicVolume(volume: number, muted: boolean) {
    this.musicVolume = Math.max(0, Math.min(1, volume));
    this.musicMuted = muted;
    this.applyMusicVolume();
  }

  /** 1 on each beat of the tune, falling to 0 before the next, for the jukebox's lights. */
  beat(): number {
    if (this.tune) return this.tune.beat(this.musicAt());
    if (this.stream && !this.stream.paused) return 0.35 + 0.25 * Math.sin(performance.now() / 320);
    return 0;
  }

  /** How far into the jukebox's track it is now, in seconds. */
  private musicAt(): number {
    return this.jukebox ? Math.max(0, (performance.now() - this.jukebox.since) / 1000) : 0;
  }

  applyMusicVolume() {
    if (!this.a.ctx) return;
    this.musicBus.gain.setTargetAtTime(this.musicGain(), this.a.ctx.currentTime, 0.04);
    this.hearStream();
  }

  private musicGain(): number {
    return this.musicMuted ? 0 : this.musicVolume * this.musicVolume;
  }

  /** Starts what the jukebox plays now, once there's audio; `changed` puts it on again from the top. */
  applyJukebox(changed = false) {
    const ctx = this.a.ctx;
    if (!ctx || (!changed && (this.tune || this.stream))) return;
    this.tune?.stop();
    this.tune = null;
    if (this.stream) {
      this.stream.pause();
      this.stream.removeAttribute('src');
      this.stream.load();
      this.stream = null;
    }
    clearInterval(this.musicTimer);
    const j = this.jukebox;
    if (!j) return;
    if (j.track === STREAM && j.url) return this.startStream(j.url);
    const tune = (this.tune = new TunePlayer(ctx, this.musicIn, j.track));
    this.a.count('tune');
    // On a timer rather than every frame, so it carries on in a background tab.
    const tick = () => tune.tick(this.musicAt());
    tick();
    this.musicTimer = window.setInterval(tick, 150);
  }

  private startStream(url: string) {
    const a = new Audio();
    a.preload = 'auto';
    a.loop = true;
    a.src = url;
    a.addEventListener('loadedmetadata', () => this.seekStream(a));
    a.addEventListener('error', () => {
      if (this.stream === a) this.onError("📻 The jukebox can't play that stream in your browser");
    });
    this.stream = a;
    this.hearStream();
    void a.play().catch(() => {});
    this.a.count('stream');
  }

  /** An audio file (not live radio) picks up where everyone else is. */
  private seekStream(a: HTMLAudioElement) {
    if (Number.isFinite(a.duration) && a.duration > 0) a.currentTime = this.musicAt() % a.duration;
  }

  /** Muffles the jukebox the further you are from it. */
  hearJukebox(now: number) {
    const d = this.jukeboxDistance();
    const cutoff = d < 5 ? 16000 : Math.max(1600, 16000 * (5 / d) ** 1.5);
    if (Math.abs(cutoff - this.musicCutoff) > this.musicCutoff * 0.02) {
      this.musicCutoff = cutoff;
      this.musicTone.frequency.setTargetAtTime(cutoff, now, 0.1);
    }
    this.hearStream();
  }

  /** A stream plays outside Web Audio (most don't allow that), so it gets quieter with distance by hand. */
  private hearStream() {
    if (!this.stream) return;
    const d = Math.max(MUSIC_REF, this.jukeboxDistance());
    this.stream.volume = Math.min(1, this.musicGain() * (MUSIC_REF / (MUSIC_REF + MUSIC_ROLLOFF * (d - MUSIC_REF))));
  }

  private jukeboxDistance(): number {
    const l = this.a.listener;
    return Math.hypot(l.x - JUKEBOX.x, l.y - JUKEBOX.y, l.z - JUKEBOX.z);
  }

}
