import * as THREE from 'three';

const VIEW_POSITION = new THREE.Vector3(10.05, 4.12, 9.05);
const VIEW_TARGET = new THREE.Vector3(-3.5, 0.75, -1.5);
const VIEW_FOV = 20;

interface ScopeElement {
  classList: Pick<DOMTokenList, 'add' | 'remove'>;
}

/** Owns the camera and input lifecycle while looking through the boss-loft telescope. */
export class TelescopeView {
  active = false;
  private readonly savedPosition = new THREE.Vector3();
  private readonly savedQuaternion = new THREE.Quaternion();
  private savedFov = 55;
  private savedZoom = 1;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly overlay: ScopeElement,
    exitButton: EventTarget,
    private readonly onEnter: () => void,
    private readonly onExit: () => void,
  ) {
    exitButton.addEventListener('click', this.exit);
  }

  enter(): boolean {
    if (this.active) return false;
    this.savedPosition.copy(this.camera.position);
    this.savedQuaternion.copy(this.camera.quaternion);
    this.savedFov = this.camera.fov;
    this.savedZoom = this.camera.zoom;
    this.active = true;
    this.overlay.classList.add('active');
    this.onEnter();
    this.update();
    return true;
  }

  readonly exit = (): boolean => {
    if (!this.active) return false;
    this.active = false;
    this.overlay.classList.remove('active');
    this.camera.position.copy(this.savedPosition);
    this.camera.quaternion.copy(this.savedQuaternion);
    this.camera.fov = this.savedFov;
    this.camera.zoom = this.savedZoom;
    this.camera.updateProjectionMatrix();
    this.onExit();
    return true;
  };

  /** PlayerController updates the shared camera every frame, so the scope reapplies its fixed view afterwards. */
  update() {
    if (!this.active) return;
    this.camera.position.copy(VIEW_POSITION);
    this.camera.lookAt(VIEW_TARGET);
    if (this.camera.fov !== VIEW_FOV || this.camera.zoom !== 1) {
      this.camera.fov = VIEW_FOV;
      this.camera.zoom = 1;
      this.camera.updateProjectionMatrix();
    }
  }
}
