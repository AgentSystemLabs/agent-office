import * as THREE from 'three';
import { ARENA, type FpsPlayer, type FpsShot } from '../../../shared/fps';
import { boxSurfaceUv, fpsMaterials } from './art';

/** The office renderer draws this arena through the existing view registry. No extra canvas or loop. */
export class FpsWorld {
  readonly scene = new THREE.Scene();
  readonly weaponScene = new THREE.Scene();
  private opponent = new THREE.Group();
  private rifle = new THREE.Group();
  private flash: THREE.Mesh;
  private beams: { line: THREE.Line; life: number }[] = [];
  private kick = 0;

  constructor() {
    this.scene.background = new THREE.Color('#aebac5');
    this.scene.fog = new THREE.Fog('#aebac5', 32, 75);
    this.scene.add(new THREE.HemisphereLight(0xe5f4ff, 0x635342, 2.4));
    const sun = new THREE.DirectionalLight(0xffe5b2, 3); sun.position.set(-8, 15, 8); this.scene.add(sun);
    this.weaponScene.add(new THREE.HemisphereLight(0xe9f6ff, 0x313336, 3));
    const mat = (color: string, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness: .75, metalness });
    const { concrete, floor, orange, blue, wood, iron } = fpsMaterials();
    const stripe = mat('#e5b558'), dark = mat('#26333f');
    const box = (parent: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, d: number, material: THREE.Material) => {
      const geometry = boxSurfaceUv(new THREE.BoxGeometry(w, h, d), parent === this.rifle ? .35 : 2);
      const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
    };
    box(this.scene, 0, -.15, 0, 33, .3, 25, floor);
    for (let x = -15; x <= 15; x += 3) box(this.scene, x, .006, 0, .025, .01, 23, concrete);
    for (let z = -10; z <= 10; z += 2.5) box(this.scene, 0, .007, z, 31, .01, .025, concrete);
    for (const b of ARENA) {
      const material = b.kind === 'wall' ? concrete : b.kind === 'crate' ? wood : b.x < 0 ? blue : orange;
      box(this.scene, b.x, b.y, b.z, b.w, b.h, b.d, material);
      if (b.kind === 'container') {
        for (let z = b.z - b.d / 2 + .2; z < b.z + b.d / 2; z += .35) for (const side of [-1, 1])
          box(this.scene, b.x + side * (b.w / 2 + .025), b.y, z, .06, b.h - .1, .06, material);
        for (const side of [-1, 1]) box(this.scene, b.x, .18, b.z + side * b.d / 2, b.w + .05, .2, .08, iron);
      }
      if (b.kind === 'crate') {
        for (const side of [-1, 1]) {
          for (const y of [b.y - b.h / 2 + .15, b.y + b.h / 2 - .15]) box(this.scene, b.x, y, b.z + side * (b.d / 2 + .02), b.w, .16, .06, iron);
          for (const x of [-1, 1]) box(this.scene, b.x + x * (b.w / 2 - .18), b.y, b.z + side * (b.d / 2 + .025), .16, b.h, .065, iron);
        }
      }
    }
    // Repeated structural beams and bright lane markings make cover and route boundaries legible.
    for (const x of [-15.4, 15.4]) for (let z = -9; z <= 9; z += 6) {
      box(this.scene, x, 2.4, z, .15, 4.8, .3, iron);
      box(this.scene, x + (x < 0 ? .03 : -.03), .75, z, .2, 1.5, .34, stripe);
    }
    for (const x of [-9, 9]) for (let z = -10; z < 10; z += 2) box(this.scene, x, .012, z, .09, .02, .8, stripe);
    for (const z of [-11.45, 11.45]) {
      box(this.scene, 0, 2, z, 8, 3.6, .08, dark);
      const sign = this.sign(z < 0 ? 'B  /  NORTH DOCK' : 'A  /  SOUTH DOCK', z < 0 ? '#d08a54' : '#61aeca');
      sign.position.set(0, 3.25, z + (z < 0 ? .1 : -.1)); if (z > 0) sign.rotation.y = Math.PI; this.scene.add(sign);
      for (let x = -3.7; x < 4; x += .35) box(this.scene, x, 1.55, z, .06, 2.4, .1, iron);
    }
    const label = this.sign('OFFICE STRIKE   /   TRAINING FACILITY 01', '#d8e4e8');
    label.position.set(-15.4, 3.7, 0); label.rotation.y = Math.PI / 2; this.scene.add(label);
    // Visible opponent dimensions follow the shared body/head hit volumes.
    const body = box(this.opponent, 0, .95, 0, .6, .9, .4, mat('#3b7583'));
    body.name = 'vest';
    box(this.opponent, 0, 1.57, 0, .4, .32, .4, iron);
    box(this.opponent, 0, 1.56, -.21, .3, .1, .03, dark);
    for (const x of [-.17, .17]) box(this.opponent, x, .25, 0, .2, .5, .24, dark);
    for (const x of [-.4, .4]) box(this.opponent, x, .95, -.07, .18, .55, .2, dark);
    box(this.opponent, .27, 1.04, -.38, .1, .13, .7, iron);
    this.scene.add(this.opponent);
    // First-person rifle stays in camera coordinates and is rendered after clearing depth.
    box(this.rifle, 0, 0, 0, .12, .16, .56, iron);
    box(this.rifle, 0, -.01, .35, .13, .13, .26, dark);
    box(this.rifle, 0, -.15, .04, .085, .22, .13, iron).rotation.x = -.2;
    box(this.rifle, 0, -.15, .18, .07, .16, .08, dark).rotation.x = -.25;
    box(this.rifle, 0, .11, -.07, .035, .06, .12, dark);
    box(this.rifle, 0, .08, -.36, .03, .07, .05, dark);
    box(this.rifle, 0, 0, -.43, .045, .045, .28, dark);
    box(this.rifle, -.04, -.13, -.16, .12, .11, .16, mat('#b39b83'));
    box(this.rifle, .04, -.15, .2, .12, .11, .18, mat('#b39b83'));
    this.flash = new THREE.Mesh(new THREE.ConeGeometry(.065, .2, 5), new THREE.MeshBasicMaterial({ color: '#ffe69a' }));
    this.flash.rotation.x = -Math.PI / 2; this.flash.position.z = -.64; this.flash.visible = false; this.rifle.add(this.flash);
    this.weaponScene.add(this.rifle);
  }

  private sign(text: string, color: string) {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 96;
    const c = canvas.getContext('2d')!; c.fillStyle = '#1d2a32'; c.fillRect(0, 0, 1024, 96);
    c.fillStyle = color; c.font = 'bold 34px monospace'; c.textAlign = 'center'; c.fillText(text, 512, 60);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(7, .66), new THREE.MeshBasicMaterial({ map: texture }));
  }

  update(opponent: FpsPlayer | undefined, camera: THREE.PerspectiveCamera, dt: number, reloading: boolean, walking: boolean, reduceMotion: boolean) {
    this.opponent.visible = !!opponent?.hp;
    if (opponent) { this.opponent.position.lerp(new THREE.Vector3(opponent.x, opponent.y, opponent.z), Math.min(1, dt * 18)); this.opponent.rotation.y = opponent.yaw; }
    this.kick = Math.max(0, this.kick - dt * 8);
    const sway = reduceMotion ? 0 : Math.sin(performance.now() / 95) * (walking ? .009 : .001);
    this.rifle.position.set(.24 + sway, -.22 - (reloading ? .16 : 0), -.52 + this.kick * .09);
    this.rifle.rotation.set(reloading ? -.5 : this.kick * .12, 0, reloading ? -.35 : 0);
    this.rifle.position.applyQuaternion(camera.quaternion).add(camera.position);
    this.rifle.quaternion.premultiply(camera.quaternion);
    this.flash.visible = this.kick > .75;
    for (const b of this.beams) { b.life -= dt; (b.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, b.life / .12); }
    for (const b of this.beams.filter(b => b.life <= 0)) { this.scene.remove(b.line); b.line.geometry.dispose(); (b.line.material as THREE.Material).dispose(); }
    this.beams = this.beams.filter(b => b.life > 0);
  }

  shot(shot: FpsShot, local: boolean) {
    if (local) this.kick = 1;
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(shot.from.x, shot.from.y, shot.from.z), new THREE.Vector3(shot.to.x, shot.to.y, shot.to.z)]), new THREE.LineBasicMaterial({ color: local ? '#ffda8c' : '#9edcff', transparent: true, opacity: .8 }));
    this.scene.add(line); this.beams.push({ line, life: .12 });
  }
}
