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
        kind: 'Worker',
        title: w.name,
        detail: [w.task?.name, desk?.label, STATUS_LABEL[w.status]].filter(Boolean).join(' · '),
        keywords: [w.title, w.worktree?.branch],
        open,
        walk: desk && spot ? () => walkThen(spot, `${w.name} at ${desk.label}`, open, desk) : undefined,
      });
    }

    const free = nearestFreeDesk();
    const hireAt = (d: DeskDef) => () => actions.hireAtDesk(d.id);
    out.push({
      icon: '✨',
      kind: 'Action',
      title: 'Hire a worker',
      detail: free ? `At ${free.label}, the free desk nearest you` : 'Every desk is taken',
      keywords: ['new worker', 'spawn an agent'],
      open: free ? hireAt(free) : () => toast('Every desk on this floor is taken', 'warn'),
      walk: free ? () => walkThen(deskSpot(free)!, free.label, hireAt(free), free) : undefined,
    });
    out.push(at('queue', 'the task queue', { icon: '📋', kind: 'Action', title: 'Open the task queue', detail: 'Issues and tasks waiting for a worker', keywords: ['backlog', 'tasks'], open: showQueue }));
    out.push({ icon: '⚙️', kind: 'Action', title: 'Settings', keywords: ['preferences', 'options'], open: () => parts.hud.showSettings() });
    if (store.invites) out.push({ icon: '👥', kind: 'Action', title: 'Invite teammates', keywords: ['team', 'add people'], open: () => openTeam(net) });
    else if (store.me.admin) out.push({ icon: '👥', kind: 'Action', title: 'Invite people', detail: 'Accounts', keywords: ['invite teammates', 'accounts', 'team'], open: () => openAccounts(net) });
    out.push({ icon: '🖼️', kind: 'Action', title: 'Hang a picture', detail: 'On a wall of this floor', keywords: ['decorate', 'frame', 'art'], open: hanging.startHanging });
    out.push({ icon: '🔎', kind: 'Action', title: 'Search the chat and every terminal', keywords: ['find'], open: showSearch });

    out.push(at('issues', 'the Issues board', { icon: '📌', kind: 'Board', title: 'Issues board', open: () => openBoard('issues', net, actions.boardActions()) }));
    out.push(at('pulls', 'the PR board', { icon: '🔀', kind: 'Board', title: 'PR board', keywords: ['pull requests'], open: () => openBoard('pulls', net, actions.boardActions()) }));
    out.push(at('services', 'the Services board', { icon: '🌐', kind: 'Board', title: 'Services board', detail: 'Web servers the workers are running', open: () => openServices() }));
    out.push(at('whiteboard', 'the whiteboard', { icon: '📝', kind: 'Board', title: 'Whiteboard', open: () => openWhiteboard(net) }));
    out.push(at('meeting', 'the meeting room', { icon: '🤝', kind: 'Board', title: 'Meeting room', keywords: ['call a meeting'], open: () => meeting.showMeeting() }));

    for (const pr of store.pulls.items) {
      out.push(
        at('pulls', 'the PR board', {
          icon: '🔀',
          kind: 'PR',
          title: `#${pr.number} ${pr.title}`,
          detail: [pr.isDraft ? 'Draft' : pr.state.toLowerCase(), pr.headRefName, pr.author].join(' · '),
          open: () => openPull(pr, net, actions.boardActions()),
        }),
      );
    }
    for (const issue of store.issues.items) {
      out.push(
        at('issues', 'the Issues board', {
          icon: '📌',
          kind: 'Issue',
          title: `#${issue.number} ${issue.title}`,
          detail: [issue.state.toLowerCase(), ...issue.labels.map((l) => l.name), issue.author].join(' · '),
          open: () => openIssue(issue, net, actions.boardActions()),
        }),
      );
    }
    for (const svc of store.services.items) {
      const board = spotOf('services');
      out.push({
        icon: '🌐',
        kind: 'Service',
        title: svc.title || svc.command,
        detail: [`:${svc.port}`, svc.title && svc.command, store.workers.get(svc.workerId)?.name].filter(Boolean).join(' · '),
        keywords: [String(svc.port)],
        // As its Open ↗ button does. A new tab needs the key press itself, so walking there shows the board instead.
        open: () => window.open(serviceUrl(svc.port), '_blank', 'noopener'),
        walk: board ? () => walkThen(board, 'the Services board', () => openServices()) : undefined,
      });
    }
    for (const p of store.peers.values()) {
      if (p.id === store.you) continue;
      const floor = store.onMyFloor(p) ? 'On this floor' : `On the ${store.floors.find((f) => f.id === p.floor)?.name ?? 'other'} floor`;
      // As clicking them under "In the office" does: over to them, by elevator if need be.
      out.push({ icon: '🙂', kind: 'Teammate', title: p.name, detail: floor, open: () => parts.walking.walkTo(p.id) });
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
