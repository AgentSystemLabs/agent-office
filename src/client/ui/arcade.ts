import * as THREE from 'three';
import { h, openModal, type Modal } from './dom';

/**
 * DEADFALL, the three.js survival game, from its GitHub Pages build. It draws at a fixed 960×540
 * (scaled up to the monitor) on medium quality and at most 60 fps, so it costs the same whatever
 * the window size and leaves the GPU room for the office.
 */
const GAME = {
  src: 'https://webdevcody.github.io/deadfall/?quality=medium&maxfps=60',
  width: 960,
  height: 540,
};
const ASPECT = GAME.width / GAME.height;
/** How much of the view (across or down, whichever runs out first) the monitor fills while you play. */
const FILL = 0.8;

/**
 * The boss's monitor. It shows a title card until you sit down and play. Then the camera glides up
 * to it and the game loads into a frame laid exactly over the screen. The camera looks straight at
 * the screen, so the frame is a plain centered box. Stopping throws the frame away, so the game
 * costs nothing while nobody's playing.
 */
export class Arcade {
  /** 0 is your own view, 1 is right up at the monitor. It eases between them. */
  private zoom = 0;
  private modal: Modal | null = null;
  private readonly at = new THREE.Vector3();
  private readonly facing = new THREE.Quaternion();

  constructor(private readonly screen: THREE.Mesh) {
    const mat = screen.material as THREE.MeshBasicMaterial;
    mat.map = titleCard();
    mat.color.set('#ffffff');
    mat.toneMapped = false;
  }

  /** Right up at the monitor and holding still: the office around it can be redrawn less often. */
  get settled(): boolean {
    return this.zoom === 1;
  }

  /** Anywhere between your view and the monitor: your first-person hands would cover the screen. */
  get zoomed(): boolean {
    return this.zoom > 0;
  }

  play() {
    if (this.modal) return;
    const frame = h('iframe', { src: GAME.src, title: 'DEADFALL', allow: 'autoplay; fullscreen; gamepad' });
    frame.style.width = `${GAME.width}px`;
    frame.style.height = `${GAME.height}px`;
    // Keys go straight to the game, without a click on it first.
    frame.addEventListener('load', () => frame.focus());
    const stop = h('button.btn', { type: 'button' }, '✕ Stop playing');
    const box = h(
      'div.arcade',
      { role: 'dialog', 'aria-label': 'DEADFALL' },
      h('div.arcade-screen', {}, frame),
      h('div.arcade-bar', {}, h('span', {}, '🌲 DEADFALL'), h('span.tip', {}, 'Esc lets go of the mouse'), stop),
    );
    const fit = () => {
      const w = Math.min(innerWidth * FILL, innerHeight * FILL * ASPECT);
      box.style.width = `${w}px`;
      box.style.height = `${w / ASPECT}px`;
      frame.style.transform = `scale(${w / GAME.width})`;
    };
    fit();
    window.addEventListener('resize', fit);
    this.modal = openModal(box, {
      backdropCloses: false,
      onClose: () => {
        window.removeEventListener('resize', fit);
        this.modal = null;
      },
    });
    this.modal.backdrop.classList.add('clear');
    stop.addEventListener('click', () => this.modal?.close());
  }

  /** Moves the camera toward the monitor while you play, and back after. Call it once the player has placed the camera. */
  update(camera: THREE.PerspectiveCamera, dt: number) {
    const want = this.modal ? 1 : 0;
    if (this.zoom === want) {
      if (!want) return;
    } else {
      this.zoom += (want - this.zoom) * Math.min(1, dt * 8);
      if (Math.abs(want - this.zoom) < 0.002) this.zoom = want;
    }
    // Straight out from the screen, back just far enough that it fills FILL of the view, like the frame box does.
    const { width, height } = (this.screen.geometry as THREE.PlaneGeometry).parameters;
    const span = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * FILL;
    const back = Math.max(height / span, width / (span * camera.aspect));
    this.screen.getWorldQuaternion(this.facing);
    this.screen.localToWorld(this.at.set(0, 0, back));
    camera.position.lerp(this.at, this.zoom);
    camera.quaternion.slerp(this.facing, this.zoom);
  }
}

/** What the monitor shows while nobody's playing: misty old-growth forest at dusk. */
function titleCard(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = GAME.width;
  c.height = GAME.height;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, GAME.height);
  sky.addColorStop(0, '#1d2b33');
  sky.addColorStop(0.6, '#6d7f79');
  sky.addColorStop(1, '#2c3a2e');
  g.fillStyle = sky;
  g.fillRect(0, 0, GAME.width, GAME.height);
  // Rows of conifers, darker the nearer they are.
  for (const [row, color, size] of [
    [330, '#3d4d45', 0.7],
    [420, '#26332b', 1],
    [540, '#121a15', 1.4],
  ] as const) {
    g.fillStyle = color;
    for (let x = -20; x < GAME.width + 40; x += 46 * size) {
      const tall = (150 + ((x * 7919) % 90)) * size;
      g.beginPath();
      g.moveTo(x, row);
      g.lineTo(x + 22 * size, row - tall);
      g.lineTo(x + 44 * size, row);
      g.fill();
    }
  }
  g.textAlign = 'center';
  g.fillStyle = '#f1ede4';
  g.font = '900 110px Nunito, ui-rounded, system-ui, sans-serif';
  g.fillText('DEADFALL', 480, 250);
  g.font = '800 30px Nunito, ui-rounded, system-ui, sans-serif';
  g.fillText('Sit in the boss’s chair and press E to play', 480, 310);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
