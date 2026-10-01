import './vault.css';
import { parseDotenv, badVaultName, type VaultEntry } from '../../shared/vault';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo, toast, type Modal } from './dom';
import { confirmDialog } from './prompt';

let open: Modal | null = null;

/**
 * 🗝️ The vault: environment variables every worker on this floor starts with, so the services they
 * run (and the previews teammates open) have their API keys in any worktree (see server/vault.ts).
 * Values go in and never come back out: it lists names. Admins change it; everyone can look.
 */
export function openVault(net: Net) {
  if (open) return;
  if (!store.floor) return toast('Take the elevator to a floor first', 'warn');
  const close = h('button.btn.close', { type: 'button', 'aria-label': 'Close', title: 'Close (Esc)' }, '✕');
  const list = h('ul.vault-list');
  const editor = h('div.vault-edit');
  /** Whether the editor is drawn for an admin, once it's drawn. */
  let drawnFor: boolean | undefined;
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': 'Vault', style: 'width:min(620px,100%)' },
    h('header', {}, h('h2', {}, '🗝️ Vault'), close),
    h(
      'div.body',
      {},
      h('p.setting-note.vault-lead', {}, 'Environment variables every worker on this floor starts with: API keys, read tokens, a database URL. Whatever a worker runs gets them too, so its dev server and the preview you open from 🌐 Services work in its worktree.'),
      list,
      editor,
      h(
        'p.setting-note',
        {},
        'Values go in and never come back out: the vault only shows their names. A worker that’s already running gets a change the next time it starts. The project’s own ',
        h('code', {}, '.env'),
        ' files, the ones git ignores, are copied into each new worktree as well.',
      ),
    ),
  );

  const name = h('input', { type: 'text', placeholder: 'NAME', 'aria-label': 'Name', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const value = h('input', { type: 'password', placeholder: 'value', 'aria-label': 'Value', autocomplete: 'new-password', spellcheck: 'false' }) as HTMLInputElement;
  const add = h('form.vault-add', {}, name, value, h('button.btn.primary', { type: 'submit' }, 'Put in')) as HTMLFormElement;
  add.addEventListener('submit', (e) => {
    e.preventDefault();
    const n = name.value.trim();
    const bad = n ? badVaultName(n) : 'Give it a name';
    if (bad) {
      toast(bad, 'warn');
      return name.focus();
    }
    net.send({ t: 'vault.set', vars: [{ name: n, value: value.value }] });
    name.value = '';
    value.value = '';
    name.focus();
  });

  const pasted = h('textarea', { rows: 5, placeholder: 'API_KEY=…\nDATABASE_URL=postgres://…', 'aria-label': 'A .env file', spellcheck: 'false' }) as HTMLTextAreaElement;
  const putAll = h('button.btn', { type: 'button' }, 'Put them all in');
  putAll.addEventListener('click', () => {
    const { vars, bad } = parseDotenv(pasted.value);
    const wrong = vars.map((v) => badVaultName(v.name)).find(Boolean);
    if (!vars.length || bad.length || wrong) return toast(wrong ?? (bad.length ? `That isn’t a .env line: ${bad[0].slice(0, 60)}` : 'Paste the lines of a .env file first'), 'warn');
    net.send({ t: 'vault.set', vars });
    pasted.value = '';
  });
  const paste = h('details.vault-paste', {}, h('summary', {}, 'Or paste a whole .env file'), pasted, h('div.seg', {}, putAll));

  /** Fills the name in to put a new value in under it. */
  const replace = (n: string) => {
    name.value = n;
    value.value = '';
    value.focus();
  };
  const remove = (n: string) => confirmDialog(`Take ${n} out of the vault?`, 'Workers that start from now on won’t have it. The ones already running keep it until they stop.', 'Take it out', () => net.send({ t: 'vault.delete', name: n }));

  const row = (e: VaultEntry, admin: boolean) =>
    h(
      'li',
      {},
      h('code.vault-name', {}, e.name),
      h('span.vault-who', {}, `${e.by || 'someone'}${e.at ? ` · ${timeAgo(e.at)}` : ''}`),
      admin ? h('button.btn', { type: 'button', title: `Put a new value in for ${e.name}`, onclick: () => replace(e.name) }, 'Replace') : null,
      admin ? h('button.btn', { type: 'button', 'aria-label': `Take ${e.name} out`, title: 'Take it out', onclick: () => remove(e.name) }, '🗑️') : null,
    );

  const render = () => {
    const s = store.vault;
    const admin = store.me.admin;
    // Changed floors with it open: that's another vault.
    if (s && s.floor !== store.floor) {
      list.replaceChildren(h('li.empty', {}, 'Loading…'));
      return net.send({ t: 'vault.get' });
    }
    list.replaceChildren(...(!s ? [h('li.empty', {}, 'Loading…')] : s.entries.length ? s.entries.map((e) => row(e, admin)) : [h('li.empty', {}, 'Nothing in it yet.')]));
    // Only when it changes, so what's half typed survives the next update.
    if (admin === drawnFor) return;
    drawnFor = admin;
    editor.replaceChildren(...(admin ? [add, paste] : [h('p.setting-note', {}, 'Only admins can put things in or take them out, since every worker on the floor runs with them.')]));
  };

  const offs = [store.on('vault', render), store.on('floor', render), store.on('me', render)];
  const modal = openModal(el, {
    doing: 'at the vault',
    onClose: () => {
      offs.forEach((off) => off());
      open = null;
    },
  });
  close.addEventListener('click', () => modal.close());
  open = modal;
  render();
  net.send({ t: 'vault.get' });
  if (store.me.admin) name.focus();
}
