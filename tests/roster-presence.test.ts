import test from 'node:test';
import assert from 'node:assert/strict';
import { waitingProfiles } from '../src/shared/roster-presence.js';
import type { WorkerProfile } from '../src/shared/worker-profiles.js';

test('team presence includes held members and removes only people already represented by workers', () => {
  const profiles: WorkerProfile[] = [
    { id: 'ready', name: 'Ready Person', description: 'Developer', enabled: true, holds: [] },
    { id: 'held', name: 'Held Person', description: 'Reviewer', enabled: false, holds: ['Source STOP'] },
    { id: 'busy', name: 'Working Person', description: 'Developer', enabled: true, holds: [] },
  ];
  const visible = waitingProfiles(profiles, [{ name: 'Working Person' }, { name: 'Pixel' }]);
  assert.deepEqual(visible.map(profile => profile.id), ['ready', 'held']);
  assert.equal(visible[1].enabled, false);
  assert.deepEqual(visible[1].holds, ['Source STOP']);
  assert.equal(waitingProfiles(profiles, []).length, 3);
});
