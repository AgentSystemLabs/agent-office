import './accounts.css';
import type { AccountInvite, AccountRole, ServerMsg } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo } from './dom';
import { confirmDialog } from './prompt';
import { copyButton } from './team';

export const inviteLink = (v: AccountInvite) => `${location.origin}/join#${v.token}`;

function expiresIn(t: number): string {
  const d = Math.round((t - Date.now()) / 86_400_000);
  return d >= 1 ? `${d}일 후 만료` : "오늘 만료";
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
  const close = h('button.btn.close', { 'aria-label': "닫기" }, '✕');
  const signedInAs = h('span.grow');
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': "계정 관리", style: 'width:min(680px,100%)' },
    h('header', {}, h('h2', {}, "🔑 계정 관리"), close),
    body,
    h('footer', {}, signedInAs),
  );

  const nameInput = h('input', { type: 'text', maxlength: 24, placeholder: "초대할 사람의 이름 (선택 사항)", 'aria-label': "초대할 사람의 이름", autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const roleSelect = h('select', { 'aria-label': "권한" }, h('option', { value: 'member' }, "일반 사용자"), h('option', { value: 'admin' }, "관리자")) as HTMLSelectElement;
  const inviteBtn = h('button.btn.primary', { type: 'submit' }, "초대 링크 만들기");
  const form = h('form.invite-row', {}, nameInput, roleSelect, inviteBtn) as HTMLFormElement;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    inviteBtn.disabled = true;
    net.send({ t: 'accounts.invite', name: nameInput.value.trim() || undefined, role: roleSelect.value as AccountRole });
  });

  const render = () => {
    const s = store.accounts;
    const me = store.me;
    signedInAs.textContent = me.account ? `${me.account.name} 계정으로 로그인 중 (${me.account.role}).` : "사무실 공용 비밀번호로 로그인했습니다.";
    const typing = document.activeElement === nameInput;
    body.replaceChildren();
    if (!s) return body.append(h('p.empty', {}, "불러오는 중…"));

    body.append(
      h('label', {}, "사용자 초대"),
      form,
      h('p.note', {}, "이름과 비밀번호를 설정해 계정 하나를 만드는 링크입니다. 한 번만 사용할 수 있고 7일 뒤 만료됩니다. 이름을 비워 두면 초대받은 사람이 직접 정합니다."),
    );
    if (status) body.append(status);
    if (fresh) {
      const v = fresh;
      body.append(h('div.cmd', {}, h('pre', {}, inviteLink(v)), copyButton("복사", () => inviteLink(v))));
    }
    if (store.invites) body.append(h('p.note', {}, "이 사무실에 접속할 권한도 필요합니다. 👥 팀원 초대를 확인하세요."));

    const list = h('ul.team-list');
    for (const a of s.accounts) {
      const you = me.account?.name === a.name;
      const seen = a.online ? 'in the office' : a.lastSeenAt ? `마지막 접속 ${timeAgo(a.lastSeenAt)}` : "접속 기록 없음";
      const role = h('button.btn', { type: 'button', title: a.role === 'admin' ? "관리자 권한 해제" : "계정 관리 권한 부여" }, a.role === 'admin' ? "일반 사용자로 변경" : "관리자로 변경");
      role.addEventListener('click', () => net.send({ t: 'accounts.role', accountId: a.id, role: a.role === 'admin' ? 'member' : 'admin' }));
      const revoke = h('button.btn.danger', { type: 'button', title: `${a.name}의 계정 삭제` }, "계정 삭제");
      revoke.addEventListener('click', () =>
        confirmDialog(
          `${a.name}의 계정을 삭제할까요?`,
          `계정을 삭제하면 모든 접속에서 즉시 로그아웃됩니다. 사용하던 터미널은 계속 실행됩니다. ${s.sharedPassword ? `${a.name}이(가) 공용 비밀번호를 알고 있으면 계속 접속할 수 있습니다. 필요하면 아래에서 공용 비밀번호 사용을 끄세요.` : ''}`,
          "계정 삭제",
          () => net.send({ t: 'accounts.revoke', accountId: a.id }),
        ),
      );
      list.append(
        h(
          'li',
          {},
          h('span.dot', { class: a.online ? 'on' : '', title: seen }),
          h('span.name', {}, a.name, you ? h('span.you', {}, " (나)") : null),
          h('span.role', { class: a.role }, a.role),
          h('span.keys', { title: `초대: ${a.createdBy}` }, seen),
          you ? null : role,
          you ? null : revoke,
        ),
      );
    }
    if (!s.accounts.length) list.append(h('li.empty', {}, "아직 등록된 계정이 없습니다"));
    body.append(h('h4', {}, "사용자 ", h('span.count', {}, String(s.accounts.length))), list);

    if (s.invites.length) {
      const invites = h('ul.team-list');
      for (const v of s.invites) {
        const cancel = h('button.btn', { type: 'button', title: "이 링크를 더 이상 사용할 수 없게 됩니다" }, "취소");
        cancel.addEventListener('click', () => {
          if (fresh?.id === v.id) fresh = null;
          net.send({ t: 'accounts.cancel', inviteId: v.id });
        });
        invites.append(
          h(
            'li',
            {},
            h('span.name', {}, v.name ?? h('i', {}, "본인이 이름 설정")),
            h('span.role', { class: v.role }, v.role),
            h('span.keys', { title: `생성: ${v.createdBy} ${timeAgo(v.createdAt)}` }, expiresIn(v.expiresAt)),
            copyButton("링크 복사", () => inviteLink(v)),
            cancel,
          ),
        );
      }
      body.append(h('h4', {}, "유효한 초대 ", h('span.count', {}, String(s.invites.length))), invites);
    }

    // The shared password: the old way in, kept as a fallback until everyone has an account.
    const toggle = h('button.btn', { type: 'button', class: s.sharedPassword ? 'danger' : '' }, s.sharedPassword ? "사용 안 함" : "다시 사용");
    const canSwitchOff = me.account?.role === 'admin';
    if (s.sharedPassword && !canSwitchOff) toggle.setAttribute('disabled', '');
    toggle.addEventListener('click', () => {
      if (!s.sharedPassword) return net.send({ t: 'accounts.shared', on: true });
      confirmDialog(
        "공용 비밀번호 사용을 끌까요?",
        "앞으로 개인 계정이 있는 사람만 로그인할 수 있습니다. 공용 비밀번호로 입장한 참여자는 모두 즉시 로그아웃됩니다.",
        "사용 안 함",
        () => net.send({ t: 'accounts.shared', on: false }),
      );
    });
    body.append(
      h('div.team-head', {}, h('h4', {}, "사무실 공용 비밀번호"), toggle),
      h(
        'p.note',
        {},
        s.sharedPassword
          ? "사용 중입니다. 비밀번호를 알면 원하는 이름으로 관리자 권한을 얻습니다. 모든 참여자가 개인 계정을 만들면 공용 비밀번호 사용을 꺼야 계정 삭제로 접근을 확실히 차단할 수 있습니다."
          : "사용하지 않습니다. 개인 계정만 로그인할 수 있습니다. 모든 관리자가 접근하지 못하면 이 컴퓨터에서 agent-office accounts password on을 실행하세요.",
        s.sharedPassword && !canSwitchOff ? h('b', {}, " 먼저 내 관리자 계정을 만들고 해당 계정으로 로그인하세요.") : null,
      ),
    );
    if (typing) nameInput.focus();
  };

  onInvited = (msg) => {
    inviteBtn.disabled = false;
    if (msg.error || !msg.invite) {
      status = h('p.team-status.error', {}, msg.error ?? "초대 링크를 만들지 못했습니다");
      return render();
    }
    fresh = msg.invite;
    nameInput.value = '';
    status = h('p.team-status.ok', {}, `✅ ${msg.invite.name ?? 'them'}에게 이 링크를 보내세요. 한 번만 사용할 수 있고 7일 뒤 만료됩니다.`);
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
