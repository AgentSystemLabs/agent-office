import * as THREE from 'three';
import type { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import type { BrowserPerformance } from '../shared/performance';

export interface GraphicsTarget {
  renderer: Pick<THREE.WebGLRenderer, 'setPixelRatio' | 'shadowMap'>;
  effect: Pick<OutlineEffect, 'enabled'>;
  scene: THREE.Scene;
}

/** Applies live graphics choices and releases shadow targets before changing their dimensions. */
export function applyGraphicsPerformance({ renderer, effect, scene }: GraphicsTarget, options: BrowserPerformance) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, options.pixelRatio));
  effect.enabled = options.outlines;
  applyShadowSize(renderer, scene, options.shadowSize);
}

/** Reconciles shadows when live quality changes or a cached world rejoins the scene. */
export function applyShadowSize(renderer: Pick<THREE.WebGLRenderer, 'shadowMap'>, scene: THREE.Scene, size: BrowserPerformance['shadowSize']) {
  renderer.shadowMap.enabled = size > 0;
  scene.traverse((object) => {
    if (!(object instanceof THREE.DirectionalLight || object instanceof THREE.SpotLight || object instanceof THREE.PointLight)) return;
    const shadow = object.shadow;
    if (!size || shadow.mapSize.x !== size || shadow.mapSize.y !== size) {
      shadow.dispose();
      shadow.map = null;
      shadow.mapPass = null;
      if (size) shadow.mapSize.set(size, size);
      shadow.needsUpdate = true;
    }
  });
  renderer.shadowMap.needsUpdate = true;
}

/** Inactive cached maps must be outside the scene, including Three's outline/shadow traversal. */
export function activateWorld(scene: THREE.Scene, previous: THREE.Group, next: THREE.Group) {
  previous.removeFromParent();
  scene.add(next);
}
