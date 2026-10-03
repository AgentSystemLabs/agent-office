/**
 * A worker's terminal floating in front of you in VR: its live screen (the frames its laptop shows)
 * on a canvas texture, and a row of keys under it you point a controller at, to answer the agent
 * (pick 1, Enter, Esc, Ctrl+C) without taking the headset off. ⌨ Type opens the virtual keyboard.
 */
import * as THREE from 'three';
import { isAsleep } from '../../../shared/status';
import { store } from '../../state';
import { STATUS_LABEL } from '../../ui/dom';
import { TERM_THEME } from '../../ui/termtheme';
import { paintScreen } from '../workers/laptop';
import type { Hand } from './rays';
import { planeHit, type SurfaceHit, type XrSurface } from './surface';

const W = 2048;
const H = 1408;
const HEAD = 104;
const KEYS_TOP = 1236;
const PAD = 24;
const GAP = 16;
/** How wide the panel is, in meters. */
export const PANEL_WIDTH = 1.3;
/** How long a key you pressed stays lit (ms). */
const FLASH_MS = 160;

export type PanelAction = { input: string } | { type: true } | { close: true };

interface Button {
  label: string;
  act: PanelAction;
  x: number;
  y: number;
  w: number;
  h: number;
}

const KEYS: { label: string; act: PanelAction; wide?: true }[] = [
  { label: '1', act: { input: '1' } },
  { label: '2', act: { input: '2' } },
  { label: '3', act: { input: '3' } },
  { label: '↑', act: { input: '\x1b[A' } },
  { label: '↓', act: { input: '\x1b[B' } },
  { label: '⏎', act: { input: '\r' } },
  { label: '⇥', act: { input: '\t' } },
  { label: 'Esc', act: { input: '\x1b' } },
  { label: '^C', act: { input: '\x03' } },
  { label: '⌨ Type…', act: { type: true }, wide: true },
];

/** The keys along the bottom, then ✕ in the header, in canvas pixels. */
const BUTTONS: Button[] = (() => {
  const small = 150;
  const keyH = H - KEYS_TOP - PAD;
  const narrow = KEYS.filter((k) => !k.wide).length;
  const wide = W - PAD * 2 - narrow * small - (KEYS.length - 1) * GAP;
  let x = PAD;
  const out: Button[] = KEYS.map((k) => {
    const w = k.wide ? wide : small;
    const b = { label: k.label, act: k.act, x, y: KEYS_TOP, w, h: keyH };
    x += w + GAP;
    return b;
  });
  out.push({ label: '✕', act: { close: true }, x: W - PAD - 96, y: 12, w: 96, h: HEAD - 24 });
  return out;
})();

export class TermPanel implements XrSurface {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  /** Whose terminal is up, or null when the panel's away. */
  workerId: string | null = null;
  /** What a button press does (send input, open the keyboard, close). */
  onAction: ((act: PanelAction) => void) | null = null;
  private readonly canvas = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  /** The buttons each hand is pointing at (index into BUTTONS), -1 for none. */
  private readonly hoverBtn = { left: -1, right: -1 };
  private flashed = -1;
  private flashUntil = 0;
  /** What was last painted, so an unchanged frame isn't painted again. */
  private drawn = '';

  constructor() {
    this.canvas.width = W;
    this.canvas.height = H;
    this.g = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false, fog: false, transparent: true, depthTest: false });
    mat.userData.outlineParameters = { visible: false };
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_WIDTH, (PANEL_WIDTH * H) / W), mat);
    this.mesh.name = 'xr-terminal';
    // Over everything: a wall you stand close to shouldn't hide it.
    this.mesh.renderOrder = 999;
    this.mesh.visible = false;
  }

  active() {
    return !!this.workerId;
  }

  open(workerId: string) {
    this.workerId = workerId;
    this.drawn = '';
    this.mesh.visible = true;
  }

  close() {
    this.workerId = null;
    this.hoverBtn.left = this.hoverBtn.right = -1;
    this.mesh.visible = false;
    this.mesh.removeFromParent();
  }

  hit(raycaster: THREE.Raycaster): SurfaceHit | null {
    return planeHit(this.mesh, raycaster);
  }

  hover(hand: Hand, hit: SurfaceHit | null) {
    this.hoverBtn[hand] = hit ? buttonAt(hit.u * W, hit.v * H) : -1;
  }

  press(_hand: Hand, hit: SurfaceHit, down: boolean): boolean {
    if (!down) return true;
    const i = buttonAt(hit.u * W, hit.v * H);
    const act = this.pressButton(i, performance.now());
    if (act) this.onAction?.(act);
    return true;
  }

  /** What pressing `button` does, lighting it up for a moment; null for none, or a key while the worker sleeps. */
  pressButton(button: number, now: number): PanelAction | null {
    const b = BUTTONS[button];
    const w = this.workerId ? store.workers.get(this.workerId) : undefined;
    if (!b || !w) return null;
    if ('input' in b.act && isAsleep(w.status)) return null;
    this.flashed = button;
    this.flashUntil = now + FLASH_MS;
    return b.act;
  }

  paint(now: number) {
    const id = this.workerId;
    if (!id) return;
    const w = store.workers.get(id);
    const screen = store.screens.get(id);
    const flash = now < this.flashUntil ? this.flashed : -1;
    const key = `${id}|${screen?.version ?? -1}|${w?.status}|${w?.name}|${this.hoverBtn.left}|${this.hoverBtn.right}|${flash}`;
    if (key === this.drawn) return;
    this.drawn = key;
    const g = this.g;
    const asleep = !w || isAsleep(w.status);

    g.fillStyle = '#1b1d2b';
    g.beginPath();
    g.roundRect(0, 0, W, H, 36);
    g.fill();

    g.textBaseline = 'middle';
    g.fillStyle = w?.color ?? '#888';
    g.beginPath();
    g.arc(PAD + 26, HEAD / 2, 22, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f2f2f7';
    g.font = '700 52px ui-sans-serif, system-ui, sans-serif';
    g.fillText(w?.name ?? 'Gone', PAD + 70, HEAD / 2);
    g.fillStyle = '#a6adc8';
    g.font = '600 40px ui-sans-serif, system-ui, sans-serif';
    g.fillText(w ? (STATUS_LABEL[w.status] ?? w.status) : '', PAD + 90 + g.measureText(w?.name ?? 'Gone').width * 1.3, HEAD / 2);

    g.save();
    g.translate(0, HEAD);
    paintScreen(g, W, KEYS_TOP - HEAD - GAP, screen, asleep ? 'asleep: wake it at its desk' : 'connecting…');
    g.restore();

    BUTTONS.forEach((b, i) => {
      const lit = i === flash;
      const pointed = i === this.hoverBtn.left || i === this.hoverBtn.right;
      const off = asleep && 'input' in b.act;
      g.fillStyle = lit ? '#ffd166' : pointed ? '#4a5078' : '#2d3047';
      g.beginPath();
      g.roundRect(b.x, b.y, b.w, b.h, 22);
      g.fill();
      if (pointed && !lit) {
        g.strokeStyle = '#ffd166';
        g.lineWidth = 6;
        g.stroke();
      }
      g.fillStyle = off ? '#6c7086' : lit ? '#2b2d42' : TERM_THEME.foreground;
      g.font = `700 ${b.h > 80 ? 64 : 48}px ui-sans-serif, system-ui, sans-serif`;
      g.textAlign = 'center';
      g.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 2);
      g.textAlign = 'left';
    });
    this.texture.needsUpdate = true;
  }
}

function buttonAt(px: number, py: number): number {
  return BUTTONS.findIndex((b) => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h);
}
