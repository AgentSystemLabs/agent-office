/**
 * The boards on the walls: the coordinator's three (the checklist, the day's timeline and the phase,
 * see features/boards/coordinator.ts and ui/coordinator.ts), the services board, the machine monitor
 * and the meeting room's two. The GitHub boards and the task queue stay in the code (see
 * docs/features.md) but nothing shows them on the wall any more. What E does at each is defined with it.
 */
import type * as THREE from 'three';
import type { GhIssue } from '../../../shared/protocol';
import type { Ctx } from '../../core/context';
import { boardHint, hintTitle, key, onE } from '../../core/hint';
import { store, type Topic } from '../../state';
import { openCoordinator, type CoordinatorFocus } from '../../ui/coordinator';
import type { BoardActions } from '../../ui/github/prompts';
import { inProgress } from '../../ui/github/progress';
import { openServices } from '../../ui/services';
import { BoardTexture, QueueBoardTexture, ServicesBoardTexture } from './world';
import { CoordinatorBoardTexture } from './coordinator';
import { MachineTexture } from './machine';
import { MeetingBoardTexture, MeetingSignTexture } from './meeting';
import type { World } from '../../world/world';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    issues: true;
    pulls: true;
    services: true;
    queue: true;
  }
}

export interface BoardsDeps {
  /** The note on the issues board you're pointing at, if any (see aimedNote in input/pointer.ts). */
  aimedNote(): GhIssue | null;
  /** Takes an issue's card off the board, into your hands (see features/carrying). */
  pickUp(it: GhIssue): void;
  /** What a board's buttons do: hand an issue to a worker, call a meeting about it… */
  boardActions(): BoardActions;
  /** The task queue's window. */
  showQueue(): void;
}

export function installBoards(ctx: Ctx, deps: BoardsDeps) {
  const { office } = ctx;
  // Boards: each draws onto a canvas texture, redrawn whenever what it shows changes. The same
  // texture goes on that board in whichever world you're in (see dressBoards).
  function mountBoard(mesh: THREE.Mesh | undefined, texture: THREE.Texture, render: () => void, topics: Topic[]) {
    if (mesh) showOn(mesh, texture);
    for (const topic of topics) store.on(topic, render);
    render();
  }
  function showOn(mesh: THREE.Mesh, texture: THREE.Texture) {
    const mat = mesh.material as THREE.MeshBasicMaterial;
    if (mat.map === texture) return;
    mat.map = texture;
    mat.needsUpdate = true;
  }
  /** Issues whose cards someone on this floor is carrying around, so they're missing from the board. */
  function offBoard(): Set<number> {
    const off = new Set<number>();
    const carrying = ctx.carrying();
    if (carrying) off.add(carrying.issue);
    for (const p of store.peers.values()) if (p.carrying && p.id !== store.you && store.onMyFloor(p)) off.add(p.carrying.issue);
    return off;
  }
  // The GitHub boards' textures are kept: pointer.ts still reads the issues board's notes, and
  // features/carrying still asks it to redraw when a card is taken off it.
  const issuesTex = new BoardTexture('issues');
  const renderIssuesBoard = () => {
    const off = offBoard();
    issuesTex.render({ ...store.issues, items: store.issues.items.filter((i) => !off.has(i.number) && !inProgress(i, store.taskForIssue(i.number))) });
  };
  let carriedOff = '';
  store.on('peers', () => {
    const k = [...offBoard()].join(',');
    if (k === carriedOff) return;
    carriedOff = k;
    renderIssuesBoard();
  });
  /** Your card came off the board or went back on it (see features/carrying). */
  function cardMoved() {
    carriedOff = [...offBoard()].join(',');
    renderIssuesBoard();
  }
  const pullsTex = new BoardTexture('pulls');
  const renderPullsBoard = () => pullsTex.render(store.pulls, store.workers);
  const queueTex = new QueueBoardTexture();
  const renderQueueBoard = () => queueTex.render(store.queue, store.workers);

  // The coordinator's three boards, in the three boards' places along the north wall.
  const checklistTex = new CoordinatorBoardTexture('checklist');
  const timelineTex = new CoordinatorBoardTexture('timeline');
  const summaryTex = new CoordinatorBoardTexture('summary');
  mountBoard(office.boardMeshes.issues, checklistTex.texture, () => checklistTex.render(store.coordinator), ['coordinator']);
  mountBoard(office.boardMeshes.queue, timelineTex.texture, () => timelineTex.render(store.coordinator), ['coordinator']);
  mountBoard(office.boardMeshes.pulls, summaryTex.texture, () => summaryTex.render(store.coordinator), ['coordinator']);

  const servicesTex = new ServicesBoardTexture();
  const renderServicesBoard = () => servicesTex.render(store.services.items, store.workers);
  mountBoard(office.boardMeshes.services, servicesTex.texture, renderServicesBoard, ['services', 'workers']);

  const openCoord = (focus: CoordinatorFocus) => onE(() => openCoordinator(ctx.net, focus));
  ctx.interactions.define('issues', {
    reach: 9,
    hint: () => boardHint('📋 Checklist'),
    use: openCoord('checklist'),
  });
  ctx.interactions.define('pulls', {
    reach: 9,
    hint: () => boardHint('🎯 Phase'),
    use: openCoord('summary'),
  });
  ctx.interactions.define('services', {
    reach: 9,
    hint: () => boardHint('🌐 Services board'),
    use: onE(() => openServices()),
  });
  ctx.interactions.define('queue', {
    reach: 9,
    hint: () => {
      const n = store.coordinator.cards.length;
      return { k: String(n), parts: [hintTitle(`🕓 Timeline${n ? ` · ${n}` : ''}`), key('E', 'Open')] };
    },
    use: openCoord('timeline'),
  });
  // The machine monitor on the west wall.
  const machineTex = new MachineTexture();
  mountBoard(office.machineScreen, machineTex.texture, () => machineTex.render(store.machine), ['machine']);
  // The meeting room: its output as it's written on the back wall, and how it's going on the door.
  const meetingBoardTex = new MeetingBoardTexture();
  mountBoard(office.meetingBoard, meetingBoardTex.texture, () => meetingBoardTex.render(store.meeting), ['meeting']);
  const meetingSignTex = new MeetingSignTexture();
  mountBoard(office.meetingSign, meetingSignTex.texture, () => meetingSignTex.render(store.meeting), ['meeting']);
  /** Puts every board's texture up on `w`'s boards. */
  function dressBoards(w: World) {
    showOn(w.boardMeshes.issues, checklistTex.texture);
    showOn(w.boardMeshes.queue, timelineTex.texture);
    showOn(w.boardMeshes.pulls, summaryTex.texture);
    showOn(w.boardMeshes.services, servicesTex.texture);
    if (w.meetingBoard) showOn(w.meetingBoard, meetingBoardTex.texture);
    if (w.meetingSign) showOn(w.meetingSign, meetingSignTex.texture);
  }

  return { issuesTex, renderPullsBoard, renderServicesBoard, renderQueueBoard, dressBoards, cardMoved };
}
