import * as THREE from 'three';
import type { GhIssue, GhPull, GhState } from '../../shared/protocol';

const NOTE_COLORS = ['#fff7b0', '#ffd6e0', '#caffbf', '#bde0fe', '#ffe5b4'];
const PINS = ['#ef476f', '#118ab2', '#06d6a0', '#ffd166'];

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width > maxW && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines) break;
    } else cur = next;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,2}$/, '…');
  return lines;
}

/** Renders a cork board with pinned sticky notes onto a canvas texture. */
export class BoardTexture {
  readonly texture: THREE.CanvasTexture;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;

  constructor(private kind: 'issues' | 'pulls') {
    this.canvas.width = 1200;
    this.canvas.height = 600;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
  }

  render(state: GhState<GhIssue> | GhState<GhPull>) {
    const g = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.fillStyle = '#d8a86a';
    g.fillRect(0, 0, W, H);
    // cork speckles
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = rnd() > 0.5 ? 'rgba(120,70,30,.18)' : 'rgba(255,240,210,.18)';
      g.fillRect(rnd() * W, rnd() * H, 3, 3);
    }
    const open = (state.items as (GhIssue | GhPull)[]).filter((i) => i.state === 'OPEN');
    if (!open.length) {
      const note = state.error ? '⚠️ gh unavailable' : state.loading && !state.fetchedAt ? 'Loading…' : this.kind === 'issues' ? 'No open issues 🎉' : 'No open PRs';
      g.fillStyle = '#fffaf3';
      g.fillRect(W / 2 - 280, H / 2 - 70, 560, 140);
      g.fillStyle = '#2b2d42';
      g.font = '800 44px Nunito, ui-rounded, system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(note, W / 2, H / 2);
      g.textAlign = 'left';
      this.texture.needsUpdate = true;
      return;
    }
    const cols = 5;
    const rows = 3;
    const nw = 208;
    const nh = 164;
    const gx = (W - cols * nw) / (cols + 1);
    const gy = (H - rows * nh) / (rows + 1);
    open.slice(0, cols * rows).forEach((it, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const x = gx + c * (nw + gx);
      const y = gy + r * (nh + gy);
      g.save();
      g.translate(x + nw / 2, y + nh / 2);
      g.rotate(((it.number * 37) % 7 - 3) * 0.012);
      g.fillStyle = 'rgba(0,0,0,.25)';
      g.fillRect(-nw / 2 + 5, -nh / 2 + 7, nw, nh);
      const draft = this.kind === 'pulls' && (it as GhPull).isDraft;
      g.fillStyle = draft ? '#e9ecef' : NOTE_COLORS[it.number % NOTE_COLORS.length];
      g.fillRect(-nw / 2, -nh / 2, nw, nh);
      g.fillStyle = '#2b2d42';
      g.font = '900 30px Nunito, ui-rounded, system-ui, sans-serif';
      g.fillText(`#${it.number}`, -nw / 2 + 14, -nh / 2 + 44);
      g.font = '700 22px Nunito, ui-rounded, system-ui, sans-serif';
      wrap(g, it.title, nw - 28, 4).forEach((line, li) => g.fillText(line, -nw / 2 + 14, -nh / 2 + 76 + li * 24));
      g.beginPath();
      g.arc(0, -nh / 2 + 10, 11, 0, Math.PI * 2);
      g.fillStyle = PINS[i % PINS.length];
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = '#2b2d42';
      g.stroke();
      g.restore();
    });
    if (open.length > cols * rows) {
      g.fillStyle = '#2b2d42';
      g.font = '800 26px Nunito, ui-rounded, system-ui, sans-serif';
      g.textAlign = 'right';
      g.fillText(`+${open.length - cols * rows} more`, W - 20, H - 16);
      g.textAlign = 'left';
    }
    this.texture.needsUpdate = true;
  }
}
