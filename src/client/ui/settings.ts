import './settings.css';
import type { Net } from '../net';
import type { OfficeSound } from '../sound';
import { store, type NeedsYouSound, type Settings, type ViewMode } from '../state';
import { askNotifyPermission, notifyPermission, type DesktopNotifier } from '../notify';
import type { ThemePick, WebhookKind } from '../../shared/protocol';
import { THEME_PICKS } from '../../shared/theme';
import { mapChoices } from '../../shared/maps';
import { dogSetting } from './settings-dog';
import { h, openModal, timeAgo } from './dom';
import { agentFields, choiceLabel, officeChoice } from './provider';
import { openPromptEditor, rewrittenPrompts } from './prompts';
import { outsideSetting } from './settings-sky';
import { choiceRow } from './settings-rows';
import { L } from '../i18n';
import { languageSettings } from './settings-language';

const VIEWS: [ViewMode, string, string][] = [
  ['first', L.settings.first, L.settings.firstNote],
  ['third', L.settings.third, L.settings.thirdNote],
];

const THEME_LABEL: Record<ThemePick, string> = L.settings.themes;

const WEBHOOK_NAME: Record<WebhookKind, string> = L.settings.webhookNames;

/** The categories down the side of ⚙️ Settings. */
export type SettingsPane = 'you' | 'sound' | 'notify' | 'building' | 'workers';

const PANES: { id: SettingsPane; icon: string; label: string; blurb: string }[] = [
  { id: 'you', icon: '🧍', label: L.main.you, blurb: L.settings2.youBlurb },
  { id: 'sound', icon: '🔊', label: L.settings2.sound, blurb: L.settings2.soundBlurb },
  { id: 'notify', icon: '🔔', label: L.settings2.notify, blurb: L.settings2.notifyBlurb },
  { id: 'building', icon: '🏢', label: L.settings2.building, blurb: L.settings2.buildingBlurb },
  { id: 'workers', icon: '🤖', label: L.page.workers, blurb: L.settings2.workersBlurb },
];

/** Who a setting is for, shown by its name: some are yours alone, some the whole office's. */
type Scope = 'you' | 'floor' | 'office';
const SCOPE: Record<Scope, [label: string, title: string]> = {
  you: L.settings2.scopeYou,
  floor: L.settings2.scopeFloor,
  office: L.settings2.scopeOffice,
};

/** One setting: its name and who it's for, then whatever sets it. */
const setting = (title: string, scope: Scope | null, ...body: Node[]) =>
  h('div.setting', {}, h('div.setting-head', {}, h('h4', {}, title), scope && h('span.scope', { class: scope, title: SCOPE[scope][1] }, SCOPE[scope][0])), ...body);

/** Where ⚙️ Settings was last, so it opens there again. */
let lastPane: SettingsPane = 'you';

/** `outside` describes the sky over the office (see describeSky), once the server has said. `first` opens on that category instead of the last one. */
export function openSettings(net: Net, settings: Settings, onChange: (s: Settings) => void, onCharacter: () => void, sound: Pick<OfficeSound, 'ding' | 'needsYou'>, notifier: DesktopNotifier, onSignOut: () => void, outside?: { now: string; live: boolean }, first?: SettingsPane) {
  const seg = h('div.seg', { role: 'radiogroup', 'aria-label': L.settings.camera });
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
      pct.textContent = settings[muted] ? L.settings.muted : `${v}%`;
      mute.textContent = settings[muted] ? L.settings.unmute : L.settings.mute;
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
  const soundRow = volumeRow(L.settings.soundsVolume, 'volume', 'muted', () => sound.ding('done'));

  /** Changes some of your own settings, and has the office take them up. */
  const change = (some: Partial<Settings>) => {
    settings = { ...settings, ...some };
    onChange(settings);
  };
  // Voice chat: an open mic, or muted until you hold V.
  const talkRow = choiceRow(L.settings.voice, [[false, L.settings.openMic], [true, L.settings.pushToTalk]], () => settings.pushToTalk, (pushToTalk) => change({ pushToTalk }));
  const musicRow = volumeRow(L.settings.jukeboxVolume, 'music', 'musicMuted');

  // The swish of the book's pages at the bookshelf, on or off.
  const pagesRow = choiceRow(L.settings2.pages, [[true, L.settings2.pagesOn], [false, L.settings.themes.off]], () => settings.pageTurns, (pageTurns) => change({ pageTurns }));
  // The alarm when a worker stops to ask you something; picking one plays it.
  const alarmRow = choiceRow<NeedsYouSound>(L.settings.needsYou, [['once', L.settings.needsYouOnce], ['remind', L.settings.needsYouRemind], ['off', L.settings.needsYouOff]], () => settings.needsYouSound, (needsYouSound) => {
    change({ needsYouSound });
    if (needsYouSound !== 'off') sound.needsYou();
  });

  // The building's holiday theme, for everyone.
  const themeRow = h('div.seg', { role: 'radiogroup', 'aria-label': L.settings.holiday });
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
        ? L.settings.halloweenNote
        : active === 'christmas'
          ? L.settings.christmasNote
          : L.settings.noDecorations;
    const how = pick === 'auto' ? L.settings.byCalendar : '';
    themeNote.textContent = `${now}${how} ${L.settings.sameForAll(by ? `${by}${at ? ` ${timeAgo(at)}` : ''}` : undefined)}`;
  };
  paintTheme();

  // The building's map, for everyone: the office, the castle, or one of your own. Opening Settings
  // has the office read its folder of maps again, so one you just added or fixed shows up.
  net.send({ t: 'map.set' });
  const mapRow = h('div.seg', { role: 'radiogroup', 'aria-label': L.settings2.map });
  const mapNote = h('p.setting-note');
  const mapBad = h('p.setting-note.bad', { style: 'white-space: pre-line' });
  const paintMap = () => {
    const { pick, by, at, custom } = store.map;
    const choices = mapChoices(custom);
    mapRow.replaceChildren(
      ...choices.map((m) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(pick === m.id),
            class: pick === m.id ? 'on' : '',
            disabled: !!m.error,
            title: m.error ? L.settings2.wontLoad(m.id, m.error) : m.description,
            onclick: () => {
              if (!m.error && store.map.pick !== m.id) net.send({ t: 'map.set', map: m.id });
            },
          },
          `${m.icon} ${m.name}`,
        ),
      ),
    );
    const now = choices.find((m) => m.id === pick) ?? choices[0];
    mapNote.textContent = `${now.description} ${L.settings2.mapNote(by ? `${by}${at ? ` ${timeAgo(at)}` : ''}` : undefined)}`;
    const broken = choices.filter((m) => m.error);
    mapBad.textContent = broken.map((m) => `⚠️ ${L.settings2.wontLoad(m.id, m.error ?? '')}`).join('\n');
    mapBad.hidden = !broken.length;
  };
  paintMap();

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
          L.settings.turnOnNotify,
        ),
      );
    } else if (perm === 'granted') {
      for (const [value, label] of [
        [true, L.settings.on],
        [false, L.settings.off],
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
      if (on) notifyRow.append(h('button.btn', { type: 'button', onclick: () => notifier.sample() }, L.settings.showOne));
    }
    notifyNote.textContent =
      perm === 'unsupported'
        ? L.settings.notifyUnsupported
        : perm === 'denied'
          ? L.settings.notifyDenied
          : L.settings.notifyNote;
  };
  paintNotify();

  // The office's Slack / Discord webhook, shared by everyone.
  const hookStatus = h('p.setting-note');
  const hookInput = h('input', { type: 'text', placeholder: 'https://hooks.slack.com/services/…', 'aria-label': L.settings.webhookUrl, spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const hookSave = h('button.btn.primary', { type: 'button' }, L.common.save);
  const hookTest = h('button.btn', { type: 'button' }, L.settings.sendTest);
  const hookRemove = h('button.btn.danger', { type: 'button' }, L.settings.remove);
  const hookActions = h('div.seg', { style: 'margin-top:8px' }, hookTest, hookRemove);
  const paintHook = () => {
    const { webhook, error, lastSentAt } = store.notify;
    hookActions.classList.toggle('hidden', !webhook);
    hookSave.textContent = webhook ? L.settings.replace : L.common.save;
    hookStatus.classList.toggle('bad', !!error);
    hookStatus.textContent = !webhook
      ? L.settings.webhookNote
      : error
        ? L.settings.postFailed(`${WEBHOOK_NAME[webhook.kind]} (${webhook.hint})`, error)
        : L.settings.posting(`${WEBHOOK_NAME[webhook.kind]} (${webhook.hint})`, `${webhook.by} ${timeAgo(webhook.at)}`, lastSentAt ? timeAgo(lastSentAt) : undefined);
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
  const agentSave = h('button.btn.primary', { type: 'button' }, L.common.save);
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
    agentBack.textContent = L.settings.backTo(store.project?.agentCmd.split(' ')[0].split(/[\\/]/).pop() ?? L.settings.theAgent);
    if (!agentTouched) agent.set(now);
    agentNote.textContent =
      L.settings.agentNote +
      (picked ? L.settings.setBy(`${picked.by} ${timeAgo(picked.at)}`) : L.settings.startedWith) +
      (admin ? '' : L.settings.adminsChange);
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
    promptsOpen.textContent = store.me.admin ? L.settings.editPrompts : L.settings.readPrompts;
    promptsNote.textContent =
      L.settings.promptsNote +
      (n ? L.settings.rewritten(n) : L.settings.allOriginal) +
      (store.me.admin ? '' : L.settings.adminsRewrite);
  };
  paintPrompts();

  // The most workers the office runs at once, across every floor. Admins set it.
  const limitInput = h('input', { type: 'text', inputmode: 'numeric', 'aria-label': L.settings.mostWorkers, spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const limitSave = h('button.btn.primary', { type: 'button' }, L.settings.setLimit);
  const limitClear = h('button.btn', { type: 'button' });
  const limitRow = h('div.webhook', {}, limitInput, limitSave, limitClear);
  const limitNote = h('p.setting-note');
  const paintLimit = () => {
    const m = store.machine;
    const admin = store.me.admin;
    limitRow.classList.toggle('hidden', !admin);
    limitInput.placeholder = m.ceiling ? L.settings.oneTo(m.ceiling) : L.settings.egSix;
    limitClear.textContent = m.ceiling ? L.settings.backTo(String(m.ceiling)) : L.settings.noLimit;
    limitClear.classList.toggle('hidden', !m.set);
    const now =
      m.limit === undefined
        ? L.settings.noLimitNote(m.workers)
        : L.settings.limitNote(m.limit ?? 0, m.workers);
    const from = m.set ? L.settings.setBy(`${m.set.by} ${timeAgo(m.set.at)}`) : '';
    const cap = m.ceiling ? L.settings.ceiling(m.ceiling) : '';
    limitNote.textContent = now + from + cap + (admin ? '' : L.settings.adminsChange);
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
  const leaveRow = h('div.seg', { role: 'radiogroup', 'aria-label': L.settings.merged });
  const leaveNote = h('p.setting-note');
  const paintLeave = () => {
    const { on, by, at } = store.leaveOnMerge;
    leaveRow.replaceChildren(
      ...([
        [true, L.settings.goHome],
        [false, L.settings.stay],
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
      ? L.settings.goHomeNote
      : L.settings.stayNote;
    leaveNote.textContent = `${now} ${L.settings.sameForAll(by ? `${by}${at ? ` ${timeAgo(at)}` : ''}` : undefined)}`;
  };
  paintLeave();

  // Where the elevator clones new projects on the office's machine. Admins move it.
  const dirInput = h('input', { type: 'text', placeholder: '~/Workspace', 'aria-label': L.elevator.workspaceFolder, spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const dirSave = h('button.btn.primary', { type: 'button' }, L.common.save);
  const dirDefault = h('button.btn', { type: 'button' }, L.settings.useDefault);
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
      L.settings.dirNote(dir) +
      (custom && by && at ? L.settings.setBy(`${by} ${timeAgo(at)}`) : '') +
      (admin ? L.settings.dirAdmin : L.settings.dirNotAdmin);
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

  // The dog on this floor: its name, breed and coat, for everyone here (see settings-dog.ts).
  const { section: dogSection, paint: paintDog } = dogSetting(net, (body) => setting(L.settings.officeDog, 'floor', ...body));
  // Your language and the office's (see settings-language.ts).
  const langs = languageSettings(net, (title, scope, body) => setting(title, scope, ...body));

  // What the sky's doing, and which clock it keeps (see settings-sky.ts).
  const sky = outside && outsideSetting(net, outside, (body) => setting(L.settings.outside, 'office', ...body));
  const account = store.me.account;
  const signOut = h('button.btn', { type: 'button' }, L.settings.signOut);
  signOut.addEventListener('click', onSignOut);
  const character = h('button.btn', { type: 'button' }, account ? L.settings.changeLook : L.settings.changeLookName);
  const panes: Record<SettingsPane, Node[]> = {
    you: [
      setting(L.settings.yourCharacter, null, character),
      setting(L.settings.camera, 'you', seg, note),
      langs.yours,
      setting(L.settings.signedIn, null, h('div.volume', {}, signOut), h('p.setting-note', {}, account ? L.settings.asAccount(account.name, account.role) : L.settings.sharedPassword)),
    ],
    sound: [
      setting(L.settings.sounds, 'you', soundRow, h('p.setting-note', {}, L.settings.soundsNote)),
      setting(L.settings.needsYou, 'you', alarmRow, h('p.setting-note', {}, L.settings.needsYouNote)),
      setting(L.settings2.pages, 'you', pagesRow, h('p.setting-note', {}, L.settings2.pagesNote)),
      setting(L.settings2.jukebox, 'you', musicRow, h('p.setting-note', {}, L.settings.jukeboxNote)),
      setting(L.settings.voice, 'you', talkRow, h('p.setting-note', {}, L.settings.voiceNote)),
    ],
    notify: [
      setting(L.settings.desktopNotify, 'you', notifyRow, notifyNote),
      setting(L.settings.teamNotify, 'office', h('div.webhook', {}, hookInput, hookSave), hookActions, hookStatus),
    ],
    building: [
      setting(L.settings2.map, 'office', mapRow, mapNote, mapBad),
      langs.office,
      setting(L.settings.holiday, 'office', themeRow, themeNote),
      ...(sky ? [sky.section] : []),
      dogSection,
      setting(L.elevator.workspaceFolder, 'office', dirRow, dirActions, dirNote),
    ],
    workers: [
      setting(L.settings2.defaultWorker, 'office', agentNow, agent.element, agentActions, agentNote),
      setting(L.settings2.workerLimit, 'office', limitRow, limitNote),
      setting(L.settings.merged, 'office', leaveRow, leaveNote),
      setting(L.promptEditor.prompts, 'office', promptsOpen, promptsNote),
    ],
  };

  // The categories down the side, the one picked on the right.
  const nav = h('nav.settings-nav', { role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': L.menu.settings });
  const tabs = new Map<SettingsPane, HTMLButtonElement>();
  const bodies = new Map<SettingsPane, HTMLElement>();
  for (const p of PANES) {
    const tab = h('button.settings-tab', { type: 'button', role: 'tab', onclick: () => show(p.id) }, h('span.icon', { 'aria-hidden': 'true' }, p.icon), h('span', {}, p.label)) as HTMLButtonElement;
    tabs.set(p.id, tab);
    nav.append(tab);
    bodies.set(p.id, h('section.settings-pane', { role: 'tabpanel', 'aria-label': p.label }, h('div.settings-head', {}, h('h3', {}, `${p.icon} ${p.label}`), h('p', {}, p.blurb)), ...panes[p.id]));
  }
  const show = (id: SettingsPane) => {
    lastPane = id;
    for (const [t, tab] of tabs) {
      tab.classList.toggle('on', t === id);
      tab.setAttribute('aria-selected', String(t === id));
      tab.tabIndex = t === id ? 0 : -1;
    }
    for (const [t, body] of bodies) body.classList.toggle('hidden', t !== id);
    bodies.get(id)!.scrollTop = 0;
    // On a phone the categories are a row across the top that scrolls sideways.
    tabs.get(id)!.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  nav.addEventListener('keydown', (e) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const i = PANES.findIndex((p) => p.id === lastPane);
    const next = PANES[(i + step + PANES.length) % PANES.length].id;
    show(next);
    tabs.get(next)!.focus();
  });

  const close = h('button.btn.close', { 'aria-label': L.common.close }, '✕');
  const el = h('div.modal.settings', { role: 'dialog', 'aria-label': L.menu.settings }, h('header', {}, h('h2', {}, `⚙️ ${L.menu.settings}`), close), h('div.settings-body', {}, nav, ...bodies.values()));
  const offNotify = store.on('notify', paintHook);
  const offDog = store.on('dog', paintDog);
  const offTheme = store.on('theme', paintTheme);
  const offMap = store.on('map', paintMap);
  const offLeave = store.on('leaveOnMerge', paintLeave);
  const offLang = [store.on('language', langs.paint), store.on('me', langs.paint)];
  const offLimit = [store.on('machine', paintLimit), store.on('me', paintLimit)];
  const offDir = [store.on('projectsDir', paintDir), store.on('me', paintDir)];
  const offPrompts = [store.on('prompts', paintAgent), store.on('prompts', paintPrompts), store.on('me', paintAgent), store.on('me', paintPrompts)];
  const modal = openModal(el, {
    doing: L.settings.doing,
    onClose: () => {
      offNotify();
      offDog();
      offTheme();
      sky?.off();
      offMap();
      offLeave();
      offLang.forEach((f) => f());
      offLimit.forEach((off) => off());
      offDir.forEach((off) => off());
      offPrompts.forEach((off) => off());
    },
  });
  show(first ?? lastPane);
  close.addEventListener('click', () => modal.close());
  character.addEventListener('click', () => {
    modal.close();
    onCharacter();
  });
}
