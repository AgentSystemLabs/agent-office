import './prompts.css';
import type { Net } from '../net';
import { store } from '../state';
import { PROMPTS, PROMPT_GROUPS, PROMPT_IDS, PROMPT_MAX, fillPrompt, placeholders, promptText, type PromptGroup, type PromptId, type PromptVars } from '../../shared/prompts';
import { h, openModal, timeAgo } from './dom';

/** One of the office's prompts, as it has it now (rewritten in ⚙️ Settings, or the default), filled in. */
export function officePrompt(id: PromptId, vars: PromptVars = {}): string {
  return fillPrompt(promptText(store.prompts.custom, id), vars);
}

/** How many of the office's prompts someone rewrote. */
export function rewrittenPrompts(): number {
  return Object.keys(store.prompts.custom).length;
}

/** What you typed and haven't saved, by prompt: kept while the page is open, so closing the window by mistake doesn't lose it. */
const drafts = new Map<PromptId, string>();

/** As the office keeps it: Windows line ends and outer whitespace don't count. */
const norm = (text: string) => text.replace(/\r\n?/g, '\n').trim();

/**
 * The office's prompts, to read and (for admins) rewrite: what the boards' buttons send workers, the
 * queue's worktree note, the board agents' briefs, the meeting room's parts and the sign-writer's
 * instructions. A list down the side, grouped by where they're used; the one picked, with its
 * placeholders, on the right.
 */
export function openPromptEditor(net: Net, first: PromptId = PROMPT_IDS[0]) {
  let current = first;
  const saved = (id: PromptId) => promptText(store.prompts.custom, id);
  const text = (id: PromptId) => drafts.get(id) ?? saved(id);
  const dirty = (id: PromptId) => drafts.has(id) && norm(drafts.get(id)!) !== saved(id);

  const list = h('nav.prompt-list', { 'aria-label': 'Prompts' });
  const items = new Map<PromptId, HTMLButtonElement>();
  const groups = new Map<PromptGroup, PromptId[]>();
  for (const id of PROMPT_IDS) groups.set(PROMPTS[id].group, [...(groups.get(PROMPTS[id].group) ?? []), id]);
  for (const [group, ids] of groups) {
    list.append(h('h4', {}, PROMPT_GROUPS[group]));
    for (const id of ids) {
      const b = h('button.prompt-item', { type: 'button', onclick: () => pick(id) }, h('span', {}, PROMPTS[id].label), h('span.prompt-mark')) as HTMLButtonElement;
      items.set(id, b);
      list.append(b);
    }
  }

  const heading = h('h3');
  const status = h('span.prompt-status');
  const used = h('p.prompt-used');
  const ta = h('textarea.prompt-text', { spellcheck: 'false', 'aria-label': 'Prompt', maxlength: PROMPT_MAX }) as HTMLTextAreaElement;
  const vars = h('div.prompt-vars');
  const warnings = h('div.prompt-warnings');
  const reset = h('button.btn', { type: 'button', title: 'Put the office’s own wording back in the box (then Save)' }, '↺ Default');
  const undo = h('button.btn', { type: 'button', title: 'Back to what’s saved' }, 'Undo changes');
  const save = h('button.btn.primary', { type: 'button' }, 'Save');
  const note = h('span.grow');
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const el = h(
    'div.modal.prompts',
    { role: 'dialog', 'aria-label': 'Prompts' },
    h('header', {}, h('h2', {}, '📝 Prompts'), close),
    h('div.prompts-body', {}, list, h('section.prompt-edit', {}, h('div.prompt-head', {}, heading, status), used, ta, vars, warnings)),
    h('footer', {}, note, reset, undo, save),
  );

  const paintItems = () => {
    for (const [id, b] of items) {
      b.classList.toggle('on', id === current);
      b.setAttribute('aria-current', String(id === current));
      const mark = b.querySelector('.prompt-mark')!;
      const edited = !!store.prompts.custom[id];
      mark.textContent = dirty(id) ? '●' : edited ? '✎' : '';
      b.title = dirty(id) ? 'Not saved yet' : edited ? 'Rewritten' : 'The default';
    }
  };

  const paintWarnings = () => {
    const def = PROMPTS[current];
    const inText = placeholders(ta.value);
    const lines: string[] = [];
    if (!ta.value.trim() && !def.optional) lines.push('It can’t be empty: write something, or put the default back.');
    for (const name of inText) if (!(name in def.vars)) lines.push(`{{${name}}} isn’t filled in here, so it’s sent just as it’s written.`);
    for (const name of def.needs ?? []) if (!inText.includes(name)) lines.push(`The office counts on {{${name}}} (${def.vars[name].toLowerCase()}): without it the worker isn’t told.`);
    warnings.replaceChildren(...lines.map((l) => h('p', {}, `⚠️ ${l}`)));
  };

  const paint = () => {
    const def = PROMPTS[current];
    const admin = store.me.admin;
    const edit = store.prompts.custom[current];
    heading.textContent = def.label;
    status.textContent = dirty(current) ? '● Not saved yet' : edit ? `✎ Rewritten by ${edit.by} ${timeAgo(edit.at)}` : 'The default';
    status.classList.toggle('dirty', dirty(current));
    used.textContent = def.used + (def.optional ? ' Leave it empty to send nothing.' : '');
    ta.readOnly = !admin;
    const names = Object.entries(def.vars);
    vars.replaceChildren(
      ...(names.length
        ? [
            h('span.prompt-vars-head', {}, admin ? 'Placeholders (click one to put it in):' : 'Placeholders:'),
            ...names.map(([name, desc]) =>
              h('button.prompt-var', { type: 'button', title: desc, disabled: !admin, onclick: () => insert(`{{${name}}}`) }, h('code', {}, `{{${name}}}`), h('small', {}, desc)),
            ),
          ]
        : [h('span.prompt-vars-head', {}, 'No placeholders: it’s sent just as it’s written.')]),
    );
    reset.classList.toggle('hidden', !admin);
    reset.toggleAttribute('disabled', norm(ta.value) === def.text);
    undo.classList.toggle('hidden', !admin || !dirty(current));
    save.classList.toggle('hidden', !admin);
    save.toggleAttribute('disabled', !dirty(current));
    note.textContent = admin ? 'For the whole office, on every floor. A rewritten prompt is used from the next time it’s sent.' : 'Only admins can change the office’s prompts. This is what they say now.';
    paintItems();
    paintWarnings();
  };

  const pick = (id: PromptId) => {
    current = id;
    ta.value = text(id);
    ta.scrollTop = 0;
    paint();
  };

  const insert = (token: string) => {
    const { selectionStart: a, selectionEnd: b, value } = ta;
    ta.value = value.slice(0, a) + token + value.slice(b);
    ta.focus();
    ta.setSelectionRange(a + token.length, a + token.length);
    ta.dispatchEvent(new Event('input'));
  };

  ta.addEventListener('input', () => {
    if (norm(ta.value) === saved(current)) drafts.delete(current);
    else drafts.set(current, ta.value);
    paint();
  });
  reset.addEventListener('click', () => {
    ta.value = PROMPTS[current].text;
    ta.dispatchEvent(new Event('input'));
  });
  undo.addEventListener('click', () => {
    drafts.delete(current);
    ta.value = saved(current);
    paint();
  });
  save.addEventListener('click', () => {
    if (!dirty(current)) return;
    const value = norm(ta.value);
    net.send({ t: 'prompts.set', id: current, text: value === PROMPTS[current].text ? null : value });
  });

  // Saved, here or by someone else: a draft that now matches is done with, and a prompt you haven't
  // touched shows what it says now.
  const offPrompts = store.on('prompts', () => {
    for (const [id, d] of drafts) if (norm(d) === saved(id)) drafts.delete(id);
    if (!drafts.has(current) && ta.value !== saved(current)) ta.value = saved(current);
    paint();
  });
  const offMe = store.on('me', paint);
  const modal = openModal(el, {
    doing: '📝 reading the office’s prompts',
    // A click beside it shouldn't throw away what you're writing.
    backdropCloses: false,
    onClose: () => {
      offPrompts();
      offMe();
    },
  });
  close.addEventListener('click', () => modal.close());
  pick(current);
  setTimeout(() => items.get(current)?.focus(), 30);
}
