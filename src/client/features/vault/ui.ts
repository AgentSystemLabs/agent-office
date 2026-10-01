import './ui.css';
import type { VaultState } from '../../../shared/protocol';
import { parseEnv } from '../../../shared/vault';
import { h, openModal, timeAgo, type Modal } from '../../ui/dom';

// The safe's window: the names of the variables in it for everyone, and for an admin, behind a
// 🔓 Unlock (so the values aren't on screen for whoever's looking over your shoulder), the .env itself
// to change. Saving it writes it into every worker's worktree on the floor.

export interface VaultDeps {
  /** The safe as the office last sent it; undefined until it answers. */
  state(): VaultState | undefined;
  save(text: string): void;
  /** The window opened, or closed again (the safe's door swings with it). */
  onOpen(open: boolean): void;
}

/** The window while it's open: show it what the office sent. */
let shown: { modal: Modal; render(): void } | undefined;

/** The office sent the safe's state: redraw the window, if it's open. */
export function vaultChanged() {
  shown?.render();
}

export function openVault(deps: VaultDeps) {
  if (shown) return;
  const body = h('div.body.vault-body');
  const footer = h('footer');
  const el = h('div.modal.vault', {}, h('header', {}, h('h2', {}, '🔐 The safe')), body, footer);
  /** What an admin is typing, once they've unlocked it. */
  let draft: string | undefined;
  let saving = false;

  const render = () => {
    const s = deps.state();
    body.replaceChildren();
    footer.replaceChildren();
    if (!s) {
      body.append(h('p.vault-note', {}, '🔢 Turning the dial…'));
      return;
    }
    body.append(
      h('p.vault-note', {}, 'Whatever is in here is written as ', h('code', {}, '.env'), " into every worker's worktree on this floor, and the floor's own checkout, so their dev servers and previews have the keys they need. Git is told to ignore it, and a ", h('code', {}, '.env'), ' a project already has is left alone.'),
    );
    if (draft === undefined) {
      const list = h('ul.vault-keys');
      for (const k of s.keys) list.append(h('li', {}, h('code', {}, k), h('span.vault-dots', {}, ' = ••••••')));
      body.append(s.keys.length ? list : h('p.vault-empty', {}, "It's empty."));
      if (!s.canEdit) body.append(h('p.vault-note', {}, 'Only admins can open it to read or change what is in it.'));
    } else {
      const area = h('textarea.vault-text', { spellcheck: 'false', autocomplete: 'off', placeholder: 'API_TOKEN=...\nDATABASE_URL=postgres://...', rows: 14 }) as HTMLTextAreaElement;
      area.value = draft;
      const problem = h('span.vault-problem');
      const check = () => {
        draft = area.value;
        const { keys, error } = parseEnv(area.value);
        problem.textContent = error ?? `${keys.length === 1 ? '1 variable' : `${keys.length} variables`}`;
        problem.classList.toggle('bad', !!error);
        saveBtn.disabled = !!error || saving || area.value.trim() === (s.text ?? '').trim();
      };
      const saveBtn = h('button.btn.primary', { type: 'button', onclick: () => {
        saving = true;
        saveBtn.disabled = true;
        deps.save(area.value);
      } }, '💾 Lock it away');
      area.addEventListener('input', () => {
        // Typing again after a save the office turned down.
        saving = false;
        check();
      });
      body.append(area, h('div.vault-status', {}, problem));
      footer.append(h('span.grow.vault-meta', {}, meta(s)), h('button.btn', { type: 'button', onclick: () => {
        draft = undefined;
        render();
      } }, '🔒 Lock'), saveBtn);
      check();
      queueMicrotask(() => area.focus());
      return;
    }
    footer.append(h('span.grow.vault-meta', {}, meta(s)));
    if (s.canEdit) footer.append(h('button.btn.primary', { type: 'button', onclick: () => {
      draft = s.text ?? '';
      render();
    } }, s.keys.length ? '🔓 Unlock' : '🔓 Open it'));
  };

  const modal = openModal(el, {
    doing: '🔐 at the safe',
    onClose: () => {
      shown = undefined;
      deps.onOpen(false);
    },
  });
  shown = {
    modal,
    render: () => {
      // Saved: what was typed is what's in the safe now, so lock it again.
      if (saving) {
        saving = false;
        draft = undefined;
      }
      render();
    },
  };
  deps.onOpen(true);
  render();
}

function meta(s: VaultState): string {
  const changed = s.by && s.at ? `${s.by} changed it ${timeAgo(s.at)}` : '';
  const where = s.keys.length ? `.env in ${s.stocked === 1 ? '1 checkout' : `${s.stocked} checkouts`}` : '';
  return [changed, where].filter(Boolean).join(' · ');
}
