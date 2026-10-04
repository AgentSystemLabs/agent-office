import type { GhCheck, GhMergeMethod, GhPull, GhPullDetail } from '../../../shared/protocol';
import type { Net } from '../../net';
import { h, openModal } from '../dom';
import { mergeWaiters } from './api';
import { MERGE_KEY, mergePref, savePref } from './prefs';

// ---- Whether a PR can merge ---------------------------------------------------------------------

const CHECK_ICON: Record<GhCheck['state'], string> = { pass: '✅', fail: '❌', pending: '🟡', skip: '⚪' };

interface MergeStatus {
  icon: string;
  text: string;
  cls: 'ok' | 'warn' | 'bad' | 'muted';
  /** False when merging can't work at all (draft, conflicts, already merged). */
  can: boolean;
  /** GitHub could merge it on its own once the requirements pass. */
  auto: boolean;
}

/** An open PR whose branch can't merge until someone resolves conflicts with the base. */
export function conflicted(d: GhPullDetail) {
  return d.state === 'OPEN' && !d.isDraft && (d.mergeable === 'CONFLICTING' || d.mergeStateStatus === 'DIRTY');
}

export function mergeStatus(d: GhPullDetail): MergeStatus {
  const failing = d.checks.filter((c) => c.state === 'fail').length;
  const pending = d.checks.filter((c) => c.state === 'pending').length;
  if (d.state === 'MERGED') return { icon: '🎉', text: "병합되었습니다.", cls: 'ok', can: false, auto: false };
  if (d.state === 'CLOSED') return { icon: '🗑️', text: "병합하지 않고 닫았습니다.", cls: 'muted', can: false, auto: false };
  if (d.isDraft) return { icon: '📝', text: "아직 초안입니다. GitHub에서 검토 준비 완료로 바꾼 뒤 병합하세요.", cls: 'muted', can: false, auto: false };
  if (conflicted(d))
    return { icon: '⚠️', text: `${d.baseRefName}과(와) 충돌하는 브랜치입니다. 먼저 충돌을 해결하세요.`, cls: 'bad', can: false, auto: false };
  if (d.mergeStateStatus === 'BEHIND') return { icon: '⤵️', text: `이 브랜치가 ${d.baseRefName}보다 뒤처져 있습니다. 이 저장소에서는 최신 변경을 반영한 뒤 병합해야 합니다.`, cls: 'warn', can: true, auto: true };
  if (d.mergeStateStatus === 'BLOCKED') {
    const why = d.reviewDecision === 'CHANGES_REQUESTED' ? "수정 요청이 있습니다" : d.reviewDecision === 'REVIEW_REQUIRED' ? "승인된 검토가 필요합니다" : failing ? `검사 ${failing}개 실패` : pending ? "필수 검사가 진행 중입니다" : "브랜치 규칙을 아직 충족하지 못했습니다";
    return { icon: '🚫', text: `병합할 수 없습니다: ${why}.`, cls: 'bad', can: true, auto: true };
  }
  if (failing) return { icon: '❌', text: `검사 ${failing}개가 실패했지만 병합은 가능합니다.`, cls: 'warn', can: true, auto: false };
  if (pending || d.mergeStateStatus === 'UNSTABLE') return { icon: '🟡', text: "검사가 진행 중입니다. 지금 병합하거나 통과한 뒤 병합할 수 있습니다.", cls: 'warn', can: true, auto: true };
  if (d.mergeStateStatus === 'UNKNOWN' || d.mergeable === 'UNKNOWN') return { icon: '⏳', text: "GitHub에서 병합 가능 여부를 확인 중입니다. 잠시 후 새로고침하세요.", cls: 'muted', can: true, auto: false };
  return { icon: '✅', text: `병합할 수 있습니다. ${d.baseRefName}과(와) 충돌이 없습니다${d.checks.length ? ", 모든 검사 통과" : ''}.`, cls: 'ok', can: true, auto: false };
}

export function checksList(checks: GhCheck[]) {
  const order: GhCheck['state'][] = ['fail', 'pending', 'pass', 'skip'];
  const sorted = [...checks].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
  return h(
    'ul.gh-checks',
    {},
    ...sorted.map((c) => h('li', {}, h('span', { 'aria-label': c.state }, CHECK_ICON[c.state]), c.url ? h('a', { href: c.url, target: '_blank', rel: 'noopener noreferrer' }, c.name) : h('span', {}, c.name))),
  );
}

// ---- Merge dialog -------------------------------------------------------------------------------

const METHOD_LABEL: Record<GhMergeMethod, string> = { squash: "Squash 후 병합", merge: "Merge commit으로 병합", rebase: "Rebase 후 병합" };

export function openMerge(it: GhPull, d: GhPullDetail, net: Net, handToWorker: () => void, onMerged: () => void) {
  const st = mergeStatus(d);
  const methods = d.repo.methods;
  let { method, deleteBranch } = mergePref(methods);
  let busy = false;

  const methodBtns = h('div.seg');
  const go = h('button.btn.primary', { type: 'button' });
  const auto = h('input', { type: 'checkbox', id: 'merge-auto' }) as HTMLInputElement;
  auto.checked = st.auto && st.cls !== 'ok';
  const renderMethods = () => {
    methodBtns.replaceChildren(
      ...methods.map((m) =>
        h('button.btn', { type: 'button', class: m === method ? 'on' : '', onclick: () => ((method = m), savePref(MERGE_KEY, { method, deleteBranch }), renderMethods()) }, METHOD_LABEL[m]),
      ),
    );
    go.textContent = auto.checked ? "⏱ 조건 충족 시 병합" : `🔀 ${METHOD_LABEL[method]}`;
  };
  auto.addEventListener('change', renderMethods);
  const del = h('input', { type: 'checkbox', id: 'merge-del' }) as HTMLInputElement;
  del.checked = deleteBranch;
  del.addEventListener('change', () => {
    deleteBranch = del.checked;
    savePref(MERGE_KEY, { method, deleteBranch });
  });
  const result = h('div.gh-merge-result.hidden');
  const cancel = h('button.btn', { type: 'button' }, "취소");
  // Conflicts can't be merged from here, so fixing them is the main button.
  const worker = conflicted(d)
    ? h('button.btn.primary', { type: 'button', title: "새 직원이 기준 브랜치를 반영하고 충돌을 해결한 뒤 선택한 방식으로 병합합니다" }, "✨ 새 직원에게 충돌 해결 및 병합 맡기기")
    : h('button.btn', { type: 'button', title: "직원이 병합을 막는 문제를 해결한 뒤 병합합니다" }, "🤖 직원에게 맡기기");

  const el = h(
    'div.modal.gh-merge',
    { role: 'dialog', 'aria-label': `PR #${it.number} 병합` },
    h('header', {}, h('h2', {}, `🔀 #${it.number} 병합`)),
    h(
      'div.body',
      {},
      h('p.gh-merge-title', {}, it.title, h('small', {}, `${it.headRefName} → ${it.baseRefName}`)),
      h('div.gh-status', { class: st.cls }, h('span', {}, st.icon), st.text),
      d.checks.length ? checksList(d.checks) : null,
      h('label', { style: 'margin-top:14px' }, "병합 방식"),
      methodBtns,
      h('label.gh-check', { for: 'merge-del' }, del, `병합 후 ${it.headRefName} 삭제`),
      st.auto ? h('label.gh-check', { for: 'merge-auto', title: 'gh pr merge --auto (the repo must allow auto-merge)' }, auto, "필수 조건을 충족하면 자동 병합") : null,
      result,
    ),
    h('footer', {}, st.can || conflicted(d) ? null : worker, h('span.grow'), cancel, conflicted(d) ? worker : go),
  );
  renderMethods();
  if (!st.can) go.disabled = true;

  const modal = openModal(el, { onClose: () => mergeWaiters.delete(it.number) });
  cancel.addEventListener('click', () => modal.close());
  worker.addEventListener('click', () => {
    modal.close();
    handToWorker();
  });
  go.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    go.disabled = true;
    result.className = 'gh-merge-result';
    result.replaceChildren(h('span.spinner'), auto.checked && st.auto ? "GitHub에 조건 충족 시 병합을 요청하는 중…" : "병합 중…");
    mergeWaiters.set(it.number, (msg) => {
      mergeWaiters.delete(it.number);
      busy = false;
      if (msg.error) {
        go.disabled = false;
        result.className = 'gh-merge-result error';
        result.replaceChildren(msg.error);
        return;
      }
      modal.close();
      onMerged();
    });
    net.send({ t: 'gh.merge', number: it.number, method, deleteBranch, auto: auto.checked && st.auto });
  });
  setTimeout(() => (st.can ? go : cancel).focus(), 30);
}
