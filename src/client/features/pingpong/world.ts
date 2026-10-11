import * as THREE from 'three';
import { mesh, roundedBox, textPlane, toon } from '../../world/toon';
import type { Collider, Interactable } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';

// A compact three-table court in the open lounge zone. The tables use regulation proportions, keep
// their own placements here, and already expose individual use targets for the playable game later.

const TABLE = { width: 1.525, length: 2.74, height: 0.76 } as const;
const PINK = '#ef5da8';
const INK = '#2b2d42';

export const PING_PONG_TABLES = [-6, 0, 6].map((z, index) => ({ x: 10.8, z, label: `Table ${index + 1}` }));

function pingPongTable({ x, z, label }: (typeof PING_PONG_TABLES)[number]) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const top = mesh(roundedBox(TABLE.width, 0.07, TABLE.length, 0.08), toon(PINK), 0, TABLE.height - 0.035, 0);
  group.add(top);

  // Crisp court lines: a center line beneath the net and a rim around the playing surface.
  const line = toon('#fffaf3');
  group.add(mesh(new THREE.BoxGeometry(TABLE.width - 0.12, 0.012, 0.025), line, 0, TABLE.height + 0.007, 0, false));
  for (const [sx, sz, w, d] of [
    [0, -1, TABLE.width - 0.08, 0.035],
    [0, 1, TABLE.width - 0.08, 0.035],
    [-1, 0, 0.035, TABLE.length - 0.08],
    [1, 0, 0.035, TABLE.length - 0.08],
  ] as const) {
    group.add(mesh(new THREE.BoxGeometry(w, 0.012, d), line, sx * (TABLE.width / 2 - 0.04), TABLE.height + 0.007, sz * (TABLE.length / 2 - 0.04), false));
  }

  // The net is deliberately separate from the tabletop, ready for ball collision and scoring rules.
  const net = mesh(new THREE.BoxGeometry(TABLE.width + 0.05, 0.16, 0.018), toon('#fffaf3'), 0, TABLE.height + 0.08, 0);
  group.add(net);
  for (const sx of [-1, 1]) group.add(mesh(new THREE.BoxGeometry(0.04, 0.22, 0.06), toon(INK), sx * (TABLE.width / 2 + 0.02), TABLE.height + 0.04, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) group.add(mesh(new THREE.BoxGeometry(0.055, TABLE.height - 0.07, 0.055), toon(INK), sx * (TABLE.width / 2 - 0.17), (TABLE.height - 0.07) / 2, sz * (TABLE.length / 2 - 0.2)));

  const plaque = textPlane(`🏓 ${label}`, { bg: '#fffaf3', color: PINK, size: 42, border: PINK });
  plaque.scale.multiplyScalar(0.4);
  plaque.position.set(0, 0.38, TABLE.length / 2 + 0.12);
  plaque.rotation.y = Math.PI;
  group.add(plaque);
  const collider: Collider = { minX: x - TABLE.width / 2, maxX: x + TABLE.width / 2, minZ: z - TABLE.length / 2, maxZ: z + TABLE.length / 2, top: TABLE.height };
  const interactable: Interactable = { kind: 'pingpong', x: x - 1.25, z, radius: 1.5 };
  group.userData.interact = interactable;
  return { group, collider, interactable };
}

declare module '../../world/types' {
  interface OfficeHandles {
    /** The three-table pink ping-pong court, ready for its future playable rules. */
    pingPongTables: readonly THREE.Group[];
  }
}

/** Three presentation-ready pink ping-pong tables in the recovered lounge court. */
export const pingPong: Fixture<'pingPongTables'> = () => {
  const tables = PING_PONG_TABLES.map(pingPongTable);
  const group = new THREE.Group();
  for (const table of tables) group.add(table.group);
  return { group, colliders: tables.map((table) => table.collider), interactables: tables.map((table) => table.interactable), handle: { pingPongTables: tables.map((table) => table.group) } };
};
