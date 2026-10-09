import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Sky } from '../src/client/world/sky.js';

function compile(mat: THREE.Material) {
  const shader = {
    uniforms: {} as Record<string, unknown>,
    vertexShader: `
#include <common>
#include <fog_pars_vertex>
void main() {
  vec3 transformed = vec3(0.0);
  #include <project_vertex>
  #include <fog_vertex>
}
`,
    fragmentShader: `
#include <common>
#include <fog_pars_fragment>
void main() {
  gl_FragColor = vec4(1.0);
  #include <lights_fragment_begin>
  #include <lights_fragment_end>
  #include <fog_fragment>
}
`,
  };
  mat.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
  return shader;
}

test('weather fog is cleared from office and garage fragments', () => {
  const shader = compile(new THREE.MeshToonMaterial({ fog: true }));
  assert.match(shader.vertexShader, /varying vec3 vSkyWorld;/);
  assert.match(shader.vertexShader, /vSkyWorld = \( modelMatrix \* skyW \)\.xyz;/);
  assert.match(shader.fragmentShader, /float skyRoom = skyClearRooms \* max\( skyInOffice\( vSkyWorld \), skyInGarage\( vSkyWorld \) \);/);
  assert.match(shader.fragmentShader, /float skyFogDepth = vFogDepth \* \( 1\.0 - skyRoom \);/);
  assert.match(shader.fragmentShader, /uniform float skyClearRooms, skyDrop, skyStreet;/);
  assert.match(shader.fragmentShader, /smoothstep\( fogNear, fogFar, skyFogDepth \/ skyReach \)/);
  assert.ok('skyClearRooms' in shader.uniforms);
});

test('unlit fogged materials get the same indoor fog clearing', () => {
  const shader = compile(new THREE.MeshBasicMaterial({ fog: true }));
  assert.match(shader.fragmentShader, /float skyInOffice/);
  assert.match(shader.fragmentShader, /float skyFogDepth = vFogDepth \* \( 1\.0 - skyRoom \);/);
  assert.ok('skyWing' in shader.uniforms);
});

test('room fog clearing is enabled for office floors, the garage and street, but not other maps or the roof', () => {
  const shader = compile(new THREE.MeshBasicMaterial({ fog: true }));
  const clearRooms = () => (shader.uniforms.skyClearRooms as { value: number }).value;
  const sky = { roof: false, indoors: false, roofStreet: 0 } as unknown as Sky;
  Sky.prototype.setIndoors.call(sky, false);
  Sky.prototype.setRoof.call(sky, false);
  assert.equal(clearRooms(), 1, 'office floors, garage and street clear fog from room fragments');
  Sky.prototype.setRoof.call(sky, true);
  assert.equal(clearRooms(), 0, 'the rooftop is outdoors, so its fog stays whole');
  Sky.prototype.setRoof.call(sky, false);
  assert.equal(clearRooms(), 1, 'returning from the roof to the office re-enables room clearing');
  Sky.prototype.setIndoors.call(sky, true);
  assert.equal(clearRooms(), 0, 'enclosed alternate maps do not use the office room boxes to clear fog');
});
