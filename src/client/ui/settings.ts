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

const VIEWS: [ViewMode, string, string][] = [
  ['first', "👀 1인칭", "캐릭터의 시점으로 봅니다. 사무실을 클릭하면 마우스로 둘러보고 사물을 클릭해 사용할 수 있습니다. Esc로 마우스를 해제합니다."],
  ['third', "🎥 3인칭", "캐릭터를 뒤에서 바라봅니다. 드래그로 시점을 돌리고 휠로 확대·축소합니다. 사물을 클릭하면 사용할 수 있습니다."],
];

const THEME_LABEL: Record<ThemePick, string> = { auto: "📅 날짜에 맞게", halloween: "🎃 핼러윈", christmas: "🎄 크리스마스", off: "끄기" };

const WEBHOOK_NAME: Record<WebhookKind, string> = { slack: 'Slack', discord: 'Discord', other: 'a webhook' };

/** The categories down the side of ⚙️ Settings. */
export type SettingsPane = 'you' | 'sound' | 'notify' | 'building' | 'workers';

const PANES: { id: SettingsPane; icon: string; label: string; blurb: string }[] = [
  { id: 'you', icon: '🧍', label: "내 설정", blurb: "캐릭터 외모, 화면 시점, 로그인 정보를 설정합니다." },
  { id: 'sound', icon: '🔊', label: "소리와 음성", blurb: "사무실 소리의 크기와 음성 채팅 방식을 설정합니다." },
  { id: 'notify', icon: '🔔', label: "알림", blurb: "다른 화면을 보고 있을 때도 직원의 응답 요청과 작업 완료를 알려줍니다." },
  { id: 'building', icon: '🏢', label: "사무실 설정", blurb: "맵, 장식, 하늘, 강아지와 프로젝트 저장 폴더를 설정합니다." },
  { id: 'workers', icon: '🤖', label: "직원", blurb: "기본 에이전트, 동시 작업 인원, 퇴근 조건과 작업 지시 문구를 설정합니다." },
];

/** Who a setting is for, shown by its name: some are yours alone, some the whole office's. */
type Scope = 'you' | 'floor' | 'office';
const SCOPE: Record<Scope, [label: string, title: string]> = {
  you: ["나만 적용", "이 브라우저에 저장되며 나에게만 적용됩니다"],
  floor: ["현재 프로젝트", "이 프로젝트의 모든 참여자에게 적용됩니다"],
  office: ["모두에게 적용", "사무실의 모든 참여자에게 적용됩니다"],
};

/** One setting: its name and who it's for, then whatever sets it. */
const setting = (title: string, scope: Scope | null, ...body: Node[]) =>
  h('div.setting', {}, h('div.setting-head', {}, h('h4', {}, title), scope && h('span.scope', { class: scope, title: SCOPE[scope][1] }, SCOPE[scope][0])), ...body);

/** Where ⚙️ Settings was last, so it opens there again. */
let lastPane: SettingsPane = 'you';

/** `outside` describes the sky over the office (see describeSky), once the server has said. `first` opens on that category instead of the last one. */
export function openSettings(net: Net, settings: Settings, onChange: (s: Settings) => void, onCharacter: () => void, sound: Pick<OfficeSound, 'ding' | 'needsYou'>, notifier: DesktopNotifier, onSignOut: () => void, outside?: { now: string; live: boolean }, first?: SettingsPane) {
  const seg = h('div.seg', { role: 'radiogroup', 'aria-label': "화면 시점" });
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
      pct.textContent = settings[muted] ? "음소거 중" : `${v}%`;
      mute.textContent = settings[muted] ? "🔊 음소거 해제" : "🔇 음소거";
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
  const soundRow = volumeRow("사무실 효과음 크기", 'volume', 'muted', () => sound.ding('done'));

  /** Changes some of your own settings, and has the office take them up. */
  const change = (some: Partial<Settings>) => {
    settings = { ...settings, ...some };
    onChange(settings);
  };
  // Voice chat: an open mic, or muted until you hold V.
  const talkRow = choiceRow("음성 채팅", [[false, "🎙️ 마이크 항상 켜기"], [true, "✋ 키를 누를 때만 말하기"]], () => settings.pushToTalk, (pushToTalk) => change({ pushToTalk }));
  const musicRow = volumeRow("주크박스 음량", 'music', 'musicMuted');

  // The swish of the book's pages at the bookshelf, on or off.
  const pagesRow = choiceRow("책장 넘기는 소리", [[true, "📖 켜기"], [false, "끄기"]], () => settings.pageTurns, (pageTurns) => change({ pageTurns }));
  // The alarm when a worker stops to ask you something; picking one plays it.
  const alarmRow = choiceRow<NeedsYouSound>("직원이 응답을 요청할 때", [['once', "🔔 한 번 알림"], ['remind', "🔁 확인할 때까지 알림"], ['off', "🔕 끄기"]], () => settings.needsYouSound, (needsYouSound) => {
    change({ needsYouSound });
    if (needsYouSound !== 'off') sound.needsYou();
  });

  // The building's holiday theme, for everyone.
  const themeRow = h('div.seg', { role: 'radiogroup', 'aria-label': "시즌 테마" });
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
        ? "핼러윈에는 직원들이 좀비로 변하고 강아지도 분장합니다. 으스스한 하늘과 호박 장식으로 사무실을 꾸밉니다."
        : active === 'christmas'
          ? "크리스마스에는 직원들이 요정으로 변하고 강아지는 루돌프가 됩니다. 장갑을 끼고 창밖의 눈을 즐겨보세요."
          : "현재 시즌 장식이 없습니다.";
    const how = pick === 'auto' ? " 날짜에 맞추면 10월에는 핼러윈, 12월에는 크리스마스 테마를 적용합니다." : '';
    themeNote.textContent = `${now}${how} 사무실 전체에 동일하게 적용됩니다${by ? `, 설정: ${by}${at ? ` ${timeAgo(at)}` : ''}` : ''}.`;
  };
  paintTheme();

  // The building's map, for everyone: the office, the castle, the space station, or one of your own. Opening Settings
  // has the office read its folder of maps again, so one you just added or fixed shows up.
  net.send({ t: 'map.set' });
  const mapRow = h('div.seg', { role: 'radiogroup', 'aria-label': "맵" });
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
            title: m.error ? `${m.id}을(를) 불러올 수 없습니다: ${m.error}` : m.description,
            onclick: () => {
              if (!m.error && store.map.pick !== m.id) net.send({ t: 'map.set', map: m.id });
            },
          },
          `${m.icon} ${m.name}`,
        ),
      ),
    );
    const now = choices.find((m) => m.id === pick) ?? choices[0];
    mapNote.textContent = `${now.description} 모든 프로젝트와 참여자에게 적용됩니다${by ? `, 선택: ${by}${at ? ` ${timeAgo(at)}` : ''}` : ''}. 직접 만든 맵은 .agent-office/maps/ 폴더에 JSON으로 저장하세요 (docs/maps.md 참고).`;
    const broken = choices.filter((m) => m.error);
    mapBad.textContent = broken.map((m) => `⚠️ ${m.id}을(를) 불러올 수 없습니다: ${m.error}`).join('\n');
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
          "🔔 알림 허용",
        ),
      );
    } else if (perm === 'granted') {
      for (const [value, label] of [
        [true, "🔔 켜기"],
        [false, "🔕 끄기"],
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
      if (on) notifyRow.append(h('button.btn', { type: 'button', onclick: () => notifier.sample() }, "테스트 알림 보기"));
    }
    notifyNote.textContent =
      perm === 'unsupported'
        ? "이 환경에서는 브라우저 알림을 표시할 수 없습니다. HTTPS 또는 localhost로 접속하세요. SSH 터널도 사용할 수 있습니다."
        : perm === 'denied'
          ? "브라우저에서 이 사이트의 알림을 차단하고 있습니다. 주소창 왼쪽 아이콘의 사이트 설정에서 알림을 허용한 뒤 다시 열어주세요."
          : "다른 탭이나 앱을 보고 있어도 직원의 응답 요청과 작업 완료 알림을 받습니다. 알림을 클릭하면 해당 직원의 책상과 터미널로 바로 이동합니다. 탭 제목에서도 대기 중인 직원 수를 확인할 수 있습니다.";
  };
  paintNotify();

  // The office's Slack / Discord webhook, shared by everyone.
  const hookStatus = h('p.setting-note');
  const hookInput = h('input', { type: 'text', placeholder: 'https://hooks.slack.com/services/…', 'aria-label': "Slack 또는 Discord webhook URL", spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const hookSave = h('button.btn.primary', { type: 'button' }, "저장");
  const hookTest = h('button.btn', { type: 'button' }, "테스트 전송");
  const hookRemove = h('button.btn.danger', { type: 'button' }, "제거");
  const hookActions = h('div.seg', { style: 'margin-top:8px' }, hookTest, hookRemove);
  const paintHook = () => {
    const { webhook, error, lastSentAt } = store.notify;
    hookActions.classList.toggle('hidden', !webhook);
    hookSave.textContent = webhook ? "변경" : "저장";
    hookStatus.classList.toggle('bad', !!error);
    hookStatus.textContent = !webhook
      ? "Slack 또는 Discord의 수신 webhook을 붙여넣으세요. 직원이 응답을 기다리거나 작업을 끝냈는데 아무도 터미널을 보고 있지 않으면 해당 채널로 알림을 보냅니다. 사무실 전체에 적용됩니다."
      : error
        ? `⚠️ ${WEBHOOK_NAME[webhook.kind]} (${webhook.hint}) 알림 전송 실패: ${error}`
        : `📣 ${WEBHOOK_NAME[webhook.kind]} (${webhook.hint})에 알림 전송 · 설정: ${webhook.by} ${timeAgo(webhook.at)}${lastSentAt ? ` · 마지막 전송 ${timeAgo(lastSentAt)}` : ''}.`;
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
  const agentSave = h('button.btn.primary', { type: 'button' }, "저장");
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
    agentBack.textContent = `${store.project?.agentCmd.split(' ')[0].split(/[\\/]/).pop() ?? 'the --agent'}(으)로 돌아가기`;
    if (!agentTouched) agent.set(now);
    agentNote.textContent =
      "책상에서 고용하거나 이슈·PR·대기열에서 시작하는 직원, 게시판 담당과 회의 참여 직원 모두 이 설정을 기본으로 사용합니다. 개별 작업은 ✏️ 수정에서 다른 에이전트를 선택할 수 있습니다." +
      (picked ? ` 설정: ${picked.by} ${timeAgo(picked.at)}.` : " 앱을 실행할 때 지정한 에이전트와 해당 에이전트의 기본 모델입니다.") +
      (admin ? '' : " 관리자가 변경할 수 있습니다.");
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
    promptsOpen.textContent = store.me.admin ? "📝 작업 지시 문구 수정…" : "📝 작업 지시 문구 보기…";
    promptsNote.textContent =
      "직원에게 맡기기, 검토, 대기열, 게시판 담당, 회의와 표지판 작성에 사용할 지시 문구입니다. " +
      (n ? `${n}개를 수정했습니다.` : "모두 기본 지시 문구를 사용합니다.") +
      (store.me.admin ? '' : " 관리자가 수정할 수 있습니다.");
  };
  paintPrompts();

  // The most workers the office runs at once, across every floor. Admins set it.
  const limitInput = h('input', { type: 'text', inputmode: 'numeric', 'aria-label': "동시 작업 최대 인원", spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const limitSave = h('button.btn.primary', { type: 'button' }, "한도 설정");
  const limitClear = h('button.btn', { type: 'button' });
  const limitRow = h('div.webhook', {}, limitInput, limitSave, limitClear);
  const limitNote = h('p.setting-note');
  const paintLimit = () => {
    const m = store.machine;
    const admin = store.me.admin;
    limitRow.classList.toggle('hidden', !admin);
    limitInput.placeholder = m.ceiling ? `1~${m.ceiling}` : "예: 6";
    limitClear.textContent = m.ceiling ? `${m.ceiling}(으)로 돌아가기` : "제한 없음";
    limitClear.classList.toggle('hidden', !m.set);
    const now =
      m.limit === undefined
        ? `인원 제한이 없습니다. 빈 책상마다 직원을 고용할 수 있습니다. 현재 전체 프로젝트에서 ${m.workers}명이 실행 중입니다.`
        : `전체 프로젝트에서 최대 ${m.limit}명을 동시에 실행합니다 (현재 ${m.workers}명). Shell과 게시판 담당도 포함하며, 한도를 넘으면 추가 고용할 수 없습니다.`;
    const from = m.set ? ` 설정: ${m.set.by} ${timeAgo(m.set.at)}.` : '';
    const cap = m.ceiling ? ` 실행 시 --max-workers ${m.ceiling}을 지정했으므로 이보다 높게 설정할 수 없습니다.` : '';
    limitNote.textContent = now + from + cap + (admin ? '' : " 관리자가 변경할 수 있습니다.");
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
  const leaveRow = h('div.seg', { role: 'radiogroup', 'aria-label': "PR이 병합된 직원 자동 퇴근" });
  const leaveNote = h('p.setting-note');
  const paintLeave = () => {
    const { on, by, at } = store.leaveOnMerge;
    leaveRow.replaceChildren(
      ...([
        [true, "🏠 자동 퇴근"],
        [false, "🪑 직접 퇴근시킬 때까지 대기"],
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
      ? "PR이 병합된 직원은 작업과 응답 대기가 끝나고 터미널을 보는 사람이 없으면 자동 퇴근합니다. 해당 worktree와 브랜치도 정리하지만, 커밋하지 않은 변경이나 GitHub에 올리지 않은 커밋이 있으면 보존합니다."
      : "끄면 PR이 병합된 직원도 보라색 테두리로 표시된 채 책상에 남습니다. 켜면 이미 병합된 직원에게도 자동 퇴근이 적용됩니다.";
    leaveNote.textContent = `${now} 사무실 전체에 동일하게 적용됩니다${by ? `, 설정: ${by}${at ? ` ${timeAgo(at)}` : ''}` : ''}.`;
  };
  paintLeave();

  // Where the elevator clones new projects on the office's machine. Admins move it.
  const dirInput = h('input', { type: 'text', placeholder: '~/Workspace', 'aria-label': "프로젝트 저장 폴더", spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const dirSave = h('button.btn.primary', { type: 'button' }, "저장");
  const dirDefault = h('button.btn', { type: 'button' }, "기본값 사용");
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
      `새 프로젝트는 이 컴퓨터의 ${dir}/<소유자>/<저장소>에 복제됩니다.` +
      (custom && by && at ? ` 설정: ${by} ${timeAgo(at)}.` : '') +
      (admin ? " 같은 저장소가 해당 위치에 있으면 기존 파일을 사용합니다. 이미 추가한 프로젝트의 위치는 바뀌지 않습니다." : " 관리자가 저장 폴더를 변경할 수 있습니다.");
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
  const { section: dogSection, paint: paintDog } = dogSetting(net, (body) => setting("사무실 강아지", 'floor', ...body));

  // What the sky's doing, and which clock it keeps (see settings-sky.ts).
  const sky = outside && outsideSetting(net, outside, (body) => setting("창밖 풍경", 'office', ...body));
  const account = store.me.account;
  const signOut = h('button.btn', { type: 'button' }, "🚪 로그아웃");
  signOut.addEventListener('click', onSignOut);
  const character = h('button.btn', { type: 'button' }, account ? "🧍 캐릭터 꾸미기" : "🧍 캐릭터와 이름 변경");
  const panes: Record<SettingsPane, Node[]> = {
    you: [
      setting("내 캐릭터", null, character),
      setting("화면 시점", 'you', seg, note),
      setting("로그인 정보", null, h('div.volume', {}, signOut), h('p.setting-note', {}, account ? `${account.name} 계정으로 로그인 중 (${account.role}).` : "사무실 공용 비밀번호로 로그인했습니다.")),
    ],
    sound: [
      setting("사무실 효과음", 'you', soundRow, h('p.setting-note', {}, "직원의 타자 소리, 발걸음, 커피 머신, 새와 빗소리, 강아지, 작업 완료음과 응답 요청 알림의 크기를 조절합니다. 음성 채팅에는 영향을 주지 않습니다.")),
      setting("직원이 응답을 요청할 때", 'you', alarmRow, h('p.setting-note', {}, "직원이 질문하거나 승인을 요청하면 알림이 울립니다. 반복 알림을 선택하면 누군가 터미널을 열 때까지 30초마다 부드럽게 다시 알려줍니다. 음량은 사무실 효과음 설정을 따릅니다.")),
      setting("책장 넘기는 소리", 'you', pagesRow, h('p.setting-note', {}, "문서를 열거나 스크롤할 때 책장 넘기는 소리가 납니다. 책장 상단의 🔈 버튼으로도 끌 수 있습니다.")),
      setting("주크박스", 'you', musicRow, h('p.setting-note', {}, "라운지의 주크박스는 같은 층에 있는 모두에게 같은 곡을 들려줍니다. 가까울수록 크게 들리며, 여기서는 내 음량만 조절합니다.")),
      setting("음성 채팅", 'you', talkRow, h('p.setting-note', {}, "V로 음성 채팅에 참여하고, V를 누른 채 말할 수 있습니다. M으로 음소거를 전환합니다. 눌러서 말하기 모드에서는 음소거 상태로 참여합니다. 나가려면 ☰ 메뉴를 사용하세요.")),
    ],
    notify: [
      setting("브라우저 알림", 'you', notifyRow, notifyNote),
      setting("팀 알림 (Slack / Discord)", 'office', h('div.webhook', {}, hookInput, hookSave), hookActions, hookStatus),
    ],
    building: [
      setting("맵", 'office', mapRow, mapNote, mapBad),
      setting("시즌 테마", 'office', themeRow, themeNote),
      ...(sky ? [sky.section] : []),
      dogSection,
      setting("프로젝트 저장 폴더", 'office', dirRow, dirActions, dirNote),
    ],
    workers: [
      setting("기본 에이전트", 'office', agentNow, agent.element, agentActions, agentNote),
      setting("동시 작업 인원", 'office', limitRow, limitNote),
      setting("PR이 병합된 직원 자동 퇴근", 'office', leaveRow, leaveNote),
      setting("작업 지시 문구", 'office', promptsOpen, promptsNote),
    ],
  };

  // The categories down the side, the one picked on the right.
  const nav = h('nav.settings-nav', { role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': "설정" });
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

  const close = h('button.btn.close', { 'aria-label': "닫기" }, '✕');
  const el = h('div.modal.settings', { role: 'dialog', 'aria-label': "설정" }, h('header', {}, h('h2', {}, "⚙️ 설정"), close), h('div.settings-body', {}, nav, ...bodies.values()));
  const offNotify = store.on('notify', paintHook);
  const offDog = store.on('dog', paintDog);
  const offTheme = store.on('theme', paintTheme);
  const offMap = store.on('map', paintMap);
  const offLeave = store.on('leaveOnMerge', paintLeave);
  const offLimit = [store.on('machine', paintLimit), store.on('me', paintLimit)];
  const offDir = [store.on('projectsDir', paintDir), store.on('me', paintDir)];
  const offPrompts = [store.on('prompts', paintAgent), store.on('prompts', paintPrompts), store.on('me', paintAgent), store.on('me', paintPrompts)];
  const modal = openModal(el, {
    doing: "⚙️ 설정 중",
    onClose: () => {
      offNotify();
      offDog();
      offTheme();
      sky?.off();
      offMap();
      offLeave();
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
