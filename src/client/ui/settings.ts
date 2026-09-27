import type { Net } from '../net';
import { store, type Settings, type ViewMode } from '../state';
import { askNotifyPermission, notifyPermission, type DesktopNotifier } from '../notify';
import type { WebhookKind } from '../../shared/protocol';
import { DOG_NAME_MAX, cleanDogName } from '../../shared/dog';
import { h, openModal, timeAgo } from './dom';

const VIEWS: [ViewMode, string, string][] = [
  ['first', '👀 First person', 'See through your own eyes. Click the office to look around with the mouse and click things to use them. Esc frees the mouse.'],
  ['third', '🎥 Third person', 'Follow your character from behind. Drag to orbit the camera, scroll to zoom, and click things to use them.'],
];

const WEBHOOK_NAME: Record<WebhookKind, string> = { slack: 'Slack', discord: 'Discord', other: 'a webhook' };

/** `outside` describes the sky over the office (see describeSky), once the server has said. */
export function openSettings(net: Net, settings: Settings, onChange: (s: Settings) => void, onCharacter: () => void, previewSound: () => void, notifier: DesktopNotifier, onSignOut: () => void, outside?: { now: string; live: boolean }) {
  const seg = h('div.seg', { role: 'radiogroup', 'aria-label': 'Camera view' });
  const note = h('p.setting-note');
  const paint = () => {
    seg.replaceChildren(
      ...VIEWS.map(([view, label]) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(settings.view === view),
            class: settings.view === view ? 'on' : '',
            onclick: () => {
              if (settings.view === view) return;
              settings = { ...settings, view };
              onChange(settings);
              paint();
            },
          },
          label,
        ),
      ),
    );
    note.textContent = VIEWS.find(([v]) => v === settings.view)![2];
  };
  paint();

  /** A volume slider with its mute button. Dragging it turns the sound back on; letting go plays `preview`. */
  const volumeRow = (label: string, level: 'volume' | 'music', muted: 'muted' | 'musicMuted', preview?: () => void) => {
    const slider = h('input', { type: 'range', min: 0, max: 100, step: 1, 'aria-label': label });
    const pct = h('span.vol-pct');
    const mute = h('button.btn', { type: 'button' });
    const row = h('div.volume', {}, mute, slider, pct);
    const paint = () => {
      const v = Math.round(settings[level] * 100);
      slider.value = String(v);
      slider.style.setProperty('--fill', `${v}%`);
      pct.textContent = settings[muted] ? 'Muted' : `${v}%`;
      mute.textContent = settings[muted] ? '🔊 Unmute' : '🔇 Mute';
      mute.setAttribute('aria-pressed', String(settings[muted]));
      mute.classList.toggle('danger', settings[muted]);
      row.classList.toggle('muted', settings[muted]);
    };
    paint();
    slider.addEventListener('input', () => {
      settings = { ...settings, [level]: Number(slider.value) / 100, [muted]: false };
      onChange(settings);
      paint();
    });
    if (preview) slider.addEventListener('change', preview);
    mute.addEventListener('click', () => {
      settings = { ...settings, [muted]: !settings[muted] };
      onChange(settings);
      paint();
      if (!settings[muted]) preview?.();
    });
    return row;
  };
  const soundRow = volumeRow('Office sounds volume', 'volume', 'muted', previewSound);
  const musicRow = volumeRow('Jukebox volume', 'music', 'musicMuted');

  // Desktop notifications: this browser's permission, then your own on/off.
  const notifyRow = h('div.seg');
  const notifyNote = h('p.setting-note');
  const paintNotify = () => {
    const perm = notifyPermission();
    const on = perm === 'granted' && settings.notify;
    notifyRow.replaceChildren();
    if (perm === 'default') {
      notifyRow.append(
        h(
          'button.btn.primary',
          {
            type: 'button',
            onclick: async () => {
              if ((await askNotifyPermission()) === 'granted') {
                settings = { ...settings, notify: true };
                onChange(settings);
                notifier.sample();
              }
              paintNotify();
            },
          },
          '🔔 Turn on notifications',
        ),
      );
    } else if (perm === 'granted') {
      for (const [value, label] of [
        [true, '🔔 On'],
        [false, '🔕 Off'],
      ] as const) {
        notifyRow.append(
          h(
            'button.btn',
            {
              type: 'button',
              role: 'radio',
              'aria-checked': String(on === value),
              class: on === value ? 'on' : '',
              onclick: () => {
                settings = { ...settings, notify: value };
                onChange(settings);
                paintNotify();
              },
            },
            label,
          ),
        );
      }
      if (on) notifyRow.append(h('button.btn', { type: 'button', onclick: () => notifier.sample() }, 'Show me one'));
    }
    notifyNote.textContent =
      perm === 'unsupported'
        ? 'This browser can’t show notifications from the office here. They need https or localhost (an SSH tunnel counts).'
        : perm === 'denied'
          ? 'Your browser blocks notifications from the office. Allow them in the site settings (the icon left of the address), then open this again.'
          : 'When a worker needs input or finishes while you’re in another tab or app, you get a notification. Click it to jump to that worker’s terminal. The tab title counts the workers waiting on someone either way.';
  };
  paintNotify();

  // The office's Slack / Discord webhook, shared by everyone.
  const hookStatus = h('p.setting-note');
  const hookInput = h('input', { type: 'text', placeholder: 'https://hooks.slack.com/services/…', 'aria-label': 'Slack or Discord webhook URL', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const hookSave = h('button.btn.primary', { type: 'button' }, 'Save');
  const hookTest = h('button.btn', { type: 'button' }, 'Send a test');
  const hookRemove = h('button.btn.danger', { type: 'button' }, 'Remove');
  const hookActions = h('div.seg', { style: 'margin-top:8px' }, hookTest, hookRemove);
  const paintHook = () => {
    const { webhook, error, lastSentAt } = store.notify;
    hookActions.classList.toggle('hidden', !webhook);
    hookSave.textContent = webhook ? 'Replace' : 'Save';
    hookStatus.classList.toggle('bad', !!error);
    hookStatus.textContent = !webhook
      ? 'Paste an incoming webhook from Slack or Discord, and the office posts to that channel when a worker needs input or finishes and nobody has its terminal open. It’s for everyone in the office.'
      : error
        ? `⚠️ Posting to ${WEBHOOK_NAME[webhook.kind]} (${webhook.hint}) failed: ${error}`
        : `📣 Posting to ${WEBHOOK_NAME[webhook.kind]} (${webhook.hint}), set by ${webhook.by} ${timeAgo(webhook.at)}${lastSentAt ? ` · last message ${timeAgo(lastSentAt)}` : ''}.`;
  };
  paintHook();
  const saveHook = () => {
    const url = hookInput.value.trim();
    if (!url) return hookInput.focus();
    net.send({ t: 'notify.webhook', url });
    hookInput.value = '';
  };
  hookSave.addEventListener('click', saveHook);
  hookInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveHook();
  });
  hookTest.addEventListener('click', () => net.send({ t: 'notify.test' }));
  hookRemove.addEventListener('click', () => net.send({ t: 'notify.webhook', url: '' }));

  // The dog on this floor, named for everyone here.
  const dogInput = h('input', { type: 'text', maxlength: DOG_NAME_MAX, 'aria-label': 'The dog’s name', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const dogSave = h('button.btn.primary', { type: 'button' }, 'Rename');
  const dogNote = h('p.setting-note');
  const dogSection = h('div', {}, h('label', { style: 'margin-top:18px' }, 'Office dog'), h('div.webhook', {}, dogInput, dogSave), dogNote);
  const paintDog = () => {
    const dog = store.dog;
    dogSection.classList.toggle('hidden', !dog);
    if (!dog) return;
    dogInput.placeholder = dog.name;
    dogNote.textContent = `${dog.name} lives on this floor. When a worker needs input, ${dog.name} runs to its desk and barks. Walk up and press E to pet it. A new name is for everyone on this floor.`;
  };
  paintDog();
  const renameDog = () => {
    const name = cleanDogName(dogInput.value);
    if (!name) return dogInput.focus();
    net.send({ t: 'dog.name', name });
    dogInput.value = '';
  };
  dogSave.addEventListener('click', renameDog);
  dogInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') renameDog();
  });

  const account = store.me.account;
  const signOut = h('button.btn', { type: 'button' }, '🚪 Sign out');
  signOut.addEventListener('click', onSignOut);
  const character = h('button.btn', { type: 'button' }, account ? '🧍 Change your look' : '🧍 Change your look & name');
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': 'Settings' },
    h('header', {}, h('h2', {}, '⚙️ Settings'), close),
    h(
      'div.body',
      {},
      h('label', {}, 'Camera view'),
      seg,
      note,
      h('label', { style: 'margin-top:18px' }, 'Office sounds'),
      soundRow,
      h('p.setting-note', {}, 'Workers typing, footsteps, the coffee machine, birds and rain outside, the dog, and the ding when a worker is done. Voice chat isn’t affected.'),
      h('label', { style: 'margin-top:18px' }, '🎵 Jukebox'),
      musicRow,
      h('p.setting-note', {}, 'The jukebox in the lounge. Everyone on the floor hears the same song, louder the closer they are to it; this is how loud it is for you alone.'),
      ...(outside
        ? [
            h('label', { style: 'margin-top:18px' }, 'Outside'),
            h('p.outside-now', {}, outside.now),
            h('p.setting-note', {}, outside.live ? 'Everyone sees the same sky: the office’s clock and the live weather where it is.' : 'Everyone sees the same sky: the office’s clock, and weather that comes and goes. Start the office with --city to use a real city’s forecast.'),
          ]
        : []),
      h('label', { style: 'margin-top:18px' }, 'Desktop notifications'),
      notifyRow,
      notifyNote,
      h('label', { style: 'margin-top:18px' }, 'Team notifications (Slack / Discord)'),
      h('div.webhook', {}, hookInput, hookSave),
      hookActions,
      hookStatus,
      dogSection,
      h('label', { style: 'margin-top:18px' }, 'Your character'),
      character,
      h('label', { style: 'margin-top:18px' }, 'Signed in'),
      h('div.volume', {}, signOut),
      h('p.setting-note', {}, account ? `As ${account.name}, with your own account (${account.role}).` : 'With the shared office password.'),
    ),
  );
  const offNotify = store.on('notify', paintHook);
  const offDog = store.on('dog', paintDog);
  const modal = openModal(el, {
    onClose: () => {
      offNotify();
      offDog();
    },
  });
  close.addEventListener('click', () => modal.close());
  character.addEventListener('click', () => {
    modal.close();
    onCharacter();
  });
}
