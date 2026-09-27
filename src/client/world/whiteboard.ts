import * as THREE from 'three';
import { WHITEBOARD } from '../../shared/layout';
import { mesh, roundedBox, textPlane, toon } from './toon';
import type { Collider, Interactable } from './office';

// The whiteboard: a rolling whiteboard on casters out on the open floor, with a marker tray. Its
// face shows whatever everyone has drawn on it (see ui/whiteboard.ts), live.

const ALU = '#aab4be';
const INK = '#2b2d42';
/** The face's canvas, in pixels per meter. */
const PX = 512;
/** Clear space around a drawing on the face, in pixels. */
const PAD = 40;
const FONT = 'Nunito, ui-rounded, system-ui, sans-serif';

export interface WhiteboardStand {
  group: THREE.Group;
  colliders: Collider[];
  /** Walk up and press E. */
  interactable: Interactable;
  /** Puts a drawing on the face (scaled to fit), or the "come and draw" note when there's none. */
  show(drawing: HTMLCanvasElement | null): void;
  /** How big a drawing fills the face, in pixels. */
  fit: { width: number; height: number };
}

export function buildWhiteboard(): WhiteboardStand {
  const { x, z, width, height, bottom } = WHITEBOARD;
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const alu = toon(ALU);
  const ink = toon(INK);
  const mid = bottom + height / 2;
  const post = width / 2 + 0.1;

  // The writing surface in its aluminium frame; the back is a plain grey panel.
  const frame = mesh(roundedBox(width + 0.14, 0.07, height + 0.14, 0.04), alu, 0, mid, 0);
  frame.rotation.x = Math.PI / 2;
  group.add(frame);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * PX);
  canvas.height = Math.round(height * PX);
  const g = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  face.position.set(0, mid, 0.04);
  group.add(face);

  // Two posts on feet with a caster at each end, and a bar across the bottom.
  for (const sx of [-post, post]) {
    group.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, bottom + height + 0.2, 10), alu, sx, (bottom + height + 0.2) / 2 + 0.1, 0));
    group.add(mesh(roundedBox(0.09, 0.07, 0.95, 0.03), alu, sx, 0.13, 0));
    for (const sz of [-0.42, 0.42]) {
      const wheel = mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 12), ink, sx, 0.055, sz, false);
      wheel.rotation.z = Math.PI / 2;
      group.add(wheel);
    }
    group.add(mesh(new THREE.SphereGeometry(0.05, 10, 8), alu, sx, bottom + height + 0.3, 0, false));
  }
  group.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, post * 2, 8).rotateZ(Math.PI / 2), alu, 0, 0.3, 0, false));

  // The marker tray, with markers and an eraser in it.
  const trayY = bottom - 0.1;
  group.add(mesh(roundedBox(width * 0.55, 0.04, 0.14, 0.02), alu, 0, trayY, 0.09));
  group.add(mesh(new THREE.BoxGeometry(width * 0.55, 0.05, 0.015), alu, 0, trayY + 0.03, 0.155, false));
  ['#2b2d42', '#ef476f', '#118ab2', '#06d6a0'].forEach((color, i) => {
    const marker = new THREE.Group();
    marker.add(mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.13, 8), toon('#f8f9fa'), 0, 0, 0, false));
    marker.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.045, 8), toon(color), 0, 0.085, 0, false));
    marker.rotation.z = Math.PI / 2 + (i % 2 ? 0.08 : -0.06);
    marker.position.set(-0.55 + i * 0.2, trayY + 0.04, 0.1);
    group.add(marker);
  });
  group.add(mesh(roundedBox(0.2, 0.06, 0.08, 0.02), toon('#ffd166'), 0.62, trayY + 0.05, 0.09, false));
  const eraserFelt = mesh(new THREE.BoxGeometry(0.19, 0.015, 0.075), toon('#6c757d'), 0.62, trayY + 0.015, 0.09, false);
  group.add(eraserFelt);

  const plaque = textPlane('📝 Whiteboard', { bg: '#fffaf3', size: 48 });
  plaque.scale.multiplyScalar(0.55);
  plaque.position.set(0, bottom + height + 0.2, 0.05);
  group.add(plaque);

  const colliders: Collider[] = [{ minX: x - post - 0.1, maxX: x + post + 0.1, minZ: z - 0.48, maxZ: z + 0.48, top: bottom + height + 0.35 }];
  const interactable: Interactable = { kind: 'whiteboard', x, z: z + 1.7, radius: 2.3 };
  group.userData.interact = interactable;

  const show = (drawing: HTMLCanvasElement | null) => {
    const W = canvas.width;
    const H = canvas.height;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, W, H);
    // A faint shine across the top corner, so it reads as a glossy board from across the room.
    const shine = g.createLinearGradient(0, 0, W * 0.5, H * 0.6);
    shine.addColorStop(0, 'rgba(210, 225, 240, 0.55)');
    shine.addColorStop(1, 'rgba(210, 225, 240, 0)');
    g.fillStyle = shine;
    g.fillRect(0, 0, W, H);
    if (drawing) {
      const s = Math.min((W - PAD * 2) / drawing.width, (H - PAD * 2) / drawing.height);
      const w = drawing.width * s;
      const h = drawing.height * s;
      g.drawImage(drawing, (W - w) / 2, (H - h) / 2, w, h);
    } else {
      g.fillStyle = '#b8c0c8';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `900 120px ${FONT}`;
      g.fillText('Draw together ✏️', W / 2, H / 2 - 70);
      g.font = `700 64px ${FONT}`;
      g.fillText('Walk up and press E — everyone on this floor sees it live', W / 2, H / 2 + 70);
    }
    texture.needsUpdate = true;
  };
  show(null);

  return { group, colliders, interactable, show, fit: { width: canvas.width - PAD * 2, height: canvas.height - PAD * 2 } };
}
