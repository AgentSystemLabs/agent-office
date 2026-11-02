import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DrunkVision } from '../src/client/features/bar/drunk';

function fakeRenderer(width: number, height: number, ratio: number, initial: THREE.RenderTarget | null = null) {
  let current = initial;
  const targets: (THREE.RenderTarget | null)[] = [];
  const renders: (THREE.RenderTarget | null)[] = [];
  const renderer = {
    getSize: (out: THREE.Vector2) => out.set(width, height),
    getPixelRatio: () => ratio,
    getRenderTarget: () => current,
    setRenderTarget: (target: THREE.RenderTarget | null) => {
      current = target;
      targets.push(target);
    },
    render: () => renders.push(current),
  } as unknown as THREE.WebGLRenderer;
  return { renderer, targets, renders, current: () => current };
}

test('drunk vision prepare warms the render target before the first filtered frame', () => {
  const previous = new THREE.WebGLRenderTarget(4, 4);
  const fake = fakeRenderer(800, 600, 2, previous);
  const drunk = new DrunkVision(fake.renderer);

  drunk.prepare();
  const warmed = fake.renders[0];
  assert.ok(warmed instanceof THREE.WebGLRenderTarget);
  assert.equal(warmed.width, 1200);
  assert.equal(warmed.height, 900);
  assert.equal(fake.current(), previous);

  drunk.prepare();
  assert.equal(fake.renders.length, 1);

  drunk.begin();
  assert.equal(fake.current(), warmed);
});
