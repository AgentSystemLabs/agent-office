import { EMOTES, type EmoteId } from '../../shared/emotes';
import { h } from './dom';

/** How far (px) the mouse has to go from the middle of the wheel before it points at an emote. */
const DEAD_ZONE = 26;
/** From the middle of the wheel to the middle of each emote, px. */
const RADIUS = 104;
/** Letting go of G sooner than this (ms) leaves the wheel open to click; holding it picks on release. */
const TAP_MS = 250;
/** The emotes go round clockwise from the top, a slice each. */
const SLICE = (Math.PI * 2) / EMOTES.length;

/**
 * The emote wheel: hold G, point the mouse at an emote and let go (or click it). A quick tap on G
 * leaves it open until you pick one, press G or Esc, or click outside it.
 */
export class EmoteWheel {
  readonly el: HTMLElement;
  private items: HTMLElement[];
  private caption: HTMLElement;
  /** The emote the mouse points at, or -1. */
  private at = -1;
  /** Mouse movement since the wheel opened, while the mouse is captured (there's no cursor then). */
  private aim = { x: 0, y: 0 };
  /** When G went down to open it; 0 once it stays open on its own. */
  private heldAt = 0;
  isOpen = false;

  constructor(
    private onPick: (id: EmoteId) => void,
    /** The wheel opened or closed: while it's open, the mouse is for picking, not for looking around. */
    private onToggle: (open: boolean) => void,
  ) {
    this.items = EMOTES.map((e, i) => {
      const a = i * SLICE - Math.PI / 2;
      return h(
        'button.emote',
        { type: 'button', title: `${e.label} (${i + 1})`, 'aria-label': e.label, style: `--x:${Math.cos(a) * RADIUS}px;--y:${Math.sin(a) * RADIUS}px`, onpointermove: () => this.point(i) },
        e.emoji,
        h('span.num', {}, i + 1),
      );
    });
    this.caption = h('div.middle');
    this.el = h('div.emote-wheel.hidden', { role: 'menu', 'aria-label': 'Emotes' }, h('div.ring', {}, ...this.items, this.caption));
    this.el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const i = this.items.findIndex((b) => b.contains(e.target as Node));
      this.pick(i >= 0 ? i : this.at);
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.isOpen) return;
      if (document.pointerLockElement) {
        // Kept within the ring, so turning back toward another emote answers straight away.
        this.aim.x += e.movementX;
        this.aim.y += e.movementY;
        const d = Math.hypot(this.aim.x, this.aim.y);
        if (d > RADIUS) {
          this.aim.x *= RADIUS / d;
          this.aim.y *= RADIUS / d;
        }
        this.aimAt(this.aim.x, this.aim.y);
      } else if (!this.items.some((b) => b.contains(e.target as Node))) {
        this.aimAt(e.clientX - window.innerWidth / 2, e.clientY - window.innerHeight / 2);
      }
    });
    window.addEventListener('blur', () => this.close());
    this.render();
  }

  /** G went down. */
  press() {
    if (this.isOpen) return this.close();
    this.isOpen = true;
    this.heldAt = performance.now();
    this.aim = { x: 0, y: 0 };
    this.at = -1;
    this.el.classList.remove('hidden');
    this.render();
    this.onToggle(true);
  }

  /** G came back up: pick what it points at, or stay open after a quick tap. */
  release() {
    if (!this.isOpen || !this.heldAt) return;
    if (this.at >= 0) this.pick(this.at);
    else if (performance.now() - this.heldAt < TAP_MS) {
      this.heldAt = 0;
      this.render();
    } else this.close();
  }

  /** A click with the mouse captured (first person): there's no cursor, so it picks what the wheel points at. */
  click() {
    this.pick(this.at);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.heldAt = 0;
    this.el.classList.add('hidden');
    this.onToggle(false);
  }

  /** Plays emote `i` (-1 picks nothing) and closes the wheel. */
  private pick(i: number) {
    this.close();
    const e = EMOTES[i];
    if (e) this.onPick(e.id);
  }

  private aimAt(x: number, y: number) {
    if (Math.hypot(x, y) < DEAD_ZONE) return this.point(-1);
    const a = Math.atan2(y, x) + Math.PI / 2;
    this.point(((Math.round(a / SLICE) % EMOTES.length) + EMOTES.length) % EMOTES.length);
  }

  private point(i: number) {
    if (i === this.at) return;
    this.at = i;
    this.render();
  }

  private render() {
    this.items.forEach((b, i) => b.classList.toggle('on', i === this.at));
    const e = EMOTES[this.at];
    const how = !e ? 'Point at one, or 1–6' : this.heldAt ? 'Let go of G' : 'Click';
    this.caption.replaceChildren(h('b', {}, e?.label ?? 'Emote'), h('small', {}, how));
  }
}
