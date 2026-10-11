import { store } from '../../state';
import type { DecisionState } from '../../../shared/decisions';
const listeners = new Set<() => void>();
let request = 0;
export const decisions = {
  state: { items: [] } as DecisionState,
  error: '',
  on(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  clear() { request++; this.error = ''; this.state = { items: [] }; listeners.forEach(fn => fn()); },
  async refresh() {
    const floor = store.floor; if (!floor) return; const current = ++request;
    try { const r = await fetch('/api/decisions?floor=' + encodeURIComponent(floor)); if (!r.ok) throw Error('Pool nicht erreichbar');
      const data: DecisionState = await r.json(); if (store.floor !== floor || current !== request) return;
      this.state = data; this.error = ''; listeners.forEach(fn => fn());
    } catch { if (store.floor !== floor || current !== request) return;
      this.error = 'Entscheidungen können gerade nicht aktualisiert werden. Angezeigte Einträge sind möglicherweise veraltet.';
      listeners.forEach(fn => fn());
    }
  },
};
