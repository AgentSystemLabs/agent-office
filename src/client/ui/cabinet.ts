import * as THREE from 'three';
import { GAME, type CabinetFrame } from '../../shared/cabinet';
import { DESK_BY_ID } from '../../shared/layout';
import type { WorkerInfo } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, toast, type Modal } from './dom';
import { ScreenZoom } from './arcade';
import { Blocks, H, W, paintScreen, type ScreenView } from './blocks';

/** What the cabinet makes a noise about: a piece landing, lines clearing (how many), the game ending. */
export type CabinetSound = 'land' | 'clear' | 'over';

/** Your game goes out to everyone watching at most this often (ms). */
const FRAME_MS = 90;

/** Keys for the game, by `code`. */
const KEYS: Record<string, 'left' | 'right' | 'down' | 'turn' | 'back' | 'drop' | 'hold' | 'pause' | 'go'> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowUp: 'turn',
  KeyW: 'turn',
  KeyX: 'turn',
  KeyZ: 'back',
  Space: 'drop',
  KeyC: 'hold',
  ShiftLeft: 'hold',
  ShiftRight: 'hold',
  KeyP: 'pause',
  Enter: 'go',
};

/**
 * The arcade cabinet in the lounge. Press E there and the camera glides up to its screen, where you
 * play BLOCKFALL (ui/blocks.ts) on the keyboard. Everyone else on the floor sees your game on the
 * cabinet as you play, and can walk up and press E to watch it up close. One of your workers needing
 * input pauses it and says who; walking away leaves it paused for when you come back. Its score goes
 * on the building's high-score table when you walk away and when the game ends.
 */
export class Cabinet {
  private mode: 'play' | 'watch' | null = null;
  private modal: Modal | null = null;
  private readonly view: ScreenZoom;
  /** Your game: the one you're playing, or the one you left paused. */
  private game: Blocks | null = null;
  /** The finished game's score has gone to the table. */
  private recorded = false;
  private sent = { version: -1, at: 0 };
  /** The worker whose question paused your game. */
  private waiting: WorkerInfo | null = null;
  /** Who you're watching. */
  private watching = '';
  /** What the cabinet in the office shows. */
  private readonly picture = document.createElement('canvas');
  private readonly texture = new THREE.CanvasTexture(this.picture);
  /** The screen you play or watch on up close, drawn at the size it shows on the page so it stays crisp. */
  private board: HTMLCanvasElement | null = null;
  /** Over the screen while a worker waits on you: who, and a way to its terminal. */
  private call: HTMLElement | null = null;
  private dirty = true;
  private painted = -1;
  private blink = -1;
  /** The last frame from whoever's playing, to hear what changed. */
  private heard: CabinetFrame | null = null;

  constructor(
    screen: THREE.Mesh,
    private readonly net: Net,
    private readonly opts: { openTerminal(workerId: string): void; sound(kind: CabinetSound, lines?: number): void },
  ) {
    this.view = new ScreenZoom(screen);
    this.picture.width = 512;
    this.picture.height = 384;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    const mat = screen.material as THREE.MeshBasicMaterial;
    mat.map = this.texture;
    mat.color.set('#ffffff');
    // Canvas text only picks up the office's font once it has loaded.
    void document.fonts.ready.then(() => (this.dirty = true));
    store.on('cabinet', () => this.onState());
    store.on('cabinetFrame', () => this.onFrame());
    store.on('workers', () => this.onWorkers());
    // Clicked off into another window: the game waits for you.
    window.addEventListener('blur', () => {
      if (this.mode === 'play') this.game?.pause(true);
    });
    // Closing the tab mid-game: what you scored still counts.
    window.addEventListener('pagehide', () => {
      if (this.mode === 'play' && !this.game?.over) this.record();
    });
  }

  /** Anywhere between your view and the screen: your first-person hands would cover it. */
  get zoomed(): boolean {
    return this.view.zoomed;
  }

  /** Your game's score, while you've left it paused here. */
  get leftAt(): number | null {
    return this.game && !this.game.over && this.mode !== 'play' ? this.game.score : null;
  }

  /** E at the cabinet: play, or carry on with the game you left; watch whoever's on it already. */
  play() {
    if (this.modal || !store.floor) return;
    const p = store.cabinet.player;
    if (p && p.id !== store.you) return this.open('watch');
    if (!this.game || this.game.over) this.newGame();
    this.net.send({ t: 'cabinet.play' });
    this.open('play');
  }

  /** One of your workers started waiting on an answer: your game stops for it, and says who. */
  needsYou(w: WorkerInfo) {
    if (this.mode !== 'play' || !this.game) return;
    this.game.pause(true);
    this.waiting = w;
    this.renderCall();
    this.dirty = true;
  }

  /** Runs the game, sends it to everyone watching, keeps the screens drawn and moves the camera. Call it once the player has placed the camera. */
  update(camera: THREE.PerspectiveCamera, dt: number) {
    const g = this.game;
    const now = performance.now();
    if (this.mode === 'play' && g) {
      g.update(dt);
      if (g.over && !this.recorded) {
        this.recorded = true;
        this.record();
        this.opts.sound('over');
      }
      if (g.version !== this.sent.version && now - this.sent.at >= FRAME_MS) {
        this.sent = { version: g.version, at: now };
        this.net.send({ t: 'cabinet.frame', frame: g.frame() });
      }
      if (g.version !== this.painted) this.dirty = true;
    }
    // The blinking "press E" with nobody playing.
    const blink = Math.floor((now / 1000) * 1.6) % 2;
    if (blink !== this.blink) {
      this.blink = blink;
      if (this.idle()) this.dirty = true;
    }
    if (this.dirty) this.paint(now);
    this.view.update(camera, dt, !!this.modal);
  }

  private newGame() {
    const g = new Blocks();
    g.onLand = (lines) => this.opts.sound(lines ? 'clear' : 'land', lines);
    this.game = g;
    this.recorded = false;
    this.sent.version = -1;
  }

  /** The game's score as it stands, for the high-score table. */
  private record() {
    const g = this.game;
    if (g && g.score > 0) this.net.send({ t: 'cabinet.score', game: g.id, score: g.score, lines: g.lines, level: g.level });
  }

  private resume() {
    this.waiting = null;
    this.renderCall();
    this.game?.pause(false);
  }

  private open(mode: 'play' | 'watch') {
    this.mode = mode;
    this.watching = mode === 'watch' ? (store.cabinet.player?.name ?? '') : '';
    const board = h('canvas', { 'aria-label': mode === 'play' ? GAME : `${this.watching} playing ${GAME}` });
    const stop = h('button.btn', { type: 'button' }, mode === 'play' ? '✕ Stop playing' : '✕ Stop watching');
    const tip = mode === 'play' ? '← → move · ↑ turn · ↓ faster · Space drop · C hold · P pause' : `👀 Watching ${this.watching}`;
    const call = h('div.cabinet-call.hidden', { role: 'status' });
    const box = h(
      'div.arcade.cabinet',
      { role: 'dialog', 'aria-label': GAME },
      h('div.arcade-screen', {}, board),
      call,
      h('div.arcade-bar', {}, h('span', {}, `🕹️ ${GAME}`), h('span.tip', {}, tip), stop),
    );

    const fit = () => {
      const { width, height } = this.view.box();
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
      board.width = Math.round(width * devicePixelRatio);
      board.height = Math.round(height * devicePixelRatio);
      this.dirty = true;
    };
    const onKey = (e: KeyboardEvent) => this.key(e, true);
    const onKeyUp = (e: KeyboardEvent) => this.key(e, false);
    this.board = board;
    this.call = call;
    fit();
    window.addEventListener('resize', fit);
    if (mode === 'play') {
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('keyup', onKeyUp, true);
    }
    this.modal = openModal(box, {
      backdropCloses: false,
      onClose: () => {
        window.removeEventListener('resize', fit);
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('keyup', onKeyUp, true);
        this.closed();
      },
    });
    this.modal.backdrop.classList.add('clear');
    stop.addEventListener('click', () => this.modal?.close());
  }

  /** Stepped away: your game waits, paused, with its score on the table so far. */
  private closed() {
    const was = this.mode;
    this.mode = null;
    this.modal = this.board = this.call = null;
    this.waiting = null;
    this.watching = '';
    this.dirty = true;
    if (was !== 'play') return;
    const g = this.game;
    // A game you never got going isn't worth coming back to.
    if (g && !g.pieces && !g.score) this.game = null;
    else if (g && !g.over) {
      g.pause(true);
      this.record();
    }
    this.net.send({ t: 'cabinet.leave' });
  }

  private key(e: KeyboardEvent, down: boolean) {
    const k = KEYS[e.code];
    const g = this.game;
    if (!k || !g || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    if (!down) {
      if (k === 'left') g.release(-1);
      else if (k === 'right') g.release(1);
      else if (k === 'down') g.softDrop(false);
      return;
    }
    // Held keys slide and drop on their own time, not the keyboard's repeat.
    if (e.repeat) return;
    if (g.over) {
      if (k === 'go' || k === 'drop') {
        this.newGame();
        this.dirty = true;
      }
      return;
    }
    if (g.state === 'paused') {
      if (k === 'pause' || k === 'go') this.resume();
      return;
    }
    if (k === 'left') g.press(-1);
    else if (k === 'right') g.press(1);
    else if (k === 'down') g.softDrop(true);
    else if (k === 'turn') g.rotate(1);
    else if (k === 'back') g.rotate(-1);
    else if (k === 'drop') g.hardDrop();
    else if (k === 'hold') g.hold();
    else if (k === 'pause') g.pause(true);
  }

  /** Who's at the cabinet changed. */
  private onState() {
    const p = store.cabinet.player;
    this.heard = store.cabinetFrame;
    if (this.mode === 'play') {
      // Someone else got there first: watch them instead.
      if (p && p.id !== store.you) {
        this.modal?.close();
        this.open('watch');
      } else if (!p) {
        // The office forgot (a dropped connection): still here.
        this.net.send({ t: 'cabinet.play' });
      }
    } else if (this.mode === 'watch' && (!p || p.id === store.you || p.name !== this.watching)) {
      if (!p) toast(`${this.watching} stepped away from the arcade`);
      this.modal?.close();
    }
    this.dirty = true;
  }

  /** Someone else's game moved on: hear it land, clear lines and end. */
  private onFrame() {
    const f = store.cabinetFrame;
    const was = this.heard;
    this.heard = f;
    this.dirty = true;
    if (!f || !was) return;
    if (f.lines > was.lines) this.opts.sound('clear', f.lines - was.lines);
    else if (f.pieces > was.pieces) this.opts.sound('land');
    if (f.state === 'over' && was.state !== 'over') this.opts.sound('over');
  }

  /** The worker that paused your game got its answer from someone else. */
  private onWorkers() {
    if (!this.waiting || store.workers.get(this.waiting.id)?.status === 'needs_input') return;
    this.waiting = null;
    this.renderCall();
    this.dirty = true;
  }

  private renderCall() {
    const el = this.call;
    if (!el) return;
    const w = this.waiting;
    el.classList.toggle('hidden', !w);
    if (!w) return el.replaceChildren();
    const go = h('button.btn.primary', { type: 'button' }, '💬 Open its terminal');
    const back = h('button.btn', { type: 'button' }, '▶ Carry on');
    go.addEventListener('click', () => {
      this.modal?.close();
      this.opts.openTerminal(w.id);
    });
    back.addEventListener('click', () => this.resume());
    el.replaceChildren(h('span', {}, `🙋 ${w.name} needs input${deskOf(w)}`), go, back);
  }

  /** Nobody's game on the screen, just the high scores. */
  private idle(): boolean {
    const p = store.cabinet.player;
    return !(this.mode === 'play' && this.game) && !(p && p.id !== store.you && store.cabinetFrame);
  }

  /** What the screen shows: your game, someone else's, or the high scores with nobody playing. */
  private screen(t: number): ScreenView {
    const c = store.cabinet;
    const g = this.game;
    if (this.mode === 'play' && g) {
      const rank = c.scores.findIndex((s) => s.game === g.id) + 1;
      return {
        frame: g.frame(),
        player: store.profile.name,
        scores: c.scores,
        mine: g.id,
        note: this.waiting ? `${this.waiting.name} needs you${deskOf(this.waiting)}` : 'P to carry on',
        prompt: rank ? `🏆 #${rank} on the table! Enter: again` : 'Enter to play again',
        t,
      };
    }
    if (c.player && c.player.id !== store.you) {
      return { frame: store.cabinetFrame, player: c.player.name, scores: c.scores, note: 'Back in a moment', prompt: store.cabinetFrame ? undefined : `▶ ${c.player.name.toUpperCase()}`, t };
    }
    const left = this.leftAt !== null;
    return { frame: null, scores: c.scores, mine: g?.id, prompt: left ? 'PRESS E TO CARRY ON' : 'PRESS E TO PLAY', t };
  }

  /** Draws the screen up close while you play or watch, and on the cabinet otherwise (the close one covers it). */
  private paint(now: number) {
    this.dirty = false;
    if (this.game) this.painted = this.game.version;
    const v = this.screen(now / 1000);
    const canvas = this.board ?? this.picture;
    const g = canvas.getContext('2d')!;
    g.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    paintScreen(g, v);
    if (!this.board) this.texture.needsUpdate = true;
  }
}

/** " at Desk 3", or nothing when it's not at a desk here. */
function deskOf(w: WorkerInfo): string {
  const d = DESK_BY_ID.get(w.deskId);
  return d ? ` at ${d.station ? `the ${d.label}` : d.label}` : '';
}
