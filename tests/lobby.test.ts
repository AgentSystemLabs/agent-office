import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Lobby } from '../src/server/lobby.js';
import { LOBBY, LOBBY_PLAN, LOBBY_SEATING, floorNumber, lobbyInfo } from '../src/shared/lobby.js';
import { seatHereOn, OFFICE_PLAN } from '../src/shared/maps/index.js';
import { store } from '../src/client/state/index.js';

test('coworking chairs belong to the lobby, which keeps its layout when project maps change', () => {
  for (const chair of LOBBY_SEATING) {
    assert.ok(seatHereOn(LOBBY_PLAN, `${chair.id}:0`, false));
    assert.equal(seatHereOn(OFFICE_PLAN, `${chair.id}:0`, false), undefined);
    assert.equal(seatHereOn(LOBBY_PLAN, `${chair.id}:0`, true), undefined);
  }
  store.map = { pick: 'castle', custom: [] };
  store.floor = LOBBY;
  assert.equal(store.plan(), LOBBY_PLAN);
  store.floor = 'project';
  assert.equal(store.plan().id, 'castle');
  assert.equal(floorNumber(lobbyInfo(2), 0), 'G');
});

test('public drawings and music survive reopening independently of project data', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-lobby-'));
  try {
    const lobby = new Lobby(dir);
    const element = { id: 'shared-drawing', type: 'rectangle', version: 1, versionNonce: 1 };
    assert.equal(lobby.whiteboard.apply([element]).accepted.length, 1);
    lobby.whiteboard.flush();
    lobby.jukebox.skip('Coworker');
    const reopened = new Lobby(dir);
    assert.deepEqual(reopened.whiteboard.scene(), [element]);
    assert.equal(reopened.jukebox.state().track, lobby.jukebox.state().track);
    assert.equal(reopened.jukebox.state().by, 'Coworker');
    assert.equal(lobbyInfo(2).people, 2);
    assert.equal(lobbyInfo(2).dir, '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
