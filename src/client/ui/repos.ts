import './repos.css';
import type { WorkerInfo } from '../../shared/protocol';
import { isBusy } from '../../shared/status';
import { store } from '../state';
import { h, openModal } from './dom';

// A worker across repositories (see WorkerInfo.repos): one task in worktrees of several floors'
// projects, all on the same branch, with a pull request in each repository it commits to.

/** Each of a worker's repositories, its own floor's first (no `floor`): the folder in its workspace, and its pull request. */
export function workerRepos(w: WorkerInfo): { floor?: string; name: string; pr?: { number: number; url: string } }[] {
  if (!w.worktree) return [];
  return [{ name: w.worktree.path.split(/[\\/]/).pop() || 'project', pr: w.pr }, ...(w.repos ?? []).map((r) => ({ floor: r.floor, name: r.name, pr: r.pr }))];
}

export interface RepoPullsActions {
  /** Its own floor's pull request, in the PR window. */
  openPull(number: number, url: string): void;
  /** Push and open the ones still missing ('worker.pr'). */
  openMissing(): void;
  /** The Changes window, on that repository's tab. */
  changes(repo?: string): void;
}

/**
 * O at the desk of a worker across repositories, once it has a pull request: each repository with
 * its pull request (or none yet) and its changes, and a button that opens the missing ones.
 */
export function openRepoPulls(workerId: string, actions: RepoPullsActions) {
  const title = h('h2');
  const note = h('p', { style: 'margin:0 0 12px;font-weight:700' });
  const list = h('ul.repo-pulls');
  const close = h('button.btn', { type: 'button' }, "닫기");
  const missing = h('button.btn.primary', { type: 'button' }, "🔀 아직 없는 PR 생성");
  const el = h('div.modal', { role: 'dialog', 'aria-label': "Pull requests" }, h('header', {}, title), h('div.body', {}, note, list), h('footer', {}, h('span.grow'), close, missing));

  const render = () => {
    const w = store.workers.get(workerId);
    if (!w?.worktree) return modal.close();
    const repos = workerRepos(w);
    title.textContent = `🔀 ${w.name}의 Pull requests`;
    note.textContent = `🌿 ${w.worktree.branch} 브랜치로 저장소 ${repos.length}개를 함께 작업합니다. 커밋한 저장소마다 PR을 생성하고 서로 연결합니다.`;
    list.replaceChildren(
      ...repos.map((r) => {
        const floor = r.floor ? store.floors.find((f) => f.id === r.floor)?.name : store.currentFloor()?.name;
        const pr = r.pr;
        return h(
          'li',
          {},
          h('span.name', {}, `📁 ${r.name}`, h('small', {}, floor ? `${floor} floor${r.floor ? '' : ' · this one'}` : "프로젝트 목록에서 제거됨")),
          pr
            ? h('button.btn', { type: 'button', title: r.floor ? "GitHub에서 열기" : "열기", onclick: () => (r.floor ? window.open(pr.url, '_blank', 'noopener') : (modal.close(), actions.openPull(pr.number, pr.url))) }, `🔀 #${pr.number}${r.floor ? ' ↗' : ''}`)
            : h('span.none', {}, "아직 PR 없음"),
          h('button.btn', { type: 'button', title: `${r.name}에서 ${w.name}이(가) 변경한 내용`, onclick: () => (modal.close(), actions.changes(r.floor)) }, "🌿 변경 사항"),
        );
      }),
    );
    const busy = isBusy(w.status);
    missing.classList.toggle('hidden', repos.every((r) => r.pr));
    missing.disabled = !!w.prOpening || busy;
    missing.textContent = w.prOpening ? "⏳ 생성 중…" : "🔀 아직 없는 PR 생성";
    missing.title = busy ? `${w.name}이(가) 아직 작업 중입니다. 완료될 때까지 기다려주세요` : "커밋이 있지만 PR이 없는 저장소에 브랜치를 push하고 PR을 생성합니다";
  };

  const unsub = store.on('workers', () => render());
  const modal = openModal(el, { doing: '🔀 looking over pull requests', onClose: () => unsub() });
  close.addEventListener('click', () => modal.close());
  missing.addEventListener('click', () => actions.openMissing());
  render();
  setTimeout(() => close.focus(), 30);
}
