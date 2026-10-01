import './accounts.css';
import type { AccountInvite, AccountRole, ServerMsg } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo } from './dom';
import { confirmDialog } from './prompt';
import { L } from '../i18n';
import { copyButton } from './team';

export const inviteLink = (v: AccountInvite) => `${location.origin}/join#${v.token}`;

function expiresIn(t: number): string {
  const d = Math.round((t - Date.now()) / 86_400_000);
  return d >= 1 ? L.accounts.expiresIn(d) : L.accounts.expiresToday;
}

let onInvited: ((msg: Extract<ServerMsg, { t: 'accounts.invited' }>) => void) | null = null;

export function routeAccountsMessage(msg: ServerMsg) {
  if (msg.t === 'accounts.invited') onInvited?.(msg);
}

/** 🔑 Accounts, for admins: invite people by link, list them, change their role or revoke them. */
export function openAccounts(net: Net) {
  let status: HTMLElement | null = null;
  /** The invite just made, shown big until the next one. */
  let fresh: AccountInvite | null = null;
  const body = h('div.body.team.accounts');
  const close = h('button.btn.close', { 'aria-label': L.common.close }, '✕');
  const signedInAs = h('span.grow');
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': L.menu.accounts, style: 'width:min(680px,100%)' },
    h('header', {}, h('h2', {}, `🔑 ${L.menu.accounts}`), close),
    body,
    h('footer', {}, signedInAs),
  );

  const nameInput = h('input', { type: 'text', maxlength: 24, placeholder: L.accounts.nameOptional, 'aria-label': L.accounts.name, autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const roleSelect = h('select', { 'aria-label': L.accounts.roleLabel }, h('option', { value: 'member' }, L.accounts.roles.member), h('option', { value: 'admin' }, L.accounts.roles.admin)) as HTMLSelectElement;
  const inviteBtn = h('button.btn.primary', { type: 'submit' }, L.accounts.makeLink);
  const form = h('form.invite-row', {}, nameInput, roleSelect, inviteBtn) as HTMLFormElement;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    inviteBtn.disabled = true;
    net.send({ t: 'accounts.invite', name: nameInput.value.trim() || undefined, role: roleSelect.value as AccountRole });
  });

  const render = () => {
    const s = store.accounts;
    const me = store.me;
    signedInAs.textContent = me.account ? L.accounts.signedInAs(me.account.name, L.accounts.roles[me.account.role] ?? me.account.role) : L.accounts.signedInShared;
    const typing = document.activeElement === nameInput;
    body.replaceChildren();
    if (!s) return body.append(h('p.empty', {}, L.common.loading));

    body.append(
      h('label', {}, L.accounts.invite),
      form,
      h('p.note', {}, L.accounts.inviteNote),
    );
    if (status) body.append(status);
    if (fresh) {
      const v = fresh;
      body.append(h('div.cmd', {}, h('pre', {}, inviteLink(v)), copyButton(L.team.copy, () => inviteLink(v))));
    }
    if (store.invites) body.append(h('p.note', {}, L.accounts.needWayInFirst));

    const list = h('ul.team-list');
    for (const a of s.accounts) {
      const you = me.account?.name === a.name;
      const seen = a.online ? L.accounts.inOffice : a.lastSeenAt ? L.accounts.seen(timeAgo(a.lastSeenAt)) : L.accounts.never;
      const role = h('button.btn', { type: 'button', title: a.role === 'admin' ? L.accounts.takeAdmin : L.accounts.giveAdmin }, a.role === 'admin' ? L.accounts.makeMember : L.accounts.makeAdmin);
      role.addEventListener('click', () => net.send({ t: 'accounts.role', accountId: a.id, role: a.role === 'admin' ? 'member' : 'admin' }));
      const revoke = h('button.btn.danger', { type: 'button', title: L.accounts.deleteAccount(a.name) }, L.accounts.revoke);
      revoke.addEventListener('click', () =>
        confirmDialog(
          L.accounts.revokeQ(a.name),
          `${L.accounts.revokeBody} ${s.sharedPassword ? L.accounts.alsoKnows(a.name) : ''}`,
          L.accounts.revoke,
          () => net.send({ t: 'accounts.revoke', accountId: a.id }),
        ),
      );
      list.append(
        h(
          'li',
          {},
          h('span.dot', { class: a.online ? 'on' : '', title: seen }),
          h('span.name', {}, a.name, you ? h('span.you', {}, ` ${L.hud.you}`) : null),
          h('span.role', { class: a.role }, L.accounts.roles[a.role] ?? a.role),
          h('span.keys', { title: L.accounts.invitedBy(a.createdBy) }, seen),
          you ? null : role,
          you ? null : revoke,
        ),
      );
    }
    if (!s.accounts.length) list.append(h('li.empty', {}, L.accounts.nobody));
    body.append(h('h4', {}, `${L.accounts.people} `, h('span.count', {}, String(s.accounts.length))), list);

    if (s.invites.length) {
      const invites = h('ul.team-list');
      for (const v of s.invites) {
        const cancel = h('button.btn', { type: 'button', title: L.accounts.linkStops }, L.hints.cancel);
        cancel.addEventListener('click', () => {
          if (fresh?.id === v.id) fresh = null;
          net.send({ t: 'accounts.cancel', inviteId: v.id });
        });
        invites.append(
          h(
            'li',
            {},
            h('span.name', {}, v.name ?? h('i', {}, L.accounts.theyPick)),
            h('span.role', { class: v.role }, L.accounts.roles[v.role] ?? v.role),
            h('span.keys', { title: L.accounts.madeBy(v.createdBy, timeAgo(v.createdAt)) }, expiresIn(v.expiresAt)),
            copyButton(L.accounts.copyLink, () => inviteLink(v)),
            cancel,
          ),
        );
      }
      body.append(h('h4', {}, `${L.accounts.openInvites} `, h('span.count', {}, String(s.invites.length))), invites);
    }

    // The shared password: the old way in, kept as a fallback until everyone has an account.
    const toggle = h('button.btn', { type: 'button', class: s.sharedPassword ? 'danger' : '' }, s.sharedPassword ? L.accounts.switchOff : L.accounts.switchOn);
    const canSwitchOff = me.account?.role === 'admin';
    if (s.sharedPassword && !canSwitchOff) toggle.setAttribute('disabled', '');
    toggle.addEventListener('click', () => {
      if (!s.sharedPassword) return net.send({ t: 'accounts.shared', on: true });
      confirmDialog(
        L.accounts.switchOffQ,
        L.accounts.switchOffBody,
        L.accounts.switchOff,
        () => net.send({ t: 'accounts.shared', on: false }),
      );
    });
    body.append(
      h('div.team-head', {}, h('h4', {}, L.accounts.sharedTitle), toggle),
      h(
        'p.note',
        {},
        s.sharedPassword
          ? L.accounts.sharedOn
          : L.accounts.sharedOff,
        s.sharedPassword && !canSwitchOff ? h('b', {}, L.accounts.makeAdminFirst) : null,
      ),
    );
    if (typing) nameInput.focus();
  };

  onInvited = (msg) => {
    inviteBtn.disabled = false;
    if (msg.error || !msg.invite) {
      status = h('p.team-status.error', {}, msg.error ?? L.accounts.inviteFailed);
      return render();
    }
    fresh = msg.invite;
    nameInput.value = '';
    status = h('p.team-status.ok', {}, L.accounts.sendLink(msg.invite.name));
    render();
  };
  // No longer an admin (someone changed your role): the list isn't yours to see any more.
  const unsubs = [store.on('accounts', render), store.on('me', () => (store.me.admin ? render() : modal.close()))];
  const modal = openModal(el, {
    onClose: () => {
      unsubs.forEach((u) => u());
      onInvited = null;
    },
  });
  close.addEventListener('click', () => modal.close());
  render();
  setTimeout(() => nameInput.focus(), 30);
  net.send({ t: 'accounts.get' });
}
