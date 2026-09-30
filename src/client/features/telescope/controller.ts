import * as THREE from 'three';

// Just beyond the objective lens and the loft's corner post: from the eyepiece both pieces of
// foreground geometry fill the narrow FOV, while this still reads as the telescope's sightline.
const VIEW_POSITION = new THREE.Vector3(8.45, 3.95, 7.75);
const VIEW_TARGET = new THREE.Vector3(-3.5, 0.75, -1.5);
const VIEW_FOV = 16;
const LOOK_SPEED = 0.0015;
const YAW_RANGE = 0.42;
const MIN_PITCH = -0.5;
const MAX_PITCH = 0.08;

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
  private yaw = 0;
  private baseYaw = 0;
  private pitch = 0;
  private readonly rotation = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly overlay: ScopeElement,
    exitButton: EventTarget,
    pointer: EventTarget,
    private readonly onEnter: () => void,
    private readonly onExit: () => void,
  ) {
    exitButton.addEventListener('click', this.exit);
    pointer.addEventListener('pointermove', this.look);
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
    this.camera.position.copy(VIEW_POSITION);
    this.camera.lookAt(VIEW_TARGET);
    this.rotation.setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.baseYaw = this.yaw = this.rotation.y;
    this.pitch = this.rotation.x;
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
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    if (this.camera.fov !== VIEW_FOV || this.camera.zoom !== 1) {
      this.camera.fov = VIEW_FOV;
      this.camera.zoom = 1;
      this.camera.updateProjectionMatrix();
    }
  }

  private readonly look = (event: Event) => {
    if (!this.active) return;
    const { movementX = 0, movementY = 0 } = event as PointerEvent;
    this.yaw = THREE.MathUtils.clamp(this.yaw - movementX * LOOK_SPEED, this.baseYaw - YAW_RANGE, this.baseYaw + YAW_RANGE);
    this.pitch = THREE.MathUtils.clamp(this.pitch - movementY * LOOK_SPEED, MIN_PITCH, MAX_PITCH);
  };
}
