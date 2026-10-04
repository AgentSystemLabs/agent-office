import * as THREE from 'three';
import { h, openModal, type Modal } from '../../ui/dom';
import { H, Minesweeper, W } from './minesweeper';
import { BossWorkstation } from './boss-workstation';

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
 * The boss's monitor: Executive Workstation (Host Terminal, Agent Comms, Fleet Radar)
 * and classic Minesweeper (minesweeper.ts).
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
  private workstation: BossWorkstation | null = null;

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
    if (game.state === 'won' || game.state === 'lost') game.reset();

    const board = h('canvas', { 'aria-label': 'Minesweeper board' }) as HTMLCanvasElement;
    const stop = h('button.btn', { type: 'button' }, '✕ Leave Workstation');
    const cornerClose = h('button.btn.close.corner', { type: 'button', 'aria-label': 'Close' }, '✕');

    const workstation = new BossWorkstation(board, (tab) => {
      if (tab === 'game') {
        fit();
      }
    });
    this.workstation = workstation;

    const box = h(
      'div.arcade',
      { role: 'dialog', 'aria-label': 'Boss Executive Workstation' },
      cornerClose,
      h('div.arcade-screen', {}, workstation.el),
      h(
        'div.arcade-bar',
        {},
        h('span', {}, '👑 Boss Executive Workstation'),
        h('span.tip', {}, 'Host Terminal · Agent Comms · Fleet Radar · Minesweeper'),
        stop
      )
    );

    // Minesweeper board pointer handlers
    const spot = (e: MouseEvent) => ({ x: (e.offsetX * W) / board.clientWidth, y: (e.offsetY * H) / board.clientHeight });
    let holding = false;

    board.addEventListener('pointerdown', (e) => {
      const { x, y } = spot(e);
      const i = game.cellAt(x, y);
      if (e.button === 2 || (e.button === 0 && (e.ctrlKey || e.shiftKey))) game.flag(i);
      else if (e.button === 1) game.chord(i);
      else if (e.button === 0 && game.onFace(x, y)) game.reset();
      else if (e.button === 0) {
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
      if (game.isOpen(i)) game.chord(i);
      else game.open(i);
      this.draw();
    });

    board.addEventListener('pointerleave', () => {
      if (holding) return;
      game.hover = -1;
      this.draw();
    });

    board.addEventListener('contextmenu', (e) => e.preventDefault());
    board.addEventListener('mousedown', (e) => e.preventDefault());

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
      doing: '👑 at the Boss Workstation',
      onClose: () => {
        window.removeEventListener('resize', fit);
        clearInterval(clock);
        this.modal = null;
        this.board = null;
        this.workstation = null;
        game.hover = game.pressed = -1;
        this.draw();
      }
    });

    this.modal.backdrop.classList.add('clear');
    stop.addEventListener('click', () => this.modal?.close());
    cornerClose.addEventListener('click', () => this.modal?.close());
  }

  /** Moves the camera toward the monitor while you use it, and back after. */
  update(camera: THREE.PerspectiveCamera, dt: number) {
    this.view.update(camera, dt, !!this.modal);
  }

  /** Draws the game on the board while you play, and on the monitor otherwise. */
  private draw() {
    if (this.board) {
      const g = this.board.getContext('2d')!;
      g.setTransform(this.board.width / W, 0, 0, this.board.height / H, 0, 0);
      this.game.paint(g, false);
    } else {
      this.drawIdleMonitor();
    }
  }

  /** Draws an attractive executive dashboard on the 3D world monitor texture when not open */
  private drawIdleMonitor() {
    const g = this.picture.getContext('2d')!;
    g.fillStyle = '#090e1a';
    g.fillRect(0, 0, W, H);

    // Accent header
    g.fillStyle = '#0f172a';
    g.fillRect(0, 0, W, 80);
    g.fillStyle = '#f59e0b';
    g.fillRect(0, 78, W, 2);

    // Header Title
    g.fillStyle = '#f59e0b';
    g.font = "bold 30px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText('👑 BOSS EXECUTIVE WORKSTATION', 40, 40);

    // System Status
    g.fillStyle = '#10b981';
    g.font = 'bold 18px monospace';
    g.textAlign = 'right';
    g.fillText('● SYSTEM READY', W - 40, 40);

    // Left Panel: Host Terminal (Absolute Permissions)
    g.fillStyle = '#111827';
    g.beginPath();
    g.roundRect(40, 110, 420, 290, 12);
    g.fill();
    g.strokeStyle = '#1e293b';
    g.lineWidth = 2;
    g.stroke();

    g.fillStyle = '#f59e0b';
    g.font = "bold 18px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    g.textAlign = 'left';
    g.fillText('⚡ HOST TERMINAL', 60, 145);

    g.fillStyle = '#94a3b8';
    g.font = '15px monospace';
    g.fillText('• Absolute Host Shell Access', 60, 185);
    g.fillText('• Instant Command Execution', 60, 220);
    g.fillText('• Budget & Lead System Status', 60, 255);
    g.fillText('• 100% Unrestricted Root Power', 60, 290);

    // Right Panel: Inter-Agent Comms & Fleet
    g.fillStyle = '#111827';
    g.beginPath();
    g.roundRect(500, 110, 420, 290, 12);
    g.fill();
    g.strokeStyle = '#1e293b';
    g.lineWidth = 2;
    g.stroke();

    g.fillStyle = '#38bdf8';
    g.font = "bold 18px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    g.textAlign = 'left';
    g.fillText('💬 INTER-AGENT COMMANDS', 520, 145);

    g.fillStyle = '#94a3b8';
    g.font = '15px monospace';
    g.fillText('• Direct Line to CEO & Lead', 520, 185);
    g.fillText('• Broadcast Directives to All', 520, 220);
    g.fillText('• Real-Time Fleet Radar', 520, 255);
    g.fillText('• 💣 Minesweeper Game Included', 520, 290);

    // Interaction hint footer
    g.fillStyle = '#f59e0b';
    g.font = "bold 20px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    g.textAlign = 'center';
    g.fillText('Press E to Take Command', W / 2, 460);

    this.texture.needsUpdate = true;
  }
}
