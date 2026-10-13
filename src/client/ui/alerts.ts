import './alerts.css';
import type { AlertCard, AlertTopic } from '../../shared/protocol';
import { store } from '../state';
import { h, openModal } from './dom';

export type AlertFilter = 'all' | AlertTopic;

export function filterAlerts(cards: AlertCard[], topic: AlertFilter): AlertCard[] {
  return topic === 'all' ? cards : cards.filter((card) => card.topic === topic);
}

const TOPICS: { id: AlertFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'general', label: 'General' },
  { id: 'convergence', label: 'Convergence' },
  { id: 'insider', label: 'Insider' },
  { id: 'entry-watch', label: 'Entry watch' },
];

function alertCard(card: AlertCard): HTMLElement {
  const details = h(
    'details.alert-details',
    {},
    h('summary', {}, 'Evidence & invalidation'),
    h('div.alert-grid', {},
      h('div', {}, h('b', {}, 'Evidence'), h('ul', {}, ...card.layers.evidence.map((item) => h('li', {}, item)))),
      h('div', {}, h('b', {}, 'Freshness'), h('p', {}, card.layers.freshness)),
      h('div', {}, h('b', {}, 'Coverage'), h('p', {}, card.layers.coverage)),
      h('div', {}, h('b', {}, 'Invalidation'), h('p', {}, card.layers.invalidation)),
    ),
    card.links.length ? h('div.alert-links', {}, ...card.links.map((link) => h('a.btn', { href: link.url, target: '_blank', rel: 'noopener' }, link.label))) : null,
  );
  return h(
    'article.alert-card',
    { 'data-severity': card.severity },
    h('div.alert-head', {}, h('span.alert-topic', {}, card.topic), h('span.alert-severity', {}, card.severity)),
    h('h3', {}, card.title),
    card.token || card.chain ? h('p.alert-market', {}, [card.token, card.chain].filter(Boolean).join(' · ')) : null,
    h('div.alert-why', {}, h('b', {}, 'WHY NOW'), h('p', {}, card.layers.whyNow)),
    details,
  );
}

export function openAlerts() {
  let filter: AlertFilter = 'all';
  const body = h('div.body.alert-board');
  const filters = h('nav.alert-filters', { 'aria-label': 'Alert topics' });
  const el = h('div.modal.alert-modal', { role: 'dialog', 'aria-label': 'Dewa Information Alpha alerts' }, h('header', {}, h('h2', {}, '📡 Dewa Information Alpha'), h('span.grow')), filters, body);
  let modal: ReturnType<typeof openModal>;

  const render = () => {
    filters.replaceChildren(...TOPICS.map(({ id, label }) => h('button.btn', { type: 'button', class: filter === id ? 'primary' : '', onclick: () => { filter = id; render(); } }, `${label} (${filterAlerts(store.alerts.cards, id).length})`)));
    const cards = filterAlerts(store.alerts.cards, filter);
    body.replaceChildren(...(cards.length ? cards.map(alertCard) : [h('div.alert-empty', {}, h('b', {}, 'No alerts yet'), h('p', {}, 'Fresh research signals will appear here with evidence, coverage, freshness, and invalidation.'))]));
  };

  render();
  const off = store.on('alerts', render);
  modal = openModal(el, { doing: 'reviewing Dewa Alpha alerts', reading: true, onClose: off });
}
