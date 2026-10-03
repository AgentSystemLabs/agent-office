/**
 * Mirrors the topmost HTML window onto a panel floating in front of you in VR, so menus, boards and
 * issue cards stay usable without leaving the headset. Windows that contain an iframe still end the
 * session — those need the browser's own chrome.
 */
import * as THREE from 'three';
import { onModalChange, topModal, type Modal } from '../../ui/dom';
import { DomTexture } from './dom-texture';
import type { Hand } from './rays';
import { planeHit, type SurfaceHit, type XrSurface } from './surface';

/** How wide a mirrored window is, in meters. */
const WIDTH = 1.15;

export class WindowSurface implements XrSurface {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly dom = new DomTexture();
  private modal: Modal | null = null;
  private hoverHit: SurfaceHit | null = null;
  private readonly mat: THREE.MeshBasicMaterial;
  /** True while an immersive session is presenting. */
  private xr = false;
  private recenter: (() => void) | null = null;

  constructor() {
    this.mat = new THREE.MeshBasicMaterial({ map: this.dom.texture, toneMapped: false, fog: false, transparent: true, depthTest: false });
    this.mat.userData.outlineParameters = { visible: false };
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH, WIDTH * 0.75), this.mat);
    this.mesh.name = 'xr-window';
    this.mesh.renderOrder = 998;
    this.mesh.visible = false;
  }

  /** Wire up modal mirroring. `isXr` / `place` / `leaveFor` come from the XR feature. */
  install(opts: {
    isXr: () => boolean;
    place: (mesh: THREE.Object3D) => void;
    /** Leave VR for a window that can't be drawn (iframe). */
    leaveFor: (why: string) => void;
  }) {
    this.recenter = () => {
      if (this.mesh.visible) opts.place(this.mesh);
    };
    onModalChange((open) => {
      this.xr = opts.isXr();
      if (!this.xr) {
        this.clear();
        return;
      }
      if (!open) {
        this.clear();
        return;
      }
      const modal = topModal();
      if (!modal) return;
      if (modal.el.querySelector('iframe')) {
        opts.leaveFor('This window has a web page in it, which the headset can’t show — left VR so you can use it');
        return;
      }
      this.show(modal, opts.place);
    });
  }

  active() {
    return this.mesh.visible && !!this.modal;
  }

  hit(raycaster: THREE.Raycaster) {
    return planeHit(this.mesh, raycaster);
  }

  hover(_hand: Hand, hit: SurfaceHit | null) {
    this.hoverHit = hit;
    if (hit) this.dom.dispatch(hit.u, hit.v, 'pointermove');
  }

  press(_hand: Hand, hit: SurfaceHit, down: boolean): boolean {
    if (down) this.dom.dispatch(hit.u, hit.v, 'click');
    return true;
  }

  scroll(hit: SurfaceHit, dy: number) {
    this.dom.dispatch(hit.u, hit.v, 'scroll', dy);
  }

  paint(now: number) {
    if (!this.active()) return;
    if (this.dom.paint(now)) this.fit();
  }

  close() {
    this.clear();
  }

  /** Re-place the panel in front of you (palette card button). */
  recentre() {
    this.recenter?.();
  }

  private show(modal: Modal, place: (mesh: THREE.Object3D) => void) {
    this.modal = modal;
    this.dom.attach(modal.el);
    this.mesh.visible = true;
    this.dom.paint();
    this.fit();
    place(this.mesh);
  }

  private clear() {
    this.modal = null;
    this.dom.detach();
    this.mesh.visible = false;
    this.mesh.removeFromParent();
    this.hoverHit = null;
  }

  private fit() {
    const aspect = this.dom.height / this.dom.width || 0.75;
    const h = WIDTH * Math.min(Math.max(aspect, 0.45), 1.2);
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.PlaneGeometry(WIDTH, h);
  }
}

/** Whether a modal can be mirrored in VR (no iframe). */
export function canMirror(modal: Modal): boolean {
  return !modal.el.querySelector('iframe');
}