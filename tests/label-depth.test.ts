import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// labelDepth (src/client/world/toon.ts) pulls labels and cards nearer for the depth test by hooking
// this line of three's sprite shader: renamed in a three upgrade, the hook would quietly do nothing.
test("three's sprite shader still has the line labels hook their depth into", () => {
  assert.ok(THREE.ShaderLib.sprite.vertexShader.includes('gl_Position = projectionMatrix * mvPosition;'));
});
