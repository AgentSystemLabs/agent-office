import './upgrade.css';
import type { UpgradeState, VersionInfo } from '../../shared/protocol';
import type { Net } from '../net';
import { isAsleep } from '../../shared/status';
import { store } from '../state';
import { closeAllModals, h, openModal, timeAgo, type Modal } from './dom';

const version = (v: VersionInfo) => h('span.version', {}, h('code', {}, v.sha), ' ', v.subject, h('small', {}, ` · ${timeAgo(v.date)}`));

/** The ⬆️ panel: what's running, what's new upstream, and the button to upgrade. */
export function openUpgrade(net: Net) {
  const body = h('div.body.upgrade');
  const close = h('button.btn.close', { 'aria-label': "닫기" }, '✕');
  const recheck = h('button.btn', { type: 'button', onclick: () => net.send({ t: 'upgrade.check' }) }, "🔄 다시 확인");
  const go = h('button.btn.primary', { type: 'button', onclick: () => net.send({ t: 'upgrade.start' }) }, "⬆️ 지금 업데이트");
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': "Agent Office 업데이트", style: 'width:min(620px,100%)' },
    h('header', {}, h('h2', {}, "⬆️ Agent Office 업데이트"), close),
    body,
    h('footer', {}, h('span.grow', {}), recheck, go),
  );

  const render = () => {
    const u = store.upgrade;
    body.replaceChildren();
    if (u.current) body.append(h('label', {}, "현재 버전"), version(u.current));
    const busy = u.phase === 'building' || u.phase === 'restarting';
    recheck.disabled = !!u.checking || busy;
    go.disabled = !u.latest || !!u.checking || busy;

    if (u.phase === 'building') {
      body.append(h('p.upgrade-status.busy', {}, h('span.spinner'), `${u.latest?.sha ?? "새 버전"}을(를) 빌드하는 중${u.by ? ` (요청: ${u.by})` : ''}. 보통 1~2분 후 재시작하며 그전까지 계속 사용할 수 있습니다.`));
    } else if (u.phase === 'failed' && u.error) {
      body.append(h('pre.upgrade-error', {}, u.error));
    }
    if (u.checking) body.append(h('p.upgrade-status.busy', {}, h('span.spinner'), "GitHub에서 변경 사항을 확인하는 중…"));
    else if (u.error && u.phase !== 'failed') body.append(h('p.upgrade-status.error', {}, u.error));
    else if (!u.latest && u.checkedAt) body.append(h('p.upgrade-status.ok', {}, `✅ 최신 버전입니다 (확인: ${timeAgo(u.checkedAt)})`));

    if (u.latest) {
      const n = u.behind ?? u.changes?.length ?? 0;
      const shown = u.changes?.length ?? 0;
      body.append(
        h('label', { style: 'margin-top:14px' }, `새 변경 사항 ${n >= 50 ? '50+' : n}개`),
        h('ul.changes', {}, ...(u.changes ?? []).map((c) => h('li', {}, h('code', {}, c.sha), ' ', c.subject))),
      );
      if (n > shown) body.append(h('p.note', {}, `…and ${n >= 50 ? 'more' : `외 ${n - shown}개`}`));
      if (!busy) {
        const awake = [...store.workers.values()].some((w) => !isAsleep(w.status));
        body.append(
          h(
            'p.note',
            {},
            "사용 중인 상태에서 새 버전을 빌드한 뒤 다시 시작합니다. 모든 참여자는 새 버전에 자동으로 재접속합니다. ",
            awake ? "재시작 중에도 직원들의 작업은 계속되며 진행 중인 내용을 이어갑니다." : '',
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
    const el = h('div.modal.restart', { role: 'alertdialog', 'aria-label': "Agent Office 업데이트 중" }, h('header', {}, h('h2', {})), restartBody);
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
    "🛠️ Agent Office 업데이트 중",
    h('div.restart-art', {}, '🏗️'),
    h('p', {}, `${u.by ? `${u.by}이(가) 업데이트 중` : "업데이트 중"}${u.latest ? ` · ${u.latest.sha}: '${u.latest.subject}'` : ''}.`),
    h('p.upgrade-status.busy', {}, h('span.spinner'), "다시 시작하는 중… 몇 초 뒤 자동으로 연결됩니다."),
  );
  clearTimeout(slowTimer);
  slowTimer = setTimeout(
    () =>
      restartBody?.append(
        h('p.note', {}, "평소보다 오래 걸리고 있습니다. ", h('button.btn', { type: 'button', onclick: () => location.reload() }, "새로고침해 보세요")),
      ),
    3 * 60_000,
  );
}

/** Reconnected to a different version than this page was loaded from: load the new client. */
export function showUpgraded(u: UpgradeState) {
  clearTimeout(slowTimer);
  const v = u.current;
  restartDialog(
    "✨ Agent Office 업데이트 완료",
    h('div.restart-art', {}, '🎉'),
    v ? h('p', {}, "현재 버전: ", h('code', {}, v.sha), `: “${v.subject}”`) : h('p', {}, "새 버전으로 실행 중입니다."),
    h('p.upgrade-status.ok', {}, h('span.spinner'), "새 버전을 불러오는 중…"),
  );
  setTimeout(() => location.reload(), 2500);
}
