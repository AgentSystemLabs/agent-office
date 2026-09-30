import * as THREE from 'three';
import { h, openModal, type Modal } from '../../ui/dom';
import { H, Minesweeper, W } from './minesweeper';

/** How much of the view (across or down, whichever runs out first) a screen fills while you play on it. */
const FILL = 0.8;

/**
 * Glides the camera up to a screen in the office while you use it, and back after. The camera looks
 * straight at the screen, so whatever is laid over it on the page is a plain centered box (see `box`).
 */
export class ScreenZoom {
  /** 0 is your own view, 1 is right up at the screen. It eases between them. */
  private zoom = 0;
  private readonly at = new THREE.Vector3();
  private readonly facing = new THREE.Quaternion();
  /** The screen's width over its height. */
  private readonly aspect: number;

  constructor(private readonly screen: THREE.Mesh) {
    const { width, height } = (screen.geometry as THREE.PlaneGeometry).parameters;
    this.aspect = width / height;
  }

  /** Anywhere between your view and the screen: your first-person hands would cover it. */
  get zoomed(): boolean {
    return this.zoom > 0;
  }

  /** How big the screen is on the page, in CSS pixels, once the camera is up at it. */
  box(): { width: number; height: number } {
    const width = Math.min(innerWidth * FILL, innerHeight * FILL * this.aspect);
    return { width, height: width / this.aspect };
  }

  /** Moves the camera toward the screen while `on`, and back after. Call it once the player has placed the camera. */
  update(camera: THREE.PerspectiveCamera, dt: number, on: boolean) {
    const want = on ? 1 : 0;
    if (this.zoom === want) {
      if (!want) return;
    } else {
      this.zoom += (want - this.zoom) * Math.min(1, dt * 8);
      if (Math.abs(want - this.zoom) < 0.002) this.zoom = want;
    }
    // Straight out from the screen, back just far enough that it fills FILL of the view, like the box does.
    const { width, height } = (this.screen.geometry as THREE.PlaneGeometry).parameters;
    const span = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * FILL;
    const back = Math.max(height / span, width / (span * camera.aspect));
    this.screen.getWorldQuaternion(this.facing);
    this.screen.localToWorld(this.at.set(0, 0, back));
    camera.position.lerp(this.at, this.zoom);
    camera.quaternion.slerp(this.facing, this.zoom);
  }
}

/**
 * The boss's monitor, which plays Minesweeper (minesweeper.ts). The monitor shows the board as it
 * was left. Sit down and play, and the camera glides up to the screen while a board you can click is
 * laid exactly over it. The camera looks straight at the screen, so that board is a plain centered box.
 */
export class Arcade {
  private modal: Modal | null = null;
  private readonly view: ScreenZoom;
  private readonly game = new Minesweeper();
  /** What the monitor shows. */
  private readonly picture = document.createElement('canvas');
  private readonly texture = new THREE.CanvasTexture(this.picture);
  /** The board you click while playing, drawn at the size it shows on screen so it stays crisp. */
  private board: HTMLCanvasElement | null = null;

  constructor(screen: THREE.Mesh) {
    this.view = new ScreenZoom(screen);
    this.picture.width = W;
    this.picture.height = H;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const mat = screen.material as THREE.MeshBasicMaterial;
    mat.map = this.texture;
    mat.color.set('#ffffff');
    mat.toneMapped = false;
    this.draw();
    // Canvas text only picks up the office's font once it has loaded.
    void document.fonts.ready.then(() => this.draw());
  }

  /** Anywhere between your view and the monitor: your first-person hands would cover the screen. */
  get zoomed(): boolean {
    return this.view.zoomed;
  }

  /** Puts it down, if you're at it (the building changed maps under you). */
  stop() {
    this.modal?.close();
  }

  play() {
    if (this.modal) return;
    const game = this.game;
    // A finished game stays up on the monitor until the next player sits down to a fresh one.
    if (game.state === 'won' || game.state === 'lost') game.reset();
    const board = h('canvas', { 'aria-label': 'Minesweeper board' });
    const stop = h('button.btn', { type: 'button' }, '✕ Stop playing');
    const box = h(
      'div.arcade',
      { role: 'dialog', 'aria-label': 'Minesweeper' },
      h('div.arcade-screen', {}, board),
      h('div.arcade-bar', {}, h('span', {}, '💣 Minesweeper'), h('span.tip', {}, 'Click to dig · right-click to flag'), stop),
    );

    // Where the mouse is, in the game's 960×540.
    const spot = (e: MouseEvent) => ({ x: (e.offsetX * W) / board.clientWidth, y: (e.offsetY * H) / board.clientHeight });
    let holding = false;
    board.addEventListener('pointerdown', (e) => {
      const { x, y } = spot(e);
      const i = game.cellAt(x, y);
      // Right-click flags, and so do Ctrl- and Shift-click for a trackpad. The middle button chords.
      if (e.button === 2 || (e.button === 0 && (e.ctrlKey || e.shiftKey))) game.flag(i);
      else if (e.button === 1) game.chord(i);
      else if (e.button === 0 && game.onFace(x, y)) game.reset();
      else if (e.button === 0) {
        // It digs when you let go, wherever you let go, like the original.
        holding = true;
        game.pressed = i;
        board.setPointerCapture(e.pointerId);
      }
      this.draw();
    });
    board.addEventListener('pointermove', (e) => {
      const { x, y } = spot(e);
      const i = game.cellAt(x, y);
      if (i === game.hover) return;
      game.hover = i;
      if (holding) game.pressed = i;
      this.draw();
    });
    board.addEventListener('pointerup', (e) => {
      if (e.button !== 0 || !holding) return;
      holding = false;
      const i = game.pressed;
      game.pressed = -1;
      // A click on a number digs around it, once its mines are all flagged.
      if (game.isOpen(i)) game.chord(i);
      else game.open(i);
      this.draw();
    });
    board.addEventListener('pointerleave', () => {
      if (holding) return;
      game.hover = -1;
      this.draw();
    });
    // No menu on right-click, and no scrolling or selecting on a click.
    board.addEventListener('contextmenu', (e) => e.preventDefault());
    board.addEventListener('mousedown', (e) => e.preventDefault());

    // The clock only runs while someone's at the monitor.
    let last = performance.now();
    const clock = setInterval(() => {
      const now = performance.now();
      if (game.tick(now - last)) this.draw();
      last = now;
    }, 250);

    const fit = () => {
      const { width, height } = this.view.box();
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
      board.width = Math.round(width * devicePixelRatio);
      board.height = Math.round(height * devicePixelRatio);
      this.draw();
    };
    this.board = board;
    fit();
    window.addEventListener('resize', fit);
    this.modal = openModal(box, {
      backdropCloses: false,
      doing: '💣 playing Minesweeper',
      onClose: () => {
        window.removeEventListener('resize', fit);
        clearInterval(clock);
        this.modal = null;
        this.board = null;
        game.hover = game.pressed = -1;
        this.draw();
      },
    });
    this.modal.backdrop.classList.add('clear');
    stop.addEventListener('click', () => this.modal?.close());
  }

  /** Moves the camera toward the monitor while you play, and back after. Call it once the player has placed the camera. */
  update(camera: THREE.PerspectiveCamera, dt: number) {
    this.view.update(camera, dt, !!this.modal);
  }

  /** Draws the game on the board while you play, and on the monitor otherwise (the board covers it while you play). */
  private draw() {
    if (this.board) {
      const g = this.board.getContext('2d')!;
      g.setTransform(this.board.width / W, 0, 0, this.board.height / H, 0, 0);
      this.game.paint(g, false);
    } else {
      this.game.paint(this.picture.getContext('2d')!, true);
      this.texture.needsUpdate = true;
    }
  }
}
