import './team.css';
import type { ServerMsg, TeamState } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal } from './dom';
import { confirmDialog } from './prompt';

export type Os = 'mac' | 'linux' | 'windows';
export const OS_LABEL: Record<Os, string> = { mac: 'macOS', linux: 'Linux', windows: 'Windows' };

export function guessOs(): Os {
  const p = navigator.userAgent;
  return /Windows/i.test(p) ? 'windows' : /Mac/i.test(p) ? 'mac' : 'linux';
}

/** Opens a URL in the browser, for ssh's LocalCommand. */
export function openCommand(url: string, os: Os): string {
  return os === 'mac' ? `open ${url}` : os === 'windows' ? `start ${url}` : `xdg-open ${url} >/dev/null 2>&1 &`;
}

/** One command that opens the tunnel and, once it's up, the office in their browser. */
export function tunnelCommand(t: TeamState, os: Os): string {
  // LocalCommand runs after the forward is listening, so the page loads on the first try.
  const open = openCommand(`http://localhost:${t.port}`, os);
  return `ssh -o ExitOnForwardFailure=yes -o PermitLocalCommand=yes -o LocalCommand="${open}" -L ${t.port}:localhost:${t.port} ${t.ssh}`;
}

function inviteMessage(t: TeamState, os: Os): string {
  const project = store.project?.name ?? 'our';
  return [
    `You're invited to the ${project} Agent Office. Run this in a terminal (${OS_LABEL[os]}):`,
    '',
    tunnelCommand(t, os),
    '',
    `It opens the office at http://localhost:${t.port} — sign in (with the office password, or the account link you get from me) and keep that terminal open while you're in.`,
    t.fingerprint ? `The first time, ssh asks whether to trust the server. Only say yes if it shows ${t.fingerprint}` : '',
  ]
    .filter((l, i, all) => l || all[i - 1])
    .join('\n')
    .trim();
}

/** On an office on a Tailscale network: the link, and how to get onto the network. */
function tailnetMessage(t: TeamState): string {
  const project = store.project?.name ?? 'our';
  return [
    `You're invited to the ${project} Agent Office: https://${t.tailnet}`,
    '',
    "It's on our Tailscale network. If you aren't on it yet: install Tailscale (https://tailscale.com/download), sign in, and accept the invite I send you from Tailscale. Then open the link and sign in with the office password, or the account link you get from me.",
  ].join('\n');
}

const TAILSCALE_ADMIN = 'https://login.tailscale.com/admin';

export async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Not a secure context: fall back to a hidden textarea.
    const ta = h('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function copyButton(label: string, text: () => string, cls = '') {
  const btn = h('button.btn', { type: 'button', class: cls }, label);
  btn.addEventListener('click', async () => {
    btn.textContent = (await copy(text())) ? "✓ 복사됨" : "복사하지 못했습니다";
    setTimeout(() => (btn.textContent = label), 1600);
  });
  return btn;
}

let onInvited: ((msg: Extract<ServerMsg, { t: 'team.invited' }>) => void) | null = null;

export function routeTeamMessage(msg: ServerMsg) {
  if (msg.t === 'team.invited') onInvited?.(msg);
}

export function openTeam(net: Net) {
  let os = guessOs();
  let status: HTMLElement | null = null;
  const body = h('div.body.team');
  const close = h('button.btn.close', { 'aria-label': "닫기" }, '✕');
  const message = (t: TeamState) => (t.tailnet ? tailnetMessage(t) : inviteMessage(t, os));
  const copyMsg = copyButton("✉️ 초대 안내 복사", () => (store.team ? message(store.team) : ''), 'primary');
  const footer = h('footer', {}, h('span.grow', {}, "초대받은 사람도 로그인해야 합니다. 사무실 비밀번호나 🔑 계정 관리에서 만든 개인 계정을 사용하세요."), copyMsg);
  const el = h('div.modal', { role: 'dialog', 'aria-label': "팀원 초대", style: 'width:min(680px,100%)' }, h('header', {}, h('h2', {}, "👥 팀원 초대"), close), body, footer);

  const input = h('input', { type: 'text', maxlength: 40, placeholder: "GitHub 사용자명", 'aria-label': "GitHub 사용자명", autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const inviteBtn = h('button.btn.primary', { type: 'submit' }, "초대");
  const form = h('form.invite-row', {}, input, inviteBtn) as HTMLFormElement;
  const setStatus = (text: string, kind: 'busy' | 'ok' | 'error') => {
    status = h('p.team-status', { class: kind }, text);
    render();
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const github = input.value.trim();
    if (!github) return input.focus();
    inviteBtn.disabled = true;
    setStatus(`GitHub에서 ${github}의 SSH key를 확인하는 중…`, 'busy');
    net.send({ t: 'team.invite', github });
  });

  let focused = false;
  const render = () => {
    const t = store.team;
    const typing = document.activeElement === input;
    body.replaceChildren();
    if (!t) return body.append(h('p.empty', {}, "불러오는 중…"));
    footer.classList.toggle('hidden', !!t.unavailable);
    if (t.unavailable) return body.append(h('p', { style: 'margin:0;font-weight:700' }, t.unavailable));
    if (t.tailnet) return renderTailnet(t);

    body.append(
      h('label', {}, "GitHub 사용자명으로 초대"),
      form,
      h('p.note', {}, "github.com/<username>.keys의 SSH key로 이 사무실에만 터널을 열 수 있습니다. 이 컴퓨터의 Shell이나 다른 포트에는 접근할 수 없습니다."),
    );
    if (status) body.append(status);
    if (t.error) body.append(h('p.team-status.error', {}, t.error));

    const tabs = h(
      'div.os-tabs',
      {},
      ...(Object.keys(OS_LABEL) as Os[]).map((o) =>
        h('button.btn', { type: 'button', class: o === os ? 'on' : '', onclick: () => ((os = o), render()) }, OS_LABEL[o]),
      ),
    );
    body.append(
      h('div.team-head', {}, h('h4', {}, "이 안내를 초대받은 사람에게 보내세요"), tabs),
      h('div.cmd', {}, h('pre', {}, tunnelCommand(t, os)), copyButton("복사", () => tunnelCommand(t, os))),
      h(
        'p.note',
        {},
        `터널을 연결하고 브라우저에서 http://localhost:${t.port}을 엽니다. 사용하는 동안 터미널을 열어 두어야 합니다. `,
        t.fingerprint ? h('span', {}, "처음 연결할 때 SSH에서 서버 신뢰 여부를 묻습니다. fingerprint가 다음 값과 일치해야 합니다: ", h('code', {}, t.fingerprint), '.') : null,
      ),
    );
    // Railway's TCP proxy, a Fly.io app's IP address and the port Dokploy or Coolify publishes
    // (addresses with a port of their own) answer every IP; AWS's firewall doesn't.
    if (!t.ssh?.startsWith('ssh://')) {
      body.append(h('p.note', {}, "허용한 IP만 SSH로 접속할 수 있습니다. 상대의 IP가 허용되지 않았다면 내 컴퓨터에서 ", h('code', {}, `${t.deploy ?? 'deploy/aws.sh'} allow <their-ip>`), ' (or ', h('code', {}, "모든 IP 허용"), ') on your machine.'));
    }

    body.append(h('h4', {}, `초대된 사용자 `, h('span.count', {}, String(t.members.length))), memberList(t));
    if (typing || !focused) setTimeout(() => input.focus(), 30);
    focused = true;
  };

  // Tailscale decides who gets in: the panel says how to let someone onto the network.
  const renderTailnet = (t: TeamState) => {
    const url = `https://${t.tailnet}`;
    const link = (path: string, text: string) => h('a', { href: `${TAILSCALE_ADMIN}/${path}`, target: '_blank', rel: 'noopener' }, text);
    body.append(
      h('label', {}, "같은 Tailscale 네트워크의 참여자는 다음 주소로 접속합니다"),
      h('div.cmd', {}, h('pre', {}, url), copyButton("복사", () => url)),
      h('p.note', {}, "별도 명령이나 열린 터미널이 필요 없습니다. HTTPS로 연결되므로 음성 채팅과 화면 공유도 사용할 수 있습니다."),
      h('h4', {}, "네트워크에 없는 사람"),
      h(
        'p.note',
        {},
        "이 컴퓨터만 공유하려면 Tailscale의 ",
        link('machines', 'Machines'),
        " 페이지에서 ",
        h('code', {}, t.tailnet!.split('.')[0]),
        "을 열고 Share…로 링크를 보내세요. 수락하면 이 컴퓨터에만 접근할 수 있습니다. 전체 네트워크에 초대하려면 ",
        link('users', 'Users'),
        '.',
      ),
    );
    if (status) body.append(status);
    if (t.error) body.append(h('p.team-status.error', {}, t.error));
    // People invited before the office went on the tailnet can still tunnel in, until they're removed.
    if (t.members.length) body.append(h('h4', {}, "SSH key로 초대됨 ", h('span.count', {}, String(t.members.length))), memberList(t));
  };

  const memberList = (t: TeamState) => {
    const list = h('ul.team-list');
    for (const m of t.members) {
      const remove = h('button.btn', { type: 'button', title: `${m.name}의 접속 권한 해제` }, "제거");
      remove.addEventListener('click', () =>
        confirmDialog(
          `${m.name}의 접속 권한을 해제할까요?`,
          `해당 key는 즉시 사용할 수 없게 됩니다. 열린 터널도 잠시 끊기므로 다른 팀원은 명령을 다시 실행해야 합니다. ${m.name}은(는) 사무실 비밀번호를 여전히 알고 있습니다.`,
          "제거",
          () => net.send({ t: 'team.remove', name: m.name }),
        ),
      );
      list.append(h('li', {}, h('span.name', {}, m.name), h('span.keys', {}, `key ${m.keys}개`), remove));
    }
    if (!t.members.length) list.append(h('li.empty', {}, "아직 없습니다"));
    return list;
  };

  onInvited = (msg) => {
    inviteBtn.disabled = false;
    if (msg.error) return setStatus(msg.error, 'error');
    input.value = '';
    setStatus(`✅ ${msg.name}을(를) 초대했습니다 (key ${msg.keys}개). 아래 명령을 전달하세요.`, 'ok');
  };
  const unsub = store.on('team', render);
  const modal = openModal(el, {
    onClose: () => {
      unsub();
      onInvited = null;
    },
  });
  close.addEventListener('click', () => modal.close());
  render();
  net.send({ t: 'team.get' });
}
