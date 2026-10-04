/**
 * The HUD: a few buttons on the top bar, everything else in the ☰ menu (Tab), with H for the controls
 * and F to hang a picture; the project in the corner (click it for the floors); Settings, and your
 * character.
 */
import { ROOF } from '../../../shared/rooftop';
import type { Ctx } from '../../core/context';
import type { CoreState } from '../../core/ctx';
import { builtFloors } from '../../core/floors';
import type { Parts } from '../../core/parts';
import { waitingInOrder, waitingLabel } from '../../nextup';
import { saveSettings, store } from '../../state';
import { openAccounts } from '../../ui/accounts';
import { openBoard } from '../../ui/boards';
import { openCharacter } from '../../ui/character';
import { $ } from '../../ui/dom';
import { toggleFloorMenu } from '../../ui/floormenu';
import { openHelp } from '../../ui/hud';
import { mountHud } from '../../ui/menu';
import { openServices } from '../../ui/services';
import { openSettings, type SettingsPane } from '../../ui/settings';
import { needsSigningIn, openSignIns } from '../../ui/signins';
import { openTeam } from '../../ui/team';
import { openUpgrade } from '../../ui/upgrade';
import { openWhiteboard } from '../whiteboard/ui';
import { describeSky } from '../../world/sky';

export type HudParts = Pick<Parts, 'worlds' | 'place' | 'travel' | 'you' | 'actions' | 'waiting' | 'meeting' | 'bookshelf' | 'hanging' | 'talk' | 'notifier'>;

/** Listens for clicks on the HUD and the project, registers what the HUD follows (see mountHud), and binds Tab, H and F. */
export function installHud(ctx: Ctx, core: CoreState, parts: HudParts) {
  const { net, voice, settings, player, sound } = ctx;
  const { inOffice } = parts.worlds;
  const { travel, waiting, actions, hanging, talk } = parts;

  // Buttons must not keep focus, or Space (jump) would click them again.
  $('hud').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (btn) setTimeout(() => btn.blur(), 0);
  });
  // The project in the corner is the floor you're on; click it for the list of floors to go to.
  $('project').addEventListener('click', () => {
    if (!store.floor) return travel.showElevator();
    toggleFloorMenu($('project'), { go: travel.switchFloor, indoors: () => (!inOffice() && !core.upTop) || parts.place.indoors(), elevator: travel.showElevator, roof: inOffice() ? () => travel.ride(ROOF) : null });
  });

  // ---- The HUD: a few buttons on the top bar, everything else in the ☰ menu ----------------------------
  const waitingNow = () => waitingInOrder(store.workers.values());
  const noMedia = () => (window.isSecureContext ? undefined : "음성 채팅과 화면 공유는 HTTPS 또는 localhost에서 사용할 수 있습니다. TLS 프록시, --self-signed 또는 SSH 터널을 이용하세요");
  const hud = mountHud(
    [
      { id: 'issues', icon: '📌', label: "이슈", section: 'Open', count: () => store.issues.items.filter((i) => i.state === 'OPEN').length, run: () => openBoard('issues', net, actions.boardActions()) },
      { id: 'pulls', icon: '🔀', label: "Pull requests", section: 'Open', count: () => store.pulls.items.filter((p) => p.state === 'OPEN').length, run: () => openBoard('pulls', net, actions.boardActions()) },
      { id: 'queue', icon: '📋', label: "작업 대기열", section: 'Open', count: () => store.queue.tasks.filter((t) => t.status !== 'done').length, title: () => "직원에게 맡길 이슈와 대기 중인 작업", run: waiting.showQueue },
      { id: 'services', icon: '🌐', label: "실행 중인 서비스", section: 'Open', count: () => store.services.items.length, title: () => "직원들이 실행한 웹 서버", run: () => openServices() },
      { id: 'whiteboard', icon: '📝', label: "화이트보드", section: 'Open', title: () => "실시간으로 함께 그리기", run: () => openWhiteboard(net) },
      // Up on the top bar while a meeting is on: what's being worked through in the meeting room.
      {
        id: 'meeting',
        icon: '🤝',
        label: "회의실",
        section: 'Open',
        status: () => store.meeting.current?.status === 'running',
        chip: () => "회의 중",
        title: () => "회의 열기: 직원들이 함께 질문을 검토하거나 작업을 진행합니다",
        run: () => parts.meeting.showMeeting(),
      },
      { id: 'search', icon: '🔎', label: "검색", section: 'Open', key: '/', title: () => "채팅과 모든 터미널 검색", run: waiting.showSearch },
      // The office has its bookshelf for them; a map of its own may not.
      { id: 'docs', icon: '📚', label: "문서", section: 'Open', shown: () => !inOffice(), title: () => "프로젝트 문서 읽기", run: parts.bookshelf.showBookshelf },
      { id: 'elevator', icon: '🛗', label: () => (inOffice() ? "엘리베이터" : "프로젝트 목록"), section: 'Open', count: () => store.floors.reduce((n, f) => n + (f.id === store.floor ? 0 : f.waiting), 0), title: () => (inOffice() ? "다른 프로젝트로 이동" : "다른 프로젝트로 이동하거나 프로젝트 추가"), run: travel.showElevator },
      { id: 'roof', icon: '🍸', label: "루프탑 바", section: 'Open', shown: () => !core.upTop && inOffice() && builtFloors().length > 0, title: () => "엘리베이터로 옥상에 올라 DJ, 바, 도시 풍경을 즐겨보세요", run: () => travel.ride(ROOF) },
      // In voice, V is push to talk, so leaving is only from here.
      { id: 'voice', icon: '🎙️', label: () => (voice.inVoice ? "음성 채팅 나가기" : "음성 채팅 참여"), section: 'Together', key: () => (voice.inVoice ? undefined : 'V'), on: () => voice.inVoice, blocked: noMedia, run: () => void talk.toggleVoice() },
      // While you're in voice, the top bar keeps the mute button handy. Muted is the usual with push to talk, so it doesn't stand out then.
      {
        id: 'mute',
        icon: () => (voice.muted ? '🔇' : '🎙️'),
        label: () => (voice.muted ? "음소거 해제" : "음소거"),
        section: 'Together',
        key: 'M',
        shown: () => voice.inVoice,
        status: () => voice.inVoice,
        on: () => voice.inVoice,
        tone: () => (voice.muted && !settings.pushToTalk ? 'danger' : undefined),
        title: () => (voice.muted ? "음소거 중: V를 누른 채 말하거나 M으로 음소거를 해제하세요" : "음소거 (M) · V를 누른 채 말하기"),
        run: () => voice.toggleMute(),
      },
      { id: 'share', icon: '🖥️', label: () => (voice.sharing ? "공유 중지" : "화면 공유"), section: 'Together', on: () => voice.sharing, status: () => voice.sharing, chip: () => "화면 공유 중", blocked: noMedia, run: () => void talk.toggleShare() },
      { id: 'decor', icon: '🖼️', label: () => (hanging.hanger.active ? "그림 걸기 취소" : "그림 걸기"), section: 'Together', key: 'F', shown: () => inOffice(), on: () => hanging.hanger.active, status: () => hanging.hanger.active, run: () => (hanging.hanger.active ? hanging.hanger.cancel() : hanging.startHanging()) },
      { id: 'team', icon: '👥', label: "팀원 초대", section: 'Together', shown: () => store.invites, run: () => openTeam(net) },
      { id: 'accounts', icon: '🔑', label: "계정 관리", section: 'Together', shown: () => store.me.admin, title: () => "사용자를 초대하고 계정을 확인하거나 접근 권한을 해제합니다", run: () => openAccounts(net) },
      { id: 'signins', icon: '🔐', label: "내 로그인 정보", section: 'Together', shown: () => !!store.me.account, tone: () => (needsSigningIn() ? 'danger' : undefined), status: needsSigningIn, chip: () => "Claude 로그인", title: () => "직원들이 사용할 내 Claude 요금제와 GitHub 계정", run: () => openSignIns(net) },
      { id: 'settings', icon: '⚙️', label: "설정", section: 'Office', run: showSettings },
      { id: 'help', icon: '❓', label: "조작법", section: 'Office', key: 'H', run: openHelp },
      { id: 'lite', icon: '📱', label: "2D 화면", section: 'Office', title: () => "휴대폰이나 성능이 낮은 컴퓨터에서 직원, 터미널, 게시판을 2D로 확인합니다", run: () => location.assign('/lite') },
      {
        id: 'upgrade',
        icon: '⬆️',
        label: () => (store.upgrade.phase === 'building' ? "업데이트 중…" : store.upgrade.latest ? "Agent Office 업데이트" : "Agent Office 업데이트"),
        section: 'Office',
        shown: () => store.upgrade.available,
        // A new version, or one being built, gets a place on the top bar until it's in.
        status: () => !!store.upgrade.latest || store.upgrade.phase === 'building',
        chip: () => (store.upgrade.phase === 'building' ? "업데이트 중…" : "업데이트"),
        tone: () => (store.upgrade.latest && store.upgrade.phase !== 'building' ? 'primary' : undefined),
        title: () => (store.upgrade.latest ? `새 버전: ${store.upgrade.latest.subject}` : "Agent Office 업데이트"),
        run: () => openUpgrade(net),
      },
      // Up on the top bar while workers wait on someone (N does the same), next to the Workers button.
      {
        id: 'waiting',
        icon: () => (waitingNow().some((w) => w.status === 'needs_input') ? '🙋' : '✅'),
        label: "응답을 기다리는 다음 직원",
        section: 'Open',
        key: 'N',
        shown: () => waitingNow().length > 0,
        status: () => waitingNow().length > 0,
        chip: () => waitingLabel(waitingNow()).replace(/^(🙋|✅) /, ''),
        on: () => waitingNow().every((w) => w.status === 'done'),
        tone: () => (waitingNow().some((w) => w.status === 'needs_input') ? 'danger' : undefined),
        title: () => "응답을 기다리는 다음 직원으로 이동: 확인이 필요한 직원부터 (N)",
        run: waiting.goToNextWaiting,
      },
    ],
    settings,
    () => saveSettings(settings),
  );
  ctx.keys.bind({
    code: 'Tab',
    preventDefault: true,
    run: () => {
      hud.toggleMenu();
    },
  });
  ctx.keys.bind({
    code: 'KeyH',
    run: () => {
      openHelp();
    },
  });
  ctx.keys.bind({
    code: 'KeyF',
    run: () => {
      hanging.startHanging();
    },
  });
  function showSettings(pane?: SettingsPane) {
    openSettings(
      net,
      settings,
      (s) => {
        // Switching to push to talk mutes you now; back to an open mic turns it on.
        const talkChanged = s.pushToTalk !== settings.pushToTalk;
        Object.assign(settings, s);
        saveSettings(settings);
        if (talkChanged) {
          voice.setMuted(settings.pushToTalk);
          hud.refresh();
        }
        player.setView(settings.view);
        sound.setVolume(settings.volume, settings.muted);
        sound.setMusicVolume(settings.music, settings.musicMuted);
      },
      editProfile,
      sound,
      parts.notifier,
      signOut,
      store.sky ? { now: describeSky(store.sky, store.officeNow()), live: !!store.sky.city } : undefined,
      pane,
    );
  }

  async function signOut() {
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    location.href = '/login';
  }

  function editProfile() {
    openCharacter(false, (p) => {
      parts.you.showMyProfile(p);
      net.send({ t: 'profile', name: p.name, color: p.color, look: p.look });
    });
  }

  return { hud, showSettings, editProfile };
}
