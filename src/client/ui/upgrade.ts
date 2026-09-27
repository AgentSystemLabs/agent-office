import type { UpgradeState, VersionInfo } from '../../shared/protocol';
import type { Net } from '../net';
import { isAsleep } from '../../shared/status';
import { store } from '../state';
import { closeAllModals, h, openModal, timeAgo, type Modal } from './dom';

const version = (v: VersionInfo) => h('span.version', {}, h('code', {}, v.sha), ' ', v.subject, h('small', {}, ` · ${timeAgo(v.date)}`));

/** The ⬆️ panel: what's running, what's new upstream, and the button to upgrade. */
export function openUpgrade(net: Net) {
  const body = h('div.body.upgrade');
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const recheck = h('button.btn', { type: 'button', onclick: () => net.send({ t: 'upgrade.check' }) }, '🔄 Check again');
  const go = h('button.btn.primary', { type: 'button', onclick: () => net.send({ t: 'upgrade.start' }) }, '⬆️ Upgrade now');
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': 'Upgrade the office', style: 'width:min(620px,100%)' },
    h('header', {}, h('h2', {}, '⬆️ Upgrade the office'), close),
    body,
    h('footer', {}, h('span.grow', {}), recheck, go),
  );

  const render = () => {
    const u = store.upgrade;
    body.replaceChildren();
    if (u.current) body.append(h('label', {}, 'Running now'), version(u.current));
    const busy = u.phase === 'building' || u.phase === 'restarting';
    recheck.disabled = !!u.checking || busy;
    go.disabled = !u.latest || !!u.checking || busy;

    if (u.phase === 'building') {
      body.append(h('p.upgrade-status.busy', {}, h('span.spinner'), `Building ${u.latest?.sha ?? 'the new version'}${u.by ? ` (started by ${u.by})` : ''}. The office keeps working until it restarts, usually in a minute or two.`));
    } else if (u.phase === 'failed' && u.error) {
      body.append(h('pre.upgrade-error', {}, u.error));
    }
    if (u.checking) body.append(h('p.upgrade-status.busy', {}, h('span.spinner'), 'Checking GitHub for changes…'));
    else if (u.error && u.phase !== 'failed') body.append(h('p.upgrade-status.error', {}, u.error));
    else if (!u.latest && u.checkedAt) body.append(h('p.upgrade-status.ok', {}, `✅ Up to date (checked ${timeAgo(u.checkedAt)})`));

    if (u.latest) {
      const n = u.behind ?? u.changes?.length ?? 0;
      const shown = u.changes?.length ?? 0;
      body.append(
        h('label', { style: 'margin-top:14px' }, `New: ${n >= 50 ? '50+' : n} change${n === 1 ? '' : 's'}`),
        h('ul.changes', {}, ...(u.changes ?? []).map((c) => h('li', {}, h('code', {}, c.sha), ' ', c.subject))),
      );
      if (n > shown) body.append(h('p.note', {}, `…and ${n >= 50 ? 'more' : `${n - shown} more`}`));
      if (!busy) {
        const awake = [...store.workers.values()].filter((w) => !isAsleep(w.status));
        const working = awake.filter((w) => w.status === 'working' || w.status === 'needs_input');
        body.append(
          h(
            'p.note',
            {},
            'Upgrading builds the new version while the office keeps running, then restarts it. Everyone reconnects on the new version automatically. ',
            awake.length ? `Workers who are awake wake back up by themselves afterwards${working.length ? `, but ${working.map((w) => w.name).join(', ')} ${working.length === 1 ? 'is' : 'are'} in the middle of something that will be interrupted` : ''}.` : '',
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

// --- Restart: a modal nobody can dismiss, then a reload onto the new version ---------------------

let restartModal: Modal | null = null;

export const restarting = () => restartModal !== null;
let restartBody: HTMLElement | null = null;
let slowTimer: ReturnType<typeof setTimeout> | undefined;

function restartDialog(title: string, ...content: (Node | string)[]) {
  if (!restartModal) {
    closeAllModals();
    restartBody = h('div.body');
    const el = h('div.modal.restart', { role: 'alertdialog', 'aria-label': 'The office is upgrading' }, h('header', {}, h('h2', {})), restartBody);
    restartModal = openModal(el, { escCloses: false, backdropCloses: false });
  }
  restartModal.el.querySelector('h2')!.textContent = title;
  restartBody!.replaceChildren(...content);
}

/** The server said it's about to restart into a new version. */
export function showRestarting(u: UpgradeState, net: Net) {
  net.expectRestart();
  restartDialog(
    '🛠️ Upgrading the office',
    h('div.restart-art', {}, '🏗️'),
    h('p', {}, `${u.by ? `${u.by} is upgrading` : 'Upgrading'} the office${u.latest ? ` to ${u.latest.sha}: “${u.latest.subject}”` : ''}.`),
    h('p.upgrade-status.busy', {}, h('span.spinner'), 'Restarting… you’ll be back in a few seconds. No need to do anything.'),
  );
  clearTimeout(slowTimer);
  slowTimer = setTimeout(
    () =>
      restartBody?.append(
        h('p.note', {}, 'This is taking longer than usual. ', h('button.btn', { type: 'button', onclick: () => location.reload() }, 'Try reloading')),
      ),
    3 * 60_000,
  );
}

/** Reconnected to a different version than this page was loaded from: load the new client. */
export function showUpgraded(u: UpgradeState) {
  clearTimeout(slowTimer);
  const v = u.current;
  restartDialog(
    '✨ The office has been upgraded',
    h('div.restart-art', {}, '🎉'),
    v ? h('p', {}, 'Now running ', h('code', {}, v.sha), `: “${v.subject}”`) : h('p', {}, 'A new version is running.'),
    h('p.upgrade-status.ok', {}, h('span.spinner'), 'Loading the new version…'),
  );
  setTimeout(() => location.reload(), 2500);
}
