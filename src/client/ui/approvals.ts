import type { ApprovalCard } from '../../shared/protocol';
import { store } from '../state';
import { h } from './dom';

// Cards for the requests the easy approvals lever didn't answer (see server/approvals.ts): a worker is
// waiting in its terminal for a yes or no on something that isn't obviously fine. Each says who, what it
// wants to run, and in plain words why it was left to a person. The answer itself is given in the
// worker's terminal, one click away.

/** Cards you've closed, by worker and when it asked, so a new request from the same worker still shows. */
const dismissed = new Set<string>();

const key = (c: ApprovalCard) => `${c.workerId}|${c.at}`;

/** Puts the cards on the page. `openTerminal` opens a worker's terminal. */
export function mountApprovals(openTerminal: (workerId: string) => void) {
  const root = h('div', { id: 'approvals', 'aria-live': 'polite', 'aria-label': 'Requests waiting for you' });
  document.body.append(root);

  const render = () => {
    const cards = store.approvals.cards.filter((c) => store.workers.get(c.workerId)?.status === 'needs_input' && !dismissed.has(key(c)));
    root.replaceChildren(
      ...cards.map((c) =>
        h(
          'div.approval',
          { role: 'alert' },
          h(
            'div.approval-head',
            {},
            h('strong', {}, `⚠️ ${c.worker} needs your OK`),
            c.floor ? h('small', {}, c.floor) : '',
            h(
              'button.btn.close',
              {
                type: 'button',
                'aria-label': 'Dismiss',
                title: 'Dismiss (the worker keeps waiting in its terminal)',
                onclick: () => {
                  dismissed.add(key(c));
                  render();
                },
              },
              '✕',
            ),
          ),
          c.description ? h('p.approval-why', {}, `“${c.description}”`) : '',
          h('ul.approval-reasons', {}, ...c.reasons.map((r) => h('li', {}, r))),
          c.command ? h('pre.approval-command', {}, c.command) : '',
          h('div.approval-actions', {}, h('button.btn.primary', { type: 'button', onclick: () => openTerminal(c.workerId) }, '🖥️ Open its terminal to answer')),
        ),
      ),
    );
  };
  store.on('approvals', render);
  store.on('workers', render);
  render();
}
