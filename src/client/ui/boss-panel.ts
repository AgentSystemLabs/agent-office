// Boss Mode — a central control panel that lets any user toggle "boss mode" and control
// all workers from one place: see their status, broadcast a prompt to all, or send them home.

import './boss-panel.css';
import { store } from '../state';
import { needyFirst } from '../nextup';
import { STATUS_LABEL, h, toast } from './dom';
import type { Net } from '../net';
import { fmtCost, fmtTokens, tokensOf } from '../../shared/protocol';
import { exportFloorReport, findMostIdleWorker } from './boss-helpers';
import { playIntercomSound } from '../sound/alerts';
import type { OfficeSound } from '../sound';

/** Whether boss mode is currently active (stored in memory; not persisted across reloads). */
let bossMode = false;

/** Re-renders the boss panel list and analytics summary bar whenever the store changes. */
export function renderBossPanel(net: Net, onOpenWorker: (id: string) => void) {
  const panel = document.getElementById('boss-panel');
  if (!panel) return;

  // --- Update Analytics Summary Bar ---
  const summaryBar = panel.querySelector<HTMLDivElement>('#boss-summary-bar');
  if (summaryBar) {
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

    const summaryContent = h(
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
        h('span.label', {}, 'Spend'),
        h('span.val.spend', {}, `${fmtCost(totalCost)} · ${fmtTokens(totalTokens)}`),
      ),
    );
    summaryBar.append(summaryContent);
  }

  // --- Update Worker List ---
  const list = panel.querySelector<HTMLUListElement>('.boss-workers');
  if (!list) return;

  list.replaceChildren();

  const workers = needyFirst(store.workers.values());

  if (!workers.length) {
    list.append(h('li.boss-empty', {}, 'No workers hired on this floor yet.'));
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

    const sendHomeBtn = h(
      'button.boss-worker-send-home',
      {
        type: 'button',
        title: `Send ${w.name} home`,
        onclick: (e: Event) => {
          e.stopPropagation();
          if (confirm(`Send ${w.name} home?`)) {
            net.send({ t: 'worker.kill', workerId: w.id });
          }
        },
      },
      'Send home',
    );

    const card = h(
      'li.boss-worker-card',
      {
        title: `Open ${w.name}'s terminal`,
        onclick: () => onOpenWorker(w.id),
      },
      h('span.boss-worker-dot', { style: `background:${w.color}` }),
      h(
        'span.boss-worker-info',
        {},
        h('div.boss-worker-name', {}, w.name),
        h('div.boss-worker-activity', {}, w.activity ?? w.title ?? w.prompt ?? '—'),
      ),
      h('span.boss-worker-status', { class: statusClass }, statusText),
      sendHomeBtn,
    );

    list.append(card);
  }
}

/**
 * Mounts the Boss Mode toggle button inside the workers panel header and wires up the
 * boss panel section that sits just below the workers panel in the sidebar.
 *
 * Call once during app init, after the DOM is ready.
 */
export function initBossMode(net: Net, onOpenWorker: (id: string) => void, sound?: OfficeSound) {
  // --- 1. Create the toggle button and inject it next to the workers count ----
  const workerCount = document.getElementById('worker-count');
  if (workerCount) {
    const toggle = h(
      'button',
      {
        id: 'boss-toggle',
        type: 'button',
        title: 'Toggle Boss Mode — control all workers from one panel',
      },
      '👔 Boss',
    );

    toggle.addEventListener('click', () => {
      bossMode = !bossMode;
      toggle.classList.toggle('boss-on', bossMode);
      const panel = document.getElementById('boss-panel');
      if (panel) panel.classList.toggle('visible', bossMode);
      if (bossMode) renderBossPanel(net, onOpenWorker);
    });

    // Insert after the count span
    workerCount.insertAdjacentElement('afterend', toggle);
  }

  // --- 2. Wire up the Broadcast button (with Intercom Sound) --------------------
  const broadcastInput = document.getElementById('boss-broadcast-input') as HTMLInputElement | null;
  const broadcastBtn = document.getElementById('boss-broadcast-btn') as HTMLButtonElement | null;

  if (broadcastInput && broadcastBtn) {
    const doSend = () => {
      const text = broadcastInput.value.trim();
      if (!text) return;
      const workers = [...store.workers.values()];
      if (!workers.length) {
        toast('No active workers to broadcast to', 'warn');
        return;
      }

      // Play Intercom audio chime alert
      playIntercomSound(sound);

      // Send the prompt to every worker on this floor
      for (const w of workers) {
        net.send({ t: 'worker.prompt', workerId: w.id, prompt: text });
      }
      broadcastInput.value = '';
      toast(`Broadcast sent to ${workers.length} worker(s)`);
    };

    broadcastBtn.addEventListener('click', doSend);
    broadcastInput.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') doSend();
    });
  }

  // --- 3. Wire up Smart Auto-Assign button -------------------------------------
  const autoAssignBtn = document.getElementById('boss-auto-assign-btn') as HTMLButtonElement | null;
  if (autoAssignBtn) {
    autoAssignBtn.addEventListener('click', () => {
      let text = broadcastInput?.value.trim() ?? '';
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

      playIntercomSound(sound);
      net.send({ t: 'worker.prompt', workerId: worker.id, prompt: text });
      if (broadcastInput) broadcastInput.value = '';
      toast(`Auto-assigned prompt to ${worker.name}`);
    });
  }

  // --- 4. Wire up Export Floor Report button -----------------------------------
  const exportBtn = document.getElementById('boss-export-report-btn') as HTMLButtonElement | null;
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      exportFloorReport();
    });
  }

  // --- 5. Wire up the Send All Home button ------------------------------------
  const sendAllBtn = document.getElementById('boss-send-all-btn') as HTMLButtonElement | null;
  if (sendAllBtn) {
    sendAllBtn.addEventListener('click', () => {
      const workers = [...store.workers.values()];
      if (!workers.length) return;
      if (!confirm(`Send all ${workers.length} worker(s) home?`)) return;
      for (const w of workers) {
        net.send({ t: 'worker.kill', workerId: w.id });
      }
    });
  }
}

/** Call this whenever the workers store changes so the boss panel stays in sync. */
export function refreshBossPanel(net: Net, onOpenWorker: (id: string) => void) {
  if (!bossMode) return;
  renderBossPanel(net, onOpenWorker);
}

