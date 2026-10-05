import test from 'node:test';
import assert from 'node:assert/strict';
import { helperDesk, helperHost, helperId, helperSpot, isHelperId, plainText } from '../src/shared/helper.js';
import { DESK_BY_ID } from '../src/shared/layout.js';
import { nearestWalkable, route, walkable, type Pt } from '../src/shared/nav.js';

const host = DESK_BY_ID.get('desk-1')!;

test('a helper is addressed by the desk it is helping at', () => {
  assert.equal(helperId('desk-3'), 'helper:desk-3');
  assert.equal(helperHost('helper:desk-3'), 'desk-3');
  assert.equal(isHelperId('helper:desk-3'), true);
  // An ordinary seat is not a helper's id, and asking gives nothing rather than a wrong desk.
  assert.equal(isHelperId('desk-3'), false);
  assert.equal(helperHost('desk-3'), undefined);
});

test('a helper stands beside its host’s desk, on a spot it can stand on', () => {
  const spot = helperSpot(host);
  assert.ok(walkable(spot.at[0], spot.at[1]), 'the standing spot should be walkable');
  // Out of the chair, or it would be sitting in the host's place.
  const chair = [host.x + Math.cos(host.rotY) * 0, host.z - Math.sin(host.rotY) * 0];
  assert.notDeepEqual(spot.at, chair);
});

test('a helper’s desk is its host’s moved beside it, with no chair of its own', () => {
  const desk = helperDesk(host, '🆘 helping Widget');
  assert.equal(desk.id, 'helper:desk-1');
  assert.equal(desk.label, '🆘 helping Widget');
  // Standing where the helper stands, not at the seat the host occupies.
  assert.deepEqual([desk.x, desk.z], helperSpot(host).at);
  // Not one of the floor's own desks, so nothing builds it and nothing sits anyone in it.
  assert.equal(desk.wing, undefined);
  // A helper cannot be helped itself, so nothing treats its id as a real seat to fill.
  assert.equal(DESK_BY_ID.has(helperId(host.id)), false);
});

test('a helper’s id is not a seat, so nothing else can be seated there', () => {
  // A helper is placed by the Floor, from its host's desk, rather than looked up in the room's own
  // seats. That is what stops a meeting or a board agent from ever being seated at a helper's spot.
  assert.equal(DESK_BY_ID.has(helperId(host.id)), false);
  // Nor is a helper ever seated at a board agent's kiosk or a meeting chair, for the same reason.
  assert.equal(DESK_BY_ID.has(helperId('station-issues')), false);
  assert.equal(DESK_BY_ID.has(helperId('meeting-0')), false);
});

test('a helper can actually be walked to every desk on the floor', () => {
  // The walk is the office's (see server/helpers.ts), worked out with the same A* the dog uses, so
  // every browser flies the model along the same points. It has to work from the doors to every desk,
  // or a helper would stop in the furniture on the way.
  const doors: Pt = [0, 0];
  const from = walkable(doors[0], doors[1]) ? doors : nearestWalkable(doors);
  const stuck: string[] = [];
  for (const [id, desk] of DESK_BY_ID) {
    if (desk.station || desk.room) continue;
    const spot = helperSpot(desk);
    const at = walkable(spot.at[0], spot.at[1]) ? spot.at : nearestWalkable(spot.at);
    const path = route(from, at);
    if (path.length < 2) {
      stuck.push(`${id}: no route`);
      continue;
    }
    // It has to arrive where the office said it would, not merely somewhere on the floor.
    const end = path[path.length - 1];
    if (end[0] !== at[0] || end[1] !== at[1]) stuck.push(`${id}: ends at ${end}, not ${at}`);
    // And every step of it has to be somewhere a body can stand.
    for (const p of path) if (!walkable(p[0], p[1])) stuck.push(`${id}: passes through unwalkable ${p}`);
  }
  assert.deepEqual(stuck, [], `a helper could not be walked to: ${stuck.join('; ')}`);
});

test('what a helper said comes out as plain text a prompt can carry', () => {
  // Escape sequences, carriage returns and trailing space would all end up in the worker's prompt.
  const raw = '[32mIt fails here[0m\r\n\r\n\r\n   \r\nbecause of the token check   ';
  const out = plainText(raw);
  assert.equal(out.includes(''), false);
  assert.equal(out.includes('\r'), false);
  assert.ok(out.startsWith('It fails here'));
  assert.ok(out.includes('because of the token check'));
  assert.ok(!/\n{3,}/.test(out), 'runs of blank lines are collapsed');
  assert.ok(!/[ \t]$/m.test(out), 'trailing space is trimmed');
  assert.equal(plainText(''), '');
});
