import * as THREE from 'three';
import { THEATRE_SWITCH, TV } from '../../shared/layout';
import { mesh, roundedBox, textPlane, toon } from './toon';
import type { Interactable } from './office';

// Theatre mode: the switch on the wall beside the lounge TV, and the light the screen throws on the
// wall round it. Flipping the switch takes the room's own light down so the picture on the TV is the
// brightest thing in the office (see Sky.setTheatre). The state is the floor's rather than yours, and
// rides with the TV's (see shared/tv.ts); this is only what the switch looks like while it changes.

/** How far the rocker tips over, either way, and how fast it gets there. */
const TILT = 0.4;
const FLIP = 8;
/** How fast the light off the screen comes up and goes, so it trails the room a little. */
const SPILL = 1.1;
/** How bright the spill on the wall round the screen gets at full. */
const SPILL_MAX = 0.5;

export interface TheatreView {
  group: THREE.Group;
  /** The switch and the screen's spill are one thing: you walk up to either. */
  interactable: Interactable;
  /**
   * Which way the switch is thrown, and whether the screen has a picture on it — a link, or somebody
   * sharing theirs — to light the room with.
   */
  show(on: boolean, lit: boolean): void;
  update(dt: number): void;
}

/** A soft round falloff, for the light the screen throws on the wall round it. */
function spillTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 10, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.3)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The theatre switch by the TV: a plate on the wall with a rocker on it, hinged along its bottom
 * edge, and a little lamp over the rocker that stays lit while the room is dark. Unlit materials,
 * both — the room's own light is what the switch takes away, and a switch that went dark with it
 * would be no use to anyone.
 */
export function buildTheatre(): TheatreView {
  const group = new THREE.Group();

  const plate = new THREE.Group();
  plate.position.set(THEATRE_SWITCH.x, THEATRE_SWITCH.y, THEATRE_SWITCH.z);
  plate.rotation.y = THEATRE_SWITCH.rotY;
  plate.add(mesh(roundedBox(0.28, 0.4, 0.05, 0.05), toon('#d8d2c4'), 0, 0, 0.02, false));
  plate.add(mesh(roundedBox(0.22, 0.33, 0.05, 0.04), toon('#f2ede2'), 0, 0, 0.03, false));
  const rocker = new THREE.Group();
  rocker.position.set(0, -0.05, 0.06);
  rocker.add(mesh(roundedBox(0.12, 0.17, 0.045, 0.025), toon('#e6e0d2'), 0, 0.085, 0, false));
  plate.add(rocker);
  // The lamp above the rocker, and a little screen of an emoji to say what the switch is for. Both
  // unlit, so they keep showing in a room the switch has just put out.
  const lampMat = new THREE.MeshBasicMaterial({ color: '#3a3d55' });
  plate.add(mesh(new THREE.CircleGeometry(0.022, 12), lampMat, 0, 0.155, 0.062, false));
  const label = textPlane('🎬', { size: 44 });
  label.scale.multiplyScalar(0.3);
  label.position.set(0, -0.135, 0.062);
  plate.add(label);
  group.add(plate);

  // The light the picture throws on the wall round the screen: a soft patch on the wall, which only
  // shows while the room is dark and the screen has something on it. It sits between the screen and
  // the wall, so the bezel hides the middle of it and all you see is the spill round the edge —
  // whichever way the picture is drawn, over the canvas or on the screen itself.
  const spill = new THREE.Mesh(
    new THREE.PlaneGeometry(TV.width * 1.8, TV.height * 2.1),
    new THREE.MeshBasicMaterial({ map: spillTexture(), color: '#cfe2ff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
  );
  spill.position.set(TV.x + 0.08, TV.y, TV.z);
  spill.rotation.y = THEATRE_SWITCH.rotY;
  spill.renderOrder = 2;
  spill.visible = false;
  group.add(spill);

  let on = false;
  let lit = false;
  const show = (isOn: boolean, hasPicture: boolean) => {
    on = isOn;
    lit = hasPicture;
  };

  const update = (dt: number) => {
    // The rocker snaps over and the lamp lights; the room itself eases down in Sky, over a second.
    rocker.rotation.x += ((on ? -TILT : TILT) - rocker.rotation.x) * Math.min(1, dt * FLIP);
    lampMat.color.set(on ? '#ffb703' : '#3a3d55');
    const want = on && lit ? SPILL_MAX : 0;
    spill.material.opacity += (want - spill.material.opacity) * Math.min(1, dt * SPILL);
    spill.visible = spill.material.opacity > 0.01;
  };

  // You use it standing a stride out from the wall, with the plate in reach.
  const interactable: Interactable = { kind: 'theatre', x: THEATRE_SWITCH.x - 1.1, z: THEATRE_SWITCH.z, radius: 1.9 };
  plate.userData.interact = interactable;
  rocker.rotation.x = TILT;

  return { group, interactable, show, update };
}
