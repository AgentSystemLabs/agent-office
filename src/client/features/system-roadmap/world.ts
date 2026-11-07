import * as THREE from 'three';
import { ROADMAP_BOARD } from '../../../shared/layout';
import { mesh, toon } from '../../world/toon';
import type { Interactable } from '../../world/types';
import { wallBoard } from '../../world/office/props';
import type { Fixture } from '../../world/office/fixture';

// A dedicated roadmap display; the System Agent stands at its registered kiosk (see STATIONS).
export const ROADMAP_FOLDER = 'docs/roadmap';

export const systemRoadmap: Fixture = () => {
  const { x, y, z, width, height, rotY } = ROADMAP_BOARD;
  const { group: board, face } = wallBoard(width, height, '#aab4be');
  board.position.set(x, y, z);
  board.rotation.y = rotY;
  const group = new THREE.Group();
  group.add(board);

  // Put the display on its own rolling stand beside the elevator, facing the elevator entry.
  const standColor = toon('#aab4be');
  const postHeight = y + height / 2 + 0.12;
  for (const side of [-1, 1]) {
    const px = x + side * (width / 2 + 0.1);
    group.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, postHeight, 10), standColor, px, postHeight / 2, z));
    group.add(mesh(new THREE.BoxGeometry(0.12, 0.07, 0.95), standColor, px, 0.12, z));
    for (const dz of [-0.38, 0.38]) group.add(mesh(new THREE.SphereGeometry(0.055, 10, 8), standColor, px, 0.055, z + dz, false));
  }
  group.add(mesh(new THREE.BoxGeometry(width + 0.2, 0.06, 0.1), standColor, x, 0.22, z));

  const canvas = document.createElement('canvas');
  canvas.width = 1040;
  canvas.height = 600;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#fffdf8';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#2b2d42';
  g.font = '900 58px Nunito, system-ui, sans-serif';
  g.fillText('SYSTEM ROADMAP', 48, 84);
  g.fillStyle = '#6c757d';
  g.font = '700 30px Nunito, system-ui, sans-serif';
  g.fillText('Project flow and architecture', 50, 132);
  const nodes = [
    { x: 56, title: 'USER', detail: 'goals & needs', color: '#e9c46a' },
    { x: 310, title: 'PRODUCT', detail: 'scope & priorities', color: '#f4a261' },
    { x: 564, title: 'SYSTEM', detail: 'services & data', color: '#8ecae6' },
    { x: 818, title: 'DELIVERY', detail: 'work & release', color: '#95d5b2' },
  ];
  for (const [i, n] of nodes.entries()) {
    const bx = n.x;
    g.fillStyle = n.color;
    g.beginPath();
    g.roundRect(bx, 210, 166, 138, 18);
    g.fill();
    g.fillStyle = '#2b2d42';
    g.font = '900 28px Nunito, system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(n.title, bx + 83, 267);
    g.font = '700 18px Nunito, system-ui, sans-serif';
    g.fillText(n.detail, bx + 83, 307);
    if (i < nodes.length - 1) {
      g.strokeStyle = '#6c757d';
      g.lineWidth = 8;
      g.beginPath();
      g.moveTo(bx + 174, 279);
      g.lineTo(bx + 240, 279);
      g.stroke();
      g.fillStyle = '#6c757d';
      g.beginPath();
      g.moveTo(bx + 240, 279);
      g.lineTo(bx + 222, 265);
      g.lineTo(bx + 222, 293);
      g.fill();
    }
  }
  g.textAlign = 'left';
  g.fillStyle = '#2b2d42';
  g.font = '800 32px Nunito, system-ui, sans-serif';
  g.fillText('Press E to read docs/roadmap', 50, 460);
  g.fillStyle = '#6c757d';
  g.font = '600 25px Nunito, system-ui, sans-serif';
  g.fillText('The project team maintains these Markdown documents.', 50, 510);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  face.material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });

  const boardUse: Interactable = { kind: 'systemroadmap', x: x + Math.sin(rotY) * 1.65, z: z + Math.cos(rotY) * 1.65, radius: 2.5 };
  board.userData.interact = boardUse;

  return {
    group,
    colliders: [{ minX: x - width / 2 - 0.18, maxX: x + width / 2 + 0.18, minZ: z - 0.5, maxZ: z + 0.5, top: postHeight }],
    interactables: [boardUse],
  };
};
