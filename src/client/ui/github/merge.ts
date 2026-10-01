import type { GhCheck, GhMergeMethod, GhPull, GhPullDetail } from '../../../shared/protocol';
import type { Net } from '../../net';
import { h, openModal } from '../dom';
import { mergeWaiters } from './api';
import { MERGE_KEY, mergePref, savePref } from './prefs';
import { L } from '../../i18n';

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
  if (d.state === 'MERGED') return { icon: '🎉', text: L.pull.mergedDone, cls: 'ok', can: false, auto: false };
  if (d.state === 'CLOSED') return { icon: '🗑️', text: L.pull.closedNoMerge, cls: 'muted', can: false, auto: false };
  if (d.isDraft) return { icon: '📝', text: L.pull.stillDraft, cls: 'muted', can: false, auto: false };
  if (conflicted(d))
    return { icon: '⚠️', text: L.pull.conflicts(d.baseRefName), cls: 'bad', can: false, auto: false };
  if (d.mergeStateStatus === 'BEHIND') return { icon: '⤵️', text: L.pull.behind(d.baseRefName), cls: 'warn', can: true, auto: true };
  if (d.mergeStateStatus === 'BLOCKED') {
    const why = d.reviewDecision === 'CHANGES_REQUESTED' ? L.pull.whyChanges : d.reviewDecision === 'REVIEW_REQUIRED' ? L.pull.whyReview : failing ? L.pull.whyFailing(failing) : pending ? L.pull.whyPending : L.pull.whyRule;
    return { icon: '🚫', text: L.pull.blocked(why), cls: 'bad', can: true, auto: true };
  }
  if (failing) return { icon: '❌', text: L.pull.failingCanMerge(failing), cls: 'warn', can: true, auto: false };
  if (pending || d.mergeStateStatus === 'UNSTABLE') return { icon: '🟡', text: L.pull.checksRunning, cls: 'warn', can: true, auto: true };
  if (d.mergeStateStatus === 'UNKNOWN' || d.mergeable === 'UNKNOWN') return { icon: '⏳', text: L.pull.unknown, cls: 'muted', can: true, auto: false };
  return { icon: '✅', text: L.pull.ready(d.baseRefName, d.checks.length > 0), cls: 'ok', can: true, auto: false };
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

const METHOD_LABEL: Record<GhMergeMethod, string> = L.pull.methods;

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
    go.textContent = auto.checked ? L.pull.mergeWhenReady : `🔀 ${METHOD_LABEL[method]}`;
  };
  auto.addEventListener('change', renderMethods);
  const del = h('input', { type: 'checkbox', id: 'merge-del' }) as HTMLInputElement;
  del.checked = deleteBranch;
  del.addEventListener('change', () => {
    deleteBranch = del.checked;
    savePref(MERGE_KEY, { method, deleteBranch });
  });
  const result = h('div.gh-merge-result.hidden');
  const cancel = h('button.btn', { type: 'button' }, L.hints.cancel);
  // Conflicts can't be merged from here, so fixing them is the main button.
  const worker = conflicted(d)
    ? h('button.btn.primary', { type: 'button', title: L.pull.newWorkerFixTip }, L.pull.newWorkerFix)
    : h('button.btn', { type: 'button', title: L.pull.handTip }, L.pull.hand);

  const el = h(
    'div.modal.gh-merge',
    { role: 'dialog', 'aria-label': L.pull.mergePr(it.number) },
    h('header', {}, h('h2', {}, `🔀 ${L.pull.mergePr(it.number)}`)),
    h(
      'div.body',
      {},
      h('p.gh-merge-title', {}, it.title, h('small', {}, `${it.headRefName} → ${it.baseRefName}`)),
      h('div.gh-status', { class: st.cls }, h('span', {}, st.icon), st.text),
      d.checks.length ? checksList(d.checks) : null,
      h('label', { style: 'margin-top:14px' }, L.pull.how),
      methodBtns,
      h('label.gh-check', { for: 'merge-del' }, del, L.pull.deleteAfter(it.headRefName)),
      st.auto ? h('label.gh-check', { for: 'merge-auto', title: L.pull.autoTip }, auto, L.pull.autoMerge) : null,
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
    result.replaceChildren(h('span.spinner'), auto.checked && st.auto ? L.pull.askingAuto : L.pull.merging);
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
