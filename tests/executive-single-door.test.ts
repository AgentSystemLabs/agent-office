import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildExecutiveBuilding } from '../src/client/executive/building-kit.js';
import { createTownInterior } from '../src/client/executive/town-interior.js';

test('Town Hall has one canonical door and no interior duplicate', () => {
  const town = buildExecutiveBuilding({ id:'town-hall', name:'Town Hall', x:0, z:-28, color:'#203c53', kind:'town' });
  const interior = createTownInterior();
  assert.equal(town.group.getObjectByName('front-door'), town.door);
  assert.equal(interior.getObjectByName('town-interior-door'), undefined);
  const source = readFileSync(new URL('../src/client/executive/preview.ts', import.meta.url), 'utf8');
  assert.ok(source.includes("activeInteriorScene=scene"));
  assert.ok(source.includes('setTownInteriorVisibility(true)'));
  assert.ok(source.includes('setTownInteriorVisibility(false)'));
  assert.equal(source.includes('town-interior-door'), false);
  assert.equal((source.match(/createDoorController\(townDoorGroup/g) ?? []).length, 1);
});
