import type { Net } from './net';
import { store } from './state';

interface Conn {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  audio: HTMLAudioElement;
  audioStream?: MediaStream;
  screen?: MediaStream;
  micSender?: RTCRtpSender;
  screenSender?: RTCRtpSender;
  level: number;
  analyser?: AnalyserNode;
}

type Signal = { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit | null };

/**
 * Mesh WebRTC for voice + screen share. Signaling rides the office WebSocket.
 * Uses the "perfect negotiation" pattern so either side can add tracks at any time.
 */
export class Voice {
  readonly conns = new Map<string, Conn>();
  private mic: MediaStream | null = null;
  private screen: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private listeners = new Set<() => void>();
  /** Asking for the mic, so a second join waits for the first instead of asking again. */
  private joining: Promise<string | null> | null = null;
  /** Push to talk is held down: letting go mutes you. */
  private talking = false;
  muted = false;
  localLevel = 0;

  constructor(private net: Net) {
    // Often enough for mouths to keep up with syllables.
    setInterval(() => this.sampleLevels(), 40);
  }

  get inVoice() {
    return !!this.mic;
  }

  get sharing() {
    return !!this.screen;
  }

  get localScreen() {
    return this.screen;
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
  }

  private changed() {
    this.listeners.forEach((fn) => fn());
    this.net.send({ t: 'voice', voice: this.inVoice, muted: this.muted, sharing: this.sharing });
  }

  /** Remote screen shares currently being received, keyed by peer id. */
  remoteScreens(): Map<string, MediaStream> {
    const out = new Map<string, MediaStream>();
    for (const [id, c] of this.conns) {
      const peer = store.peers.get(id);
      if (c.screen && peer?.sharing && c.screen.getVideoTracks().some((t) => t.readyState === 'live')) out.set(id, c.screen);
    }
    return out;
  }

  levelOf(peerId: string): number {
    return peerId === store.you ? this.localLevel : (this.conns.get(peerId)?.level ?? 0);
  }

  /** `muted` joins with the mic off, for push to talk. */
  joinVoice(muted = false): Promise<string | null> {
    if (this.mic) return Promise.resolve(null);
    this.joining ??= this.join(muted).finally(() => (this.joining = null));
    return this.joining;
  }

  private async join(muted: boolean): Promise<string | null> {
    if (!window.isSecureContext) return 'Voice needs HTTPS (or localhost). Ask whoever runs the office to enable TLS.';
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (err) {
      return `Microphone unavailable: ${(err as Error).message}`;
    }
    this.muted = muted;
    this.talking = false;
    this.mic.getAudioTracks().forEach((t) => (t.enabled = !muted));
    this.ensureAudioCtx();
    if (this.audioCtx) {
      const src = this.audioCtx.createMediaStreamSource(this.mic);
      this.localAnalyser = this.audioCtx.createAnalyser();
      this.localAnalyser.fftSize = 1024;
      src.connect(this.localAnalyser);
    }
    const track = this.mic.getAudioTracks()[0];
    for (const c of this.conns.values()) c.micSender = c.pc.addTrack(track, this.mic);
    this.changed();
    return null;
  }

  leaveVoice() {
    if (!this.mic) return;
    for (const c of this.conns.values()) {
      if (c.micSender) {
        try {
          c.pc.removeTrack(c.micSender);
        } catch {
          // connection closed
        }
        c.micSender = undefined;
      }
    }
    this.mic.getTracks().forEach((t) => t.stop());
    this.mic = null;
    this.localAnalyser = null;
    this.localLevel = 0;
    this.talking = false;
    this.changed();
  }

  toggleMute() {
    this.setMuted(!this.muted);
  }

  setMuted(muted: boolean) {
    if (!this.mic) return;
    this.talking = false;
    if (muted === this.muted) return;
    this.muted = muted;
    this.mic.getAudioTracks().forEach((t) => (t.enabled = !muted));
    this.changed();
  }

  /** Push to talk: the mic is on while it's held down, and muted once you let go (see stopTalking). */
  startTalking() {
    if (!this.mic || this.talking) return;
    this.setMuted(false);
    this.talking = true;
  }

  stopTalking() {
    if (this.talking) this.setMuted(true);
  }

  async startShare(): Promise<string | null> {
    if (this.screen) return null;
    if (!window.isSecureContext || !navigator.mediaDevices?.getDisplayMedia) return 'Screen sharing needs HTTPS (or localhost).';
    try {
      this.screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
    } catch (err) {
      return (err as Error).name === 'NotAllowedError' ? null : `Could not share: ${(err as Error).message}`;
    }
    const track = this.screen.getVideoTracks()[0];
    track.contentHint = 'detail';
    track.addEventListener('ended', () => this.stopShare());
    for (const c of this.conns.values()) c.screenSender = c.pc.addTrack(track, this.screen);
    this.changed();
    return null;
  }

  stopShare() {
    if (!this.screen) return;
    for (const c of this.conns.values()) {
      if (c.screenSender) {
        try {
          c.pc.removeTrack(c.screenSender);
        } catch {
          // closed
        }
        c.screenSender = undefined;
      }
    }
    this.screen.getTracks().forEach((t) => t.stop());
    this.screen = null;
    this.changed();
  }

  /** Called whenever the set of peers changes. */
  syncPeers() {
    // Nobody on the 2D view has voice (see PeerInfo.lite), so there's nothing to connect to.
    for (const [id, p] of store.peers) if (id !== store.you && !p.lite && !this.conns.has(id)) this.connect(id);
    for (const id of [...this.conns.keys()]) if (!store.peers.has(id) || store.peers.get(id)!.lite) this.drop(id);
  }

  reset() {
    for (const id of [...this.conns.keys()]) this.drop(id);
  }

  /** Proximity voice: louder when you're close, never fully silent. */
  setVolume(peerId: string, volume: number) {
    const c = this.conns.get(peerId);
    if (c) c.audio.volume = Math.max(0, Math.min(1, volume));
  }

  async handleSignal(from: string, data: Signal) {
    const c = this.conns.get(from) ?? this.connect(from);
    const { pc } = c;
    try {
      if (data.description) {
        const collision = data.description.type === 'offer' && (c.makingOffer || pc.signalingState !== 'stable');
        c.ignoreOffer = !c.polite && collision;
        if (c.ignoreOffer) return;
        await pc.setRemoteDescription(data.description);
        if (data.description.type === 'offer') {
          await pc.setLocalDescription();
          this.signal(from, { description: pc.localDescription!.toJSON() });
        }
      } else if (data.candidate !== undefined) {
        try {
          await pc.addIceCandidate(data.candidate ?? undefined);
        } catch (err) {
          if (!c.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.warn('rtc signal failed', err);
    }
  }

  private signal(to: string, data: Signal) {
    this.net.send({ t: 'rtc', to, data });
  }

  private ensureAudioCtx() {
    if (!this.audioCtx) {
      try {
        this.audioCtx = new AudioContext();
      } catch {
        this.audioCtx = null;
      }
    }
    void this.audioCtx?.resume();
  }

  private connect(id: string): Conn {
    const pc = new RTCPeerConnection({ iceServers: store.ice });
    const audio = new Audio();
    audio.autoplay = true;
    const c: Conn = { pc, polite: store.you < id, makingOffer: false, ignoreOffer: false, audio, level: 0 };
    this.conns.set(id, c);

    pc.onnegotiationneeded = async () => {
      try {
        c.makingOffer = true;
        await pc.setLocalDescription();
        this.signal(id, { description: pc.localDescription!.toJSON() });
      } catch (err) {
        console.warn('rtc negotiation failed', err);
      } finally {
        c.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => this.signal(id, { candidate: candidate ? candidate.toJSON() : null });
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') pc.restartIce();
    };
    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] ?? new MediaStream([track]);
      if (track.kind === 'audio') {
        c.audioStream = stream;
        audio.srcObject = stream;
        void audio.play().catch(() => {
          // Autoplay blocked until the user interacts; retry on the next click.
          window.addEventListener('pointerdown', () => void audio.play().catch(() => {}), { once: true });
        });
        this.ensureAudioCtx();
        if (this.audioCtx) {
          try {
            const src = this.audioCtx.createMediaStreamSource(stream);
            c.analyser = this.audioCtx.createAnalyser();
            c.analyser.fftSize = 1024;
            src.connect(c.analyser);
          } catch {
            // analyser is optional
          }
        }
      } else {
        c.screen = stream;
        track.addEventListener('unmute', () => this.listeners.forEach((fn) => fn()));
        track.addEventListener('ended', () => this.listeners.forEach((fn) => fn()));
      }
      this.listeners.forEach((fn) => fn());
    };

    // Share whatever we're already sending.
    if (this.mic) c.micSender = pc.addTrack(this.mic.getAudioTracks()[0], this.mic);
    if (this.screen) c.screenSender = pc.addTrack(this.screen.getVideoTracks()[0], this.screen);
    return c;
  }

  private drop(id: string) {
    const c = this.conns.get(id);
    if (!c) return;
    c.pc.close();
    c.audio.srcObject = null;
    this.conns.delete(id);
    this.listeners.forEach((fn) => fn());
  }

  private readonly levelBuf = new Uint8Array(1024);

  private sampleLevels() {
    const buf = this.levelBuf;
    const rms = (a: AnalyserNode) => {
      a.getByteTimeDomainData(buf);
      let s = 0;
      for (const v of buf) s += ((v - 128) / 128) ** 2;
      return Math.sqrt(s / buf.length);
    };
    this.localLevel = this.localAnalyser && !this.muted ? rms(this.localAnalyser) : 0;
    for (const c of this.conns.values()) c.level = c.analyser ? rms(c.analyser) : 0;
  }
}
