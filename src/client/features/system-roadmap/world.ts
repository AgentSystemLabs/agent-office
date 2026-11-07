import * as THREE from 'three';
import { FLOOR, ROADMAP_BOARD } from '../../../shared/layout';
import { Person } from '../../world/character';
import { textPlane } from '../../world/toon';
import type { Interactable } from '../../world/types';
import { wallBoard } from '../../world/office/props';
import type { Fixture } from '../../world/office/fixture';

// A dedicated roadmap station: a readable project sign beside a small guide character.
export const ROADMAP_FOLDER = 'docs/roadmap';

export const systemRoadmap: Fixture = () => {
  const { x, y, z, width, height, rotY } = ROADMAP_BOARD;
  const { group: board, face } = wallBoard(width, height, '#aab4be');
  board.position.set(x, y, z + 0.08);
  board.rotation.y = rotY;

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

  const boardUse: Interactable = { kind: 'systemroadmap', x, z: z + 1.65, radius: 2.5 };
  board.userData.interact = boardUse;

  const agent = new Person('System Agent', '#7654a8', { skin: 2, hair: 9, style: 2 });
  agent.setDoing('Ask me about the roadmap');
  agent.root.position.set(FLOOR.maxX - 2.2, 0, FLOOR.minZ + 3.4);
  agent.root.rotation.y = 0;
  const agentUse: Interactable = { kind: 'systemagent', x: agent.root.position.x, z: agent.root.position.z + 0.1, radius: 1.8 };
  agent.root.userData.interact = agentUse;

  const plaque = textPlane('🗺️ System Roadmap', { bg: '#fffaf3', size: 56 });
  plaque.scale.multiplyScalar(0.9);
  plaque.position.set(x, y + height / 2 + 0.45, z + 0.03);
  plaque.rotation.y = rotY;

  return {
    group: new THREE.Group().add(board, agent.root, plaque),
    interactables: [boardUse, agentUse],
  };
};
