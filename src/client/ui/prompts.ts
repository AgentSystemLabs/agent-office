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

  const list = h('nav.prompt-list', { 'aria-label': "작업 지시 문구" });
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
  const ta = h('textarea.prompt-text', { spellcheck: 'false', 'aria-label': "작업 지시", maxlength: PROMPT_MAX }) as HTMLTextAreaElement;
  const vars = h('div.prompt-vars');
  const warnings = h('div.prompt-warnings');
  const reset = h('button.btn', { type: 'button', title: "기본 지시 문구로 되돌리기 (저장해야 적용됩니다)" }, "↺ 기본값");
  const undo = h('button.btn', { type: 'button', title: "저장된 내용으로 되돌리기" }, "수정 취소");
  const save = h('button.btn.primary', { type: 'button' }, "저장");
  const note = h('span.grow');
  const close = h('button.btn.close', { 'aria-label': "닫기" }, '✕');
  const el = h(
    'div.modal.prompts',
    { role: 'dialog', 'aria-label': "작업 지시 문구" },
    h('header', {}, h('h2', {}, "📝 작업 지시 문구"), close),
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
      b.title = dirty(id) ? "아직 저장하지 않음" : edited ? "수정됨" : "기본 문구";
    }
  };

  const paintWarnings = () => {
    const def = PROMPTS[current];
    const inText = placeholders(ta.value);
    const lines: string[] = [];
    if (!ta.value.trim() && !def.optional) lines.push("비워 둘 수 없습니다. 내용을 입력하거나 기본 문구로 되돌리세요.");
    for (const name of inText) if (!(name in def.vars)) lines.push(`{{${name}}} isn’t filled in here, so it’s sent just as it’s written.`);
    for (const name of def.needs ?? []) if (!inText.includes(name)) lines.push(`The office counts on {{${name}}} (${def.vars[name].toLowerCase()}): without it the worker isn’t told.`);
    warnings.replaceChildren(...lines.map((l) => h('p', {}, `⚠️ ${l}`)));
  };

  const paint = () => {
    const def = PROMPTS[current];
    const admin = store.me.admin;
    const edit = store.prompts.custom[current];
    heading.textContent = def.label;
    status.textContent = dirty(current) ? '● Not saved yet' : edit ? `✎ Rewritten by ${edit.by} ${timeAgo(edit.at)}` : "기본 문구";
    status.classList.toggle('dirty', dirty(current));
    used.textContent = def.used + (def.optional ? ' Leave it empty to send nothing.' : '');
    ta.readOnly = !admin;
    const names = Object.entries(def.vars);
    vars.replaceChildren(
      ...(names.length
        ? [
            h('span.prompt-vars-head', {}, admin ? "치환 변수 (클릭해서 삽입):" : "치환 변수:"),
            ...names.map(([name, desc]) =>
              h('button.prompt-var', { type: 'button', title: desc, disabled: !admin, onclick: () => insert(`{{${name}}}`) }, h('code', {}, `{{${name}}}`), h('small', {}, desc)),
            ),
          ]
        : [h('span.prompt-vars-head', {}, "치환 변수 없이 작성한 내용 그대로 전달됩니다.")]),
    );
    reset.classList.toggle('hidden', !admin);
    reset.toggleAttribute('disabled', norm(ta.value) === def.text);
    undo.classList.toggle('hidden', !admin || !dirty(current));
    save.classList.toggle('hidden', !admin);
    save.toggleAttribute('disabled', !dirty(current));
    note.textContent = admin ? "모든 프로젝트에 적용됩니다. 수정한 지시 문구는 다음 작업부터 사용합니다." : "관리자만 지시 문구를 수정할 수 있습니다. 현재 사용 중인 내용입니다.";
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
    doing: "📝 작업 지시 문구를 읽는 중",
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
