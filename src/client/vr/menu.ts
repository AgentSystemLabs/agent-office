/**
 * The VR core menu: a wrist-or-dash panel with the VR-essential actions as ray-clickable
 * buttons. Every action calls the same underlying function the DOM UI calls — the wiring
 * arrives through VrMenuActions (see attach.ts for the exact main.ts snippet), so there is
 * no forked logic here. Read-only views render from the same stores the DOM boards read.
 *
 * Views: main (Hire, Next waiting, Queue, Issues/PRs, Mute, Exit VR), hire (free desks),
 * queue (running/queued/done), board (issues/PRs tabs, read + hand-to-worker), and a detail
 * view for one issue or PR.
 */

import type * as THREE from 'three';
import type { GhIssue, GhPull, GhState, QueueState, QueueTask, WorkerInfo } from '../../shared/protocol';
import { TERM_FONT } from '../fonts';
import { waitingInOrder } from '../nextup';
import { clampScroll, type Rect } from './math';
import { WorldPanel } from './panel';

export interface VrMenuStores {
  subscribe: (topic: 'workers' | 'issues' | 'pulls' | 'queue', fn: () => void) => () => void;
  getWorkers: () => WorkerInfo[];
  getIssues: () => GhState<GhIssue>;
  getPulls: () => GhState<GhPull>;
  getQueue: () => QueueState;
  getFreeDesks: () => { id: string; label: string }[];
  isMuted: () => boolean;
  inVoice: () => boolean;
}

export interface VrMenuActions {
  /** Opens the hire choices for a desk — the DOM hire dialog's function (main.ts hireAtDesk). */
  hire: (deskId: string) => void;
  /** To the longest-waiting worker — the DOM N key's function (main.ts goToNextWaiting). */
  nextWaiting: () => void;
  /** Hands an issue to a worker — the DOM board's assign path (issuePrompt + sendToWorker). */
  handToWorker: (issueNumber: number, title: string) => void;
  /** Puts an issue on the task queue — the DOM board's queue path (queue.add with issuePrompt). */
  queueIssue: (issueNumber: number, title: string) => void;
  /** Mutes/unmutes — the DOM M key's function (voice.toggleMute). */
  toggleMute: () => void;
  /** Leaves the immersive session — the XR session owner's exit. */
  exitVr: () => void;
}

export type MenuView = 'main' | 'hire' | 'queue' | 'board' | 'detail';

export interface MenuDetail {
  kind: 'issue' | 'pull';
  number: number;
}

const HEADER_H = 0.12;
const BODY: Rect = { x: 0.03, y: HEADER_H + 0.02, w: 0.94, h: 1 - HEADER_H - 0.05 };
const BACK_BTN: Rect = { x: 0.03, y: 0.015, w: 0.16, h: 0.09 };
const TABS: Rect = { x: 0.55, y: 0.015, w: 0.42, h: 0.09 };

interface MainItem {
  id: string;
  icon: string;
  title: string;
  sub: () => string;
}

const DETAIL_BODY_MAX = 900;

export class VrMenu {
  readonly panel: WorldPanel;
  /** Opening a worker's terminal from a queue row (wired by attach.ts to the VR terminal panel). */
  onOpenTerminal: ((workerId: string) => void) | null = null;
  /** Opening the controls card from the ❓ row (wired by attach.ts to the VR controls panel). */
  onShowControls: (() => void) | null = null;

  private stores: VrMenuStores;
  private actions: VrMenuActions;
  private unsubs: (() => void)[] = [];
  private view: MenuView = 'main';
  private boardTab: 'issues' | 'pulls' = 'issues';
  private detail: MenuDetail | null = null;
  /** Scroll offset (and list identity) the row buttons were last synced to. */
  private rowSyncKey = '';
  private lastMuted = '';

  constructor(stores: VrMenuStores, actions: VrMenuActions, widthM = 0.62, heightM = 0.72) {
    this.stores = stores;
    this.actions = actions;
    this.panel = new WorldPanel({ width: widthM, height: heightM, paint: (ctx, w, h, _dirty, state) => this.paint(ctx, w, h, state) });
    this.panel.setScrollRegion('list', BODY);
    this.panel.setVisible(false);
    this.unsubs = (['workers', 'issues', 'pulls', 'queue'] as const).map((t) => stores.subscribe(t, () => this.refresh()));
    this.syncButtons();
  }

  get visible(): boolean {
    return this.panel.visible;
  }

  toggle() {
    this.panel.setVisible(!this.panel.visible);
    if (this.panel.visible) {
      this.refresh();
      this.panel.markDirty();
    }
  }

  show(view: MenuView = 'main') {
    this.view = view;
    this.detail = view === 'detail' ? this.detail : null;
    this.panel.setScrollOffset('list', 0);
    this.panel.setVisible(true);
    this.refresh();
    this.panel.markDirty();
  }

  hide() {
    this.panel.setVisible(false);
  }

  currentView(): MenuView {
    return this.view;
  }

  private go(view: MenuView, detail: MenuDetail | null = null) {
    this.view = view;
    this.detail = detail;
    this.panel.setScrollOffset('list', 0);
    this.refresh();
    this.panel.markDirty();
  }

  private refresh() {
    if (!this.panel.visible) return;
    const muted = `${this.stores.isMuted()}|${this.stores.inVoice()}`;
    if (muted !== this.lastMuted) this.lastMuted = muted;
    this.syncButtons();
    this.panel.markDirty();
  }

  // ---- Data -------------------------------------------------------------------------------

  private waiting(): WorkerInfo[] {
    return waitingInOrder(this.stores.getWorkers());
  }

  private openIssues(): GhIssue[] {
    return this.stores.getIssues().items.filter((i) => i.state === 'OPEN');
  }

  private openPulls(): GhPull[] {
    return this.stores.getPulls().items.filter((p) => p.state === 'OPEN');
  }

  private queueLists(): { running: QueueTask[]; queued: QueueTask[]; done: QueueTask[] } {
    const tasks = this.stores.getQueue().tasks;
    return {
      running: tasks.filter((t) => t.status === 'running'),
      queued: tasks.filter((t) => t.status === 'queued'),
      done: tasks.filter((t) => t.status === 'done').slice(-8).reverse(),
    };
  }

  // ---- Buttons ----------------------------------------------------------------------------

  private mainItems(): MainItem[] {
    const waiting = this.waiting();
    const needs = waiting.filter((w) => w.status === 'needs_input').length;
    const q = this.stores.getQueue();
    const activeQueue = q.tasks.filter((t) => t.status !== 'done').length;
    return [
      { id: 'hire', icon: '✨', title: 'Hire worker', sub: () => `${this.stores.getFreeDesks().length} free desks` },
      {
        id: 'next', icon: needs ? '🙋' : '✅', title: 'Next waiting worker',
        sub: () => (waiting.length ? `${waiting[0].name}${waiting.length > 1 ? ` +${waiting.length - 1} more` : ''} (N)` : 'nobody waiting (N)'),
      },
      { id: 'queue', icon: '📋', title: 'Task queue', sub: () => (q.maxWorkers === 0 ? `paused · ${activeQueue} tasks` : `${activeQueue} active · ${q.maxWorkers} at once`) },
      { id: 'board', icon: '📌', title: 'Issues / PRs', sub: () => `${this.openIssues().length} issues · ${this.openPulls().length} PRs` },
      {
        id: 'mute', icon: this.stores.isMuted() ? '🔇' : '🎙️', title: this.stores.isMuted() ? 'Unmute' : 'Mute',
        sub: () => (this.stores.inVoice() ? 'in voice (M)' : 'not in voice'),
      },
      { id: 'controls', icon: '❓', title: 'VR controls', sub: () => 'pinches, teleports, sticks' },
      { id: 'exit', icon: '🚪', title: 'Exit VR', sub: () => 'back to the flat screen' },
    ];
  }

  private mainRect(i: number, n: number): Rect {
    const gap = 0.018;
    const h = (BODY.h - gap * (n - 1)) / n;
    return { x: BODY.x, y: BODY.y + i * (h + gap), w: BODY.w, h };
  }

  /** Rows currently listed in the scroll body, each a button-height unit. */
  private syncButtons() {
    if (this.view === 'main') {
      const items = this.mainItems();
      this.panel.setButtons(items.map((item, i) => ({ id: item.id, rect: this.mainRect(i, items.length), onClick: () => this.mainClick(item.id) })));
      return;
    }
    const buttons: { id: string; rect: Rect; onClick: () => void }[] = [{ id: 'back', rect: BACK_BTN, onClick: () => this.go('main') }];
    if (this.view === 'board') {
      buttons.push(
        { id: 'tab:issues', rect: { x: TABS.x, y: TABS.y, w: TABS.w / 2, h: TABS.h }, onClick: () => { this.boardTab = 'issues'; this.panel.setScrollOffset('list', 0); this.refresh(); } },
        { id: 'tab:pulls', rect: { x: TABS.x + TABS.w / 2, y: TABS.y, w: TABS.w / 2, h: TABS.h }, onClick: () => { this.boardTab = 'pulls'; this.panel.setScrollOffset('list', 0); this.refresh(); } },
      );
    }
    if (this.view === 'detail' && this.detail) {
      const d = this.detail;
      if (d.kind === 'issue') {
        buttons.push(
          { id: 'act:hand', rect: { x: 0.05, y: 0.82, w: 0.42, h: 0.12 }, onClick: () => this.actions.handToWorker(d.number, this.issueTitle(d.number)) },
          { id: 'act:queue', rect: { x: 0.53, y: 0.82, w: 0.42, h: 0.12 }, onClick: () => this.actions.queueIssue(d.number, this.issueTitle(d.number)) },
        );
      }
      if (d.kind === 'pull') {
        const w = this.pullWorker(d.number);
        if (w) buttons.push({ id: 'act:term', rect: { x: 0.05, y: 0.82, w: 0.9, h: 0.12 }, onClick: () => this.onOpenTerminal?.(w) });
      }
      this.panel.setButtons(buttons);
      return;
    }
    // Scrollable rows: buttons sit where the rows paint (scroll offset applied); rows
    // scrolled out of the body simply never get hit.
    const count = this.rowCount();
    const rowH = this.rowHPx();
    const off = this.panel.scrollOffset('list');
    for (let i = 0; i < count; i++) {
      buttons.push({ id: `row:${i}`, rect: { x: BODY.x, y: BODY.y + (i - off) * rowH, w: BODY.w, h: rowH * 0.92 }, onClick: () => this.rowClick(i) });
    }
    this.rowSyncKey = `${this.view}|${this.boardTab}|${count}|${off.toFixed(3)}`;
    this.panel.setButtons(buttons);
  }

  /** Row buttons track the list's scroll offset; re-syncs only when it (or the list) moved. */
  private syncRowsIfMoved() {
    const key = `${this.view}|${this.boardTab}|${this.rowCount()}|${this.panel.scrollOffset('list').toFixed(3)}`;
    if (key !== this.rowSyncKey) this.syncButtons();
  }

  private rowHPx(): number {
    // In normalized units; ~9 rows visible.
    return BODY.h / 9;
  }

  private rowCount(): number {
    if (this.view === 'hire') return Math.max(1, this.stores.getFreeDesks().length);
    if (this.view === 'queue') {
      const l = this.queueLists();
      return l.running.length + l.queued.length + l.done.length;
    }
    // board
    return this.boardTab === 'issues' ? Math.max(1, this.openIssues().length) : Math.max(1, this.openPulls().length);
  }

  private mainClick(id: string) {
    switch (id) {
      case 'hire': return this.go('hire');
      case 'next': return this.actions.nextWaiting();
      case 'queue': return this.go('queue');
      case 'board': return this.go('board');
      case 'mute': return this.actions.toggleMute();
      case 'controls': return this.onShowControls?.();
      case 'exit': return this.actions.exitVr();
    }
  }

  private rowClick(i: number) {
    if (this.view === 'hire') {
      const desks = this.stores.getFreeDesks();
      const d = desks[i];
      if (d) this.actions.hire(d.id);
      else this.panel.markDirty();
      return;
    }
    if (this.view === 'queue') {
      const w = this.queueWorkerAt(i);
      if (w) this.onOpenTerminal?.(w);
      return;
    }
    if (this.view === 'board') {
      if (this.boardTab === 'issues') {
        const it = this.openIssues()[i];
        if (it) this.go('detail', { kind: 'issue', number: it.number });
      } else {
        const pr = this.openPulls()[i];
        if (pr) this.go('detail', { kind: 'pull', number: pr.number });
      }
    }
  }

  private queueWorkerAt(i: number): string | null {
    const l = this.queueLists();
    const all = [...l.running, ...l.queued, ...l.done];
    const t = all[i];
    if (!t?.workerId || !this.stores.getWorkers().some((w) => w.id === t.workerId)) return null;
    return t.workerId;
  }

  private issueTitle(number: number): string {
    return this.stores.getIssues().items.find((i) => i.number === number)?.title ?? '';
  }

  private pullWorker(number: number): string | null {
    const pr = this.stores.getPulls().items.find((p) => p.number === number);
    if (!pr) return null;
    for (const w of this.stores.getWorkers()) {
      if (w.pr?.number === pr.number || (w.worktree && w.worktree.branch === pr.headRefName)) return w.id;
    }
    return null;
  }

  // ---- Paint --------------------------------------------------------------------------------

  private paint(ctx: CanvasRenderingContext2D, w: number, h: number, state: { hoverId: string | null; pressedId: string | null; time: number }) {
    ctx.fillStyle = 'rgba(12,12,15,0.96)';
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, Math.round(h * 0.02));
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = Math.max(2, h * 0.003);
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, Math.round(h * 0.02));
    ctx.clip();

    const title = this.view === 'main' ? '☰ Menu' : this.view === 'hire' ? '✨ Hire worker' : this.view === 'queue' ? '📋 Task queue' : this.view === 'board' ? '📌 Issues / PRs' : this.detailTitle();
    ctx.fillStyle = '#eeeeee';
    ctx.font = `700 ${Math.round(h * 0.042)}px ${TERM_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(title, w * (this.view === 'main' ? 0.05 : 0.22), h * HEADER_H * 0.55, w * (this.view === 'board' ? 0.3 : 0.5));
    if (this.view !== 'main') this.paintBack(ctx, w, h, state);
    if (this.view === 'board') this.paintTabs(ctx, w, h, state);
    ctx.strokeStyle = '#ee6018';
    ctx.lineWidth = Math.max(2, h * 0.004);
    ctx.beginPath();
    ctx.moveTo(0, h * HEADER_H);
    ctx.lineTo(w, h * HEADER_H);
    ctx.stroke();

    if (this.view === 'main') this.paintMain(ctx, w, h, state);
    else if (this.view === 'detail') this.paintDetail(ctx, w, h, state);
    else this.paintList(ctx, w, h, state);
    ctx.restore();
  }

  private detailTitle(): string {
    if (!this.detail) return '';
    return this.detail.kind === 'issue' ? `📌 #${this.detail.number}` : `🔀 #${this.detail.number}`;
  }

  private pill(ctx: CanvasRenderingContext2D, r: Rect, w: number, h: number, id: string, state: { hoverId: string | null; pressedId: string | null }, hot = '#ee6018') {
    const x = r.x * w;
    const y = r.y * h;
    const hot_ = state.hoverId === id || state.pressedId === id;
    ctx.fillStyle = hot_ ? hot : 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.roundRect(x, y, r.w * w, r.h * h, r.h * h * 0.35);
    ctx.fill();
  }

  private paintBack(ctx: CanvasRenderingContext2D, w: number, h: number, state: { hoverId: string | null; pressedId: string | null }) {
    this.pill(ctx, BACK_BTN, w, h, 'back', state);
    ctx.fillStyle = '#eeeeee';
    ctx.font = `700 ${Math.round(BACK_BTN.h * h * 0.42)}px ${TERM_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('← back', (BACK_BTN.x + BACK_BTN.w / 2) * w, (BACK_BTN.y + BACK_BTN.h / 2) * h);
    ctx.textAlign = 'left';
  }

  private paintTabs(ctx: CanvasRenderingContext2D, w: number, h: number, state: { hoverId: string | null; pressedId: string | null }) {
    const tabs: { id: string; label: string; tab: 'issues' | 'pulls' }[] = [
      { id: 'tab:issues', label: `📌 ${this.openIssues().length}`, tab: 'issues' },
      { id: 'tab:pulls', label: `🔀 ${this.openPulls().length}`, tab: 'pulls' },
    ];
    tabs.forEach((t, i) => {
      const r: Rect = { x: TABS.x + (TABS.w / 2) * i, y: TABS.y, w: TABS.w / 2 - 0.01, h: TABS.h };
      const active = this.boardTab === t.tab;
      const hot = state.hoverId === t.id || state.pressedId === t.id;
      ctx.fillStyle = active ? '#ee6018' : hot ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.07)';
      ctx.beginPath();
      ctx.roundRect(r.x * w, r.y * h, r.w * w, r.h * h, r.h * h * 0.35);
      ctx.fill();
      ctx.fillStyle = active ? '#111' : '#eeeeee';
      ctx.font = `700 ${Math.round(r.h * h * 0.4)}px ${TERM_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(t.label, (r.x + r.w / 2) * w, (r.y + r.h / 2) * h);
    });
    ctx.textAlign = 'left';
  }

  private paintMain(ctx: CanvasRenderingContext2D, w: number, h: number, state: { hoverId: string | null; pressedId: string | null }) {
    const items = this.mainItems();
    items.forEach((item, i) => {
      const r = this.mainRect(i, items.length);
      const hot = state.hoverId === item.id || state.pressedId === item.id;
      ctx.fillStyle = hot ? (item.id === 'exit' ? 'rgba(239,71,111,0.35)' : 'rgba(238,96,24,0.28)') : 'rgba(255,255,255,0.06)';
      ctx.beginPath();
      ctx.roundRect(r.x * w, r.y * h, r.w * w, r.h * h, r.h * h * 0.22);
      ctx.fill();
      if (hot) {
        ctx.strokeStyle = item.id === 'exit' ? '#ef476f' : '#ee6018';
        ctx.lineWidth = Math.max(2, h * 0.003);
        ctx.stroke();
      }
      const cx = (r.x + 0.02) * w;
      const cy = (r.y + r.h / 2) * h;
      ctx.font = `${Math.round(r.h * h * 0.42)}px ${TERM_FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText(item.icon, cx, cy);
      ctx.fillStyle = '#eeeeee';
      ctx.font = `700 ${Math.round(r.h * h * 0.3)}px ${TERM_FONT}`;
      ctx.fillText(item.title, cx + r.h * h * 0.62, cy - r.h * h * 0.14, r.w * w * 0.7);
      ctx.fillStyle = '#8c8c8c';
      ctx.font = `500 ${Math.round(r.h * h * 0.22)}px ${TERM_FONT}`;
      ctx.fillText(item.sub(), cx + r.h * h * 0.62, cy + r.h * h * 0.26, r.w * w * 0.7);
      ctx.fillStyle = '#eeeeee';
    });
  }

  private paintList(ctx: CanvasRenderingContext2D, w: number, h: number, state: { hoverId: string | null; pressedId: string | null }) {
    const count = this.rowCount();
    const rowH = this.rowHPx();
    const visible = BODY.h / rowH;
    this.panel.setScrollContent('list', count, visible);
    // Row buttons track the scroll offset (re-synced while the list moves).
    const top = clampScroll(this.panel.scrollOffset('list'), count, visible);

    const bx = BODY.x * w;
    const by = BODY.y * h;
    const bw = BODY.w * w;
    const bh = BODY.h * h;
    ctx.save();
    ctx.beginPath();
    ctx.rect(bx, by, bw, bh);
    ctx.clip();
    const first = Math.floor(top);
    const last = Math.min(count, Math.ceil(top + visible) + 1);
    for (let i = first; i < last; i++) {
      const y = by + (i - top) * rowH * h;
      const rh = rowH * h * 0.92;
      const hot = state.hoverId === `row:${i}` || state.pressedId === `row:${i}`;
      ctx.fillStyle = hot ? 'rgba(238,96,24,0.25)' : 'rgba(255,255,255,0.05)';
      ctx.beginPath();
      ctx.roundRect(bx, y, bw, rh, rh * 0.2);
      ctx.fill();
      this.paintRow(ctx, i, bx, y, bw, rh);
    }
    // Empty states.
    if (this.view === 'hire' && !this.stores.getFreeDesks().length) this.centerNote(ctx, w, 'Every desk is taken', h);
    if (this.view === 'board' && this.boardTab === 'issues' && !this.openIssues().length) this.centerNote(ctx, w, 'No open issues 🎉', h);
    if (this.view === 'board' && this.boardTab === 'pulls' && !this.openPulls().length) this.centerNote(ctx, w, 'No open PRs', h);
    if (this.view === 'queue' && count === 0) this.centerNote(ctx, w, 'Nothing on the queue', h);
    ctx.restore();
    // Scrollbar.
    if (count > visible) {
      const trackX = (BODY.x + BODY.w) * w + w * 0.004;
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(trackX, by, Math.max(3, w * 0.005), bh);
      const thumbH = Math.max(bh * 0.06, (bh * visible) / count);
      const thumbY = by + ((bh - thumbH) * top) / (count - visible);
      ctx.fillStyle = '#ee6018';
      ctx.fillRect(trackX, thumbY, Math.max(3, w * 0.005), thumbH);
    }
  }

  private centerNote(ctx: CanvasRenderingContext2D, w: number, text: string, h: number) {
    ctx.fillStyle = '#8c8c8c';
    ctx.font = `500 ${Math.round(h * 0.032)}px ${TERM_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(text, (BODY.x + BODY.w / 2) * w, (BODY.y + BODY.h / 2) * h);
    ctx.textAlign = 'left';
  }

  private paintRow(ctx: CanvasRenderingContext2D, i: number, x: number, y: number, bw: number, rh: number) {
    if (this.view === 'hire') {
      const d = this.stores.getFreeDesks()[i];
      if (!d) return;
      this.rowText(ctx, '🪑', d.label, 'tap to hire here', x, y, bw, rh);
      return;
    }
    if (this.view === 'queue') {
      const l = this.queueLists();
      const all: { t: QueueTask; icon: string }[] = [
        ...l.running.map((t) => ({ t, icon: '🤖' })),
        ...l.queued.map((t) => ({ t, icon: '⏳' })),
        ...l.done.map((t) => ({ t, icon: t.outcome === 'done' ? '✅' : '⚠️' })),
      ];
      const row = all[i];
      if (!row) return;
      const title = row.t.issue !== undefined ? `#${row.t.issue} ${row.t.title}` : row.t.title;
      const sub = row.t.status === 'running' ? `${row.t.workerName ?? 'a worker'}` : row.t.status === 'queued' ? `queued by ${row.t.addedBy}` : row.t.pr ? `PR #${row.t.pr.number}` : row.t.outcome ?? 'done';
      this.rowText(ctx, row.icon, title, sub, x, y, bw, rh);
      return;
    }
    // board
    if (this.boardTab === 'issues') {
      const it = this.openIssues()[i];
      if (!it) return;
      const task = this.stores.getQueue().tasks.find((t) => t.issue === it.number && t.status !== 'done');
      this.rowText(ctx, task ? '📋' : '📌', `#${it.number} ${it.title}`, `${it.author} · 💬 ${it.comments}`, x, y, bw, rh);
    } else {
      const pr = this.openPulls()[i];
      if (!pr) return;
      this.rowText(ctx, pr.isDraft ? '📝' : '🔀', `#${pr.number} ${pr.title}`, `${pr.author} · +${pr.additions}/-${pr.deletions}`, x, y, bw, rh);
    }
  }

  private rowText(ctx: CanvasRenderingContext2D, icon: string, title: string, sub: string, x: number, y: number, bw: number, rh: number) {
    ctx.fillStyle = '#eeeeee';
    ctx.font = `${Math.round(rh * 0.4)}px ${TERM_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, x + rh * 0.18, y + rh / 2);
    const tx = x + rh * 0.85;
    ctx.font = `600 ${Math.round(rh * 0.32)}px ${TERM_FONT}`;
    ctx.fillText(this.clip(ctx, title, bw - rh), tx, y + rh * 0.32);
    ctx.fillStyle = '#8c8c8c';
    ctx.font = `500 ${Math.round(rh * 0.24)}px ${TERM_FONT}`;
    ctx.fillText(this.clip(ctx, sub, bw - rh), tx, y + rh * 0.72);
    ctx.fillStyle = '#eeeeee';
  }

  private clip(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
    if (ctx.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
    return `${s}…`;
  }

  private paintDetail(ctx: CanvasRenderingContext2D, w: number, h: number, state: { hoverId: string | null; pressedId: string | null }) {
    const d = this.detail;
    if (!d) return;
    const item = d.kind === 'issue'
      ? this.stores.getIssues().items.find((i) => i.number === d.number)
      : this.stores.getPulls().items.find((p) => p.number === d.number);
    if (!item) {
      this.centerNote(ctx, w, 'Gone from the board', h);
      return;
    }
    const bx = BODY.x * w;
    const bw = BODY.w * w;
    let y = BODY.y * h + h * 0.01;
    ctx.fillStyle = '#eeeeee';
    ctx.font = `700 ${Math.round(h * 0.032)}px ${TERM_FONT}`;
    ctx.textBaseline = 'top';
    const titleLines = this.wrap(ctx, item.title, bw);
    for (const line of titleLines.slice(0, 3)) {
      ctx.fillText(line, bx, y);
      y += h * 0.04;
    }
    y += h * 0.005;
    ctx.fillStyle = '#8c8c8c';
    ctx.font = `500 ${Math.round(h * 0.024)}px ${TERM_FONT}`;
    const meta = d.kind === 'issue'
      ? `by ${(item as GhIssue).author} · 💬 ${(item as GhIssue).comments}`
      : `by ${(item as GhPull).author} · ${(item as GhPull).isDraft ? 'draft' : 'in review'} · +${(item as GhPull).additions}/-${(item as GhPull).deletions}`;
    ctx.fillText(meta, bx, y);
    y += h * 0.045;
    const labels = item.labels.slice(0, 4);
    if (labels.length) {
      ctx.font = `600 ${Math.round(h * 0.022)}px ${TERM_FONT}`;
      let lx = bx;
      for (const l of labels) {
        const tw = ctx.measureText(l.name).width + w * 0.03;
        if (lx + tw > bx + bw) break;
        ctx.fillStyle = `#${l.color}`;
        ctx.beginPath();
        ctx.roundRect(lx, y, tw, h * 0.032, h * 0.01);
        ctx.fill();
        ctx.fillStyle = '#111';
        ctx.fillText(l.name, lx + w * 0.015, y + h * 0.004);
        lx += tw + w * 0.015;
      }
      y += h * 0.05;
    }
    // Body, clipped to the space above the action buttons.
    const bottom = h * 0.8;
    ctx.fillStyle = '#cfcfcf';
    ctx.font = `400 ${Math.round(h * 0.023)}px ${TERM_FONT}`;
    const body = (item.body || 'No description.').replace(/\s+/g, ' ').slice(0, DETAIL_BODY_MAX);
    for (const line of this.wrap(ctx, body, bw)) {
      if (y + h * 0.03 > bottom) break;
      ctx.fillText(line, bx, y);
      y += h * 0.03;
    }
    // Actions.
    if (d.kind === 'issue') {
      this.actionBtn(ctx, w, h, { x: 0.05, y: 0.82, w: 0.42, h: 0.12 }, 'act:hand', '🤖 Hand to worker', state, true);
      this.actionBtn(ctx, w, h, { x: 0.53, y: 0.82, w: 0.42, h: 0.12 }, 'act:queue', '📋 Queue it', state, false);
    } else {
      const workerId = this.pullWorker(d.number);
      const name = workerId ? (this.stores.getWorkers().find((x) => x.id === workerId)?.name ?? '') : '';
      this.actionBtn(ctx, w, h, { x: 0.05, y: 0.82, w: 0.9, h: 0.12 }, 'act:term', workerId ? `💻 ${name}'s terminal` : 'No desk for this PR', state, !!workerId);
    }
  }

  private actionBtn(ctx: CanvasRenderingContext2D, w: number, h: number, r: Rect, id: string, label: string, state: { hoverId: string | null; pressedId: string | null }, primary: boolean) {
    const hot = state.hoverId === id || state.pressedId === id;
    ctx.fillStyle = primary ? (hot ? '#ff7a2e' : '#ee6018') : hot ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.roundRect(r.x * w, r.y * h, r.w * w, r.h * h, r.h * h * 0.3);
    ctx.fill();
    ctx.fillStyle = primary ? '#111' : '#eeeeee';
    ctx.font = `700 ${Math.round(r.h * h * 0.3)}px ${TERM_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, (r.x + r.w / 2) * w, (r.y + r.h / 2) * h);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  private wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = '';
    for (const word of words) {
      const next = cur ? `${cur} ${word}` : word;
      if (ctx.measureText(next).width > maxW && cur) {
        lines.push(cur);
        cur = word;
      } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  update(dt: number, camera?: THREE.Camera | null) {
    // Mute state can flip from the desktop side; the button label follows it.
    const muted = `${this.stores.isMuted()}|${this.stores.inVoice()}`;
    if (muted !== this.lastMuted && this.panel.visible) {
      this.lastMuted = muted;
      this.syncButtons();
      this.panel.markDirty();
    }
    // Row buttons track the list's scroll offset.
    if (this.panel.visible && this.view !== 'main' && this.view !== 'detail') {
      this.syncRowsIfMoved();
    }
    this.panel.update(dt, camera);
  }

  dispose() {
    this.unsubs.forEach((u) => u());
    this.panel.dispose();
  }
}
