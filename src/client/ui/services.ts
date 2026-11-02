import './services.css';
import type { ServiceInfo, ServicesState } from '../../shared/protocol';
import { store } from '../state';
import { h, openModal, timeAgo, toast } from './dom';
import { copy, copyButton, guessOs, openCommand, OS_LABEL, type Os } from './team';

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
  return { who: w?.name ?? 'A worker', color: w?.color ?? '#8d99ae', branch: w?.worktree?.branch };
}

export function openServices() {
  let os = guessOs();
  let picked: number | null = null;
  let copied: number | null = null;
  const body = h('div.body.team.services');
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const tabs = h('div.os-tabs');
  const footer = h('footer', {}, h('span.grow', {}, 'Tunnels go through the office, so the office password still guards every page. Keep the terminal open while you look.'));
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': 'Services', style: 'width:min(760px,100%)' },
    h('header', {}, h('h2', {}, '🌐 Services'), tabs, close),
    body,
    footer,
  );

  const controlService = async (action: 'start' | 'stop', svc: ServiceInfo) => {
    try {
      const name = svc.title || svc.command;
      toast(action === 'start' ? 'Starting service…' : 'Stopping service…', 'info');
      const res = await fetch(`/api/services/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ floor: store.floor, name, command: svc.command }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data.error || `Failed to ${action} service`, 'warn');
      } else {
        toast(action === 'start' ? 'Service started' : 'Service stopped', 'info');
      }
    } catch (err) {
      toast((err as Error).message, 'warn');
    }
  };

  const showServiceLogs = async (svc: ServiceInfo) => {
    const name = svc.title || svc.command;
    const logPre = h('pre', {
      style: 'max-height:60vh;overflow:auto;background:#1b1b1b;color:#f0f0f0;padding:12px;border-radius:10px;font-size:12px;line-height:1.45;white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;margin:0;',
    }, 'Loading logs…');
    const refreshLogs = h('button.btn', { type: 'button' }, '🔄 Refresh');
    const closeLogs = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
    const logModalEl = h(
      'div.modal',
      { role: 'dialog', 'aria-label': `Logs: ${name}`, style: 'width:min(800px,95vw);' },
      h('header', {}, h('h2', {}, `📜 Logs · ${name}`), refreshLogs, closeLogs),
      h('div.body', {}, logPre),
    );
    const logModal = openModal(logModalEl, { doing: 'viewing service logs' });
    closeLogs.addEventListener('click', () => logModal.close());

    const loadLogs = async () => {
      refreshLogs.disabled = true;
      try {
        const floorId = store.floor ?? '';
        const res = await fetch(`/api/services/logs?floor=${encodeURIComponent(floorId)}&name=${encodeURIComponent(name)}`);
        if (!res.ok) {
          logPre.textContent = 'Could not load logs from service.';
          return;
        }
        const data = await res.json();
        const lines: string[] = data.logs ?? [];
        logPre.textContent = lines.length ? lines.join('\n') : 'No logs recorded yet.';
        logPre.scrollTop = logPre.scrollHeight;
      } catch (err) {
        logPre.textContent = `Error: ${(err as Error).message}`;
      } finally {
        refreshLogs.disabled = false;
      }
    };
    refreshLogs.addEventListener('click', loadLogs);
    void loadLogs();
  };

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
      ? 'Every link goes through the office, so the office sign-in still guards every page.'
      : 'Tunnels go through the office, so the office password still guards every page. Keep the terminal open while you look.';
    body.replaceChildren(
      h(
        'p.note',
        { style: 'margin:0 0 12px' },
        direct
          ? 'Web servers the workers are running. Each has its own link on your Tailscale network: open it, or click the row to copy it for someone else on the network.'
          : 'Web servers the workers are running. Click one to copy a command that opens it on your computer — run it in a terminal and the page opens by itself.',
      ),
    );
    if (!direct && elsewhere(s)) {
      body.append(
        h(
          'div.svc-auto',
          {},
          h('p', {}, '⚡ Open them all, by themselves'),
          h(
            'p.note',
            {},
            'Run this on your computer and leave it running. Every server a worker starts opens on the same port there (',
            h('code', {}, 'localhost:5173'),
            ' is the worker’s), and closes when the worker stops it. It needs the ',
            h('code', {}, 'agent-office'),
            ' command on your computer: the install line in the README.',
          ),
          h('div.cmd', {}, h('pre', {}, autoTunnel()), copyButton('Copy', () => autoTunnel())),
        ),
      );
    }
    if (!s.items.length) {
      body.append(
        h(
          'div.svc-empty',
          {},
          h('p', {}, 'Nothing running yet.'),
          h('p.note', {}, 'When a worker starts a web server — ', h('code', {}, 'npm run dev'), ', a preview build, ', h('code', {}, 'python -m http.server'), ' — it shows up here within a few seconds. Try prompting: “start the dev server in the background so we can review it”.'),
        ),
      );
      return;
    }
    const list = h('ul.svc-list');
    for (const svc of s.items) {
      const { who, color, branch } = describe(svc);
      const on = picked === svc.port;
      const isStopped = svc.title?.includes('(Stopped)') || svc.workerId === 'dev-server-stopped';
      const isDevServer =
        svc.workerId?.startsWith('dev-server') ||
        svc.title?.toLowerCase().includes('server') ||
        svc.title?.toLowerCase().includes('dev') ||
        svc.title?.includes('(Stopped)') ||
        svc.title?.includes('(Running)');

      const actionsRow = h('div', { style: 'display:inline-flex;gap:6px;margin-left:auto;align-items:center;' });

      if (isDevServer) {
        const toggleBtn = h('button.btn', {
          type: 'button',
          title: isStopped ? 'Start dev server' : 'Stop dev server',
          style: isStopped
            ? 'background:#e8f5e9;border-color:#2e7d32;color:#1b5e20;padding:2px 8px;font-size:12px;font-weight:800;'
            : 'background:#ffebee;border-color:#c62828;color:#b71c1c;padding:2px 8px;font-size:12px;font-weight:800;',
        }, isStopped ? '▶ Start' : '⏹ Stop');
        toggleBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          void controlService(isStopped ? 'start' : 'stop', svc);
        });

        const logsBtn = h('button.btn', {
          type: 'button',
          title: 'View service logs',
          style: 'padding:2px 8px;font-size:12px;font-weight:800;',
        }, '📜 Logs');
        logsBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          void showServiceLogs(svc);
        });

        actionsRow.append(toggleBtn, logsBtn);
      }

      const title = direct ? `Open ${serviceUrl(svc.port)}` : `Open ${serviceUrl(svc.port)} (needs the tunnel, unless the office runs on this computer)`;
      if (svc.port > 0 && !isStopped) {
        const open = h('a.btn', { href: serviceUrl(svc.port), target: '_blank', rel: 'noopener', title }, 'Open ↗');
        open.addEventListener('click', (e) => e.stopPropagation());
        actionsRow.append(open);
      }

      const li = h(
        'li',
        { class: on ? 'on' : '', tabindex: 0, role: 'button', title: direct ? 'Copy the link' : 'Copy the tunnel command' },
        h('span.dot', { style: `background:${color}` }),
        h(
          'div.svc-main',
          {},
          h('div.svc-title', {}, svc.title || svc.command),
          h('div.svc-meta', {}, [who, branch ? `🌿 ${branch}` : '', svc.title ? svc.command : '', `started ${timeAgo(svc.since)}`].filter(Boolean).join(' · ')),
        ),
        svc.port > 0 ? h('span.svc-port', {}, `:${svc.port}`) : null,
        actionsRow,
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
          ? h('p.team-status.ok', {}, `✅ Copied ${serviceUrl(svc.port)}. Anyone on the network who's signed in to the office can open it.`)
          : h('p.team-status', {}, `The link for :${svc.port}: ${serviceUrl(svc.port)}`),
      );
    } else if (svc) {
      const cmd = serviceTunnel(s, svc.port, os);
      body.append(
        copied === svc.port
          ? h('p.team-status.ok', {}, `✅ Copied. Paste it in a terminal: it opens ${serviceUrl(svc.port)} once the tunnel is up.`)
          : h('p.team-status', {}, `The command for :${svc.port} — run it in a terminal, and it opens ${serviceUrl(svc.port)}.`),
        h('div.cmd', {}, h('pre', {}, cmd), copyButton('Copy', () => cmd)),
      );
    } else if (picked !== null) {
      body.append(h('p.team-status.error', {}, `The server on :${picked} stopped.`));
    }
    if (direct) return;
    body.append(
      s.ssh
        ? h('p.note', {}, 'It uses the same SSH access as the office. Not invited yourself (you set the office up)? Run ', h('code', {}, `${s.deploy ?? 'deploy/aws.sh'} service <port>`), ' instead.')
        : h('p.note', {}, 'Replace ', h('code', {}, 'you@your-server'), ' with how you SSH to the office\'s machine. If the office runs on this computer, just click Open.'),
    );
  };

  const unsubs = [store.on('services', render), store.on('workers', render)];
  // Keeps "up 5m" fresh.
  const tick = setInterval(render, 30_000);
  const modal = openModal(el, {
    doing: '🌐 at the services board',
    onClose: () => {
      unsubs.forEach((u) => u());
      clearInterval(tick);
    },
  });
  close.addEventListener('click', () => modal.close());
  render();
}
