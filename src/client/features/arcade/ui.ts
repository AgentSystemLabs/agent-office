import * as THREE from 'three';
import { store } from '../../state';
import { needyFirst } from '../../nextup';
import { h, openModal, STATUS_LABEL, toast, type Modal } from '../../ui/dom';
import type { Net } from '../../net';
import { fmtCost, fmtTokens, tokensOf } from '../../../shared/protocol';
import { exportFloorReport, findMostIdleWorker } from '../../ui/boss-helpers';
import { playIntercomSound } from '../../sound/alerts';
import type { OfficeSound } from '../../sound';

/** Screen width and height units for the monitor texture. */
export const W = 960;
export const H = 540;

/** How much of the view a screen fills while you look at it. */
const FILL = 0.8;

export interface ArcadeDeps {
  openWorkerTerminal?: (id: string) => void;
  sound?: OfficeSound;
}

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
 * The boss's monitor, which runs the Boss Worker Control System. The monitor shows a glowing, live
 * command center terminal dashboard with Executive RGB Monitor Glow. Sitting down and pressing E
 * opens the Boss Control Center modal allowing full management of all workers on the floor.
 */
export class Arcade {
  private modal: Modal | null = null;
  private readonly view: ScreenZoom;
  /** What the 3D monitor screen shows. */
  private readonly picture = document.createElement('canvas');
  private readonly texture = new THREE.CanvasTexture(this.picture);
  private storeOff: (() => void) | null = null;

  constructor(
    private readonly screen: THREE.Mesh,
    private readonly net: Net,
    private readonly deps?: ArcadeDeps,
  ) {
    this.view = new ScreenZoom(screen);
    this.picture.width = W;
    this.picture.height = H;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const mat = screen.material as THREE.MeshBasicMaterial;
    mat.map = this.texture;
    mat.color.set('#ffffff');
    mat.toneMapped = false;
    this.draw();

    // Re-draw the 3D monitor screen canvas whenever worker states change in store.
    store.on('workers', () => this.draw());
    void document.fonts.ready.then(() => this.draw());
  }

  /** Anywhere between your view and the monitor: your first-person hands would cover the screen. */
  get zoomed(): boolean {
    return this.view.zoomed;
  }

  /** Puts it down, if you're at it (e.g. building changed maps). */
  stop() {
    this.modal?.close();
  }

  /** Opens the Boss Worker Control System Modal Window. */
  play() {
    if (this.modal) return;

    // --- 1. Broadcast Bar components (with Intercom Sound & Auto-Assign) ---
    const broadcastInput = h('input.boss-broadcast-input', {
      type: 'text',
      placeholder: 'Broadcast prompt to all workers...',
    }) as HTMLInputElement;

    const broadcastBtn = h('button.boss-broadcast-btn', { type: 'button' }, 'Broadcast');

    const autoAssignBtn = h(
      'button',
      {
        type: 'button',
        title: 'Auto-assign prompt to the most idle worker',
        style: 'background:rgba(56, 189, 248, 0.15); border:1px solid #38bdf8; color:#38bdf8; font-weight:700; font-size:11px; padding:4px 10px; border-radius:8px; cursor:pointer; margin-left:4px;',
        onclick: () => {
          let text = broadcastInput.value.trim();
          if (!text) {
            const userPrompt = window.prompt('Enter prompt to auto-assign to the most idle worker:');
            if (!userPrompt || !userPrompt.trim()) return;
            text = userPrompt.trim();
          }

          const worker = findMostIdleWorker(store.workers.values());
          if (!worker) {
            toast('No idle workers available to assign prompt', 'warn');
            return;
          }

          playIntercomSound(this.deps?.sound);
          this.net.send({ t: 'worker.prompt', workerId: worker.id, prompt: text });
          broadcastInput.value = '';
          toast(`Auto-assigned prompt to ${worker.name}`);
        },
      },
      '⚡ Auto-Assign',
    );

    const doBroadcast = () => {
      const text = broadcastInput.value.trim();
      if (!text) return;
      const workers = [...store.workers.values()];
      if (!workers.length) {
        toast('No active workers to broadcast to', 'warn');
        return;
      }

      playIntercomSound(this.deps?.sound);

      for (const w of workers) {
        this.net.send({ t: 'worker.prompt', workerId: w.id, prompt: text });
      }
      broadcastInput.value = '';
      toast(`Broadcast sent to ${workers.length} worker(s)`);
    };

    broadcastBtn.addEventListener('click', doBroadcast);
    broadcastInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doBroadcast();
    });

    const broadcastBar = h('div.boss-broadcast', {}, broadcastInput, broadcastBtn, autoAssignBtn);

    // --- 2. Action Header (Export Report, Send All Home) ---
    const exportBtn = h(
      'button',
      {
        type: 'button',
        title: 'Export Floor Report as Markdown',
        style: 'background:rgba(34, 197, 94, 0.15); border:1px solid #22c55e; color:#4ade80; font-weight:700; font-size:11px; padding:4px 10px; border-radius:8px; cursor:pointer; margin-right:6px;',
        onclick: () => {
          exportFloorReport();
        },
      },
      '📥 Export Report',
    );

    const sendAllBtn = h(
      'button',
      {
        type: 'button',
        class: 'danger',
        onclick: () => {
          const workers = [...store.workers.values()];
          if (!workers.length) {
            toast('No workers to send home', 'warn');
            return;
          }
          if (confirm(`Send all ${workers.length} worker(s) home?`)) {
            for (const w of workers) {
              this.net.send({ t: 'worker.kill', workerId: w.id });
            }
            toast(`Sent all ${workers.length} worker(s) home`);
          }
        },
      },
      'Send All Home',
    );

    const modalHeader = h(
      'div.boss-header',
      {},
      h('h3', {}, '👔 Boss Control Center'),
      h('div.boss-actions', {}, exportBtn, sendAllBtn),
    );

    // --- 3. Live Analytics Summary Bar ---
    const summaryBar = h('div.boss-summary-bar', {}) as HTMLDivElement;

    const refreshSummaryBar = () => {
      summaryBar.replaceChildren();
      const workersList = [...store.workers.values()];
      const totalCount = workersList.length;
      const workingCount = workersList.filter((w) => w.status === 'working').length;
      const needsInputCount = workersList.filter((w) => w.status === 'needs_input').length;

      let totalTokens = 0;
      let totalCost = 0;
      for (const w of workersList) {
        if (w.usage) {
          totalTokens += tokensOf(w.usage);
          totalCost += w.usage.cost || 0;
        }
      }

      const content = h(
        'div.boss-summary-bar-content',
        {},
        h('div.boss-stat-item', { title: 'Total Workers' }, h('span.label', {}, 'Workers'), h('span.val', {}, String(totalCount))),
        h('div.boss-stat-item', { title: 'Working / Active' }, h('span.label', {}, 'Working'), h('span.val.working', {}, String(workingCount))),
        h(
          'div.boss-stat-item',
          { title: 'Needs Your Input' },
          h('span.label', {}, 'Needs Input'),
          h('span', { class: 'val' + (needsInputCount > 0 ? ' needs' : '') }, String(needsInputCount)),
        ),
        h(
          'div.boss-stat-item',
          { title: 'Total Token / Dollar Spend' },
          h('span.label', {}, 'Total Spend'),
          h('span.val.spend', {}, `${fmtCost(totalCost)} · ${fmtTokens(totalTokens)}`),
        ),
      );
      summaryBar.append(content);
    };

    refreshSummaryBar();

    // --- 4. Worker List container ---
    const workerListEl = h('ul.boss-workers', {}) as HTMLUListElement;

    const refreshList = () => {
      refreshSummaryBar();
      workerListEl.replaceChildren();
      const workers = needyFirst(store.workers.values());
      if (!workers.length) {
        workerListEl.append(h('li.boss-empty', {}, 'No workers hired on this floor yet.'));
        return;
      }

      for (const w of workers) {
        const statusClass =
          w.status === 'needs_input'
            ? 'needs_input'
            : w.status === 'working'
              ? 'working'
              : w.status === 'done'
                ? 'done'
                : 'idle';

        const statusText = w.status === 'needs_input' ? 'NEEDS YOU' : (STATUS_LABEL[w.status] ?? w.status);

        const terminalBtn = h(
          'button.boss-worker-terminal',
          {
            type: 'button',
            title: `Open ${w.name}'s terminal`,
            onclick: (e: Event) => {
              e.stopPropagation();
              this.deps?.openWorkerTerminal?.(w.id);
            },
          },
          'Terminal',
        );

        const sendHomeBtn = h(
          'button.boss-worker-send-home',
          {
            type: 'button',
            title: `Send ${w.name} home`,
            onclick: (e: Event) => {
              e.stopPropagation();
              if (confirm(`Send ${w.name} home?`)) {
                this.net.send({ t: 'worker.kill', workerId: w.id });
              }
            },
          },
          'Send home',
        );

        const card = h(
          'li.boss-worker-card',
          {
            title: `Open ${w.name}'s terminal`,
            onclick: () => this.deps?.openWorkerTerminal?.(w.id),
          },
          h('span.boss-worker-dot', { style: `background:${w.color}` }),
          h(
            'span.boss-worker-info',
            {},
            h('div.boss-worker-name', {}, w.name),
            h('div.boss-worker-activity', {}, w.activity ?? w.title ?? w.prompt ?? '—'),
          ),
          h('span.boss-worker-status', { class: statusClass }, statusText),
          terminalBtn,
          sendHomeBtn,
        );

        workerListEl.append(card);
      }
    };

    refreshList();

    // --- 5. Assemble Modal Window Structure ---
    const stopBtn = h('button.btn', { type: 'button' }, '✕ Exit Boss System');
    const screenContent = h('div.arcade-screen', { style: 'display:flex; flex-direction:column;' }, modalHeader, summaryBar, broadcastBar, workerListEl);
    const box = h(
      'div.arcade',
      { role: 'dialog', 'aria-label': 'Boss Worker Control System' },
      screenContent,
      h('div.arcade-bar', {}, h('span', {}, '👔 Boss Control Center'), h('span.tip', {}, 'Control all workers from one place'), stopBtn),
    );

    const fit = () => {
      const { width, height } = this.view.box();
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
      this.draw();
    };
    fit();
    window.addEventListener('resize', fit);

    const onWorkersStoreChange = () => {
      refreshList();
      this.draw();
    };
    this.storeOff = store.on('workers', onWorkersStoreChange);

    this.modal = openModal(box, {
      backdropCloses: false,
      doing: '👔 Boss Control Center',
      onClose: () => {
        window.removeEventListener('resize', fit);
        if (this.storeOff) {
          this.storeOff();
          this.storeOff = null;
        }
        this.modal = null;
        this.draw();
      },
    });

    this.modal.backdrop.classList.add('clear');
    stopBtn.addEventListener('click', () => this.modal?.close());
  }

  /** Moves the camera toward the monitor while you look at it, and back after. */
  update(camera: THREE.PerspectiveCamera, dt: number) {
    this.view.update(camera, dt, !!this.modal);
  }

  /**
   * Draws the glowing Boss Command Center terminal dashboard onto the 3D monitor canvas (`this.picture`)
   * and updates Executive RGB Monitor Glow tint on the 3D monitor screen mesh.
   */
  public draw() {
    const g = this.picture.getContext('2d');
    if (!g) return;

    const FONT = "Nunito, ui-rounded, 'SF Pro Rounded', system-ui, sans-serif";

    // --- Calculate Worker Stats & Executive RGB Status ---
    const workers = [...store.workers.values()];
    const totalCount = workers.length;
    const workingCount = workers.filter((w) => w.status === 'working').length;
    const needsInputCount = workers.filter((w) => w.status === 'needs_input').length;
    const doneCount = workers.filter((w) => w.status === 'done').length;

    let totalTokens = 0;
    let totalCost = 0;
    for (const w of workers) {
      if (w.usage) {
        totalTokens += tokensOf(w.usage);
        totalCost += w.usage.cost || 0;
      }
    }

    // --- Executive RGB Monitor Glow status determination ---
    let rgbHex = '#f5a623';
    let rgbLabel = 'SYSTEM ONLINE';
    let rgbBadgeBg = '#166534';
    let rgbBadgeFg = '#86efac';

    if (needsInputCount > 0) {
      rgbHex = '#ef4444';
      rgbLabel = 'RGB: RED ALERT (NEEDS YOU)';
      rgbBadgeBg = '#7f1d1d';
      rgbBadgeFg = '#fca5a5';
    } else if (totalCount > 0 && workers.every((w) => w.status === 'done' || w.status === 'exited')) {
      rgbHex = '#22c55e';
      rgbLabel = 'RGB: GREEN (ALL FINISHED)';
      rgbBadgeBg = '#166534';
      rgbBadgeFg = '#86efac';
    } else if (workingCount > 0) {
      rgbHex = '#00f0ff';
      rgbLabel = 'RGB: BLUE (WORKING ACTIVE)';
      rgbBadgeBg = '#075985';
      rgbBadgeFg = '#a5f3fc';
    }

    // Update 3D monitor mesh screen material color tint dynamically
    const mat = this.screen.material as THREE.MeshBasicMaterial;
    if (mat) {
      mat.color.set(rgbHex);
    }

    // --- Background ---
    g.fillStyle = '#080c14';
    g.fillRect(0, 0, W, H);

    // --- Cybernetic Grid Lines ---
    g.strokeStyle = 'rgba(0, 240, 255, 0.04)';
    g.lineWidth = 1;
    for (let x = 0; x < W; x += 30) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, H);
      g.stroke();
    }
    for (let y = 0; y < H; y += 30) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
    }

    // --- Outer Frame with Dynamic RGB Accent ---
    g.strokeStyle = rgbHex;
    g.lineWidth = 2;
    g.strokeRect(15, 15, W - 30, H - 30);

    // Corner accents
    g.fillStyle = rgbHex;
    g.fillRect(12, 12, 12, 4);
    g.fillRect(12, 12, 4, 12);
    g.fillRect(W - 24, 12, 12, 4);
    g.fillRect(W - 16, 12, 4, 12);
    g.fillRect(12, H - 16, 12, 4);
    g.fillRect(12, H - 24, 4, 12);
    g.fillRect(W - 24, H - 16, 12, 4);
    g.fillRect(W - 16, H - 24, 4, 12);

    // --- Header Banner ---
    g.fillStyle = '#101827';
    g.beginPath();
    g.roundRect(25, 25, W - 50, 55, 8);
    g.fill();
    g.strokeStyle = '#1f293d';
    g.stroke();

    g.font = `800 24px ${FONT}`;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = '#f5a623';
    g.fillText('👔 BOSS WORKER CONTROL SYSTEM', 45, 52);

    // Live status badge with RGB indicator
    g.fillStyle = rgbBadgeBg;
    g.beginPath();
    g.roundRect(W - 275, 37, 240, 30, 15);
    g.fill();
    g.fillStyle = rgbBadgeFg;
    g.beginPath();
    g.arc(W - 257, 52, 5, 0, Math.PI * 2);
    g.fill();
    g.font = `700 12px ${FONT}`;
    g.fillStyle = rgbBadgeFg;
    g.fillText(rgbLabel, W - 243, 52);

    // --- Stat Summary Cards (5 Cards) ---
    const cardWidth = 172;
    const cardGap = 13;
    const startX = 25;

    const drawCard = (idx: number, title: string, val: string, color: string) => {
      const x = startX + idx * (cardWidth + cardGap);
      g.fillStyle = '#0d131f';
      g.beginPath();
      g.roundRect(x, 95, cardWidth, 65, 8);
      g.fill();
      g.strokeStyle = '#1f293d';
      g.stroke();

      g.font = `700 11px ${FONT}`;
      g.fillStyle = '#64748b';
      g.fillText(title, x + 12, 115);

      g.font = `900 22px ${FONT}`;
      g.fillStyle = color;
      g.fillText(val, x + 12, 142);
    };

    drawCard(0, 'TOTAL WORKERS', String(totalCount), '#38bdf8');
    drawCard(1, 'ACTIVE WORKING', String(workingCount), '#4ade80');
    drawCard(2, 'NEEDS INPUT', String(needsInputCount), needsInputCount > 0 ? '#ef4444' : '#9ca3af');
    drawCard(3, 'TOTAL TOKENS', fmtTokens(totalTokens), '#a855f7');
    drawCard(4, 'TOTAL SPEND', fmtCost(totalCost), '#f5a623');

    // --- Main Monitor Feed Panel ---
    g.fillStyle = '#0d131f';
    g.beginPath();
    g.roundRect(25, 175, W - 50, 290, 8);
    g.fill();
    g.strokeStyle = '#1f293d';
    g.stroke();

    g.font = `700 13px ${FONT}`;
    g.fillStyle = '#00f0ff';
    g.fillText('LIVE WORKER MONITOR FEED', 45, 198);

    if (!totalCount) {
      g.font = `800 22px ${FONT}`;
      g.fillStyle = '#475569';
      g.textAlign = 'center';
      g.fillText('NO WORKERS HIRED ON THIS FLOOR', W / 2, 300);
      g.font = `600 15px ${FONT}`;
      g.fillStyle = '#334155';
      g.fillText('Sit in the boss chair and press E to open the control system', W / 2, 335);
    } else {
      g.textAlign = 'left';
      const maxShow = 5;
      const displayWorkers = needyFirst(workers).slice(0, maxShow);

      displayWorkers.forEach((w, idx) => {
        const rowY = 220 + idx * 46;

        // Row background
        g.fillStyle = idx % 2 === 0 ? '#131c2e' : '#0f172a';
        g.beginPath();
        g.roundRect(40, rowY, W - 80, 40, 6);
        g.fill();

        // Worker color dot
        g.fillStyle = w.color || '#38bdf8';
        g.beginPath();
        g.arc(58, rowY + 20, 6, 0, Math.PI * 2);
        g.fill();

        // Worker name
        g.font = `800 15px ${FONT}`;
        g.fillStyle = '#f8fafc';
        g.fillText(w.name, 76, rowY + 20);

        // Status Tag
        const st = w.status;
        const stLabel = st === 'needs_input' ? 'NEEDS YOU' : (STATUS_LABEL[st] ?? st).toUpperCase();
        const stBg = st === 'needs_input' ? '#7f1d1d' : st === 'working' ? '#166534' : st === 'done' ? '#1e3a5f' : '#374151';
        const stFg = st === 'needs_input' ? '#fca5a5' : st === 'working' ? '#86efac' : st === 'done' ? '#93c5fd' : '#9ca3af';

        g.fillStyle = stBg;
        g.beginPath();
        g.roundRect(220, rowY + 9, 100, 22, 4);
        g.fill();

        g.font = `800 11px ${FONT}`;
        g.fillStyle = stFg;
        g.textAlign = 'center';
        g.fillText(stLabel, 270, rowY + 20);
        g.textAlign = 'left';

        // Activity / Prompt snippet
        const act = w.activity ?? w.title ?? w.prompt ?? '—';
        const truncated = act.length > 55 ? act.slice(0, 52) + '...' : act;
        g.font = `600 13px ${FONT}`;
        g.fillStyle = '#94a3b8';
        g.fillText(truncated, 335, rowY + 20);
      });
    }

    // --- Footer Status line ---
    g.font = `700 12px ${FONT}`;
    g.fillStyle = '#475569';
    g.textAlign = 'center';
    g.fillText('[ MONITORED BY BOSS COMMAND CENTER ]   ·   SIT IN CHAIR & PRESS E TO OPEN CONTROL MODAL', W / 2, 492);

    this.texture.needsUpdate = true;
  }
}

