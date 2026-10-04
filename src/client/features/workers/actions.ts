/**
 * What you do with workers: hire one at a desk (with a task, or a shell), prompt it, wake it, send it
 * home, fix a worktree deleted outside the office, open its pull requests; ask a board agent; stand
 * at a desk; and what the hint bar says at a desk or a board agent's kiosk. Also what the boards'
 * buttons do with a worker.
 */
import { STATION_AGENT, deskSeat, type DeskDef } from '../../../shared/layout';
import { canLabel } from '../../../shared/floorplan';
import { officeFull, pressureNote } from '../../../shared/machine';
import type { AgentEffort, AgentProvider, WorkerInfo } from '../../../shared/protocol';
import { isAsleep, isBusy } from '../../../shared/status';
import type { Ctx, Hint } from '../../core/context';
import type { CoreState } from '../../core/ctx';
import { seatBuilt } from '../../core/floors';
import { aside, key } from '../../core/hint';
import type { Parts } from '../../core/parts';
import { STATION_INFO } from '../../core/stations';
import { askNotifyPermission, notifyPermission } from '../../notify';
import { repoChoices } from '../../shared/hiring';
import { store } from '../../state';
import { openAsk } from '../../ui/ask';
import { STATUS_LABEL, clip, closeAllModals, h, toast } from '../../ui/dom';
import { openDeskLabel } from '../../ui/floorplan';
import type { MeetingPreset } from '../../ui/meeting';
import { confirmDialog, lostWorktreeDialog, openPrompt, routeWorktreeMessage, sendHomeDialog } from '../../ui/prompt';
import { providerLabel, resolvedProvider } from '../../ui/provider';
import { openPull } from '../../ui/pull';
import { openRepoPulls, workerRepos } from '../../ui/repos';
import { openTerminal } from '../../ui/terminal';
import { hiringPaused, usageLabel, usageTitle } from '../../ui/usage';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    desk: true;
    station: true;
  }
}

export type WorkerActionsParts = Pick<Parts, 'worlds' | 'seating' | 'walking' | 'waiting' | 'meeting' | 'cards'>;

/** Registers the worktree answer (worker.worktree), and defines what's done at a desk and at a board agent. */
export function installWorkerActions(ctx: Ctx, core: CoreState, parts: WorkerActionsParts) {
  const { player, net, me, settings } = ctx;
  const { plan, inOffice } = parts.worlds;
  const openWorkerTerminal = (id: string) => parts.waiting.openWorkerTerminal(id);
  const openWorkerChanges = (id: string, repo?: string) => parts.waiting.openWorkerChanges(id, repo);

  function freeDesk(): string | null {
    // Prefer the empty desk nearest to you; when they're all taken, the bean bag that's out.
    let best: string | null = null;
    let bestD = Infinity;
    for (const d of plan().desks) {
      if (!seatBuilt(d.id)) continue;
      if (store.workerAtDesk(d.id)) continue;
      const dist = Math.hypot(d.x - player.pos.x, d.z - player.pos.z);
      if (dist < bestD) {
        bestD = dist;
        best = d.id;
      }
    }
    return best ?? firstFreeSeat() ?? null;
  }

  /** The first seat nobody's at, in the map's order: the desks (as far as the floor's built out), then the overflow seats. */
  function firstFreeSeat(): string | undefined {
    return [...plan().desks, ...plan().overflow].find((d) => seatBuilt(d.id) && !store.workerAtDesk(d.id))?.id;
  }

  let askedToNotify = false;

  /** The office is at its worker limit: says so, and says yes (the office would refuse the hire anyway). */
  function officeIsFull(): boolean {
    const m = store.machine;
    if (!officeFull(m)) return false;
    toast(`🚫 직원 한도 ${m.limit}명에 도달했습니다. 새 직원을 고용하려면 먼저 한 명을 퇴근시키세요`, 'warn');
    return true;
  }

  function hire(deskId: string, prompt?: string, worktree = false, provider?: AgentProvider, model?: string, effort?: AgentEffort, issue?: number, repos?: string[], via?: 'herald') {
    net.send({ t: 'worker.spawn', deskId, prompt, worktree, provider, model, effort, issue, repos: repos?.length ? repos : undefined, via });
    // The moment notifications start to matter: ask once (it has to come from a key press or click).
    if (settings.notify && notifyPermission() === 'default' && !askedToNotify) {
      askedToNotify = true;
      void askNotifyPermission();
    }
  }

  function openShell(deskId: string) {
    if (officeIsFull()) return;
    net.send({ t: 'worker.spawn', deskId, kind: 'shell' });
  }

  function promptAtDesk(deskId: string) {
    const w = store.workerAtDesk(deskId);
    const desk = plan().byId.get(deskId)!;
    if (!w) {
      if (officeIsFull()) return;
      openPrompt({
        title: `✨ ${desk.label}에 새 작업 맡기기`,
        subtitle: "새 직원이 자리에 앉아 이 작업을 바로 시작합니다.",
        warning: pressureNote(store.machine),
        submitLabel: "직원 고용 및 작업 시작",
        providerOption: true,
        worktreeOption: !!store.project?.branch,
        repoOptions: repoChoices(),
        onSubmit: (text, o) => hire(deskId, text, o.worktree, o.provider, o.model, o.effort, undefined, o.repos),
      });
    } else if (w.lost) {
      fixLostWorktree(w);
    } else if (isAsleep(w.status)) {
      toast(`${w.name}이(가) 잠든 상태입니다. 먼저 R을 눌러 재개하세요`, 'warn');
    } else if (w.kind === 'shell') {
      openPrompt({
        title: `🐚 ${w.name}에서 명령 실행`,
        placeholder: 'npm run dev',
        submitLabel: "실행 ▶",
        onSubmit: (text) => net.send({ t: 'worker.prompt', workerId: w.id, prompt: text }),
      });
    } else {
      openPrompt({
        title: `💬 ${w.name}에게 작업 지시`,
        subtitle: w.status === 'working' ? `${w.name}이(가) 작업 중입니다. 메시지는 입력 대기열에 추가됩니다.` : undefined,
        onSubmit: (text) => net.send({ t: 'worker.prompt', workerId: w.id, prompt: text }),
      });
    }
  }

  /** Direct hire from an empty desk, with an optional first prompt and provider choice. */
  function hireAtDesk(deskId: string) {
    const desk = plan().byId.get(deskId)!;
    if (officeIsFull()) return;
    openPrompt({
      title: `✨ ${desk.label}에 직원 고용`,
      subtitle: "지시 내용을 비워 두고 고용한 다음 나중에 작업을 맡겨도 됩니다.",
      warning: pressureNote(store.machine),
      placeholder: "첫 작업을 적어주세요 (선택 사항)…",
      submitLabel: "직원 고용 및 작업 시작",
      allowEmpty: true,
      providerOption: true,
      worktreeOption: !!store.project?.branch,
      repoOptions: repoChoices(),
      onSubmit: (text, o) => hire(deskId, text || undefined, o.worktree, o.provider, o.model, o.effort, undefined, o.repos),
    });
  }

  ctx.messages.on('worker.worktree', routeWorktreeMessage);
  function killWorker(id: string) {
    const w = store.workers.get(id);
    if (!w) return;
    const where = plan().byId.get(w.deskId)?.label ?? "책상";
    const session = w.kind === 'shell' ? "공용 Shell" : `${providerLabel(w.provider, store.project)} 세션`;
    if (w.meeting) {
      // The meeting's worktree is the whole table's: it's tidied away once they've all gone.
      const m = store.meeting.current;
      const on = m?.id === w.meeting && m.status === 'running';
      confirmDialog(`${w.name}을(를) 퇴근시킬까요?`, on ? `${w.name}은(는) '${m.title}' 회의에 참여 중입니다. 퇴근시키면 회의도 중단됩니다.` : `${w.name}이(가) 회의실에서 나갑니다.`, "퇴근시키기", () => net.send({ t: 'worker.kill', workerId: id }));
      return;
    }
    if (w.worktree) {
      // A worker with its own worktree: choose what becomes of the worktree and its branch.
      sendHomeDialog({
        workerId: id,
        name: w.name,
        where,
        worktree: w.worktree,
        repos: w.repos?.length ? [w.worktree.path.split('/').pop() ?? "전용", ...w.repos.map((r) => r.name)] : undefined,
        ask: () => net.send({ t: 'worker.worktree', workerId: id }),
        onConfirm: (cleanup) => net.send({ t: 'worker.kill', workerId: id, cleanup }),
      });
      return;
    }
    const body = plan().byId.get(w.deskId)?.station
      ? `${session}을(를) 종료하고 기존 작업 지시를 잊습니다. 다음에 ${where}에서 지시하면 새 세션을 시작합니다.`
      : `${where}의 ${session}을(를) 종료하고 책상을 비웁니다.`;
    confirmDialog(`${w.name}을(를) 퇴근시킬까요?`, body, "퇴근시키기", () => net.send({ t: 'worker.kill', workerId: id }));
  }

  /** E at a board agent: type it a request. It's hired with it when nobody is there yet. */
  function askStation(deskId: string) {
    const kind = plan().byId.get(deskId)?.station;
    if (!kind) return;
    const w = store.workerAtDesk(deskId);
    const name = STATION_AGENT[kind].name;
    const info = STATION_INFO[kind];
    // A prompt typed into a question it's asking would answer it.
    if (w?.status === 'needs_input') {
      toast(`${name}이(가) 응답을 기다립니다. 터미널을 열었습니다`, 'warn');
      return openWorkerTerminal(w.id);
    }
    // Nobody there yet: asking hires the agent.
    if (!w && officeIsFull()) return;
    const subtitle = !w
      ? `${info.does} · 전용 터미널에서 실행합니다. 게시판 앞에서 O를 누르면 볼 수 있습니다.`
      : isAsleep(w.status)
        ? `${name}이(가) 잠든 상태입니다. 깨우면 이전 작업을 이어갑니다.`
        : isBusy(w.status)
          ? `${name}이(가) 작업 중입니다. 현재 작업이 끝나면 입력한 지시를 처리합니다.`
          : undefined;
    openPrompt({
      title: `${info.icon} ${name}에게 요청`,
      subtitle,
      placeholder: `예: ${info.example}`,
      submitLabel: "작업 보내기 ✨",
      warning: w ? undefined : pressureNote(store.machine),
      onSubmit: (text) => net.send({ t: 'station.prompt', deskId, prompt: text }),
    });
  }

  function resumeWorker(w: WorkerInfo) {
    if (w.lost) return fixLostWorktree(w);
    if (!w.sessionId && w.kind !== 'shell') toast(`${w.name}의 저장된 Claude 세션이 없어 새로 시작합니다`, 'warn');
    net.send({ t: 'worker.resume', workerId: w.id });
  }

  /**
   * Anything done with a worker whose worktree was deleted outside agent-office (see WorkerInfo.lost):
   * it can't work there, so this says so and offers to put the folder back, everyone's at once when
   * more are lost, or to send it home.
   */
  function fixLostWorktree(w: WorkerInfo) {
    if (!w.lost || !w.worktree) return;
    const others = [...store.workers.values()].filter((o) => o.lost && o.id !== w.id);
    lostWorktreeDialog({
      name: w.name,
      worktree: w.worktree,
      lost: w.lost,
      workspace: w.repos?.length ? w.worktree.path.replace(/[\\/][^\\/]*$/, '') : undefined,
      others: others.map((o) => o.name),
      openTerminal: isAsleep(w.status) ? undefined : () => openTerminal(net, w.id, () => openWorkerChanges(w.id)),
      rebuild: (all) => {
        toast(all ? `worktree ${others.length + 1}개를 다시 만드는 중…` : `${w.name}의 worktree를 다시 만드는 중…`);
        net.send({ t: 'worker.rebuild', workerId: w.id, all });
      },
      sendHome: () => killWorker(w.id),
    });
  }

  /** Whether a worker's branch can become a PR: it has its own worktree, still there, and isn't mid-turn. */
  function prReady(w: WorkerInfo) {
    return !!w.worktree && !w.lost && !isBusy(w.status);
  }

  /** O at a desk: see the worker's pull request, or push its branch and open one. */
  function pullRequestFor(w: WorkerInfo) {
    if (w.repos?.length) return pullRequestsFor(w);
    if (w.pr) {
      const it = store.pulls.items.find((p) => p.number === w.pr!.number);
      if (it) openPull(it, net, boardActions());
      else window.open(w.pr.url, '_blank', 'noopener');
      return;
    }
    if (!w.worktree) return toast(`${w.name}은(는) 공용 프로젝트 폴더에서 작업합니다. 전용 worktree가 있는 직원만 PR을 생성할 수 있습니다`, 'warn');
    if (w.lost) return fixLostWorktree(w);
    if (w.prOpening) return;
    if (!prReady(w)) return toast(`${w.name}의 현재 상태는 '${STATUS_LABEL[w.status]}'입니다. 완료될 때까지 기다려주세요`, 'warn');
    toast(`${w.worktree.branch}을(를) push하고 PR을 생성하는 중…`);
    net.send({ t: 'worker.pr', workerId: w.id });
  }

  /**
   * O at the desk of a worker across repositories: with no pull request yet, the office opens one in
   * each repository it committed to (and lists them all in each one). Once it has one, O shows each
   * repository's, with a button for the ones still missing.
   */
  function pullRequestsFor(w: WorkerInfo) {
    const open = () => {
      const now = store.workers.get(w.id);
      if (!now || now.prOpening) return;
      if (now.lost) return fixLostWorktree(now);
      if (!prReady(now)) return toast(`${now.name}의 현재 상태는 '${STATUS_LABEL[now.status]}'입니다. 완료될 때까지 기다려주세요`, 'warn');
      toast(`${now.name}의 각 저장소에 ${now.worktree?.branch ?? "작업 브랜치"}을(를) push하고 PR을 생성하는 중…`);
      net.send({ t: 'worker.pr', workerId: now.id });
    };
    if (!workerRepos(w).some((r) => r.pr)) return open();
    openRepoPulls(w.id, {
      openPull: (number, url) => {
        const it = store.pulls.items.find((p) => p.number === number);
        if (it) openPull(it, net, boardActions());
        else window.open(url, '_blank', 'noopener');
      },
      openMissing: open,
      changes: (repo) => openWorkerChanges(w.id, repo),
    });
  }

  /** Puts you in front of a desk, looking at it: the PR board's "Go to desk". */
  function goToDesk(deskId: string) {
    const desk = plan().byId.get(deskId);
    if (!desk) return;
    closeAllModals();
    standAt(desk);
    const w = store.workerAtDesk(deskId);
    toast(w ? `${desk.label} · ${w.name}의 책상 앞` : `현재 위치: ${desk.label}`);
  }

  /** Behind the worker, looking over their shoulder at the laptop (or in front of a board agent's kiosk). */
  function standAt(desk: DeskDef) {
    const { seating } = parts;
    if (player.seat) seating.standUp();
    // The car first (the activities' own order has it last).
    ctx.activities.stop('driver', 'desk');
    ctx.activities.stopAll('desk');
    parts.walking.stopWalkingTo();
    // In line for the throne: in front of it, where it stands.
    const w = store.workerAtDesk(desk.id);
    const court = parts.worlds.court();
    const inLine = w && court ? court.spotOf(w.id) : -1;
    if (inLine >= 0) {
      // At the front: up on the throne, if it's free, where E is for them.
      const throne = inLine === 0 && plan().throne ? seating.freePlace(plan().throne!) : null;
      if (throne) {
        player.pos.set(throne.x, throne.y, throne.z);
        player.sit(throne);
        me.sit(throne.hips);
        net.send({ t: 'sit', seat: throne.key });
        player.camYaw = throne.rotY - Math.PI;
        player.lookPitch = -0.2;
        return;
      }
      // Else beside it in line, turned to it.
      const at = plan().lineup[inLine];
      const x = at.x + Math.cos(at.rotY) * 1.3;
      const z = at.z - Math.sin(at.rotY) * 1.3;
      player.pos.set(x, parts.worlds.groundHere(x, z, 1.5), z);
      player.vy = 0;
      player.facing = Math.atan2(at.x - x, at.z - z);
      player.camYaw = player.facing - Math.PI;
      player.lookPitch = -0.2;
      return;
    }
    let spot = deskSeat(desk, desk.station ? -1.6 : desk.beanbag ? 1.6 : 2.4);
    // On a map of its own, the office's distances can land in a pillar: the nearest open floor to it.
    const world = ctx.world();
    if (!inOffice() && (!player.fits(spot.x, spot.z, 0) || !world.nav.walkable(spot.x, spot.z))) {
      const [x, z] = world.nav.nearestWalkable([spot.x, spot.z]);
      spot = { x, z };
    }
    player.pos.set(spot.x, 0, spot.z);
    player.vy = 0;
    player.facing = Math.atan2(desk.x - spot.x, desk.z - spot.z);
    player.camYaw = player.facing - Math.PI;
    player.lookPitch = -0.2;
  }

  function deskHint(deskId: string): Hint {
    const w = store.workerAtDesk(deskId);
    if (!w && plan().byId.get(deskId)?.room) return { k: 'room', parts: [h('span.title', {}, `🤝 ${plan().byId.get(deskId)!.label} · 비어 있음`), key('E', "회의 열기")] };
    // The sign over it, if it has one, and L to hang one (or change it).
    const sign = store.floorPlan.labels[deskId]?.text;
    const labelKey = canLabel(deskId) ? key('L', sign ? "표지판" : "표지판") : '';
    const deskName = `${sign ? `🪧 ${sign} · ` : ''}${plan().byId.get(deskId)!.label}`;
    if (!w) {
      const paused = hiringPaused();
      const m = store.machine;
      const full = officeFull(m);
      return {
        k: `${paused}|${full}|${m.workers}|${m.limit}|${!!m.pressure}|${sign}`,
        parts: [
          h('span.title', {}, `${deskName} · 비어 있음`),
          ...(full
            ? [h('span.cost', {}, `🚫 인원 한도 도달 · 직원 ${m.workers}/${m.limit}명`)]
            : [
                m.pressure ? h('span.cost', { title: `이 컴퓨터의 자원이 부족합니다: ${m.pressure}` }, "⚠️ 컴퓨터 자원 부족") : '',
                ...(paused ? [h('span.cost', {}, "💸 오늘 예산을 모두 사용했습니다. 내일부터 다시 고용할 수 있습니다")] : [key('E', "직원 고용"), key('P', "작업을 맡기며 고용")]),
                key('B', "Shell"),
              ]),
          labelKey,
        ],
      };
    }
    if (w.lost && w.worktree) {
      return {
        k: `lost|${w.id}|${w.lost.branch}|${sign}`,
        parts: [
          h('span.title', {}, `${sign ? `🪧 ${sign} · ` : ''}${w.name} · 🌿 worktree 삭제됨`),
          aside("Agent Office 외부에서 삭제됨"),
          key('E', "복구하기"),
          key('X', "퇴근시키기"),
          labelKey,
        ],
      };
    }
    const doing = w.activity ? clip(w.activity, 48) : '';
    const workerProvider = w.kind === 'agent' ? resolvedProvider(w.provider, store.project) : undefined;
    const spent = w.kind === 'agent' && w.usage ? usageLabel(w.usage, workerProvider) : '';
    const shell = w.kind === 'shell';
    return {
      k: w.status + w.id + (w.pr?.number ?? '') + (w.repos?.map((r) => r.pr?.number ?? '-').join() ?? '') + (w.prOpening ? '!' : '') + doing + spent + (sign ?? ''),
      parts: [
        h('span.title', {}, `${sign ? `🪧 ${sign} · ` : ''}${w.name} · ${STATUS_LABEL[w.status]}`),
        doing ? aside(doing) : '',
        spent ? h('span.cost', { title: usageTitle(w.usage!, workerProvider) }, spent) : '',
        key('E', "터미널 열기"),
        key('C', "변경 사항"),
        isAsleep(w.status) ? key('R', shell ? "다시 시작" : "재개") : key('P', shell ? "명령 실행" : "작업 지시"),
        w.repos?.length ? reposKey(w) : w.pr ? key('O', `PR #${w.pr.number}`) : w.prOpening ? aside("⏳ PR 생성 중…") : prReady(w) ? key('O', "PR 생성") : '',
        key('X', "퇴근시키기"),
        labelKey,
      ],
    };
  }

  /** The O in the desk hint of a worker across repositories: its pull requests so far, or opening them. */
  function reposKey(w: WorkerInfo) {
    const repos = workerRepos(w);
    const prs = repos.filter((r) => r.pr).length;
    if (w.prOpening) return aside("⏳ PR 생성 중…");
    if (prs) return key('O', `PR ${prs}/${repos.length}`);
    return prReady(w) ? key('O', `PR 생성 (저장소 ${repos.length}개)`) : '';
  }

  function stationHint(deskId: string): Hint {
    const kind = plan().byId.get(deskId)?.station;
    if (!kind) return { k: '', parts: [] };
    const w = store.workerAtDesk(deskId);
    const info = STATION_INFO[kind];
    if (!w) {
      const m = store.machine;
      const full = officeFull(m);
      return {
        k: `${full}|${m.workers}|${m.limit}`,
        parts: [
          h('span.title', {}, `${info.icon} ${STATION_AGENT[kind].name}`),
          aside(info.offer.replace(/^Ask me /, '')),
          full ? h('span.cost', {}, `🚫 인원 한도 도달 · 직원 ${m.workers}/${m.limit}명`) : key('E', "작업 지시"),
        ],
      };
    }
    const doing = w.activity ? clip(w.activity, 48) : '';
    const provider = resolvedProvider(w.provider, store.project);
    const spent = w.usage ? usageLabel(w.usage, provider) : '';
    return {
      k: w.status + w.id + doing + spent,
      parts: [
        h('span.title', {}, `${info.icon} ${w.name} · ${STATUS_LABEL[w.status]}`),
        doing ? aside(doing) : '',
        spent ? h('span.cost', { title: usageTitle(w.usage!, provider) }, spent) : '',
        key('E', isAsleep(w.status) ? "작업을 맡기며 재개" : "작업 지시"),
        key('O', "터미널"),
        key('X', "퇴근시키기"),
      ],
    };
  }

  ctx.interactions.define('desk', {
    reach: 4.5,
    hint: (it) => (it.deskId ? deskHint(it.deskId) : { k: '', parts: [] }),
    use: (it, key) => {
      if (!it.deskId) return;
      if (key === 'L') return openDeskLabel(net, it.deskId);
      const w = store.workerAtDesk(it.deskId);
      // Nobody is hired at the meeting table: a meeting seats its own workers there.
      if (!w && plan().byId.get(it.deskId)?.room) return key === 'E' ? parts.meeting.showMeeting() : undefined;
      if (key === 'B' && !w) return openShell(it.deskId);
      if (key === 'P') return promptAtDesk(it.deskId);
      if (key === 'E') return w ? openWorkerTerminal(w.id) : hireAtDesk(it.deskId);
      if (key === 'C' && w) return openWorkerChanges(w.id);
      if (key === 'R' && w && isAsleep(w.status)) return resumeWorker(w);
      if (key === 'X' && w) return killWorker(w.id);
      if (key === 'O' && w) return pullRequestFor(w);
    },
  });
  ctx.interactions.define('station', {
    reach: 4.5,
    hint: (it) => (it.deskId ? stationHint(it.deskId) : { k: '', parts: [] }),
    use: (it, key) => {
      if (!it.deskId) return;
      const w = store.workerAtDesk(it.deskId);
      if (key === 'E' || key === 'P') return askStation(it.deskId);
      if (key === 'O' && w) return openWorkerTerminal(w.id);
      if (key === 'X' && w) return killWorker(w.id);
    },
  });

  /** A prompt from the boards goes to a new worker at a free desk, or to one already at a desk. With `issue`, that worker takes the issue. */
  function sendToWorker(title: string, text: { context?: string; initial?: string }, issue?: number) {
    const desk = freeDesk();
    const awake = [...store.workers.values()].filter((w) => w.kind === 'agent' && !isAsleep(w.status));
    if (!desk && !awake.length) {
      toast("빈 책상이나 자리가 없습니다. 먼저 직원을 퇴근시키세요", 'warn');
      return;
    }
    openAsk({
      title,
      ...text,
      newDesk: desk ? plan().byId.get(desk)!.label : undefined,
      workers: awake.map((w) => ({ id: w.id, name: w.name, color: w.color, status: w.status })),
      worktreeOption: !!store.project?.branch,
      providerOption: true,
      repoOptions: repoChoices(),
      onSubmit: (prompt, to, worktree, provider, model, effort, repos) => {
        if (to) net.send({ t: 'worker.prompt', workerId: to, prompt, issue });
        else if (desk) hire(desk, prompt, worktree, provider, model, effort, issue, repos);
      },
    });
  }

  /** What the boards' buttons do: hand an issue to a worker, queue it, call a meeting about it, go to a desk, take its card. */
  function boardActions() {
    return {
      queue: (prompt: string, title: string, issue: number, provider?: AgentProvider, model?: string, effort?: AgentEffort) => net.send({ t: 'queue.add', prompt, title, issue, provider, model, effort }),
      assign: (prompt: string, title: string, issue?: number) => sendToWorker(`🤖 ${title}`, { initial: prompt }, issue),
      ask: (context: string, title: string) => sendToWorker(`✍️ ${title}`, { context }),
      meeting: (preset: MeetingPreset) => parts.meeting.showMeeting(preset),
      goToDesk,
      pickUp: parts.cards.pickUp,
    };
  }

  return { officeIsFull, firstFreeSeat, hire, hireAtDesk, resumeWorker, fixLostWorktree, pullRequestFor, standAt, boardActions };
}
