import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import '../src/client/world/sky.js';

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
  assert.match(shader.fragmentShader, /smoothstep\( fogNear, fogFar, skyFogDepth \/ skyReach \)/);
  assert.ok('skyClearRooms' in shader.uniforms);
});

test('unlit fogged materials get the same indoor fog clearing', () => {
  const shader = compile(new THREE.MeshBasicMaterial({ fog: true }));
  assert.match(shader.fragmentShader, /float skyInOffice/);
  assert.match(shader.fragmentShader, /float skyFogDepth = vFogDepth \* \( 1\.0 - skyRoom \);/);
  assert.ok('skyWing' in shader.uniforms);
});
