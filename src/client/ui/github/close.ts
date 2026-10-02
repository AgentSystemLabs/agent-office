import type { GhCloseReason, GhIssue, GhPull } from '../../../shared/protocol';
import type { Net } from '../../net';
import { store, workerForPull } from '../../state';
import { h, openModal } from '../dom';
import { closeWaiters } from './api';
import { L } from '../../i18n';

// ---- Close dialog -------------------------------------------------------------------------------

const REASON_LABEL: Record<GhCloseReason, string> = L.pull.reasons;

/** Closes an issue (as completed or not planned) or a PR without merging, with an optional comment. */
export function openClose(kind: 'issue' | 'pull', it: GhIssue | GhPull, net: Net, onClosed: () => void) {
  const key = `${kind}:${it.number}`;
  const pull = kind === 'pull' ? (it as GhPull) : null;
  let reason: GhCloseReason = 'completed';
  let busy = false;

  const go = h('button.btn.danger', { type: 'button' });
  const reasons = h('div.seg');
  const renderReasons = () => {
    reasons.replaceChildren(...(Object.keys(REASON_LABEL) as GhCloseReason[]).map((r) => h('button.btn', { type: 'button', class: r === reason ? 'on' : '', onclick: () => ((reason = r), renderReasons()) }, REASON_LABEL[r])));
    go.textContent = pull ? L.pull.closePr : `${reason === 'completed' ? '✔️' : '🚫'} ${L.pull.closeAs(REASON_LABEL[reason].replace(/^\S+ /, '').toLowerCase())}`;
  };
  const comment = h('textarea', { rows: 4, placeholder: L.pull.commentOptional, 'aria-label': L.pull.closingComment }) as HTMLTextAreaElement;
  const del = h('input', { type: 'checkbox', id: 'close-del' }) as HTMLInputElement;
  const w = pull && workerForPull(store.workers.values(), pull);
  const result = h('div.gh-merge-result.hidden');
  const cancel = h('button.btn', { type: 'button' }, L.hints.cancel);

  const el = h(
    'div.modal.gh-merge',
    { role: 'dialog', 'aria-label': L.pull.closeItem(!!pull, it.number) },
    h('header', {}, h('h2', {}, `${pull ? '🚫' : '✔️'} ${L.pull.closeItem(!!pull, it.number)}`)),
    h(
      'div.body',
      {},
      h('p.gh-merge-title', {}, it.title, pull ? h('small', {}, `${pull.headRefName} → ${pull.baseRefName}`) : null),
      pull
        ? h('div.gh-status.muted', {}, h('span', {}, 'ℹ️'), `${L.pull.wontMerge}${w ? L.pull.stillAtDesk(w.name) : ''}`)
        : h('label', {}, L.pull.why),
      pull ? h('label.gh-check', { for: 'close-del' }, del, L.pull.deleteToo(pull.headRefName)) : reasons,
      comment,
      result,
    ),
    h('footer', {}, h('span.grow'), cancel, go),
  );
  renderReasons();

  const modal = openModal(el, { onClose: () => closeWaiters.delete(key) });
  cancel.addEventListener('click', () => modal.close());
  go.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    go.disabled = true;
    result.className = 'gh-merge-result';
    result.replaceChildren(h('span.spinner'), L.pull.closing(!!pull));
    closeWaiters.set(key, (msg) => {
      closeWaiters.delete(key);
      busy = false;
      if (msg.error) {
        go.disabled = false;
        result.className = 'gh-merge-result error';
        result.replaceChildren(msg.error);
        return;
      }
      modal.close();
      onClosed();
    });
    net.send({ t: 'gh.close', kind, number: it.number, comment: comment.value.trim() || undefined, reason: pull ? undefined : reason, deleteBranch: !!pull && del.checked });
  });
  setTimeout(() => comment.focus(), 30);
}
