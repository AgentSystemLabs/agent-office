// The workers list in the sidebar: every worker on your floor, what it's on, and what it has spent.

import { store } from '../state';
import { DESK_BY_ID } from '../../shared/layout';
import { $, h, STATUS_LABEL } from './dom';
import { usageLabel, usageTitle } from './usage';
import { providerLabel, providerUsageState, providerWaitingLabel, resolvedProvider, modelBadge } from './provider';

export function renderWorkers(onOpen: (id: string) => void) {
  const ul = $('workers');
  ul.replaceChildren();
  const workers = [...store.workers.values()].sort((a, b) => a.createdAt - b.createdAt);
  for (const w of workers) {
    const provider = w.kind === 'agent' ? providerLabel(w.provider, store.project) : null;
    const providerKind = w.kind === 'agent' ? resolvedProvider(w.provider, store.project) : undefined;
    const usageState = w.kind === 'agent' ? providerUsageState(w.provider, store.project, w.usage) : undefined;
    const waiting = usageState === 'waiting' ? providerWaitingLabel(providerKind, store.project) : '';
    const usageNote = usageState === 'untracked' ? ' · usage untracked' : waiting ? ` · ${waiting}` : '';
    const badge = w.kind === 'agent' ? modelBadge(w.provider, w.model, w.effort) : undefined;
    const sub = [provider && `⚙️ ${provider}${badge ? ` · ${badge}` : ''}${usageNote}`, w.worktree && `🌿 ${w.worktree.branch}`, w.repos?.length && `🗂️ ${w.repos.length + 1} repos`, w.pr && `🔀 PR #${w.pr.number}`, w.activity || w.title || w.prompt].filter(Boolean).join(' · ');
    ul.append(
      h(
        'li',
        { onclick: () => onOpen(w.id), title: `Open ${w.name}'s terminal` },
        h('span.dot', { style: `background:${w.color}` }),
        h('span.name', {}, w.name, sub ? h('span.sub', {}, sub) : null,
          usageState === 'tracked' && w.usage ? h('span.cost', { title: usageTitle(w.usage, providerKind) }, usageLabel(w.usage, providerKind)) : null),
        w.lost ? h('span.pill.lost', { title: 'Its worktree was deleted outside agent-office: open it to fix it' }, 'worktree deleted') : h('span.pill', { class: w.status }, STATUS_LABEL[w.status] ?? w.status),
      ),
    );
  }
  if (!workers.length) ul.append(h('li.empty', {}, 'Walk up to a desk and press E to hire one'));
  // The count is the workers hired onto desks and bean bags (and a meeting's table): the board agents
  // standing at the Issues, PR and queue kiosks are listed but aren't counted.
  const hired = workers.filter((w) => !DESK_BY_ID.get(w.deskId)?.station).length;
  $('worker-count').textContent = hired ? String(hired) : '';
}
