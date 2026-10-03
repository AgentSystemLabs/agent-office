/**
 * The picture's finish: the scene is drawn in high range, gets ambient occlusion (the soft dark where
 * things meet), a gentle bloom on what's bright (windows, lamps, the sun on a wall) and is then tone
 * mapped to the screen, like a camera's. Drawn straight to the screen instead while something else has
 * the render target (the drunk blur, see features/bar/drunk.ts).
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export class Post {
  private composer: EffectComposer;
  private pass: RenderPass;
  private ao: GTAOPass;

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
  ) {
    const size = renderer.getSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(Math.min(renderer.getPixelRatio(), 1.5));
    this.pass = new RenderPass(scene, camera);
    this.ao = new GTAOPass(scene, camera, size.x, size.y);
    this.ao.updateGtaoMaterial({ radius: 0.7, distanceExponent: 1.4, thickness: 1.2, scale: 1.2, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
    this.ao.blendIntensity = 0.9;
    const bloom = new UnrealBloomPass(size, 0.22, 0.7, 1.0);
    this.composer.addPass(this.pass);
    this.composer.addPass(this.ao);
    this.composer.addPass(bloom);
    this.composer.addPass(new OutputPass());
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h);
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    if (this.renderer.getRenderTarget()) {
      this.renderer.autoClear = true;
      this.renderer.render(scene, camera);
      return;
    }
    this.pass.scene = this.ao.scene = scene;
    this.pass.camera = this.ao.camera = camera;
    this.composer.render();
  }
}
