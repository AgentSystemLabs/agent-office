import './services.css';
import type { ServiceInfo, ServicesState } from '../../shared/protocol';
import { store } from '../state';
import { h, openModal, timeAgo } from './dom';
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
  return { who: w?.name ?? "직원", color: w?.color ?? '#8d99ae', branch: w?.worktree?.branch };
}

export function openServices() {
  let os = guessOs();
  let picked: number | null = null;
  let copied: number | null = null;
  const body = h('div.body.team.services');
  const close = h('button.btn.close', { 'aria-label': "닫기" }, '✕');
  const tabs = h('div.os-tabs');
  const footer = h('footer', {}, h('span.grow', {}, "터널은 사무실을 통해 연결되므로 각 페이지에 로그인 인증이 적용됩니다. 사용하는 동안 터미널을 열어 두세요."));
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': "실행 중인 서비스", style: 'width:min(760px,100%)' },
    h('header', {}, h('h2', {}, "🌐 실행 중인 서비스"), tabs, close),
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
      ? "모든 링크는 사무실을 통해 연결되므로 로그인 인증이 적용됩니다."
      : "터널은 사무실을 통해 연결되므로 각 페이지에 로그인 인증이 적용됩니다. 사용하는 동안 터미널을 열어 두세요.";
    body.replaceChildren(
      h(
        'p.note',
        { style: 'margin:0 0 12px' },
        direct
          ? "직원들이 실행한 웹 서버입니다. 각 서비스에는 Tailscale 링크가 있습니다. 직접 열거나 행을 클릭해 같은 네트워크의 참여자에게 공유할 수 있습니다."
          : "직원들이 실행한 웹 서버입니다. 클릭하면 내 컴퓨터에서 여는 명령을 복사합니다. 터미널에 실행하면 페이지가 자동으로 열립니다.",
      ),
    );
    if (!direct && elsewhere(s)) {
      body.append(
        h(
          'div.svc-auto',
          {},
          h('p', {}, "⚡ 모든 서비스 자동으로 열기"),
          h(
            'p.note',
            {},
            "내 컴퓨터에서 이 명령을 실행한 채 두세요. 직원이 시작한 서버가 같은 포트로 열립니다 (",
            h('code', {}, 'localhost:5173'),
            "는 직원의 서버 포트). 직원이 서버를 끄면 연결도 종료됩니다. 내 컴퓨터에 ",
            h('code', {}, 'agent-office'),
            " 명령이 필요합니다. README의 설치 방법을 참고하세요.",
          ),
          h('div.cmd', {}, h('pre', {}, autoTunnel()), copyButton("복사", () => autoTunnel())),
        ),
      );
    }
    if (!s.items.length) {
      body.append(
        h(
          'div.svc-empty',
          {},
          h('p', {}, "아직 실행 중인 서비스가 없습니다."),
          h('p.note', {}, "직원이 웹 서버를 실행하면 (", h('code', {}, 'npm run dev'), ", 미리보기 빌드, ", h('code', {}, 'python -m http.server'), " 등) 몇 초 안에 여기에 표시됩니다. '확인할 수 있도록 개발 서버를 백그라운드에서 실행해줘'라고 요청해 보세요."),
        ),
      );
      return;
    }
    const list = h('ul.svc-list');
    for (const svc of s.items) {
      const { who, color, branch } = describe(svc);
      const on = picked === svc.port;
      const title = direct ? `${serviceUrl(svc.port)} 열기` : `${serviceUrl(svc.port)} 열기 (사무실이 다른 컴퓨터에서 실행 중이면 터널 필요)`;
      const open = h('a.btn', { href: serviceUrl(svc.port), target: '_blank', rel: 'noopener', title }, "열기 ↗");
      open.addEventListener('click', (e) => e.stopPropagation());
      const li = h(
        'li',
        { class: on ? 'on' : '', tabindex: 0, role: 'button', title: direct ? "링크 복사" : "터널 연결 명령 복사" },
        h('span.dot', { style: `background:${color}` }),
        h(
          'div.svc-main',
          {},
          h('div.svc-title', {}, svc.title || svc.command),
          h('div.svc-meta', {}, [who, branch ? `🌿 ${branch}` : '', svc.title ? svc.command : '', `시작: ${timeAgo(svc.since)}`].filter(Boolean).join(' · ')),
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
          ? h('p.team-status.ok', {}, `✅ ${serviceUrl(svc.port)}을(를) 복사했습니다. 같은 네트워크에서 사무실에 로그인한 참여자가 열 수 있습니다.`)
          : h('p.team-status', {}, `:${svc.port} 링크: ${serviceUrl(svc.port)}`),
      );
    } else if (svc) {
      const cmd = serviceTunnel(s, svc.port, os);
      body.append(
        copied === svc.port
          ? h('p.team-status.ok', {}, `✅ 복사했습니다. 터미널에서 실행하면 터널 연결 후 ${serviceUrl(svc.port)}이(가) 열립니다.`)
          : h('p.team-status', {}, `:${svc.port} 연결 명령입니다. 터미널에서 실행하면 ${serviceUrl(svc.port)}이(가) 열립니다.`),
        h('div.cmd', {}, h('pre', {}, cmd), copyButton("복사", () => cmd)),
      );
    } else if (picked !== null) {
      body.append(h('p.team-status.error', {}, `:${picked} 서버가 종료되었습니다.`));
    }
    if (direct) return;
    body.append(
      s.ssh
        ? h('p.note', {}, "사무실과 같은 SSH 접근 권한을 사용합니다. 직접 설치해 본인을 초대하지 않았다면 ", h('code', {}, `${s.deploy ?? 'deploy/aws.sh'} service <port>`), "을 실행하세요.")
        : h('p.note', {}, "다음 값을 ", h('code', {}, 'you@your-server'), "사무실 컴퓨터의 SSH 주소로 바꾸세요. 이 컴퓨터에서 실행 중이면 열기만 누르면 됩니다."),
    );
  };

  const unsubs = [store.on('services', render), store.on('workers', render)];
  // Keeps "up 5m" fresh.
  const tick = setInterval(render, 30_000);
  const modal = openModal(el, {
    doing: "🌐 서비스 목록을 보는 중",
    onClose: () => {
      unsubs.forEach((u) => u());
      clearInterval(tick);
    },
  });
  close.addEventListener('click', () => modal.close());
  render();
}
