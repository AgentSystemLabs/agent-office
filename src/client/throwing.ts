import * as THREE from 'three';
import { GREEN, ROUND, landing, meterAt, targetFrame, throwSpot, type BarGame, type Toss } from '../shared/bargames';
import { isTyping, type PlayerController } from './player';
import { $, h, modalOpen } from './ui/dom';
import type { Person } from './world/character';

// Stepping up to the dart board's oche or the axe lane's line, up on the roof (E there): you stand
// at the line with a dart (or an axe) in hand, and the camera looks over your shoulder at the target.
// The mouse (or the arrow keys) moves where you aim, which wanders a little with your hand, and more
// after a few drinks. Holding Space (or the mouse button) draws it back while the meter runs up and
// down; let go to throw. In the green a dart flies true and an axe turns just right to stick. Too
// soft and a dart drops, too hard and it sails high; either way an axe comes in wrong and bounces
// off. E steps back from the line.

interface Feel {
  /** The meter runs from nothing to full in this long, then back down (its green is GREEN's). */
  meter: number;
  /** How far your aim wanders (meters), sober, and how quickly. */
  sway: number;
  swayRate: number;
  /** How far you can aim from the target's middle (meters: either side, down and up), and how fast the keys move it (m/s). */
  reach: { u: number; down: number; up: number };
  keys: number;
  /** Meters the aim moves for a pixel of the mouse, while it's captured. */
  mouse: number;
  /** The camera, from where you stand: back from the line, out to your right, up, and how wide it sees (degrees). */
  cam: { back: number; side: number; up: number; fov: number };
  /** Seconds from one throw to being ready for the next. */
  between: number;
}

const FEEL: Record<BarGame, Feel> = {
  darts: { meter: 1.05, sway: 0.01, swayRate: 1, reach: { u: 0.32, down: 0.4, up: 0.32 }, keys: 0.12, mouse: 0.0004, cam: { back: 0.5, side: 0.62, up: 1.6, fov: 24 }, between: 0.65 },
  axe: { meter: 1.3, sway: 0.035, swayRate: 0.8, reach: { u: 1.1, down: 1.2, up: 0.95 }, keys: 0.45, mouse: 0.0012, cam: { back: 1.9, side: 0.9, up: 2.35, fov: 36 }, between: 1.35 },
};
/** Let go with the meter under this and you didn't throw after all. */
const MIN_POWER = 0.04;

export type ThrowStage = 'aim' | 'wind' | 'throw' | 'wait';

export interface ThrowHooks {
  /** You stepped up to the line with a dart or an axe (or stepped back, null): everyone else sees it. */
  holding(game: BarGame | null): void;
  /** You let go of one: it leaves your hand at `from` (an axe turned `turn`, see world/bargames.ts AXE), for where `toss` says. */
  toss(toss: Toss, from: THREE.Vector3, turn: number): void;
  /** Where you're aiming on the target, while you are (null: not any more). */
  aim(game: BarGame | null, u: number, v: number): void;
  /** Stepped back from the line. */
  done(): void;
}

const want = new THREE.Vector3();
const look = new THREE.Vector3();
const lookAt = new THREE.Matrix4();
const turn = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const plane = new THREE.Plane();
const hit = new THREE.Vector3();

export class Thrower {
  private game: BarGame | null = null;
  private stage: ThrowStage = 'aim';
  /** Where you aim on the target (u right, v up, meters from its middle), before your hand wanders off it. */
  private aimU = 0;
  private aimV = 0;
  private swayT = 0;
  /** When you started drawing back (performance.now()), and when you can throw again. */
  private windAt = 0;
  private readyAt = 0;
  /** Throws so far this round (it starts again after the last). */
  private n = 0;
  /** How hard the last throw was, marked on the meter. */
  private lastPower = -1;
  /** How drunk you are, for how much your hand wanders (see booze.ts). */
  drunk = 0;
  private camPos = new THREE.Vector3();
  private camQuat = new THREE.Quaternion();
  private readonly panel: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly sweet: HTMLElement;
  private readonly mark: HTMLElement;
  private readonly infoEl: HTMLElement;
  private shown = '';
  /** What the panel's bottom line says: this round's throws so far (see setInfo). */
  private info = '';

  constructor(
    private readonly player: PlayerController,
    private readonly me: Person,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly canvas: HTMLElement,
    private readonly hooks: ThrowHooks,
  ) {
    this.titleEl = h('div.throw-title');
    this.fill = h('span.throw-fill');
    this.sweet = h('span.throw-sweet');
    this.mark = h('span.throw-last');
    this.infoEl = h('div.throw-info');
    this.panel = h('div.throw.panel.hidden', { id: 'throw', 'aria-label': 'Throwing' }, this.titleEl, h('div.throw-meter', {}, this.sweet, this.fill, this.mark), this.infoEl);
    $('hud').append(this.panel);
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    canvas.addEventListener('pointerdown', (e) => {
      // In first person, the click that captures the mouse isn't a throw.
      const capturing = e.pointerType === 'mouse' && player.canLock && !player.locked;
      if (this.game && e.button === 0 && !modalOpen() && !capturing) this.windUp();
    });
    window.addEventListener('pointerup', (e) => {
      if (this.game && e.button === 0) this.letGo();
    });
    window.addEventListener('pointermove', (e) => this.pointer(e));
    // Tabbed away while drawing back: the key never comes back up, so it's no throw.
    window.addEventListener('blur', () => this.stage === 'wind' && this.putBack());
  }

  get active(): boolean {
    return this.game !== null;
  }

  /** Which game you're throwing at, if you're at a line. */
  get playing(): BarGame | null {
    return this.game;
  }

  get doing(): ThrowStage | null {
    return this.game ? this.stage : null;
  }

  /** How wide the camera sees while you're at the line (degrees). */
  get fov(): number {
    return this.game ? FEEL[this.game].cam.fov : 55;
  }

  /** Which throw of the round is next (from 1). */
  get next(): number {
    return this.game ? (this.n % ROUND[this.game]) + 1 : 1;
  }

  /** How far the meter is up right now (0–1), while you draw back. */
  get power(): number {
    if (this.stage !== 'wind' || !this.game) return 0;
    return meterAt((performance.now() - this.windAt) / 1000, FEEL[this.game].meter);
  }

  /** Up to the line with a dart (or an axe) in hand, aiming at the middle. */
  start(game: BarGame): void {
    if (this.game) return;
    this.game = game;
    this.stage = 'aim';
    this.aimU = 0;
    this.aimV = game === 'darts' ? 0.103 : 0;
    this.n = 0;
    this.lastPower = -1;
    this.info = '';
    const p = this.player;
    p.rig = () => this.stand();
    p.mouseLook = false;
    this.stand();
    this.camPos.copy(this.camera.position);
    this.camQuat.copy(this.camera.quaternion);
    this.me.setThrowing(game);
    this.hooks.holding(game);
    this.panel.classList.remove('hidden');
    this.shown = '';
  }

  /** Back from the line, the dart (or axe) put down. */
  stop(): void {
    const game = this.game;
    if (!game) return;
    this.game = null;
    const p = this.player;
    p.rig = null;
    p.mouseLook = true;
    // Facing the target: in third person, the camera goes round behind you.
    p.camYaw = throwSpot(game).facing + Math.PI;
    p.lookPitch = -0.08;
    this.me.setThrowing(null);
    this.hooks.holding(null);
    this.hooks.aim(null, 0, 0);
    this.panel.classList.add('hidden');
    this.hooks.done();
  }

  /** The panel's bottom line: the round so far. */
  setInfo(text: string): void {
    this.info = text;
  }

  /** Every frame, once the player has moved: aiming, drawing back, and the camera. */
  update(dt: number): void {
    const game = this.game;
    if (!game) return;
    const f = FEEL[game];
    const p = this.player;
    if (this.stage === 'aim' || this.stage === 'wind') {
      const k = f.keys * dt;
      if (p.holding('KeyA', 'ArrowLeft')) this.aimU -= k;
      if (p.holding('KeyD', 'ArrowRight')) this.aimU += k;
      if (p.holding('KeyW', 'ArrowUp')) this.aimV += k;
      if (p.holding('KeyS', 'ArrowDown')) this.aimV -= k;
      this.clampAim();
    }
    if (this.stage === 'wait' && performance.now() >= this.readyAt) this.stage = 'aim';
    this.swayT += dt * f.swayRate;
    this.me.tossBack(this.stage === 'wind' ? this.power : 0);
    const [su, sv] = this.sway();
    this.hooks.aim(this.stage === 'aim' || this.stage === 'wind' ? game : null, this.aimU + su, this.aimV + sv);
    this.placeCamera(dt, game);
    this.render(game);
  }

  /** Where your hand has wandered off your aim, right now. */
  private sway(): [number, number] {
    const f = FEEL[this.game!];
    const t = this.swayT;
    const a = f.sway * (1 + 2.5 * Math.min(1.3, this.drunk));
    return [a * (Math.sin(t * 1.3) + 0.5 * Math.sin(t * 2.9 + 1)) * 0.67, a * (Math.cos(t * 1.1 + 2) + 0.5 * Math.sin(t * 2.3)) * 0.67];
  }

  private clampAim() {
    const r = FEEL[this.game!].reach;
    this.aimU = THREE.MathUtils.clamp(this.aimU, -r.u, r.u);
    this.aimV = THREE.MathUtils.clamp(this.aimV, -r.down, r.up);
  }

  /** At the line for the game, facing the target. */
  private stand() {
    const s = throwSpot(this.game!);
    const p = this.player;
    p.pos.set(s.x, 0, s.z);
    p.facing = s.facing;
    p.moving = false;
  }

  private key(e: KeyboardEvent, down: boolean) {
    if (!this.game || e.code !== 'Space') return;
    if (down && (e.repeat || isTyping(e) || modalOpen() || e.metaKey || e.ctrlKey || e.altKey)) return;
    if (down) this.windUp();
    else this.letGo();
  }

  private windUp() {
    if (this.stage !== 'aim' || performance.now() < this.readyAt) return;
    this.stage = 'wind';
    this.windAt = performance.now();
  }

  private letGo() {
    if (this.stage !== 'wind' || !this.game) return;
    const power = this.power;
    if (power < MIN_POWER) return this.putBack();
    const game = this.game;
    const [su, sv] = this.sway();
    this.n = (this.n % ROUND[game]) + 1;
    const out: Toss = { ...landing(game, this.aimU + su, this.aimV + sv, power, [Math.random() * 2 - 1, Math.random() * 2 - 1]), n: this.n };
    this.lastPower = power;
    this.stage = 'throw';
    this.me.toss((from, turn) => {
      if (this.game !== game) return;
      this.hooks.toss(out, from, turn);
      this.stage = 'wait';
      this.readyAt = performance.now() + FEEL[game].between * 1000;
    });
  }

  /** Drawn back and let go without throwing: back to aiming. */
  private putBack() {
    this.stage = 'aim';
    this.me.tossBack(0);
  }

  /** The mouse moves your aim: by how far it moved while it's captured, or to wherever it points on the target. */
  private pointer(e: PointerEvent) {
    if (!this.game || modalOpen() || this.stage === 'throw') return;
    const f = FEEL[this.game];
    if (this.player.locked) {
      this.aimU += THREE.MathUtils.clamp(e.movementX, -250, 250) * f.mouse;
      this.aimV -= THREE.MathUtils.clamp(e.movementY, -250, 250) * f.mouse;
    } else {
      if (e.target !== this.canvas) return;
      const r = this.canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      const t = targetFrame(this.game);
      plane.setFromNormalAndCoplanarPoint(look.set(t.out.x, 0, t.out.z), want.set(t.x, t.y, t.z));
      if (!ray.ray.intersectPlane(plane, hit)) return;
      this.aimU = (hit.x - t.x) * t.right.x + (hit.z - t.z) * t.right.z;
      this.aimV = hit.y - t.y;
    }
    this.clampAim();
  }

  /** Over your right shoulder, looking at the middle of the target. */
  private placeCamera(dt: number, game: BarGame) {
    const c = FEEL[game].cam;
    const s = throwSpot(game);
    const t = targetFrame(game);
    const fx = Math.sin(s.facing);
    const fz = Math.cos(s.facing);
    want.set(s.x - fx * c.back + t.right.x * c.side, c.up, s.z - fz * c.back + t.right.z * c.side);
    look.set(t.x, t.y, t.z);
    const k = 1 - Math.exp(-dt * 7);
    this.camPos.lerp(want, k);
    lookAt.lookAt(this.camPos, look, UP);
    turn.setFromRotationMatrix(lookAt);
    this.camQuat.slerp(turn, k);
    this.camera.position.copy(this.camPos);
    this.camera.quaternion.copy(this.camQuat);
  }

  /** The meter (its green where the throw goes true), which throw of the round is next, and the round so far. */
  private render(game: BarGame) {
    const g = GREEN[game];
    const power = this.stage === 'wind' ? this.power : 0;
    this.fill.style.width = `${power * 100}%`;
    this.mark.style.left = `${this.lastPower * 100}%`;
    this.mark.classList.toggle('hidden', this.lastPower < 0);
    this.sweet.style.left = `${(g.at - g.width / 2) * 100}%`;
    this.sweet.style.width = `${g.width * 100}%`;
    const next = this.stage === 'aim' || this.stage === 'wind' ? this.next : this.n;
    const title = game === 'darts' ? `🎯 Darts · dart ${next} of ${ROUND.darts}` : `🪓 Axe throwing · axe ${next} of ${ROUND.axe}`;
    const text = `${title}|${this.info}`;
    if (text === this.shown) return;
    this.shown = text;
    this.titleEl.textContent = title;
    this.infoEl.textContent = this.info || (game === 'darts' ? 'Aim with the mouse · hold Space and let go in the green' : 'Let go in the green to stick it');
  }
}
