import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BEANBAGS, DESK_BY_ID, MAINTENANCE, MAINTENANCE_LAPTOP, MAINTENANCE_MODEL, STATIONS, STATION_AGENT, WINDOWS, deskSeat } from '../src/shared/layout.js';
import { route, walkable } from '../src/shared/nav.js';
import { stationBrief } from '../src/server/stations.js';
import { PROMPTS } from '../src/shared/prompts.js';
import { LAPTOP_BRIEF, askLaptop, laptopArgs, laptopModel, officeSourceDir } from '../src/server/maintenance.js';

const inCloset = (x: number, z: number) => x > MAINTENANCE.minX && x < MAINTENANCE.maxX && z > MAINTENANCE.minZ && z < MAINTENANCE.maxZ;

test("the maintenance closet is where the west wall's third window was, and nothing else is in it", () => {
  assert.equal(
    WINDOWS.filter((w) => w.wall === 'west' && w.u + w.width / 2 > MAINTENANCE.minZ && w.u - w.width / 2 < MAINTENANCE.maxZ).length,
    0,
    'no window opens onto the closet',
  );
  for (const b of BEANBAGS) assert.ok(!inCloset(b.x, b.z), `${b.id} is out of the closet`);
});

test('the maintenance agent has a kiosk of his own, inside the closet, facing the door', () => {
  const kiosk = STATIONS.find((s) => s.station === 'maintenance');
  assert.ok(kiosk);
  assert.equal(DESK_BY_ID.get(kiosk.id), kiosk);
  assert.ok(inCloset(kiosk.x, kiosk.z));
  // He stands on the wall side of it, still in the room.
  const stand = deskSeat(kiosk, 0.55);
  assert.ok(inCloset(stand.x, stand.z) && stand.x < kiosk.x);
  assert.equal(STATION_AGENT.maintenance.name, 'Maintenance agent');
});

test('you can walk in through the closet door to his counter and to the laptop', () => {
  const door = (MAINTENANCE.door.z0 + MAINTENANCE.door.z1) / 2;
  assert.ok(walkable(MAINTENANCE.maxX + 1, door, 0), 'outside the door is open floor');
  assert.ok(walkable(MAINTENANCE.maxX - 0.5, door, 0), 'just inside the door is open floor');
  assert.ok(!walkable(MAINTENANCE.maxX, MAINTENANCE.minZ + 0.2, 0), 'the wall beside the door is not');
  const kiosk = STATIONS.find((s) => s.station === 'maintenance')!;
  const front: [number, number] = [kiosk.x + 1, kiosk.z];
  const outside: [number, number] = [MAINTENANCE.maxX + 2, door];
  const way = route(outside, front, 0);
  assert.ok(way && way.length >= 2, 'a way in to his counter');
  const there = route(outside, [MAINTENANCE_LAPTOP.x + 0.7, MAINTENANCE_LAPTOP.z], 0);
  assert.ok(there && there.length >= 2, 'a way in to the laptop');
});

test("the maintenance agent's brief sends him to the office's own source in a worktree, never the running checkout or the queue", () => {
  const brief = stationBrief('maintenance');
  assert.match(brief, /Maintenance agent/);
  assert.match(brief, /CLAUDE\.md/);
  assert.match(brief, /worktree/);
  assert.match(brief, /never edit, switch branches, stash, reset or commit in it/);
  assert.match(brief, /Never restart, stop or redeploy/);
  assert.match(brief, /never merge your own pull request/);
  assert.doesNotMatch(brief, /office-queue/);
  assert.ok(brief.endsWith('The request:'));
  assert.ok(PROMPTS['station.maintenance'] && PROMPTS['station.maintenance'].group === 'stations');
});

test('the laptop asks gpt-6-luna, read-only, and a question arrives after its brief', () => {
  assert.equal(MAINTENANCE_MODEL, 'gpt-6-luna');
  assert.equal(laptopModel({}), 'gpt-6-luna');
  assert.equal(laptopModel({ AGENT_OFFICE_MAINTENANCE_MODEL: ' gpt-x ' }), 'gpt-x');
  const args = laptopArgs('how do floors work?', 'gpt-6-luna');
  assert.deepEqual(args.slice(0, 5), ['exec', '--model', 'gpt-6-luna', '--sandbox', 'read-only']);
  assert.ok(args.includes('--ephemeral'));
  assert.equal(args.at(-1), `${LAPTOP_BRIEF}\n\nhow do floors work?`);
});

test("the office's source is the install the server runs from, unless AGENT_OFFICE_SOURCE says another", () => {
  const dir = officeSourceDir({});
  assert.ok(dir && path.basename(dir).length > 0);
  assert.equal(officeSourceDir({ AGENT_OFFICE_SOURCE: tmpdir() }), path.resolve(tmpdir()));
  assert.equal(officeSourceDir({ AGENT_OFFICE_SOURCE: '/definitely/not/here' }), undefined);
});

test('the laptop gives back what the model printed, or says why it could not', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-laptop-'));
  const fake = (name: string, body: string) => {
    const file = path.join(dir, name);
    writeFileSync(file, `#!/bin/sh\n${body}\n`);
    chmodSync(file, 0o755);
    return file;
  };
  const ok = await askLaptop('hi', { codex: fake('ok', 'echo "Floors are projects."; echo "noise" >&2') });
  assert.deepEqual(ok, { answer: 'Floors are projects.' });
  // codex exec waits for the end of stdin before it starts: the laptop must close it.
  const patient = await askLaptop('hi', { codex: fake('patient', 'cat >/dev/null; echo "read all of stdin"') });
  assert.deepEqual(patient, { answer: 'read all of stdin' });
  const failed = await askLaptop('hi', { codex: fake('bad', 'echo "unknown model" >&2; exit 1') });
  assert.deepEqual(failed, { error: 'unknown model' });
  const missing = await askLaptop('hi', { codex: path.join(dir, 'nope') });
  assert.ok('error' in missing && /codex CLI isn't installed/.test(missing.error));
});
