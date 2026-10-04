import './signins.css';
import type { SignInKind, SignInState } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, type Modal } from './dom';
import { confirmDialog } from './prompt';
import { copyButton } from './team';

const NAMES: Record<SignInKind, string> = { claude: 'Claude', github: 'GitHub' };

let open: { modal: Modal; say(why?: string): void } | null = null;

/**
 * 🔐 Your sign-ins: the Claude plan your workers run on and the GitHub account the office acts as
 * for you, both your own (see server/signins.ts). The office runs the sign-in itself and hands you
 * the page to open; or paste a token; admins may use the office machine's own instead.
 * `why` says what sent you here (hiring a worker before signing in, say).
 */
export function openSignIns(net: Net, why?: string) {
  if (open) return open.say(why);
  const close = h('button.btn.close', { 'aria-label': "닫기" }, '✕');
  const banner = h('p.team-status', { hidden: true });
  const cards = h('div.signins');
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': "내 로그인 정보", style: 'width:min(640px,100%)' },
    h('header', {}, h('h2', {}, "🔐 내 로그인 정보"), close),
    h(
      'div.body.team',
      {},
      h('p.note.lead', {}, "직원들은 내 Claude 요금제를 사용하고 GitHub에서도 내 계정으로 작업합니다. 댓글, 병합, PR에는 내 이름이 표시되며, 로그인 정보는 내 직원들만 사용합니다."),
      banner,
      cards,
      h('p.note', {}, "책상에서 🐚 Shell을 열고 ", h('code', {}, 'claude auth login'), ' and ', h('code', {}, 'gh auth login'), " 명령으로 로그인할 수도 있습니다."),
    ),
  );

  // Kept across renders, so a half-typed code or token survives the next update.
  const inputs = {
    code: h('input', { type: 'text', placeholder: "인증 코드를 여기에 붙여넣으세요", 'aria-label': "로그인 페이지의 인증 코드", autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement,
    claude: h('input', { type: 'password', placeholder: 'sk-ant-oat01-…', 'aria-label': "Claude 토큰", autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement,
    github: h('input', { type: 'password', placeholder: 'ghp_… or github_pat_…', 'aria-label': "GitHub 토큰", autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement,
  };

  const say = (text?: string) => {
    banner.hidden = !text;
    banner.textContent = text ?? '';
  };

  const button = (label: string, onClick: () => void, cls = '') => {
    const b = h('button.btn', { type: 'button', class: cls }, label);
    b.addEventListener('click', onClick);
    return b;
  };

  const tokenRow = (which: SignInKind) => {
    const input = inputs[which];
    const save = h('button.btn', { type: 'submit' }, "저장");
    const form = h('form.invite-row', {}, input, save) as HTMLFormElement;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const token = input.value.trim();
      if (!token) return input.focus();
      net.send({ t: 'signins.token', which, token });
      input.value = '';
    });
    return form;
  };

  const card = (which: SignInKind, s: SignInState, office: boolean) => {
    const status =
      s.status === 'ok'
        ? h('span.signin-who.ok', {}, '✅ ', s.how === 'office' ? `사무실 기본 로그인${s.who ? ` (${s.who})` : ''}` : (s.who ?? "로그인 정보"))
        : s.status === 'busy'
          ? h('span.signin-who', {}, "⏳ 로그인 중…")
          : h('span.signin-who.none', {}, "로그인 안 됨");
    const head = h('div.team-head', {}, h('h4', {}, which === 'claude' ? '✳️ Claude' : '🐙 GitHub'), status);
    const body = h('div.signin-body');
    const box = h('section.signin', { class: s.status }, head, body);
    if (s.error) body.append(h('p.team-status.error', {}, s.error));

    if (s.pending) {
      const url = s.pending.url && /^https:\/\//.test(s.pending.url) ? s.pending.url : undefined;
      if (!url) {
        body.append(h('p.note', {}, `${NAMES[which]} 로그인을 시작하는 중…`));
      } else if (which === 'claude') {
        const send = h('button.btn.primary', { type: 'submit' }, s.pending.sent ? "확인 중…" : "보내기");
        if (s.pending.sent) send.setAttribute('disabled', '');
        const form = h('form.invite-row', {}, inputs.code, send) as HTMLFormElement;
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const code = inputs.code.value.trim();
          if (!code) return inputs.code.focus();
          net.send({ t: 'signins.code', code });
          inputs.code.value = '';
        });
        body.append(
          h('ol.signin-steps', {}, h('li', {}, h('a.btn.primary', { href: url, target: '_blank', rel: 'noopener noreferrer' }, "Claude 로그인 페이지 열기 ↗"), "에서 내 계정으로 로그인하세요."), h('li', {}, "표시된 인증 코드를 여기에 붙여넣으세요:", form)),
        );
      } else {
        const code = s.pending.code ?? '';
        body.append(
          h(
            'ol.signin-steps',
            {},
            h('li', {}, "일회용 인증 코드를 복사하세요:", h('div.cmd', {}, h('pre.signin-code', {}, code), copyButton("복사", () => code))),
            h('li', {}, h('a.btn.primary', { href: url, target: '_blank', rel: 'noopener noreferrer' }, "github.com/login/device 열기 ↗"), "에서 코드를 입력하세요."),
            h('li', {}, "GitHub 인증을 마치면 자동으로 반영됩니다."),
          ),
        );
      }
      body.append(h('div.signin-actions', {}, button("취소", () => net.send({ t: 'signins.cancel', which }))));
      return box;
    }

    if (s.status === 'ok') {
      const change = button(s.how === 'office' ? "내 계정으로 변경" : "로그아웃", () => {
        if (s.how === 'office') return net.send({ t: 'signins.signout', which });
        confirmDialog(`${NAMES[which]}에서 로그아웃할까요?`, which === 'claude' ? "앞으로 고용할 직원은 다시 로그인해야 합니다. 이미 실행 중인 직원은 계속 작업합니다." : "다시 로그인할 때까지 내 계정으로 GitHub 작업을 수행할 수 없습니다.", "로그아웃", () => net.send({ t: 'signins.signout', which }));
      });
      body.append(h('div.signin-actions', {}, change));
      return box;
    }

    // Not signed in (or busy looking): the ways in.
    const start = button(`${NAMES[which]} 로그인`, () => net.send({ t: 'signins.start', which }), 'primary');
    const actions = h('div.signin-actions', {}, start);
    if (office) actions.append(button("사무실 기본 로그인 사용", () => net.send({ t: 'signins.office', which })));
    body.append(
      actions,
      which === 'claude'
        ? h('p.note', {}, "또는 토큰을 붙여넣으세요. 내 컴퓨터에서 ", h('code', {}, 'claude setup-token'), "을 실행해 발급하거나 Anthropic API key를 사용할 수 있습니다.")
        : h('p.note', {}, "또는 GitHub 토큰을 붙여넣으세요 (", h('a', { href: 'https://github.com/settings/tokens/new?scopes=repo,read:org,workflow&description=Agent%20Office', target: '_blank', rel: 'noopener noreferrer' }, "토큰 만들기"), " · repo, read:org, workflow 권한 필요)."),
      tokenRow(which),
    );
    return box;
  };

  const render = () => {
    const s = store.signins;
    const typing = document.activeElement;
    cards.replaceChildren();
    if (!s) {
      cards.append(h('p.empty', {}, store.me.account ? "불러오는 중…" : "공용 비밀번호로 입장한 경우 직원들은 사무실 기본 로그인 정보를 사용합니다."));
      return;
    }
    cards.append(card('claude', s.claude, s.office), card('github', s.github, s.office));
    if (typing instanceof HTMLInputElement && Object.values(inputs).includes(typing) && typing.isConnected) typing.focus();
    // Once both are sorted, whatever sent you here is too.
    if (s.claude.status === 'ok' && s.github.status === 'ok') say();
  };

  const unsub = store.on('signins', render);
  const modal = openModal(el, {
    onClose: () => {
      unsub();
      open = null;
    },
  });
  close.addEventListener('click', () => modal.close());
  open = { modal, say };
  say(why);
  render();
  net.send({ t: 'signins.get' });
}

/** Whether the panel should greet someone who just came in: their Claude sign-in still to do. */
export function needsSigningIn(): boolean {
  const s = store.signins;
  return !!store.me.account && !!s && s.claude.status === 'none' && s.claude.how === 'login';
}
