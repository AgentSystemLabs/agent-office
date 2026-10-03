/**
 * A card of common actions on the left controller grip in VR: find, menu, boards, dictate, keyboard,
 * exit VR — so you don't need a physical keyboard for the usual office moves.
 */
import * as THREE from 'three';
import type { Hand } from './rays';
import { planeHit, type SurfaceHit, type XrSurface } from './surface';

const W = 512;
const H = 720;
const PAD = 16;
const GAP = 10;
const BTN_H = 56;
/** How wide the card is, in meters. */
const CARD_W = 0.14;

export type CardAction =
  | 'find'
  | 'menu'
  | 'next'
  | 'queue'
  | 'issues'
  | 'pulls'
  | 'hire'
  | 'chat'
  | 'emotes'
  | 'mute'
  | 'talk'
  | 'keyboard'
  | 'dictate'
  | 'settings'
  | 'help'
  | 'recenter'
  | 'exit'
  | 'collapse';

interface Btn {
  id: CardAction;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const ACTIONS: { id: CardAction; label: string }[] = [
  { id: 'find', label: '🔎 Find' },
  { id: 'menu', label: '☰ Menu' },
  { id: 'next', label: '⏭ Next waiting' },
  { id: 'queue', label: '📋 Queue' },
  { id: 'issues', label: '📌 Issues' },
  { id: 'pulls', label: '🔀 PRs' },
  { id: 'hire', label: '✨ Hire' },
  { id: 'chat', label: '💬 Chat' },
  { id: 'emotes', label: '😀 Emotes' },
  { id: 'mute', label: '🔇 Mute' },
  { id: 'talk', label: '🎙️ Talk' },
  { id: 'keyboard', label: '⌨ Keyboard' },
  { id: 'dictate', label: '🎤 Dictate' },
  { id: 'settings', label: '⚙️ Settings' },
  { id: 'help', label: '❓ Help' },
  { id: 'recenter', label: '照準 Recenter' },
  { id: 'exit', label: '🚪 Exit VR' },
];

export class PaletteCard implements XrSurface {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  onAction: ((id: CardAction) => void) | null = null;
  private readonly canvas = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private buttons: Btn[] = [];
  private hoverBtn = { left: -1, right: -1 };
  private collapsed = false;
  private shown = false;
  private flashed = -1;
  private flashUntil = 0;
  private drawn = '';

  constructor() {
    this.canvas.width = W;
    this.canvas.height = H;
    this.g = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false, fog: false, transparent: true, depthTest: false });
    mat.userData.outlineParameters = { visible: false };
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W, (CARD_W * H) / W), mat);
    this.mesh.name = 'xr-palette-card';
    this.mesh.renderOrder = 1001;
    this.mesh.visible = false;
    this.layout();
  }

  active() {
    return this.shown;
  }

  show() {
    this.shown = true;
    this.mesh.visible = true;
    this.drawn = '';
  }

  hide() {
    this.shown = false;
    this.mesh.visible = false;
    this.mesh.removeFromParent();
  }

  close() {
    this.hide();
  }

  hit(raycaster: THREE.Raycaster) {
    return planeHit(this.mesh, raycaster);
  }

  hover(hand: Hand, hit: SurfaceHit | null) {
    this.hoverBtn[hand] = hit ? btnAt(this.buttons, hit.u * W, hit.v * H) : -1;
  }

  press(_hand: Hand, hit: SurfaceHit, down: boolean): boolean {
    if (!down) return true;
    const i = btnAt(this.buttons, hit.u * W, hit.v * H);
    const b = this.buttons[i];
    if (!b) return true;
    this.flashed = i;
    this.flashUntil = performance.now() + 140;
    this.drawn = '';
    if (b.id === 'collapse') {
      this.collapsed = !this.collapsed;
      this.layout();
      this.resize();
      return true;
    }
    this.onAction?.(b.id);
    return true;
  }

  paint(now: number) {
    if (!this.shown) return;
    const flash = now < this.flashUntil ? this.flashed : -1;
    const key = `${this.collapsed}|${this.hoverBtn.left}|${this.hoverBtn.right}|${flash}`;
    if (key === this.drawn) return;
    this.drawn = key;
    const g = this.g;
    g.fillStyle = '#1b1d2b';
    g.beginPath();
    g.roundRect(0, 0, W, this.canvas.height, 24);
    g.fill();
    g.fillStyle = '#f2f2f7';
    g.font = '800 28px ui-sans-serif, system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.fillText(this.collapsed ? '☰' : 'Office', PAD, 28);
    this.buttons.forEach((b, i) => {
      const lit = i === flash;
      const pointed = i === this.hoverBtn.left || i === this.hoverBtn.right;
      g.fillStyle = lit ? '#ffd166' : pointed ? '#4a5078' : '#2d3047';
      g.beginPath();
      g.roundRect(b.x, b.y, b.w, b.h, 12);
      g.fill();
      g.fillStyle = lit ? '#2b2d42' : '#f2f2f7';
      g.font = '700 22px ui-sans-serif, system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1);
      g.textAlign = 'left';
    });
    this.texture.needsUpdate = true;
  }

  private layout() {
    const buttons: Btn[] = [];
    const list = this.collapsed ? [] : ACTIONS;
    let y = 52;
    for (const a of list) {
      buttons.push({ id: a.id, label: a.label, x: PAD, y, w: W - PAD * 2, h: BTN_H });
      y += BTN_H + GAP;
    }
    buttons.push({ id: 'collapse', label: this.collapsed ? '▴ Open' : '▾ Collapse', x: PAD, y, w: W - PAD * 2, h: BTN_H });
    this.buttons = buttons;
    const h = y + BTN_H + PAD;
    if (this.canvas.height !== h) {
      this.canvas.height = h;
      this.resize();
    }
  }

  private resize() {
    const h = this.canvas.height;
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.PlaneGeometry(CARD_W, (CARD_W * h) / W);
  }
}

function btnAt(buttons: Btn[], px: number, py: number): number {
  return buttons.findIndex((b) => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h);
}
