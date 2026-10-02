import './upgrade.css';
import type { UpgradeState, VersionInfo } from '../../shared/protocol';
import type { Net } from '../net';
import { isAsleep } from '../../shared/status';
import { store } from '../state';
import { closeAllModals, h, openModal, timeAgo, type Modal } from './dom';
import { L } from '../i18n';

const version = (v: VersionInfo) => h('span.version', {}, h('code', {}, v.sha), ' ', v.subject, h('small', {}, ` · ${timeAgo(v.date)}`));

/** The ⬆️ panel: what's running, what's new upstream, and the button to upgrade. */
export function openUpgrade(net: Net) {
  const body = h('div.body.upgrade');
  const close = h('button.btn.close', { 'aria-label': L.common.close }, '✕');
  const recheck = h('button.btn', { type: 'button', onclick: () => net.send({ t: 'upgrade.check' }) }, L.upgrade.checkAgain);
  const go = h('button.btn.primary', { type: 'button', onclick: () => net.send({ t: 'upgrade.start' }) }, L.upgrade.now);
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': L.menu.upgrade, style: 'width:min(620px,100%)' },
    h('header', {}, h('h2', {}, `⬆️ ${L.menu.upgrade}`), close),
    body,
    h('footer', {}, h('span.grow', {}), recheck, go),
  );

  const render = () => {
    const u = store.upgrade;
    body.replaceChildren();
    if (u.current) body.append(h('label', {}, L.upgrade.runningNow), version(u.current));
    const busy = u.phase === 'building' || u.phase === 'restarting';
    recheck.disabled = !!u.checking || busy;
    go.disabled = !u.latest || !!u.checking || busy;

    if (u.phase === 'building') {
      body.append(h('p.upgrade-status.busy', {}, h('span.spinner'), L.upgrade.building(u.latest?.sha, u.by)));
    } else if (u.phase === 'failed' && u.error) {
      body.append(h('pre.upgrade-error', {}, u.error));
    }
    if (u.checking) body.append(h('p.upgrade-status.busy', {}, h('span.spinner'), L.upgrade.checking));
    else if (u.error && u.phase !== 'failed') body.append(h('p.upgrade-status.error', {}, u.error));
    else if (!u.latest && u.checkedAt) body.append(h('p.upgrade-status.ok', {}, L.upgrade.upToDate(timeAgo(u.checkedAt))));

    if (u.latest) {
      const n = u.behind ?? u.changes?.length ?? 0;
      const shown = u.changes?.length ?? 0;
      body.append(
        h('label', { style: 'margin-top:14px' }, L.upgrade.newChanges(n >= 50 ? '50+' : String(n), n === 1)),
        h('ul.changes', {}, ...(u.changes ?? []).map((c) => h('li', {}, h('code', {}, c.sha), ' ', c.subject))),
      );
      if (n > shown) body.append(h('p.note', {}, n >= 50 ? L.upgrade.andMoreOpen : L.changes.andMore(n - shown)));
      if (!busy) {
        const awake = [...store.workers.values()].some((w) => !isAsleep(w.status));
        body.append(
          h(
            'p.note',
            {},
            L.upgrade.how,
            awake ? L.upgrade.workersKeep : '',
          ),
        );
      }
    }
  };

  const unsub = store.on('upgrade', render);
  const unsubWorkers = store.on('workers', render);
  const modal = openModal(el, {
    onClose: () => {
      unsub();
      unsubWorkers();
    },
  });
  close.addEventListener('click', () => modal.close());
  render();
  net.send({ t: 'upgrade.check' });
}

// --- Restart: a modal saying so, then a reload onto the new version ------------------------------

let restartModal: Modal | null = null;
/** The office said it's restarting: this page reloads when it's back, whether or not the window is still up. */
let restartPending = false;

export const restarting = () => restartPending;
let restartBody: HTMLElement | null = null;
let slowTimer: ReturnType<typeof setTimeout> | undefined;

function restartDialog(title: string, ...content: (Node | string)[]) {
  if (!restartModal) {
    closeAllModals();
    restartBody = h('div.body');
    const el = h('div.modal.restart', { role: 'alertdialog', 'aria-label': L.upgrade.isUpgrading }, h('header', {}, h('h2', {})), restartBody);
    // Closing it only hides it: the reload still comes once the office is back.
    restartModal = openModal(el, {
      backdropCloses: false,
      onClose: () => {
        restartModal = null;
        restartBody = null;
      },
    });
  }
  restartModal.el.querySelector('h2')!.textContent = title;
  restartBody!.replaceChildren(...content);
}

/** The server said it's about to restart into a new version. */
export function showRestarting(u: UpgradeState, net: Net) {
  net.expectRestart();
  restartPending = true;
  restartDialog(
    L.upgrade.upgradingTitle,
    h('div.restart-art', {}, '🏗️'),
    h('p', {}, L.upgrade.upgradingTo(u.by, u.latest ? `${u.latest.sha}: “${u.latest.subject}”` : undefined)),
    h('p.upgrade-status.busy', {}, h('span.spinner'), L.upgrade.restarting),
  );
  clearTimeout(slowTimer);
  slowTimer = setTimeout(
    () =>
      restartBody?.append(
        h('p.note', {}, L.upgrade.slow, h('button.btn', { type: 'button', onclick: () => location.reload() }, L.upgrade.reload)),
      ),
    3 * 60_000,
  );
}

/** Reconnected to a different version than this page was loaded from: load the new client. */
export function showUpgraded(u: UpgradeState) {
  clearTimeout(slowTimer);
  const v = u.current;
  restartDialog(
    L.upgrade.upgraded,
    h('div.restart-art', {}, '🎉'),
    v ? h('p', {}, L.upgrade.nowRunning, h('code', {}, v.sha), `: “${v.subject}”`) : h('p', {}, L.upgrade.newRunning),
    h('p.upgrade-status.ok', {}, h('span.spinner'), L.upgrade.loadingNew),
  );
  setTimeout(() => location.reload(), 2500);
}
