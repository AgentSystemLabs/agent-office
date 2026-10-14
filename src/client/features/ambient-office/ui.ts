import { h, openModal, type Modal } from '../../ui/dom';
import { CAST, CAST_BY_ID } from './cast';
import { checklist, readNotes, saveNotes, savePreferences, workBrief, type Preferences } from './notes';
import type { Snapshot } from './simulation';
import './ui.css';

export function ambientPanel(deps: {
  snapshot: () => Snapshot;
  floor: () => string;
  preferences: Preferences;
  busy: (id: string | null) => void;
}) {
  let modal: Modal | null = null;
  let selected = 'pam';
  let status: HTMLElement | null = null;
  let current: HTMLElement | null = null;
  let roster: HTMLElement | null = null;
  let memories: HTMLElement | null = null;
  let lines: HTMLElement | null = null;
  const badge = h('button.ambient-badge', { type: 'button', title: 'Open the ambient office · optional coworkers', onclick: () => open() }, 'Dunder Mifflin');
  document.body.append(badge);

  function paint() {
    const snapshot = deps.snapshot();
    badge.textContent = `Dunder Mifflin · ${snapshot.clock}${deps.preferences.enabled ? '' : ' · hidden'}`;
    if (!modal) return;
    status!.textContent = `${snapshot.clock} · ${snapshot.phase} · Season 6 ensemble`;
    current!.textContent = snapshot.people.find((p) => p.person.id === selected)?.activity ?? '';
    for (const button of roster!.querySelectorAll<HTMLButtonElement>('button')) {
      const state = snapshot.people.find((p) => p.person.id === button.dataset.id)!;
      button.classList.toggle('selected', selected === state.person.id);
      button.classList.toggle('away', !state.present);
      button.title = `${state.person.job} · ${state.activity}`;
    }
    memories!.replaceChildren(...snapshot.memories.map((text) => h('li', {}, text)));
  }

  function open(id = 'pam') {
    if (modal) return;
    selected = CAST_BY_ID.has(id) ? id : 'pam';
    const floor = deps.floor();
    let note = readNotes(floor);
    let saveMessage = '';
    let response = '';
    status = h('p.ambient-status');
    current = h('p.ambient-current');
    memories = h('ul.ambient-memories');
    lines = h('div.ambient-detail');
    roster = h('nav.ambient-roster', { 'aria-label': 'Coworkers' }, ...CAST.map((p) => h('button', { type: 'button', 'data-id': p.id, onclick: () => { selected = p.id; response = ''; render(); paint(); } }, p.name)));
    const enabled = h('input', { type: 'checkbox', checked: deps.preferences.enabled });
    const quiet = h('input', { type: 'checkbox', checked: deps.preferences.quiet });
    for (const [input, field] of [[enabled, 'enabled'], [quiet, 'quiet']] as const) input.addEventListener('change', () => {
      deps.preferences[field] = input.checked;
      savePreferences(deps.preferences);
      paint();
    });
    const panel = h('section.panel.ambient-panel', { 'aria-label': 'Ambient office' },
      h('header', {}, h('h2', {}, 'Dunder Mifflin'), status),
      h('div.ambient-controls', {}, h('label', {}, enabled, ' Show coworkers'), h('label', {}, quiet, ' Quiet work · hide dialogue')),
      h('p.ambient-intro', {}, 'The branch has its own day. You can work, ignore the conversations, or say hello whenever you like.'),
      h('div.ambient-columns', {}, roster, lines),
      h('details.ambient-continuity', {}, h('summary', {}, 'Around the branch'), memories),
    );
    modal = openModal(panel, { doing: 'Ambient office · optional scratchpad', onClose: () => { modal = null; deps.busy(null); } });

    function render() {
      const p = CAST_BY_ID.get(selected)!;
      // Opening the directory does not summon an absent character. Busy only while explicitly helping.
      deps.busy(null);
      const reply = h('p.ambient-reply', { role: 'status' }, response || p.greeting);
      const saved = h('p.ambient-save', { role: 'status' }, saveMessage);
      const notes = h('textarea', { rows: 5, maxlength: 12000, 'aria-label': 'Private work notes', placeholder: 'Write notes or one task per line…' }, note);
      notes.addEventListener('input', () => {
        note = notes.value;
        saveMessage = saveNotes(floor, note) ? 'Saved in this browser for this floor.' : 'Storage unavailable. Copy your notes before closing.';
        saved.textContent = saveMessage;
      });
      const result = h('textarea.ambient-output', { rows: 6, readonly: true, 'aria-label': 'Prepared work brief or checklist' });
      result.hidden = true;
      const help = () => {
        if (!note.trim()) { reply.textContent = 'Add your notes or task first.'; return; }
        if (deps.snapshot().people.find((s) => s.person.id === p.id)?.present) deps.busy(p.id);
        result.value = p.id === 'pam' || p.id === 'erin' ? checklist(note) : workBrief(p, note);
        result.hidden = false;
        reply.textContent = p.id === 'pam' || p.id === 'erin' ? 'Your task list is ready below. Nothing has been sent or scheduled.' : 'Your work brief is ready below. Copy it to a worker to carry out the request.';
        result.focus();
        result.select();
      };
      lines!.replaceChildren(
        h('h3', {}, p.name), h('p.ambient-job', {}, p.job), current!, h('p', {}, p.personality),
        h('p.ambient-utility', {}, `Available scratchpad: ${p.utility}`), reply,
        h('div.ambient-actions', {},
          h('button.btn', { type: 'button', onclick: () => { deps.busy(null); reply.textContent = p.greeting; } }, 'Say hello'),
          h('button.btn', { type: 'button', onclick: () => { deps.busy(null); reply.textContent = `${deps.snapshot().people.find((s) => s.person.id === p.id)?.activity}. ${deps.snapshot().memories[0] ?? ''}`; } }, 'Ask about the day')),
        h('label', {}, 'Private notes · kept in your browser', notes), saved,
        h('button.btn.primary', { type: 'button', onclick: help }, p.id === 'pam' || p.id === 'erin' ? 'Organize my task list' : 'Prepare a work brief'),
        result,
        h('p.ambient-limit', {}, 'Local notes and preparation only. Scheduling, reminders, messaging and agent work require connected capabilities. Staff resume their routine when you close this window.'),
      );
    }
    render();
    paint();
  }

  return { open, paint, close: () => modal?.close(), badge };
}
