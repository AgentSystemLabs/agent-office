import './ui.css';
// The 📝 whiteboard window, and the drawing on the whiteboard in the office. Excalidraw itself is in
// whiteboard-app.ts, loaded the first time either needs it.

import type { ServerMsg } from '../../../shared/protocol';
import { byIndex } from '../../../shared/whiteboard';
import type { Net } from '../../net';
import { store } from '../../state';
import { h, openModal, toast, type Modal } from '../../ui/dom';
import type { WhiteboardApp } from './whiteboard-app';

declare const __EXCALIDRAW_ASSETS__: string;

let loading: Promise<typeof import('./whiteboard-app')> | undefined;

/** Excalidraw, loaded once. It gets its fonts from the office (see vite.config.ts). */
function excalidraw() {
  (window as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH ??= __EXCALIDRAW_ASSETS__;
  loading ??= import('./whiteboard-app').catch((err) => {
    loading = undefined;
    throw err;
  });
  return loading;
}

interface OpenBoard {
  modal: Modal;
  /** The floor whose whiteboard this is. */
  floor: string;
  app?: WhiteboardApp;
  people: HTMLElement;
}

let open: OpenBoard | null = null;
/** Redraws the board in the office; it waits while the window is open in front of it. */
let redrawBoard = () => {};

/** Opens the floor's whiteboard, to draw on with everyone else who has it open. */
export function openWhiteboard(net: Net) {
  if (open) return;
  const floor = store.floor;
  if (!floor) return toast('Take the elevator to a floor first', 'warn');
  const people = h('div.wb-people');
  const close = h('button.btn.close', { 'aria-label': 'Close', title: 'Close (Esc)' }, '✕');
  const host = h('div.wb-host', {}, h('div.wb-loading', {}, '✏️ Getting the markers out…'));
  const el = h('div.wb-window', { role: 'dialog', 'aria-label': 'Whiteboard' }, h('header', {}, h('h2', {}, '📝 Whiteboard'), people, close), host);
  // Esc first gets you out of whatever you're doing in Excalidraw (typing, drawing, a menu, a tool),
  // then lets go of what's selected, and once there's nothing left, closes the window.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || open !== board || (board.app && !board.app.idle())) return;
    e.preventDefault();
    e.stopPropagation();
    if (!board.app?.deselect()) board.modal.close();
  };
  const unsubscribe = [store.on('drawing', renderPeople), store.on('peers', renderPeople)];
  const board: OpenBoard = {
    floor,
    people,
    modal: openModal(el, {
      escCloses: false,
      doing: '🖍️ at the whiteboard',
      onClose: () => {
        window.removeEventListener('keydown', onKey, true);
        unsubscribe.forEach((off) => off());
        board.app?.unmount();
        open = null;
        net.send({ t: 'wb.close' });
        redrawBoard();
      },
    }),
  };
  open = board;
  window.addEventListener('keydown', onKey, true);
  close.addEventListener('click', () => board.modal.close());
  net.send({ t: 'wb.open' });
  renderPeople();
  excalidraw().then(
    (m) => {
      if (open !== board) return;
      host.replaceChildren();
      board.app = m.mountWhiteboard(host, (msg) => net.send(msg), `${store.project?.name ?? 'office'} whiteboard`);
    },
    () => host.replaceChildren(h('div.wb-loading', {}, "Couldn't load the whiteboard. Check your connection and open it again.")),
  );
}

/** Who else is drawing, in the window's title bar. */
function renderPeople() {
  if (!open) return;
  const others = store.drawing.filter((id) => id !== store.you).flatMap((id) => store.peers.get(id) ?? []);
  open.people.replaceChildren(
    ...(others.length
      ? [h('span.wb-live', {}, 'LIVE'), ...others.map((p) => h('span.wb-person', { title: `${p.name} is drawing` }, h('span.dot', { style: `background:${p.color}` }), p.name))]
      : [h('span.wb-alone', {}, 'Just you for now. Anyone on this floor can join in.')]),
  );
}

/** Whiteboard messages, for the window when it's open (the store has already taken them in). */
export function routeWhiteboardMessage(msg: ServerMsg, net: Net) {
  if (!open) return;
  switch (msg.t) {
    case 'welcome':
      // Back from a dropped connection, and the office has forgotten the window was open.
      if (store.floor !== open.floor) return open.modal.close();
      net.send({ t: 'wb.open' });
      open.app?.resync();
      return;
    case 'floor.enter':
      return open.modal.close();
    case 'wb.update':
    case 'wb.pointer':
    case 'wb.people':
    case 'peer.update':
    case 'peer.leave':
      open.app?.receive(msg);
  }
}

/**
 * Keeps the whiteboard in the office showing the drawing: redrawn a moment after it changes, and not
 * more than a few times a second while someone draws, or once you close the window if you have it
 * open (it hides the board anyway). `width` × `height` is the room for it, in pixels.
 */
export function mirrorWhiteboard(show: (drawing: HTMLCanvasElement | null) => void, width: number, height: number) {
  let timer = 0;
  let busy = false;
  let again = false;
  const draw = async () => {
    timer = 0;
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    const floor = store.floor;
    try {
      const elements = [...store.whiteboard.values()].sort(byIndex);
      const drawing = elements.some((el) => !el.isDeleted) ? await (await excalidraw()).renderPreview(elements, width, height) : null;
      // Rode the elevator meanwhile: this floor's drawing is on its way.
      if (store.floor === floor) show(drawing);
    } catch {
      // keep whatever the board shows
    }
    busy = false;
    if (again) {
      again = false;
      soon(300);
    }
  };
  const soon = (ms: number) => {
    if (!open) timer ||= window.setTimeout(() => void draw(), ms);
  };
  redrawBoard = () => soon(300);
  store.on('whiteboard', () => soon(300));
  // Arriving: after the office has loaded, since drawing it means loading Excalidraw.
  soon(1500);
}
