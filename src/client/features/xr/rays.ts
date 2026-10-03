/**
 * Pointing with the controllers in VR: a laser from each hand, with a dot where it lands. The office
 * aims along the aiming hand's (the last to pull its trigger), and either hand points at the terminal
 * panel's keys. With hand tracking, a pinch is the trigger.
 */
import * as THREE from 'three';

export type Hand = 'left' | 'right';

/** How long a laser is with nothing at the end of it (meters). */
const REST = 2;
/** The laser's color: at nothing, at something in reach, at the panel. */
const TONE = { far: '#ffffff', near: '#7ee787', panel: '#ffd166' } as const;
export type Tone = keyof typeof TONE;

interface Pointer {
  hand: Hand | null;
  source: XRInputSource | null;
  /** The controller's target-ray space, in the rig. */
  space: THREE.Group;
  laser: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  dot: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  ray: THREE.Ray;
}

export class XrRays {
  /** Which hand aims: the last to pull its trigger (or pinch). */
  active: Hand = 'right';
  /** A pinch with a tracked hand (which has no buttons) began or ended. */
  onPinch: ((hand: Hand, down: boolean) => void) | null = null;
  private readonly pointers: Pointer[] = [];
  private readonly scale = new THREE.Vector3();

  constructor(renderer: THREE.WebGLRenderer, rig: THREE.Group) {
    const line = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    const dotGeo = new THREE.SphereGeometry(0.008, 12, 8);
    // The controller itself: a short stick, so you can see where your hand is.
    const stickGeo = new THREE.CylinderGeometry(0.01, 0.014, 0.09, 10).rotateX(Math.PI / 2).translate(0, 0, 0.05);
    for (let i = 0; i < 2; i++) {
      const space = renderer.xr.getController(i);
      const laser = new THREE.Line(line, new THREE.LineBasicMaterial({ color: TONE.far, transparent: true, opacity: 0.75, fog: false }));
      laser.frustumCulled = false;
      const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: TONE.far, fog: false, depthTest: false, transparent: true }));
      dot.renderOrder = 1000;
      const stick = new THREE.Mesh(stickGeo, new THREE.MeshBasicMaterial({ color: '#3d405b', fog: false }));
      for (const m of [laser.material, dot.material, stick.material]) m.userData.outlineParameters = { visible: false };
      space.add(laser, dot, stick);
      space.visible = false;
      const p: Pointer = { hand: null, source: null, space, laser, dot, ray: new THREE.Ray() };
      space.addEventListener('connected', (e) => {
        p.source = e.data;
        p.hand = e.data.handedness === 'left' ? 'left' : 'right';
        // Gaze and screen taps have no hand to draw a laser from.
        space.visible = e.data.targetRayMode === 'tracked-pointer';
      });
      space.addEventListener('disconnected', () => {
        p.source = null;
        p.hand = null;
        space.visible = false;
      });
      // A controller's trigger is read off its gamepad (see controller.ts); a tracked hand has none.
      space.addEventListener('selectstart', () => p.hand && !p.source?.gamepad && this.onPinch?.(p.hand, true));
      space.addEventListener('selectend', () => p.hand && !p.source?.gamepad && this.onPinch?.(p.hand, false));
      rig.add(space);
      this.pointers.push(p);
    }
  }

  /** `hand`'s ray in world space, or null while it isn't tracked. Call after the rig has moved this frame. */
  rayOf(hand: Hand): THREE.Ray | null {
    const p = this.pointers.find((q) => q.hand === hand && q.space.visible);
    if (!p) return null;
    p.space.updateWorldMatrix(true, false);
    p.ray.origin.setFromMatrixPosition(p.space.matrixWorld);
    p.ray.direction.set(0, 0, -1).transformDirection(p.space.matrixWorld);
    return p.ray;
  }

  /** Draws `hand`'s laser out to `distance` (world units) with a dot there, or at rest with none. */
  show(hand: Hand, distance: number | null, tone: Tone) {
    const p = this.pointers.find((q) => q.hand === hand);
    if (!p) return;
    // The rig shrinks you down for the tabletop: lengths in the controller's space are real meters.
    const s = p.space.getWorldScale(this.scale).x || 1;
    const len = distance === null ? REST : distance / s;
    p.laser.scale.set(1, 1, len);
    p.laser.material.color.set(TONE[tone]);
    p.laser.material.opacity = hand === this.active || tone === 'panel' ? 0.8 : 0.35;
    p.dot.visible = distance !== null;
    p.dot.position.set(0, 0, -len);
    p.dot.material.color.set(TONE[tone]);
  }
}
