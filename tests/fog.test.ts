import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import '../src/client/world/sky.js';

// Exercise the actual material hook with Three.js's shaders, including unlit signs and sprites.
for (const [name, Material] of [
  ['toon', THREE.MeshToonMaterial],
  ['basic', THREE.MeshBasicMaterial],
  ['sprite', THREE.SpriteMaterial],
] as const) {
  test(`${name} fog uses the surface's world position and shared indoor boundaries`, () => {
    const source = THREE.ShaderLib[name];
    const shader = { vertexShader: source.vertexShader, fragmentShader: source.fragmentShader, uniforms: {} };
    const material = new Material();
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    assert.ok(shader.vertexShader.includes('vSkyFogWorld = vec3('));
    assert.ok(shader.fragmentShader.includes('fogFactor *= 1.0 - skyInside * skyInOffice( vSkyFogWorld )'));
    assert.ok(shader.fragmentShader.includes('uniform vec4 skyWing'));
    const uniforms = shader.uniforms as Record<string, { value: unknown }>;
    assert.equal(uniforms.skyInside.value, 1);
    assert.ok(uniforms.skyWing.value instanceof THREE.Vector4);
    const another = { ...source, uniforms: {} };
    new Material().onBeforeCompile(another, {} as THREE.WebGLRenderer);
    assert.equal((another.uniforms as typeof uniforms).skyWing, uniforms.skyWing);
  });
}
