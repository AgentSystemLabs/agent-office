import './services.css';
import type { ServiceInfo, ServicesState } from '../../shared/protocol';
import { store } from '../state';
import { h, openModal, timeAgo } from './dom';
import { copy, copyButton, guessOs, openCommand, OS_LABEL, type Os } from './team';
import { L } from '../i18n';

/** Whether this page came over the office's Tailscale network, where every server has its own link. */
function onTailnet(s: ServicesState): boolean {
  return !!s.tailnet && location.hostname === s.tailnet;
}

export function serviceUrl(port: number, s = store.services): string {
  // Tailscale Serve points <office>.ts.net:<port> at the office, which relays it by the port.
  if (onTailnet(s)) return `https://${s.tailnet}:${port}`;
  // The tunnel lands on the office's own port, so it speaks whatever the office speaks.
  return `${location.protocol}//localhost:${port}`;
}

/**
 * One command that tunnels localhost:<port> to the office, which relays it to the worker's
 * server, and opens it once the tunnel is up. It uses the same SSH access as the office itself.
 */
export function serviceTunnel(s: ServicesState, port: number, os: Os): string {
  const open = openCommand(serviceUrl(port), os);
  return `ssh -N -o ExitOnForwardFailure=yes -o PermitLocalCommand=yes -o LocalCommand="${open}" -L ${port}:localhost:${s.port} ${s.ssh ?? 'you@your-server'}`;
}

/**
 * The command that opens every worker's server on someone's own computer by itself, as each one
 * starts (`agent-office tunnel`, src/server/tunnel/). It reaches the office the way this page did.
 */
export function autoTunnel(origin = location.origin): string {
  return origin === 'http://localhost:4600' ? 'agent-office tunnel' : `agent-office tunnel ${origin}`;
}

/** Whether the office is likely on another machine than this browser, so its workers' ports aren't already here. */
function elsewhere(s: ServicesState): boolean {
  return !!s.ssh || !/^(?:localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
}

function describe(svc: ServiceInfo): { who: string; color: string; branch?: string } {
  const w = store.workers.get(svc.workerId);
  return { who: w?.name ?? L.pull.aWorker, color: w?.color ?? '#8d99ae', branch: w?.worktree?.branch };
}

export function openServices() {
  let os = guessOs();
  let picked: number | null = null;
  let copied: number | null = null;
  const body = h('div.body.team.services');
  const close = h('button.btn.close', { 'aria-label': L.common.close }, '✕');
  const tabs = h('div.os-tabs');
  const footer = h('footer', {}, h('span.grow', {}, L.services.foot));
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': L.menu.services, style: 'width:min(760px,100%)' },
    h('header', {}, h('h2', {}, `🌐 ${L.menu.services}`), tabs, close),
    body,
    footer,
  );

  const pick = async (svc: ServiceInfo) => {
    const s = store.services;
    picked = svc.port;
    copied = (await copy(onTailnet(s) ? serviceUrl(svc.port) : serviceTunnel(s, svc.port, os))) ? svc.port : null;
    render();
  };

  const render = () => {
    const s = store.services;
    const direct = onTailnet(s);
    tabs.replaceChildren(
      ...(direct ? [] : (Object.keys(OS_LABEL) as Os[])).map((o) =>
        h('button.btn', { type: 'button', class: o === os ? 'on' : '', onclick: () => ((os = o), (copied = null), render()) }, OS_LABEL[o]),
      ),
    );
    footer.firstElementChild!.textContent = direct
      ? L.services.footDirect
      : L.services.foot;
    body.replaceChildren(
      h(
        'p.note',
        { style: 'margin:0 0 12px' },
        direct
          ? L.services.introDirect
          : L.services.intro,
      ),
    );
    if (!direct && elsewhere(s)) {
      body.append(
        h(
          'div.svc-auto',
          {},
          h('p', {}, L.services.autoTitle),
          h(
            'p.note',
            {},
            L.services.auto1,
            h('code', {}, 'localhost:5173'),
            L.services.auto2,
            h('code', {}, 'agent-office'),
            L.services.auto3,
          ),
          h('div.cmd', {}, h('pre', {}, autoTunnel()), copyButton(L.team.copy, () => autoTunnel())),
        ),
      );
    }
    if (!s.items.length) {
      body.append(
        h(
          'div.svc-empty',
          {},
          h('p', {}, L.services.nothing),
          h('p.note', {}, L.services.when1, h('code', {}, 'npm run dev'), L.services.when2, h('code', {}, 'python -m http.server'), L.services.when3),
        ),
      );
      return;
    }
    const list = h('ul.svc-list');
    for (const svc of s.items) {
      const { who, color, branch } = describe(svc);
      const on = picked === svc.port;
      const title = direct ? L.services.openUrl(serviceUrl(svc.port)) : L.services.openTip(serviceUrl(svc.port));
      const open = h('a.btn', { href: serviceUrl(svc.port), target: '_blank', rel: 'noopener', title }, L.services.open);
      open.addEventListener('click', (e) => e.stopPropagation());
      const li = h(
        'li',
        { class: on ? 'on' : '', tabindex: 0, role: 'button', title: direct ? L.services.copyLink : L.services.copyTunnel },
        h('span.dot', { style: `background:${color}` }),
        h(
          'div.svc-main',
          {},
          h('div.svc-title', {}, svc.title || svc.command),
          h('div.svc-meta', {}, [who, branch ? `🌿 ${branch}` : '', svc.title ? svc.command : '', L.queue.started(timeAgo(svc.since))].filter(Boolean).join(' · ')),
        ),
        h('span.svc-port', {}, `:${svc.port}`),
        open,
      );
      li.addEventListener('click', () => void pick(svc));
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void pick(svc);
        }
      });
      list.append(li);
    }
    body.append(list);

    const svc = s.items.find((i) => i.port === picked);
    if (svc && direct) {
      body.append(
        copied === svc.port
          ? h('p.team-status.ok', {}, L.services.copiedLink(serviceUrl(svc.port)))
          : h('p.team-status', {}, L.services.linkFor(svc.port, serviceUrl(svc.port))),
      );
    } else if (svc) {
      const cmd = serviceTunnel(s, svc.port, os);
      body.append(
        copied === svc.port
          ? h('p.team-status.ok', {}, L.services.copied(serviceUrl(svc.port)))
          : h('p.team-status', {}, L.services.commandFor(svc.port, serviceUrl(svc.port))),
        h('div.cmd', {}, h('pre', {}, cmd), copyButton(L.team.copy, () => cmd)),
      );
    } else if (picked !== null) {
      body.append(h('p.team-status.error', {}, L.services.stopped(picked)));
    }
    if (direct) return;
    body.append(
      s.ssh
        ? h('p.note', {}, L.services.sameSsh, h('code', {}, `${s.deploy ?? 'deploy/aws.sh'} service <port>`), L.services.instead)
        : h('p.note', {}, L.services.replace, h('code', {}, 'you@your-server'), L.services.replaceWith),
    );
  };

  const unsubs = [store.on('services', render), store.on('workers', render)];
  // Keeps "up 5m" fresh.
  const tick = setInterval(render, 30_000);
  const modal = openModal(el, {
    doing: L.services.doing,
    onClose: () => {
      unsubs.forEach((u) => u());
      clearInterval(tick);
    },
  });
  close.addEventListener('click', () => modal.close());
  render();
}
