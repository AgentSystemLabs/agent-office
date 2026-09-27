import * as THREE from 'three';
import type { CarriedIssue } from '../../shared/protocol';
import { NOTE_COLORS, PINS, wrap } from './boards';
import { toon, toonUnique } from './toon';

const W = 320;
const H = 240;
const FONT = 'Nunito, ui-rounded, system-ui, sans-serif';

/**
 * An issue's sticky note, taken off the issues board: a thin card in the note's color, with the pin,
 * the number and the title on its front (+z) and plain paper behind. `width` is in meters.
 */
function issueCard(card: CarriedIssue, width: number): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const color = NOTE_COLORS[card.issue % NOTE_COLORS.length];
  g.fillStyle = color;
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#2b2d42';
  g.font = `900 52px ${FONT}`;
  g.fillText(`#${card.issue}`, 22, 84);
  g.font = `700 28px ${FONT}`;
  wrap(g, card.title, W - 44, 4).forEach((line, i) => g.fillText(line, 22, 128 + i * 30));
  g.beginPath();
  g.arc(W / 2, 20, 12, 0, Math.PI * 2);
  g.fillStyle = PINS[card.issue % PINS.length];
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = '#2b2d42';
  g.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const face = toonUnique('#ffffff');
  face.map = tex;
  const paper = toon(color);
  // Box faces go +x, -x, +y, -y, +z, -z: the note is on the front.
  const m = new THREE.Mesh(new THREE.BoxGeometry(width, (width * H) / W, width * 0.02), [paper, paper, paper, paper, face, paper]);
  m.castShadow = true;
  return m;
}

/** The issue card someone holds, under `parent`: swapped for another card, or dropped (null). */
export class HeldCard {
  private mesh: THREE.Mesh | null = null;
  private issue = 0;

  constructor(
    private parent: THREE.Object3D,
    private width: number,
  ) {}

  get held(): boolean {
    return this.mesh !== null;
  }

  set(card: CarriedIssue | null | undefined) {
    if ((card?.issue ?? 0) === this.issue) return;
    if (this.mesh) {
      this.parent.remove(this.mesh);
      this.mesh.geometry.dispose();
      const face = (this.mesh.material as THREE.MeshToonMaterial[])[4];
      face.map?.dispose();
      face.dispose();
      this.mesh = null;
    }
    this.issue = card?.issue ?? 0;
    if (!card) return;
    this.mesh = issueCard(card, this.width);
    this.parent.add(this.mesh);
  }
}
