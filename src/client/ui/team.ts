import './team.css';
import type { ServerMsg, TeamState } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal } from './dom';
import { confirmDialog } from './prompt';
import { L } from '../i18n';

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
    L.team.msgInvited(project, OS_LABEL[os]),
    '',
    tunnelCommand(t, os),
    '',
    L.team.msgOpens(t.port),
    t.fingerprint ? L.team.msgFingerprint(t.fingerprint) : '',
  ]
    .filter((l, i, all) => l || all[i - 1])
    .join('\n')
    .trim();
}

/** On an office on a Tailscale network: the link, and how to get onto the network. */
function tailnetMessage(t: TeamState): string {
  const project = store.project?.name ?? 'our';
  return [
    L.team.msgTailnet(store.project?.name, `https://${t.tailnet}`),
    '',
    L.team.msgTailnetHow,
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
    btn.textContent = (await copy(text())) ? L.team.copied : L.team.copyFailed;
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
  const close = h('button.btn.close', { 'aria-label': L.common.close }, '✕');
  const message = (t: TeamState) => (t.tailnet ? tailnetMessage(t) : inviteMessage(t, os));
  const copyMsg = copyButton(L.team.copyMessage, () => (store.team ? message(store.team) : ''), 'primary');
  const footer = h('footer', {}, h('span.grow', {}, L.team.stillSignIn), copyMsg);
  const el = h('div.modal', { role: 'dialog', 'aria-label': L.menu.invite, style: 'width:min(680px,100%)' }, h('header', {}, h('h2', {}, `👥 ${L.menu.invite}`), close), body, footer);

  const input = h('input', { type: 'text', maxlength: 40, placeholder: L.team.username, 'aria-label': L.team.username, autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const inviteBtn = h('button.btn.primary', { type: 'submit' }, L.team.invite);
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
    setStatus(L.team.fetching(github), 'busy');
    net.send({ t: 'team.invite', github });
  });

  let focused = false;
  const render = () => {
    const t = store.team;
    const typing = document.activeElement === input;
    body.replaceChildren();
    if (!t) return body.append(h('p.empty', {}, L.common.loading));
    footer.classList.toggle('hidden', !!t.unavailable);
    if (t.unavailable) return body.append(h('p', { style: 'margin:0;font-weight:700' }, t.unavailable));
    if (t.tailnet) return renderTailnet(t);

    body.append(
      h('label', {}, L.team.byUsername),
      form,
      h('p.note', {}, L.team.keysNote),
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
      h('div.team-head', {}, h('h4', {}, L.team.thenSend), tabs),
      h('div.cmd', {}, h('pre', {}, tunnelCommand(t, os)), copyButton(L.team.copy, () => tunnelCommand(t, os))),
      h(
        'p.note',
        {},
        L.team.opensTunnel(t.port),
        t.fingerprint ? h('span', {}, L.team.fingerprintMust, h('code', {}, t.fingerprint), '.') : null,
      ),
    );
    // Railway's TCP proxy, a Fly.io app's IP address and the port Dokploy or Coolify publishes
    // (addresses with a port of their own) answer every IP; AWS's firewall doesn't.
    if (!t.ssh?.startsWith('ssh://')) {
      body.append(h('p.note', {}, L.team.sshOnly, h('code', {}, `${t.deploy ?? 'deploy/aws.sh'} allow <their-ip>`), L.team.orParen, h('code', {}, 'allow anywhere'), L.team.onYourMachine));
    }

    body.append(h('h4', {}, `${L.team.invited} `, h('span.count', {}, String(t.members.length))), memberList(t));
    if (typing || !focused) setTimeout(() => input.focus(), 30);
    focused = true;
  };

  // Tailscale decides who gets in: the panel says how to let someone onto the network.
  const renderTailnet = (t: TeamState) => {
    const url = `https://${t.tailnet}`;
    const link = (path: string, text: string) => h('a', { href: `${TAILSCALE_ADMIN}/${path}`, target: '_blank', rel: 'noopener' }, text);
    body.append(
      h('label', {}, L.team.tailnetOpens),
      h('div.cmd', {}, h('pre', {}, url), copyButton(L.team.copy, () => url)),
      h('p.note', {}, L.team.tailnetNote),
      h('h4', {}, L.team.notOnIt),
      h(
        'p.note',
        {},
        L.team.share1,
        link('machines', 'Machines'),
        L.team.share2,
        h('code', {}, t.tailnet!.split('.')[0]),
        L.team.share3,
        link('users', 'Users'),
        '.',
      ),
    );
    if (status) body.append(status);
    if (t.error) body.append(h('p.team-status.error', {}, t.error));
    // People invited before the office went on the tailnet can still tunnel in, until they're removed.
    if (t.members.length) body.append(h('h4', {}, L.team.bySshKey, h('span.count', {}, String(t.members.length))), memberList(t));
  };

  const memberList = (t: TeamState) => {
    const list = h('ul.team-list');
    for (const m of t.members) {
      const remove = h('button.btn', { type: 'button', title: L.team.removeAccess(m.name) }, L.settings.remove);
      remove.addEventListener('click', () =>
        confirmDialog(
          L.team.removeQ(m.name),
          L.team.removeBody(m.name),
          L.settings.remove,
          () => net.send({ t: 'team.remove', name: m.name }),
        ),
      );
      list.append(h('li', {}, h('span.name', {}, m.name), h('span.keys', {}, L.team.keys(m.keys)), remove));
    }
    if (!t.members.length) list.append(h('li.empty', {}, L.team.nobody));
    return list;
  };

  onInvited = (msg) => {
    inviteBtn.disabled = false;
    if (msg.error) return setStatus(msg.error, 'error');
    input.value = '';
    setStatus(L.team.isInvited(msg.name ?? '', L.team.keys(msg.keys ?? 0)), 'ok');
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
