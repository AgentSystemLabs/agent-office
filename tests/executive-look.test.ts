import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { updateLook, movementVector } from '../src/client/executive/look-controls.js';

test('look responds on both axes independently and clamps pitch',()=>{
  const a=updateLook({yaw:0,pitch:0},100,-100);assert.ok(a.yaw<0);assert.ok(a.pitch>0);
  const fast=updateLook({yaw:0,pitch:0},100,0,.005);assert.ok(Math.abs(fast.yaw)>Math.abs(a.yaw));
  const b=updateLook(a,-200,200);assert.ok(b.yaw>0);assert.ok(b.pitch<0);
  assert.equal(updateLook(b,0,100000).pitch,-1.15);assert.equal(updateLook(b,0,-100000).pitch,1.15);
});
test('forward movement follows yaw and diagonals stay normalized',()=>{
  const north=movementVector(0,1,0),east=movementVector(-Math.PI/2,1,0),diagonal=movementVector(.4,1,1);
  assert.ok(north.z < -.99);assert.ok(east.x>.99);assert.ok(Math.abs(Math.hypot(diagonal.x,diagonal.z)-1)<1e-9);
});
