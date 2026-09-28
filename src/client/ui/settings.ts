import type { Net } from '../net';
import { store, type Settings, type ViewMode } from '../state';
import { askNotifyPermission, notifyPermission, type DesktopNotifier } from '../notify';
import type { ThemePick, WebhookKind } from '../../shared/protocol';
import { THEME_PICKS } from '../../shared/theme';
import { DOG_NAME_MAX, cleanDogName } from '../../shared/dog';
import { h, openModal, timeAgo } from './dom';
import { onJiraSetup } from './jira';

const VIEWS: [ViewMode, string, string][] = [
  ['first', 'First person', 'See through your own eyes. Click the office to look around with the mouse and click things to use them. Esc frees the mouse.'],
  ['third', 'Third person', 'Follow your character from behind. Drag to orbit the camera, scroll to zoom, and click things to use them.'],
];

const THEME_LABEL: Record<ThemePick, string> = { auto: 'By the calendar', halloween: 'Halloween', christmas: 'Christmas', off: 'Off' };

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

  // WebXR in the headset browser: how moving and turning feel in the headset.
  const locoRow = h('div.seg', { role: 'radiogroup', 'aria-label': 'VR locomotion' });
  const turnRow = h('div.seg', { role: 'radiogroup', 'aria-label': 'VR turning' });
  const fadeRow = h('div.seg', { role: 'radiogroup', 'aria-label': 'VR teleport fade' });
  const speedSlider = h('input', { type: 'range', min: 30, max: 180, step: 5, 'aria-label': 'Smooth-turn speed' });
  const speedPct = h('span.vol-pct');
  const speedRow = h('div.volume', {}, speedSlider, speedPct);
  const segBtn = (on: boolean, label: string, onclick: () => void) => h('button.btn', { type: 'button', role: 'radio', 'aria-checked': String(on), class: on ? 'on' : '', onclick }, label);
  const paintVr = () => {
    locoRow.replaceChildren(
      segBtn(!settings.vr.glide, 'Teleport only', () => {
        settings = { ...settings, vr: { ...settings.vr, glide: false } };
        onChange(settings);
        paintVr();
      }),
      segBtn(settings.vr.glide, '+ Smooth glide', () => {
        settings = { ...settings, vr: { ...settings.vr, glide: true } };
        onChange(settings);
        paintVr();
      }),
    );
    turnRow.replaceChildren(
      segBtn(settings.vr.turn === 'snap', 'Snap turn', () => {
        settings = { ...settings, vr: { ...settings.vr, turn: 'snap' } };
        onChange(settings);
        paintVr();
      }),
      segBtn(settings.vr.turn === 'smooth', 'Smooth turn', () => {
        settings = { ...settings, vr: { ...settings.vr, turn: 'smooth' } };
        onChange(settings);
        paintVr();
      }),
    );
    fadeRow.replaceChildren(
      segBtn(settings.vr.fade, 'Fade on', () => {
        settings = { ...settings, vr: { ...settings.vr, fade: true } };
        onChange(settings);
        paintVr();
      }),
      segBtn(!settings.vr.fade, 'Fade off', () => {
        settings = { ...settings, vr: { ...settings.vr, fade: false } };
        onChange(settings);
        paintVr();
      }),
    );
    speedSlider.value = String(settings.vr.turnSpeed);
    speedSlider.style.setProperty('--fill', `${((settings.vr.turnSpeed - 30) / 150) * 100}%`);
    speedPct.textContent = `${settings.vr.turnSpeed}°/s`;
    speedRow.classList.toggle('muted', settings.vr.turn !== 'smooth');
  };
  paintVr();
  speedSlider.addEventListener('input', () => {
    settings = { ...settings, vr: { ...settings.vr, turnSpeed: Number(speedSlider.value) } };
    onChange(settings);
    paintVr();
  });

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
      mute.textContent = settings[muted] ? 'Unmute' : 'Mute';
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
          'Turn on notifications',
        ),
      );
    } else if (perm === 'granted') {
      for (const [value, label] of [
        [true, 'On'],
        [false, 'Off'],
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
      `New projects from the elevator are cloned into ${dir}/<owner>/<repo> (GitLab: ${dir}/<host>/<group>/<project>) on the office’s machine. It can’t be inside a git checkout.` +
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

  // Jira: the office's one account (admins connect it; a read-only token is enough), and the epic this floor's issue board shows.
  const jiraSite = h('input', { type: 'text', placeholder: 'https://your-site.atlassian.net', 'aria-label': 'Jira Cloud site', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const jiraEmail = h('input', { type: 'email', placeholder: 'Email of the account the token belongs to', 'aria-label': 'Atlassian account email', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const jiraToken = h('input', { type: 'password', placeholder: 'API token (read-only is enough)', 'aria-label': 'Atlassian API token', spellcheck: 'false', autocomplete: 'new-password' }) as HTMLInputElement;
  const jiraConnect = h('button.btn.primary', { type: 'button' }, 'Connect') as HTMLButtonElement;
  const jiraCancel = h('button.btn', { type: 'button' }, 'Cancel');
  const jiraForm = h('div.jira-form', {}, jiraSite, jiraEmail, jiraToken, h('div.seg', {}, jiraConnect, jiraCancel));
  const jiraChange = h('button.btn', { type: 'button' }, 'Change');
  const jiraRemove = h('button.btn.danger', { type: 'button' }, 'Remove');
  const jiraActions = h('div.seg', { style: 'margin-top:8px' }, jiraChange, jiraRemove);
  const jiraNote = h('p.setting-note');
  const epicInput = h('input', { type: 'text', placeholder: 'Epic key, e.g. EDP-168', 'aria-label': 'Jira epic for this floor', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const epicSave = h('button.btn.primary', { type: 'button' }, 'Set epic') as HTMLButtonElement;
  const epicRemove = h('button.btn.danger', { type: 'button' }, 'Remove epic');
  const epicRow = h('div.webhook', {}, epicInput, epicSave);
  const epicActions = h('div.seg', { style: 'margin-top:8px' }, epicRemove);
  const epicNote = h('p.setting-note');
  let editingJira = false;
  let jiraBusy: '' | 'connect' | 'epic' = '';
  let jiraError = '';
  let epicError = '';
  const paintJira = () => {
    const { connection, epic } = store.jira;
    const admin = store.me.admin;
    const onFloor = !!store.floor;
    jiraForm.classList.toggle('hidden', !admin || (!!connection && !editingJira));
    jiraCancel.classList.toggle('hidden', !connection);
    jiraActions.classList.toggle('hidden', !admin || !connection || editingJira);
    jiraConnect.disabled = jiraBusy === 'connect';
    jiraConnect.textContent = jiraBusy === 'connect' ? 'Checking…' : 'Connect';
    jiraNote.classList.toggle('bad', !!jiraError);
    jiraNote.textContent = jiraError
      ? `⚠️ ${jiraError}`
      : connection
        ? `🎫 Reading ${connection.site} as ${connection.name === connection.email ? connection.email : `${connection.name} (${connection.email})`}, set up by ${connection.by} ${timeAgo(connection.at)}. The office only reads Jira; it never changes a ticket.`
        : admin
          ? 'Connect the office to Jira Cloud: a site, an email and an API token from https://id.atlassian.com/manage-profile/security/api-tokens. A read-only token (scope read:jira-work) is enough, since the office only reads. The token stays on the office’s machine and is never shown again. Each floor then picks its own epic.'
          : 'The office isn’t connected to Jira. An admin can connect it.';
    const showEpic = !!connection && onFloor;
    epicRow.classList.toggle('hidden', !admin || !showEpic);
    epicActions.classList.toggle('hidden', !admin || !showEpic || !epic);
    epicSave.disabled = jiraBusy === 'epic';
    epicSave.textContent = jiraBusy === 'epic' ? 'Checking…' : 'Set epic';
    if (!epicInput.value && epic) epicInput.value = epic.key;
    epicNote.classList.toggle('hidden', !showEpic);
    epicNote.classList.toggle('bad', !!epicError);
    epicNote.textContent = epicError
      ? `⚠️ ${epicError}`
      : epic
        ? `This floor’s issue board has a Jira tab for ${epic.key}${epic.summary ? ` (“${epic.summary}”)` : ''}: all of its tickets, in To Do, In Progress and Done. Set by ${epic.by} ${timeAgo(epic.at)}.`
        : admin
          ? 'Give this floor a Jira epic and its issue board gets a Jira tab with all of the epic’s tickets, in To Do, In Progress and Done.'
          : 'This floor has no Jira epic. An admin can set one.';
  };
  const offSetup = onJiraSetup((msg) => {
    if (msg.step === 'connect') {
      jiraBusy = '';
      jiraError = msg.error ?? '';
      if (msg.ok) {
        editingJira = false;
        jiraToken.value = '';
      }
    } else {
      jiraBusy = '';
      epicError = msg.error ?? '';
    }
    paintJira();
  });
  paintJira();
  const connectJira = () => {
    if (!jiraSite.value.trim()) return jiraSite.focus();
    if (!jiraEmail.value.trim()) return jiraEmail.focus();
    if (!jiraToken.value.trim()) return jiraToken.focus();
    jiraBusy = 'connect';
    jiraError = '';
    net.send({ t: 'jira.connect', site: jiraSite.value.trim(), email: jiraEmail.value.trim(), token: jiraToken.value.trim() });
    paintJira();
  };
  jiraConnect.addEventListener('click', connectJira);
  jiraToken.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') connectJira();
  });
  jiraChange.addEventListener('click', () => {
    editingJira = true;
    jiraSite.value = store.jira.connection?.site ?? '';
    jiraEmail.value = store.jira.connection?.email ?? '';
    paintJira();
    jiraToken.focus();
  });
  jiraCancel.addEventListener('click', () => {
    editingJira = false;
    jiraError = '';
    jiraToken.value = '';
    paintJira();
  });
  jiraRemove.addEventListener('click', () => {
    if (confirm('Disconnect the office from Jira? Every floor’s Jira tab goes away until someone connects it again.')) net.send({ t: 'jira.disconnect' });
  });
  const saveEpic = () => {
    const key = epicInput.value.trim();
    if (!key) return epicInput.focus();
    jiraBusy = 'epic';
    epicError = '';
    net.send({ t: 'jira.epic', key });
    paintJira();
  };
  epicSave.addEventListener('click', saveEpic);
  epicInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveEpic();
  });
  epicRemove.addEventListener('click', () => {
    epicInput.value = '';
    net.send({ t: 'jira.epic', key: '' });
  });

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
  const signOut = h('button.btn', { type: 'button' }, 'Sign out');
  signOut.addEventListener('click', onSignOut);
  const character = h('button.btn', { type: 'button' }, account ? 'Change your look' : 'Change your look & name');
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': 'Settings' },
    h('header', {}, h('h2', {}, 'Settings'), close),
    h(
      'div.body',
      {},
      h('label', {}, 'Camera view'),
      seg,
      note,
      h('label', { style: 'margin-top:18px' }, 'VR (headset browser)'),
      h('p.setting-note', { style: 'margin:0 0 6px' }, 'Locomotion'),
      locoRow,
      h('p.setting-note', {}, 'Teleport aims with A held (or the left stick pushed forward); gliding walks the stick. Teleport-only is the comfortable default.'),
      h('p.setting-note', { style: 'margin:10px 0 6px' }, 'Turning (right stick)'),
      turnRow,
      speedRow,
      h('p.setting-note', {}, 'Snap turn steps 45° per push; smooth turn spins at the speed above.'),
      h('p.setting-note', { style: 'margin:10px 0 6px' }, 'Teleport fade'),
      fadeRow,
      h('p.setting-note', {}, 'A blink through black as you land, or a straight cut when it’s off.'),
      h('label', { style: 'margin-top:18px' }, 'Office sounds'),
      soundRow,
      h('p.setting-note', {}, 'Workers typing, the coffee machine, thunder, the dog, and the ding when a worker is done. Voice chat isn’t affected.'),
      h('label', { style: 'margin-top:18px' }, 'Jukebox'),
      musicRow,
      h('p.setting-note', {}, 'The jukebox in the lounge. Everyone on the floor hears the same song, louder the closer they are to it; this is how loud it is for you alone.'),
      ...(outside
        ? [
            h('label', { style: 'margin-top:18px' }, 'Outside'),
            h('p.outside-now', {}, outside.now),
            h(
              'p.setting-note',
              {},
              outside.live
                ? 'Everyone sees the same sky: the office’s clock and the live weather where it is.'
                : 'Everyone sees the same sky: the office’s clock, and weather that comes and goes. Start the office with --city to use a real city’s forecast.',
            ),
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
      h('label', { style: 'margin-top:18px' }, 'Worker limit'),
      limitRow,
      limitNote,
      h('label', { style: 'margin-top:18px' }, 'Jira'),
      jiraForm,
      jiraActions,
      jiraNote,
      epicRow,
      epicActions,
      epicNote,
      h('label', { style: 'margin-top:18px' }, 'Workspace folder'),
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
  const offLimit = [store.on('machine', paintLimit), store.on('me', paintLimit)];
  const offDir = [store.on('projectsDir', paintDir), store.on('me', paintDir)];
  const offJira = [store.on('jira', paintJira), store.on('me', paintJira), offSetup];
  const modal = openModal(el, {
    doing: '⚙️ in settings',
    onClose: () => {
      offNotify();
      offDog();
      offTheme();
      offLimit.forEach((off) => off());
      offDir.forEach((off) => off());
      offJira.forEach((off) => off());
    },
  });
  close.addEventListener('click', () => modal.close());
  character.addEventListener('click', () => {
    modal.close();
    onCharacter();
  });
}
