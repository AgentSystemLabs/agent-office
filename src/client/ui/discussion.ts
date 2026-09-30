import { store } from '../state';
import { h, openModal, toast } from './dom';

/** Start a visible, bounded exchange between workers already at their desks. */
export function openDiscussion(onStart: (first: string, second: string, topic: string) => void) {
  const workers = [...store.workers.values()].filter((w) => w.kind === 'agent' && !w.lost);
  if (workers.length < 2) return toast('Hire two agents on this floor first', 'warn');
  const option = (w: typeof workers[number]) => h('option', { value: w.id }, w.name);
  const first = h('select', { 'aria-label': 'Implementation owner' }, ...workers.map(option)) as HTMLSelectElement;
  const second = h('select', { 'aria-label': 'Independent reviewer' }, ...workers.map(option)) as HTMLSelectElement;
  const pixel = workers.find((w) => w.name.toLowerCase() === 'pixel');
  const byte = workers.find((w) => w.name.toLowerCase() === 'byte');
  first.value = pixel?.id ?? workers[0].id;
  second.value = byte?.id ?? workers.find((w) => w.id !== first.value)!.id;
  const topic = h('textarea', { rows: 5, maxlength: 1000, placeholder: 'What should they decide or work on?', 'aria-label': 'Discussion topic' }) as HTMLTextAreaElement;
  const submit = h('button.btn.primary', { type: 'submit' }, 'Start discussion');
  const form = h('form.modal', { role: 'dialog', 'aria-label': 'Worker discussion' },
    h('header', {}, h('h2', {}, '💬 Worker discussion')),
    h('div.body', {},
      h('p', {}, 'Six messages maximum. The implementation owner makes changes; the reviewer reads and challenges the plan. All replies appear in Office chat.'),
      h('label', {}, 'Implementation owner', first),
      h('label', {}, 'Independent reviewer', second),
      h('label', {}, 'Topic', topic),
    ),
    h('footer', {}, submit),
  ) as HTMLFormElement;
  const modal = openModal(form);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (first.value === second.value) return toast('Choose two different workers', 'warn');
    if (!topic.value.trim()) return topic.focus();
    onStart(first.value, second.value, topic.value.trim());
    modal.close();
  });
  topic.focus();
}
