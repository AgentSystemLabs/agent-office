import type { Ctx } from '../../core/context';
import { boardHint, onE } from '../../core/hint';
import { store } from '../../state';
import { blockedDecision } from '../../../shared/decisions';
import { decisions } from './state';
import { openDecisions } from './ui';
declare module '../../world/types' { interface InteractKinds { decisions: true } }
export function installDecisions(ctx: Ctx) {
  ctx.interactions.define('decisions', { reach: 2.5, hint: () => boardHint('Entscheidungen'), use: onE(() => openDecisions()) });
  const paint = () => ctx.office.decisionMonitor.render(decisions.state.items.filter(d => d.status === 'open').length, decisions.state.items.filter(blockedDecision).length);
  decisions.on(paint); store.on('floor', () => { decisions.clear(); void decisions.refresh(); });
  setInterval(() => { if (store.floor) void decisions.refresh(); }, 10000);
  void decisions.refresh();
}
