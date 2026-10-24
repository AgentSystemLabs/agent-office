import type { DomainMonitorState } from '../../shared/domain-monitor';
import { h, openModal } from './dom';
import './domain-monitor.css';

export function openDomainMonitor() {
  const content = h('div.body.domain-monitor'), controller = new AbortController();
  let busy = false;
  const modal = openModal(h('div.modal', { role: 'dialog', 'aria-label': 'Cloudflare status', style: 'width:min(1050px,100%)' },
    h('header', {}, h('h2', {}, '☁️ Cloudflare status')), content), { doing: '☁️ checking Cloudflare domains', onClose: () => { clearInterval(timer); controller.abort(); } });
  const render = async () => {
    if (busy) return; busy = true;
    try {
      const response = await fetch('/api/domain-monitor', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw Error('Monitoring unavailable (HTTP ' + response.status + ').');
      const s = await response.json() as DomainMonitorState;
      const when = (value?: string) => value ? new Date(value).toLocaleString() : 'Not yet checked';
      const stale = !s.checkedAt || Date.now() - Date.parse(s.checkedAt) > 150_000;
      content.replaceChildren(
        h('p', {}, 'Monitoring from ', h('strong', {}, s.location), '. Checks continue while this panel is closed. Office must remain running on this computer.'),
        h('p', { class: stale ? 'monitor-warning' : '' }, `${s.checking ? 'Checking… · ' : ''}${stale ? 'STALE / NOT YET VERIFIED · ' : ''}Last website check: ${when(s.checkedAt)} · Every ${s.intervalSeconds}s · Live API discovery: ${when(s.discoveredAt)}`),
        h('p.note', {}, 'Reachable means an HTTPS response at /. Redirects, restricted pages and zero traffic do not establish application health. Worker counts are sampled aggregate analytics, not a complete exception log.'),
        ...s.issues.map(issue => h('p.monitor-warning', {}, issue)),
      );
      if (!s.enabled) content.append(h('p', {}, 'Cloudflare monitoring is not enabled in this Office installation.'));
      const table = h('table.monitor-table', {}, h('thead', {}, h('tr', {}, ...['Domain', 'Website status', 'Workers / Pages', 'Last checked'].map(x => h('th', {}, x)))));
      const tbody = h('tbody'); table.append(tbody);
      for (const d of s.domains) tbody.append(h('tr', {},
        h('td', {}, h('a', { href: 'https://' + d.hostname + '/', target: '_blank', rel: 'noopener noreferrer' }, d.hostname)),
        h('td', { class: 'monitor-' + d.status }, `${d.status.toUpperCase()}${d.http ? ' · HTTP ' + d.http : ''} · ${d.latencyMs} ms`, d.issue ? h('div', {}, d.issue) : null, d.ray ? h('small', {}, 'Ray ' + d.ray) : null),
        h('td', {}, d.workers.join(', ') || 'DNS / origin; no Worker route found'), h('td', {}, when(d.checkedAt)),
      ));
      content.append(h('h3', {}, `Domains (${s.domains.length})`), table);
      content.append(h('h3', {}, `Worker outcomes · ${when(s.analyticsFrom)} — ${when(s.analyticsTo)}`));
      if (!s.analyticsAt) content.append(h('p.monitor-warning', {}, 'Worker error analytics unavailable; no zero-error claim.'));
      const workers = h('table.monitor-table', {}, h('thead', {}, h('tr', {}, ...['Worker', 'Requests', 'Errors', 'Outcomes'].map(x => h('th', {}, x)))));
      const body = h('tbody'); workers.append(body);
      for (const name of s.workers) {
        const m = s.metrics.find(x => x.name === name);
        body.append(h('tr', {}, h('td', {}, name), h('td', {}, m ? m.requests : 'No returned traffic'), h('td', { class: m?.errors ? 'monitor-error' : '' }, m ? m.errors : 'Not established'), h('td', {}, m ? Object.entries(m.outcomes).map(([k, v]) => `${k}: ${v}`).join(', ') : 'No sample / analytics unavailable')));
      }
      content.append(workers);
    } catch (e) { if (!controller.signal.aborted) content.replaceChildren(h('p.monitor-warning', {}, e instanceof Error ? e.message : 'Monitoring unavailable.')); }
    finally { busy = false; }
  };
  const timer = setInterval(() => void render(), 5000); void render();
  return modal;
}

/** The lightweight Office view shares this module without importing the 3D engine. */
export function mountDomainMonitorLink(anchor: HTMLElement) {
  anchor.after(h('button.btn', { type: 'button', onclick: () => openDomainMonitor() }, '☁️ Cloudflare status'));
}
