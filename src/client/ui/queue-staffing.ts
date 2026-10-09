import { h } from './dom';
import type { Net } from '../net';

export function queueStaffing(net: Net) {
  const select = h('select', { 'aria-label': 'Queue workers', style: 'font:inherit;padding:6px;border:2px solid var(--ink);border-radius:8px;background:white' },
    h('option', { value: 'new' }, 'Hire new workers'),
    h('option', { value: 'existing' }, 'Only existing workers')) as HTMLSelectElement;
  select.addEventListener('change', () => net.send({ t: 'queue.staffing', existingOnly: select.value === 'existing' }));
  const note = h('p.note');
  return {
    element: h('div', {}, h('label', {}, 'Queue workers ', select), note),
    render(existing: boolean) {
      select.value = existing ? 'existing' : 'new';
      note.textContent = existing
        ? 'Uses ready, manually hired workers on this floor with the task owner’s sign-in. Their models and existing workspaces are kept. Close their terminals to make them available. Busy, stopped and board agents are skipped. No new workers are hired; tasks wait when none is available.'
        : 'Each task hires a fresh worker in its own worktree.';
    },
  };
}
