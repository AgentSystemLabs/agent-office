/**
 * The command palette (Ctrl+K, ⌘K on a Mac): the workers, the office's actions, its boards, the pull
 * requests, issues and services, and the people in it. Enter does it; Shift+Enter walks you over to
 * where it's done first.
 */
import { DESK_BY_ID, DESKS, WING_DESKS, deskSeat, type DeskDef } from '../../../shared/layout';
import { isPaletteKey } from '../../../shared/palette';
import type { Ctx } from '../../core/context';
import { seatBuilt } from '../../core/floors';
import type { Parts } from '../../core/parts';
import { STATION_INFO } from '../../core/stations';
import { isTyping } from '../../player';
import { store } from '../../state';
import { openAccounts } from '../../ui/accounts';
import { openBoard } from '../../ui/boards';
import { STATUS_LABEL, toast } from '../../ui/dom';
import { paletteOpen, togglePalette, type PaletteEntry } from '../../ui/palette';
import { openIssue, openPull } from '../../ui/pull';
import { openServices, serviceUrl } from '../../ui/services';
import { openTeam } from '../../ui/team';
import { IS_MAC } from '../../ui/termkeys';
import { openWhiteboard } from '../whiteboard/ui';
import type { InteractKind, Interactable } from '../../world/types';
import { L, placeLabel } from '../../i18n';

export type PaletteParts = Pick<Parts, 'walking' | 'waiting' | 'actions' | 'hud' | 'hanging' | 'meeting' | 'telescope'>;

/** Listens for Ctrl+K (⌘K) on the window. */
export function installPalette(ctx: Ctx, parts: PaletteParts) {
  const { office, player, net } = ctx;
  const walkThen = (...a: Parameters<Parts['walking']['walkThen']>) => parts.walking.walkThen(...a);
  const showQueue = () => parts.waiting.showQueue();
  const showSearch = () => parts.waiting.showSearch();

  /** Where you stand to use something of this kind on this floor, like the Issues board. */
  function spotOf(kind: InteractKind): Interactable | undefined {
    return office.interactables.find((it) => it.kind === kind && !it.off);
  }

  /** Where you stand at a desk: behind the worker, looking over their shoulder (as standAt), or by a chair at the meeting table. */
  function deskSpot(desk: DeskDef): { x: number; z: number } | undefined {
    if (desk.room) return office.interactables.find((it) => it.deskId === desk.id);
    return deskSeat(desk, desk.station ? -1.6 : desk.beanbag ? 1.6 : 2.4);
  }

  /** The free desk nearest you, for hiring from the palette. */
  function nearestFreeDesk(): DeskDef | undefined {
    let best: DeskDef | undefined;
    let bestD = Infinity;
    for (const d of [...DESKS, ...WING_DESKS]) {
      if (store.workerAtDesk(d.id) || !office.desks.has(d.id) || !seatBuilt(d.id)) continue;
      const dist = Math.hypot(d.x - player.pos.x, d.z - player.pos.z);
      if (dist < bestD) {
        best = d;
        bestD = dist;
      }
    }
    return best;
  }

  /** An entry that walks you over to `kind`'s spot (Shift+Enter) before doing what Enter does. */
  function at(kind: InteractKind, what: string, entry: Omit<PaletteEntry, 'walk'>): PaletteEntry {
    const it = spotOf(kind);
    return { ...entry, walk: it ? () => walkThen(it, what, entry.open) : undefined };
  }

  /** Everything the palette finds, in the order it lists them before you type. */
  function paletteEntries(): PaletteEntry[] {
    const { waiting, actions, meeting, hanging } = parts;
    const out: PaletteEntry[] = [];
    for (const w of store.workers.values()) {
      const desk = DESK_BY_ID.get(w.deskId);
      const spot = desk && deskSpot(desk);
      const open = () => waiting.openWorkerTerminal(w.id);
      out.push({
        icon: desk?.station ? STATION_INFO[desk.station].icon : w.kind === 'shell' ? '🐚' : '🧑‍💻',
        kind: L.provider.worker,
        title: w.name,
        detail: [w.task?.name, desk && placeLabel(desk), STATUS_LABEL[w.status]].filter(Boolean).join(' · '),
        keywords: [w.title, w.worktree?.branch],
        open,
        walk: desk && spot ? () => walkThen(spot, L.game.whoAt(w.name, placeLabel(desk)), open, desk) : undefined,
      });
    }

    const free = nearestFreeDesk();
    const hireAt = (d: DeskDef) => () => actions.hireAtDesk(d.id);
    out.push({
      icon: '✨',
      kind: L.game.kindAction,
      title: L.hints.hire,
      detail: free ? L.game.nearestFree(placeLabel(free)) : L.game.everyDeskTaken,
      keywords: ['new worker', 'spawn an agent'],
      open: free ? hireAt(free) : () => toast(L.game.floorFull, 'warn'),
      walk: free ? () => walkThen(deskSpot(free)!, placeLabel(free), hireAt(free), free) : undefined,
    });
    out.push(at('queue', L.game.theQueue, { icon: '📋', kind: L.game.kindAction, title: L.game.openQueue, detail: L.menu.queueTip, keywords: ['backlog', 'tasks'], open: showQueue }));
    out.push({ icon: '⚙️', kind: L.game.kindAction, title: L.menu.settings, keywords: ['preferences', 'options'], open: () => parts.hud.showSettings() });
    if (store.invites) out.push({ icon: '👥', kind: L.game.kindAction, title: L.menu.invite, keywords: ['team', 'add people'], open: () => openTeam(net) });
    else if (store.me.admin) out.push({ icon: '👥', kind: L.game.kindAction, title: L.game.invitePeople, detail: L.menu.accounts, keywords: ['invite teammates', 'accounts', 'team'], open: () => openAccounts(net) });
    out.push({ icon: '🖼️', kind: L.game.kindAction, title: L.menu.hang, detail: L.game.onAWall, keywords: ['decorate', 'frame', 'art'], open: hanging.startHanging });
    out.push({ icon: '🔎', kind: L.game.kindAction, title: L.menu.searchTip, keywords: ['find'], open: showSearch });

    out.push(at('issues', L.game.theIssues, { icon: '📌', kind: L.game.kindBoard, title: L.boards.issuesBoard, open: () => openBoard('issues', net, actions.boardActions()) }));
    out.push(at('pulls', L.game.thePulls, { icon: '🔀', kind: L.game.kindBoard, title: L.game.prBoard, keywords: ['pull requests'], open: () => openBoard('pulls', net, actions.boardActions()) }));
    out.push(at('services', L.game.theServices, { icon: '🌐', kind: L.game.kindBoard, title: L.game.servicesBoard, detail: L.menu.servicesTip, open: () => openServices() }));
    out.push(at('whiteboard', L.game.theWhiteboard, { icon: '📝', kind: L.game.kindBoard, title: L.menu.whiteboard, open: () => openWhiteboard(net) }));
    out.push(at('meeting', L.game.theMeeting, { icon: '🤝', kind: L.game.kindBoard, title: L.menu.meeting, keywords: ['call a meeting'], open: () => meeting.showMeeting() }));

    for (const pr of store.pulls.items) {
      out.push(
        at('pulls', L.game.thePulls, {
          icon: '🔀',
          kind: 'PR',
          title: `#${pr.number} ${pr.title}`,
          detail: [pr.isDraft ? L.pull.draft : pr.state === 'MERGED' ? L.pull.merged : pr.state === 'CLOSED' ? L.pull.closed : L.pull.open, pr.headRefName, pr.author].join(' · '),
          open: () => openPull(pr, net, actions.boardActions()),
        }),
      );
    }
    for (const issue of store.issues.items) {
      out.push(
        at('issues', L.game.theIssues, {
          icon: '📌',
          kind: 'Issue',
          title: `#${issue.number} ${issue.title}`,
          detail: [issue.state === 'OPEN' ? L.pull.openIssue : L.pull.closedIssue, ...issue.labels.map((l) => l.name), issue.author].join(' · '),
          open: () => openIssue(issue, net, actions.boardActions()),
        }),
      );
    }
    for (const svc of store.services.items) {
      const board = spotOf('services');
      out.push({
        icon: '🌐',
        kind: L.game.kindService,
        title: svc.title || svc.command,
        detail: [`:${svc.port}`, svc.title && svc.command, store.workers.get(svc.workerId)?.name].filter(Boolean).join(' · '),
        keywords: [String(svc.port)],
        // As its Open ↗ button does. A new tab needs the key press itself, so walking there shows the board instead.
        open: () => window.open(serviceUrl(svc.port), '_blank', 'noopener'),
        walk: board ? () => walkThen(board, L.game.theServices, () => openServices()) : undefined,
      });
    }
    for (const p of store.peers.values()) {
      if (p.id === store.you) continue;
      const floor = store.onMyFloor(p) ? L.game.onThisFloor : L.game.onFloor(store.floors.find((f) => f.id === p.floor)?.name);
      // As clicking them under "In the office" does: over to them, by elevator if need be.
      out.push({ icon: '🙂', kind: L.game.kindTeammate, title: p.name, detail: floor, open: () => parts.walking.walkTo(p.id) });
    }
    return out;
  }

  // Ctrl+K (⌘K on a Mac), from anywhere but a text box or a terminal, where the key is theirs: in a
  // shell, Ctrl+K cuts to the end of the line. In the palette's own box it puts the palette away.
  window.addEventListener('keydown', (e) => {
    if (!isPaletteKey(e, IS_MAC)) return;
    const inPalette = paletteOpen() && !!(e.target as HTMLElement | null)?.closest?.('.modal.palette');
    if (!inPalette && (isTyping(e) || parts.telescope.active)) return;
    e.preventDefault();
    if (!e.repeat) togglePalette(paletteEntries);
  });

  return { paletteEntries };
}
