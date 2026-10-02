import './signins.css';
import type { SignInKind, SignInState } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, type Modal } from './dom';
import { confirmDialog } from './prompt';
import { copyButton } from './team';
import { L } from '../i18n';

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
  const close = h('button.btn.close', { 'aria-label': L.common.close }, '✕');
  const banner = h('p.team-status', { hidden: true });
  const cards = h('div.signins');
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': L.game.signIns, style: 'width:min(640px,100%)' },
    h('header', {}, h('h2', {}, `🔐 ${L.game.signIns}`), close),
    h(
      'div.body.team',
      {},
      h('p.note.lead', {}, L.signin.lead),
      banner,
      cards,
      h('p.note', {}, L.signin.shell1, h('code', {}, 'claude auth login'), L.signin.and, h('code', {}, 'gh auth login'), L.signin.shell2),
    ),
  );

  // Kept across renders, so a half-typed code or token survives the next update.
  const inputs = {
    code: h('input', { type: 'text', placeholder: L.signin.pasteCode, 'aria-label': L.signin.codeLabel, autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement,
    claude: h('input', { type: 'password', placeholder: 'sk-ant-oat01-…', 'aria-label': L.signin.claudeToken, autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement,
    github: h('input', { type: 'password', placeholder: L.signin.ghPlaceholder, 'aria-label': L.signin.githubToken, autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement,
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
    const save = h('button.btn', { type: 'submit' }, L.common.save);
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
        ? h('span.signin-who.ok', {}, '✅ ', s.how === 'office' ? `${L.signin.officeOwn}${s.who ? ` (${s.who})` : ''}` : (s.who ?? L.settings.signedIn))
        : s.status === 'busy'
          ? h('span.signin-who', {}, L.signin.signingIn)
          : h('span.signin-who.none', {}, L.signin.notSignedIn);
    const head = h('div.team-head', {}, h('h4', {}, which === 'claude' ? '✳️ Claude' : '🐙 GitHub'), status);
    const body = h('div.signin-body');
    const box = h('section.signin', { class: s.status }, head, body);
    if (s.error) body.append(h('p.team-status.error', {}, s.error));

    if (s.pending) {
      const url = s.pending.url && /^https:\/\//.test(s.pending.url) ? s.pending.url : undefined;
      if (!url) {
        body.append(h('p.note', {}, L.signin.starting(NAMES[which])));
      } else if (which === 'claude') {
        const send = h('button.btn.primary', { type: 'submit' }, s.pending.sent ? L.signin.checking : L.signin.send);
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
          h('ol.signin-steps', {}, h('li', {}, h('a.btn.primary', { href: url, target: '_blank', rel: 'noopener noreferrer' }, L.signin.openClaude), L.signin.withOwn), h('li', {}, L.signin.showsCode, form)),
        );
      } else {
        const code = s.pending.code ?? '';
        body.append(
          h(
            'ol.signin-steps',
            {},
            h('li', {}, L.signin.copyCode, h('div.cmd', {}, h('pre.signin-code', {}, code), copyButton(L.team.copy, () => code))),
            h('li', {}, h('a.btn.primary', { href: url, target: '_blank', rel: 'noopener noreferrer' }, L.signin.openDevice), L.signin.enterThere),
            h('li', {}, L.signin.updatesItself),
          ),
        );
      }
      body.append(h('div.signin-actions', {}, button(L.hints.cancel, () => net.send({ t: 'signins.cancel', which }))));
      return box;
    }

    if (s.status === 'ok') {
      const change = button(s.how === 'office' ? L.signin.useMine : L.signin.signOut, () => {
        if (s.how === 'office') return net.send({ t: 'signins.signout', which });
        confirmDialog(L.signin.signOutQ(NAMES[which]), which === 'claude' ? L.signin.signOutClaude : L.signin.signOutGithub, L.signin.signOut, () => net.send({ t: 'signins.signout', which }));
      });
      body.append(h('div.signin-actions', {}, change));
      return box;
    }

    // Not signed in (or busy looking): the ways in.
    const start = button(L.signin.signInWith(NAMES[which]), () => net.send({ t: 'signins.start', which }), 'primary');
    const actions = h('div.signin-actions', {}, start);
    if (office) actions.append(button(L.signin.useOffice, () => net.send({ t: 'signins.office', which })));
    body.append(
      actions,
      which === 'claude'
        ? h('p.note', {}, L.signin.pasteToken1, h('code', {}, 'claude setup-token'), L.signin.pasteToken2)
        : h('p.note', {}, L.signin.ghToken1, h('a', { href: 'https://github.com/settings/tokens/new?scopes=repo,read:org,workflow&description=Agent%20Office', target: '_blank', rel: 'noopener noreferrer' }, L.signin.makeOne), L.signin.ghToken2),
      tokenRow(which),
    );
    return box;
  };

  const render = () => {
    const s = store.signins;
    const typing = document.activeElement;
    cards.replaceChildren();
    if (!s) {
      cards.append(h('p.empty', {}, store.me.account ? L.common.loading : L.signin.sharedPassword));
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
