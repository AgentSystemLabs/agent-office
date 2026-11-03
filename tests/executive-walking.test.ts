import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createTownBody, moveTownBody } from '../src/client/executive/town-walking.js';
import { createInteriorBody, isClearInteriorSpawn, moveInterior, resolveInteriorSpawn } from '../src/client/executive/town-interior.js';

test('director can enter the doorway and reach the boardroom aisle', () => {
  const body=createTownBody();moveTownBody(body,0,-2.8);assert.ok(body.pos.z < -7.7);
  moveTownBody(body,-.55,-.7);assert.ok(body.pos.z < -8.2);
});
test('first-person interior confines movement to the cleared shell', () => {
  const body=createInteriorBody();moveInterior(body,0,-20);assert.ok(body.pos.z > -3.3,'rear wall stops forward movement');
  const side=createInteriorBody();moveInterior(side,20,0);assert.ok(side.pos.x < 4.8,'side wall stops movement');
  const exit=createInteriorBody();moveInterior(exit,0,20);assert.ok(exit.pos.z < 3.3,'exit wall stops movement');
  const aisle=createInteriorBody();moveInterior(aisle,2.5,0);moveInterior(aisle,0,-4);assert.ok(aisle.pos.z < 1,'cleared interior remains navigable');
});
test('first-person spawn is clear and has room to leave in every direction', () => {
  const spawn=resolveInteriorSpawn();
  assert.equal(spawn.x,0); assert.ok(Math.abs(spawn.z-2.35)<1e-9);
  assert.equal(isClearInteriorSpawn(spawn),true);
  for(const [dx,dz] of [[0,-.6],[0,.6],[-.6,0],[.6,0]]){
    const body=createInteriorBody();body.pos.set(spawn.x,0.6,spawn.z);moveInterior(body,dx,dz);
    assert.ok(Math.hypot(body.pos.x-spawn.x,body.pos.z-spawn.z)>.2,`spawn should allow movement ${dx},${dz}`);
  }
  assert.equal(isClearInteriorSpawn({x:0,z:-1.25}),true,'cleared shell has no furniture footprint');
});
test('walls and doorway boundary block ground-floor movement', () => {
  const wall=createTownBody();moveTownBody(wall,0,-20);assert.ok(wall.pos.z > -13.3);
  const doorway=createInteriorBody();moveInterior(doorway,0,20);assert.ok(doorway.pos.z < 3.3);
});
