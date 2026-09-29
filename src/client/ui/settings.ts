import type { Net } from '../net';
import { store, type Settings, type ViewMode } from '../state';
import { askNotifyPermission, notifyPermission, type DesktopNotifier } from '../notify';
import type { ThemePick, WebhookKind } from '../../shared/protocol';
import { THEME_PICKS } from '../../shared/theme';
import { DOG_NAME_MAX, cleanDogName } from '../../shared/dog';
import { h, openModal, timeAgo } from './dom';
import { agentFields, choiceLabel, officeChoice } from './provider';
import { openPromptEditor, rewrittenPrompts } from './prompts';

const VIEWS: [ViewMode, string, string][] = [
  ['first', '👀 First person', 'See through your own eyes. Click the office to look around with the mouse and click things to use them. Esc frees the mouse.'],
  ['third', '🎥 Third person', 'Follow your character from behind. Drag to orbit the camera, scroll to zoom, and click things to use them.'],
];

const THEME_LABEL: Record<ThemePick, string> = { auto: '📅 By the calendar', halloween: '🎃 Halloween', christmas: '🎄 Christmas', off: 'Off' };

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

  // Voice chat: an open mic, or muted until you hold V.
  const talkRow = h('div.seg', { role: 'radiogroup', 'aria-label': 'Voice chat' });
  const paintTalk = () => {
    talkRow.replaceChildren(
      ...(
        [
          [false, '🎙️ Open mic'],
          [true, '✋ Push to talk'],
        ] as const
      ).map(([ptt, label]) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(settings.pushToTalk === ptt),
            class: settings.pushToTalk === ptt ? 'on' : '',
            onclick: () => {
              if (settings.pushToTalk === ptt) return;
              settings = { ...settings, pushToTalk: ptt };
              onChange(settings);
              paintTalk();
            },
          },
          label,
        ),
      ),
    );
  };
  paintTalk();
  const musicRow = volumeRow('Jukebox volume', 'music', 'musicMuted');

  // The building's holiday theme, for everyone.
  const themeRow = h('div.seg', { role: 'radiogroup', 'aria-label': 'Holiday theme' });
  const themeNote = h('p.setting-note');
  const paintTheme = () => {
    const { pick, active, by, at } = store.theme;
    themeRow.replaceChildren(
      ...THEME_PICKS.map((p) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(pick === p),
            class: pick === p ? 'on' : '',
            onclick: () => {
              if (store.theme.pick !== p) net.send({ t: 'theme.set', pick: p });
            },
          },
          THEME_LABEL[p],
        ),
      ),
    );
    const now =
      active === 'halloween'
        ? 'Halloween: the workers are zombies, your hands are an undead warlock’s, the dog’s in costume, the sky’s gone creepy and there are jack-o’-lanterns everywhere.'
        : active === 'christmas'
          ? 'Christmas: the workers are elves, your hands are in mittens, the dog’s Rudolph, and it’s snowing outside.'
          : 'No decorations up right now.';
    const how = pick === 'auto' ? ' By the calendar it’s Halloween through October and Christmas through December.' : '';
    themeNote.textContent = `${now}${how} It’s the same for everyone in the building${by ? `, set by ${by}${at ? ` ${timeAgo(at)}` : ''}` : ''}.`;
  };
  paintTheme();

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

  // The worker everyone starts on, unless whoever starts one picks another. Admins pick it.
  const agent = agentFields(store.project, 'office-agent', officeChoice(store.project));
  let agentTouched = false;
  agent.element.addEventListener('change', () => (agentTouched = true));
  agent.element.addEventListener('input', () => (agentTouched = true));
  const agentSave = h('button.btn.primary', { type: 'button' }, 'Save');
  const agentBack = h('button.btn', { type: 'button' });
  const agentActions = h('div.seg', { style: 'margin-top:8px' }, agentSave, agentBack);
  const agentNow = h('p.outside-now');
  const agentNote = h('p.setting-note');
  const paintAgent = () => {
    const admin = store.me.admin;
    const picked = store.prompts.agent;
    const now = officeChoice(store.project);
    agent.element.classList.toggle('hidden', !admin);
    agentActions.classList.toggle('hidden', !admin);
    agentNow.classList.toggle('hidden', admin);
    agentNow.textContent = choiceLabel(now);
    agentBack.classList.toggle('hidden', !picked);
    agentBack.textContent = `Back to ${store.project?.agentCmd.split(' ')[0].split(/[\\/]/).pop() ?? 'the --agent'}`;
    if (!agentTouched) agent.set(now);
    agentNote.textContent =
      'Every worker starts on this: hired at a desk, handed an issue or a pull request from the boards, taken off the queue, the board agents and meetings. Where you start one, ✏️ Edit picks another just for it.' +
      (picked ? ` Set by ${picked.by} ${timeAgo(picked.at)}.` : ' It’s the agent the office was started with, on its own default model.') +
      (admin ? '' : ' Admins can change it.');
  };
  paintAgent();
  agentSave.addEventListener('click', () => {
    if (!agent.valid()) return;
    agentTouched = false;
    net.send({ t: 'prompts.agent', choice: agent.choice() });
  });
  agentBack.addEventListener('click', () => {
    agentTouched = false;
    net.send({ t: 'prompts.agent', choice: null });
  });

  // The prompts the office writes for workers by itself, for the whole office. Admins rewrite them.
  const promptsOpen = h('button.btn', { type: 'button', onclick: () => openPromptEditor(net) });
  const promptsNote = h('p.setting-note');
  const paintPrompts = () => {
    const n = rewrittenPrompts();
    promptsOpen.textContent = store.me.admin ? '📝 Edit the prompts…' : '📝 Read the prompts…';
    promptsNote.textContent =
      'What 🤖 Hand to a worker, 🔍 Review and the boards’ other buttons tell a worker, the note the queue adds to a task, the board agents’ briefs, the meeting room’s parts and the sign writer’s instructions. ' +
      (n ? `${n} of them rewritten.` : 'All as the office wrote them.') +
      (store.me.admin ? '' : ' Admins can rewrite them.');
  };
  paintPrompts();

  // The most workers the office runs at once, across every floor. Admins set it.
  const limitInput = h('input', { type: 'text', inputmode: 'numeric', 'aria-label': 'Most workers at once', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const limitSave = h('button.btn.primary', { type: 'button' }, 'Set limit');
  const limitClear = h('button.btn', { type: 'button' });
  const limitRow = h('div.webhook', {}, limitInput, limitSave, limitClear);
  const limitNote = h('p.setting-note');
  const paintLimit = () => {
    const m = store.machine;
    const admin = store.me.admin;
    limitRow.classList.toggle('hidden', !admin);
    limitInput.placeholder = m.ceiling ? `1 to ${m.ceiling}` : 'e.g. 6';
    limitClear.textContent = m.ceiling ? `Back to ${m.ceiling}` : 'No limit';
    limitClear.classList.toggle('hidden', !m.set);
    const now =
      m.limit === undefined
        ? `No limit: the office hires a worker for every free seat. ${m.workers} ${m.workers === 1 ? 'is' : 'are'} here now, across every floor.`
        : `At most ${m.limit} worker${m.limit === 1 ? '' : 's'} at once, across every floor (${m.workers} now), shells and board agents too. Hiring past that is refused.`;
    const from = m.set ? ` Set by ${m.set.by} ${timeAgo(m.set.at)}.` : '';
    const cap = m.ceiling ? ` The office was started with --max-workers ${m.ceiling}, so it can't go any higher.` : '';
    limitNote.textContent = now + from + cap + (admin ? '' : ' Admins can change it.');
  };
  paintLimit();
  const saveLimit = () => {
    const n = Number(limitInput.value.trim());
    if (!limitInput.value.trim() || !Number.isInteger(n) || n < 1) return limitInput.focus();
    net.send({ t: 'machine.limit', limit: n });
    limitInput.value = '';
  };
  limitSave.addEventListener('click', saveLimit);
  limitInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveLimit();
  });
  limitClear.addEventListener('click', () => net.send({ t: 'machine.limit', limit: null }));

  // Whether a worker whose pull request merged goes home by itself, for everyone.
  const leaveRow = h('div.seg', { role: 'radiogroup', 'aria-label': 'Workers whose pull request merged' });
  const leaveNote = h('p.setting-note');
  const paintLeave = () => {
    const { on, by, at } = store.leaveOnMerge;
    leaveRow.replaceChildren(
      ...([
        [true, '🏠 Go home by themselves'],
        [false, '🪑 Stay until sent home'],
      ] as const).map(([value, label]) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(on === value),
            class: on === value ? 'on' : '',
            onclick: () => {
              if (store.leaveOnMerge.on !== value) net.send({ t: 'leaveOnMerge.set', on: value });
            },
          },
          label,
        ),
      ),
    );
    const now = on
      ? 'Once a worker’s pull request merges, it goes home as soon as it isn’t working or waiting on you and nobody has its terminal open, and its worktree and branch are deleted. A worktree with uncommitted changes, or commits that aren’t on GitHub, is kept.'
      : 'A worker whose pull request merged stays at its desk, outlined in purple, until someone sends it home. Turned on, the ones already merged go too.';
    leaveNote.textContent = `${now} It’s the same for everyone in the building${by ? `, set by ${by}${at ? ` ${timeAgo(at)}` : ''}` : ''}.`;
  };
  paintLeave();

  // Where the elevator clones new projects on the office's machine. Admins move it.
  const dirInput = h('input', { type: 'text', placeholder: '~/Workspace', 'aria-label': 'Workspace folder', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const dirSave = h('button.btn.primary', { type: 'button' }, 'Save');
  const dirDefault = h('button.btn', { type: 'button' }, 'Use the default');
  const dirRow = h('div.webhook', {}, dirInput, dirSave);
  const dirActions = h('div.seg', { style: 'margin-top:8px' }, dirDefault);
  const dirNote = h('p.setting-note');
  const paintDir = () => {
    const { dir, custom, by, at } = store.projectsDir;
    const admin = store.me.admin;
    dirInput.value = dir;
    dirRow.classList.toggle('hidden', !admin);
    dirActions.classList.toggle('hidden', !admin || !custom);
    dirNote.textContent =
      `New projects from the elevator are cloned into ${dir}/<owner>/<repo> on the office’s machine.` +
      (custom && by && at ? ` Set by ${by} ${timeAgo(at)}.` : '') +
      (admin ? ' A checkout of the same repository that’s already there is used as it is. Floors you already have stay where they are.' : ' An admin can move it.');
  };
  paintDir();
  const saveDir = () => {
    const dir = dirInput.value.trim();
    if (!dir) return dirInput.focus();
    if (dir !== store.projectsDir.dir) net.send({ t: 'floor.projectsDir', dir });
  };
  dirSave.addEventListener('click', saveDir);
  dirInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveDir();
  });
  dirDefault.addEventListener('click', () => net.send({ t: 'floor.projectsDir', dir: '' }));

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
      h('label', { style: 'margin-top:18px' }, 'Voice chat'),
      talkRow,
      h('p.setting-note', {}, 'Either way, V joins voice, holding V talks and you’re muted once you let go, and M mutes or unmutes. With push to talk you join muted. Leave voice from the ☰ menu.'),
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
      h('label', { style: 'margin-top:18px' }, 'Holiday theme'),
      themeRow,
      themeNote,
      h('label', { style: 'margin-top:18px' }, 'Desktop notifications'),
      notifyRow,
      notifyNote,
      h('label', { style: 'margin-top:18px' }, 'Team notifications (Slack / Discord)'),
      h('div.webhook', {}, hookInput, hookSave),
      hookActions,
      hookStatus,
      h('label', { style: 'margin-top:18px' }, '🤖 Default worker'),
      agentNow,
      agent.element,
      agentActions,
      agentNote,
      h('label', { style: 'margin-top:18px' }, '📝 Prompts'),
      promptsOpen,
      promptsNote,
      h('label', { style: 'margin-top:18px' }, '👷 Worker limit'),
      limitRow,
      limitNote,
      h('label', { style: 'margin-top:18px' }, '🎉 Workers whose pull request merged'),
      leaveRow,
      leaveNote,
      h('label', { style: 'margin-top:18px' }, '📁 Workspace folder'),
      dirRow,
      dirActions,
      dirNote,
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
  const offTheme = store.on('theme', paintTheme);
  const offLeave = store.on('leaveOnMerge', paintLeave);
  const offLimit = [store.on('machine', paintLimit), store.on('me', paintLimit)];
  const offDir = [store.on('projectsDir', paintDir), store.on('me', paintDir)];
  const offPrompts = [store.on('prompts', paintAgent), store.on('prompts', paintPrompts), store.on('me', paintAgent), store.on('me', paintPrompts)];
  const modal = openModal(el, {
    doing: '⚙️ in settings',
    onClose: () => {
      offNotify();
      offDog();
      offTheme();
      offLeave();
      offLimit.forEach((off) => off());
      offDir.forEach((off) => off());
      offPrompts.forEach((off) => off());
    },
  });
  close.addEventListener('click', () => modal.close());
  character.addEventListener('click', () => {
    modal.close();
    onCharacter();
  });
}
