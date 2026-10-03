import test from 'node:test';
import assert from 'node:assert/strict';
import { whereabouts } from '../src/client/ui/whereabouts.js';
import { CAFE_TABLES, ROOF_TABLES } from '../src/shared/layout.js';
import type { PeerInfo } from '../src/shared/protocol.js';
import { ROOF } from '../src/shared/rooftop.js';

function peer(x: number, z: number, floor?: string, y = 0): PeerInfo {
  return { id: 'p', name: 'P', color: '#fff', look: { skin: 0, hair: 0, style: 0 }, x, y, z, rotY: 0, moving: false, voice: false, muted: false, sharing: false, floor };
}

test("the roof's corner over the meeting room is a tall table, not the meeting room", () => {
  const t = ROOF_TABLES.find((t) => t.x > 9 && t.z > 8)!;
  assert.equal(whereabouts(peer(t.x + 0.7, t.z, 'agent-office')), '🤝 in the meeting room');
  assert.equal(whereabouts(peer(t.x + 0.7, t.z, ROOF)), '🕯️ at a tall table');
});

test('up on the roof, the café counter and its tables have their own words, and the rest none', () => {
  assert.equal(whereabouts(peer(CAFE_TABLES[0].x, CAFE_TABLES[0].z, ROOF)), '☕ at a café table');
  assert.equal(whereabouts(peer(11.5, 0, ROOF)), '☕ at the café counter');
  assert.equal(whereabouts(peer(0, 3, ROOF)), undefined);
  assert.equal(whereabouts({ ...peer(12, 0, ROOF), seat: 'roof-stool-3:0' }), '🪑 on the bar stool');
});

test('someone on the 2D view is on the 2D view, unless they have something open', () => {
  assert.equal(whereabouts({ ...peer(0, 0, 'agent-office'), lite: true }), '📱 on the 2D view');
  assert.equal(whereabouts({ ...peer(0, 0, 'agent-office'), lite: true, doing: "💻 in Pixel's terminal" }), "💻 in Pixel's terminal");
});
