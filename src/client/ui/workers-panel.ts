// The workers list retains its rows while their display values change.
// One that needs you goes to the top, in red, saying what it's asking and for how long.
import { needyFirst } from '../nextup';
import { store } from '../state';
import { DESK_BY_ID } from '../../shared/layout';
import { $, h, STATUS_LABEL, timeAgo } from './dom';
import { usageLabel, usageTitle } from './usage';
import { providerLabel, providerUsageState, providerWaitingLabel, resolvedProvider, modelBadge } from './provider';
import { coalescedUpdate, KeyedRows } from './updates';

interface DisplayWorker {
  id: string;
  name: string;
  color: string;
  sub: string;
  cost: string;
  costTitle: string;
  status: string;
  lost: boolean;
  asking: boolean;
  ask: string;
}
interface WorkerRow { el: HTMLLIElement; dot: HTMLElement; label: Text; sub: HTMLElement; cost: HTMLElement; pill: HTMLElement; ask: HTMLElement }
const rows = new KeyedRows<DisplayWorker, WorkerRow>();
let openWorker: (id: string) => void;
const pending = coalescedUpdate(paintWorkers, (fn) => requestAnimationFrame(fn), (id) => cancelAnimationFrame(id));

export function renderWorkers(onOpen: (id: string) => void) {
  openWorker = onOpen;
  pending.schedule();
}

function paintWorkers() {
  const ul = $('workers');
  const workers = needyFirst(store.workers.values());
  const display = workers.map((w): DisplayWorker => {
    const asking = w.status === 'needs_input' && !w.lost;
    const provider = w.kind === 'agent' ? providerLabel(w.provider, store.project) : null;
    const providerKind = w.kind === 'agent' ? resolvedProvider(w.provider, store.project) : undefined;
    const usageState = w.kind === 'agent' ? providerUsageState(w.provider, store.project, w.usage) : undefined;
    const waiting = usageState === 'waiting' ? providerWaitingLabel(providerKind, store.project) : '';
    const usageNote = usageState === 'untracked' ? ' · usage untracked' : waiting ? ` · ${waiting}` : '';
    const badge = w.kind === 'agent' ? modelBadge(w.provider, w.model, w.effort, w.usage?.model) : undefined;
    const sub = [provider && `⚙️ ${provider}${badge ? ` · ${badge}` : ''}${usageNote}`, w.worktree && `🌿 ${w.worktree.branch}`, w.repos?.length && `🗂️ ${w.repos.length + 1} repos`, w.pr && `🔀 PR #${w.pr.number}`, w.activity || w.title || w.prompt].filter(Boolean).join(' · ');
    // What it's stopped on, and since when, on a line of its own under its name.
    const ask = asking ? `🙋 ${w.activity ?? 'Waiting on an answer'}${w.waitingSince ? ` · ${timeAgo(w.waitingSince)}` : ''}` : '';
    return { id: w.id, name: w.name, color: w.color, sub, status: w.status, lost: !!w.lost, asking, ask,
      cost: usageState === 'tracked' && w.usage ? usageLabel(w.usage, providerKind) : '',
      costTitle: usageState === 'tracked' && w.usage ? usageTitle(w.usage, providerKind) : '' };
  });
  const next = rows.reconcile(display, (w) => w.id, (w) => JSON.stringify(w), makeRow, paintRow).map((row) => row.el);
  const retained = new Set<Node>(next);
  for (const node of [...ul.childNodes]) if (!retained.has(node)) node.remove();
  next.forEach((node, index) => { if (ul.children[index] !== node) ul.insertBefore(node, ul.children[index] ?? null); });
  if (!workers.length) ul.append(h('li.empty', {}, 'Walk up to a desk and press E to hire one'));
  const hired = workers.filter((w) => !DESK_BY_ID.get(w.deskId)?.station).length;
  $('worker-count').textContent = hired ? String(hired) : '';
  $('workers-panel').classList.toggle('needs-you-panel', workers.some((w) => w.status === 'needs_input'));
}

function makeRow(w: DisplayWorker): WorkerRow {
  const label = document.createTextNode('');
  const dot = h('span.dot');
  const sub = h('span.sub');
  const cost = h('span.cost');
  const pill = h('span.pill');
  const ask = h('span.ask');
  const el = h('li', { onclick: () => openWorker(w.id) }, dot, h('span.name', {}, label, sub, cost), pill);
  const row = { el, dot, label, sub, cost, pill, ask };
  paintRow(row, w);
  return row;
}

function paintRow(row: WorkerRow, w: DisplayWorker) {
  row.el.title = w.asking ? `${w.name} needs you: open its terminal to answer` : `Open ${w.name}'s terminal`;
  row.el.classList.toggle('needs-you-row', w.asking);
  row.dot.style.background = w.color;
  row.label.nodeValue = w.name;
  row.sub.textContent = w.sub;
  row.sub.hidden = !w.sub;
  row.cost.textContent = w.cost;
  row.cost.title = w.costTitle;
  row.cost.hidden = !w.cost;
  row.pill.className = `pill ${w.lost ? 'lost' : w.status}`;
  row.pill.title = w.lost ? 'Its worktree was deleted outside agent-office: open it to fix it' : '';
  row.pill.textContent = w.lost ? 'worktree deleted' : w.asking ? 'NEEDS YOU' : STATUS_LABEL[w.status] ?? w.status;
  row.ask.textContent = w.ask;
  if (w.asking) row.el.append(row.ask);
  else row.ask.remove();
}
