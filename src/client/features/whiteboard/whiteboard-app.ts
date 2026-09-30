// Inside the whiteboard window: Excalidraw, kept in step with everyone else on the floor. Loaded
// (React and Excalidraw, a few MB) only when someone opens the whiteboard, or when there's a drawing
// to show on the board in the office (see ui.ts).
//
// Syncing works like Excalidraw's own live collaboration: every change bumps an element's version,
// each browser sends the elements it changed, and everyone merges what arrives with
// reconcileElements, which keeps the newer copy of each element.

import { createElement as e } from 'react';
import { createRoot } from 'react-dom/client';
import { CaptureUpdateAction, Excalidraw, MainMenu, WelcomeScreen, exportToCanvas, reconcileElements, restoreElements } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { BinaryFileData, Collaborator, ExcalidrawImperativeAPI, SocketId } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { RemoteExcalidrawElement } from '@excalidraw/excalidraw/data/reconcile';
import type { ClientMsg, ServerMsg } from '../../../shared/protocol';
import { WB_MAX_ELEMENT_BYTES, byIndex, newer, type WbElement, type WbPointer } from '../../../shared/whiteboard';
import { store } from '../../state';
import { toast } from '../../ui/dom';

/** How often your changes, and your mouse, go out while you draw. */
const SEND_MS = 50;
const POINTER_MS = 40;
/** Keeps each message well under the office socket's 2 MB limit. */
const BATCH_BYTES = 900_000;

const asExcalidraw = (els: readonly WbElement[]) => restoreElements(els as unknown as ExcalidrawElement[], null);

// ---- Pictures ---------------------------------------------------------------------------------------
// Kept apart from the elements, as Excalidraw does: an image element names its picture by id (a hash
// of the picture), and the picture itself goes up and down over HTTP.

const files = new Map<string, BinaryFileData>();
/** Pictures the office has, so they needn't go up again. */
const stored = new Set<string>();
const uploads = new Map<string, Promise<boolean>>();
/** Pictures the office didn't have when asked, and when; asked again after a while. */
const missing = new Map<string, number>();

const fileUrl = (id?: string) => `/api/whiteboard/file?floor=${encodeURIComponent(store.floor ?? '')}${id ? `&id=${encodeURIComponent(id)}` : ''}`;

/** Fetches the pictures these elements show that this browser doesn't have yet. */
async function loadFiles(els: readonly ExcalidrawElement[]): Promise<BinaryFileData[]> {
  const now = Date.now();
  const want = new Set<string>();
  for (const el of els) {
    const id = el.type === 'image' && !el.isDeleted ? el.fileId : null;
    if (id && !files.has(id) && now - (missing.get(id) ?? 0) > 10_000) want.add(id);
  }
  const got: BinaryFileData[] = [];
  await Promise.all(
    [...want].map(async (id) => {
      try {
        const res = await fetch(fileUrl(id));
        if (!res.ok) throw new Error(String(res.status));
        const f = (await res.json()) as BinaryFileData;
        files.set(id, f);
        stored.add(id);
        missing.delete(id);
        got.push(f);
      } catch {
        missing.set(id, Date.now());
      }
    }),
  );
  return got;
}

/** Puts a picture on the office's board; resolves to whether it's there now. */
function upload(f: BinaryFileData): Promise<boolean> {
  let p = uploads.get(f.id);
  if (p) return p;
  p = fetch(fileUrl(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: f.id, mimeType: f.mimeType, dataURL: f.dataURL, created: f.created }) })
    .then(async (res) => {
      if (res.ok) {
        stored.add(f.id);
        files.set(f.id, f);
        return true;
      }
      const { error } = (await res.json().catch(() => ({}))) as { error?: string };
      toast(error ?? "Couldn't put that picture on the whiteboard", 'warn');
      return false;
    })
    .catch(() => {
      // Offline: try again with the next change.
      uploads.delete(f.id);
      return false;
    });
  uploads.set(f.id, p);
  return p;
}

// ---- The board in the office ------------------------------------------------------------------------

/**
 * The drawing as a picture for the board in the office, as big as fits in `maxW` × `maxH` pixels
 * (small drawings are scaled up, but not blown up past 3×). Null when nothing is drawn.
 */
export async function renderPreview(elements: readonly WbElement[], maxW: number, maxH: number): Promise<HTMLCanvasElement | null> {
  const live = asExcalidraw(elements.filter((el) => !el.isDeleted));
  if (!live.length) return null;
  await loadFiles(live);
  return exportToCanvas({
    elements: live,
    files: Object.fromEntries(files),
    appState: { exportBackground: false, exportWithDarkMode: false },
    exportPadding: 12,
    getDimensions: (w: number, h: number) => {
      const scale = Math.min(maxW / w, maxH / h, 3);
      return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale };
    },
  });
}

// ---- The window ---------------------------------------------------------------------------------------

/** Excalidraw's own hash of a collaborator id. */
function hashToInteger(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash << 5) - hash + id.charCodeAt(i);
  return hash;
}

function hueOf(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

const tints = new Map<string, string>();
/**
 * Excalidraw colors each collaborator's cursor with a pastel it picks from a hash of their id, and
 * takes no color of ours. So this picks an id for them whose pastel is the nearest to their own color.
 */
function tintedId(peerId: string, color: string): string {
  const key = `${peerId}|${color}`;
  let id = tints.get(key);
  if (id) return id;
  const want = hueOf(color);
  let best = Infinity;
  for (let n = 0; n < 80 && best > 5; n++) {
    const candidate = `${peerId}~${n}`;
    const off = Math.abs(((Math.abs(hashToInteger(candidate)) % 37) * 10) - want);
    const d = Math.min(off, 360 - off);
    if (d < best) {
      best = d;
      id = candidate;
    }
  }
  tints.set(key, id!);
  return id!;
}

export interface WhiteboardApp {
  /** Nothing under way that Esc should finish first: no text being typed, no shape being drawn, no menu open, no tool picked. */
  idle(): boolean;
  /** Lets go of whatever is selected; false when nothing was. */
  deselect(): boolean;
  /** Whiteboard messages from the office (the store has already taken them in). */
  receive(msg: ServerMsg): void;
  /** Back after the connection dropped: merges the board as the office has it, and sends what was drawn meanwhile. */
  resync(): void;
  /** Sends what's left to send, and takes Excalidraw down. */
  unmount(): void;
}

export function mountWhiteboard(host: HTMLElement, send: (msg: ClientMsg) => void, name: string): WhiteboardApp {
  let api: ExcalidrawImperativeAPI | null = null;
  /** Your changes on their way out: the live elements, sent as they are when the timer fires. */
  const pending = new Map<string, ExcalidrawElement>();
  let sendTimer = 0;
  const pointers = new Map<string, WbPointer & { selected?: string[] }>();
  /** Elements too big to send, which you've been told about. */
  const tooBig = new Set<string>();
  let lastPointer = 0;
  let collabFrame = 0;

  const schedule = () => {
    if (pending.size && !sendTimer) sendTimer = window.setTimeout(flush, SEND_MS);
  };

  /** Notes every element that's newer here than what the office last had of it. */
  const noteChanges = (els: readonly ExcalidrawElement[]) => {
    for (const el of els) if (newer(el, store.whiteboard.get(el.id))) pending.set(el.id, el);
    schedule();
  };

  function flush() {
    window.clearTimeout(sendTimer);
    sendTimer = 0;
    const out: WbElement[] = [];
    for (const [id, el] of pending) {
      // A picture goes up before the element that shows it, so nobody gets an image they can't load.
      if (el.type === 'image' && el.fileId && !el.isDeleted && !stored.has(el.fileId)) {
        const f = api?.getFiles()[el.fileId];
        if (f) void upload(f).then((ok) => ok && schedule());
        continue;
      }
      pending.delete(id);
      out.push({ ...(el as unknown as WbElement) });
    }
    if (!out.length) return;
    store.drew(out);
    let batch: WbElement[] = [];
    let size = 0;
    for (const el of out) {
      const n = JSON.stringify(el).length;
      // The office would refuse it (or drop the connection over it), so it stays on your screen only.
      if (n > WB_MAX_ELEMENT_BYTES) {
        if (!tooBig.has(el.id)) toast("That's too big for the whiteboard, so only you can see it. Try it in smaller pieces.", 'warn');
        tooBig.add(el.id);
        continue;
      }
      if (batch.length && size + n > BATCH_BYTES) {
        send({ t: 'wb.update', elements: batch });
        batch = [];
        size = 0;
      }
      batch.push(el);
      size += n;
    }
    if (batch.length) send({ t: 'wb.update', elements: batch });
  }

  /** Merges elements from the office into the drawing; whatever you're in the middle of stays yours. */
  const merge = (remote: readonly WbElement[]) => {
    if (!api || !remote.length) return;
    const restored = asExcalidraw(remote) as RemoteExcalidrawElement[];
    const elements = reconcileElements(api.getSceneElementsIncludingDeleted(), restored, api.getAppState());
    api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
    void loadFiles(restored).then((got) => got.length && api?.addFiles(got));
  };

  /** Everyone else with the whiteboard open, with their cursors and selections. */
  const showCollaborators = () => {
    collabFrame = 0;
    if (!api) return;
    const collaborators = new Map<SocketId, Collaborator>();
    for (const id of store.drawing) {
      const peer = store.peers.get(id);
      if (id === store.you || !peer) continue;
      const p = pointers.get(id);
      collaborators.set(id as SocketId, {
        id: tintedId(id, peer.color),
        socketId: id as SocketId,
        username: peer.name,
        color: { background: peer.color, stroke: peer.color },
        pointer: p && { x: p.x, y: p.y, tool: p.tool },
        button: p?.button,
        selectedElementIds: p?.selected ? Object.fromEntries(p.selected.map((s) => [s, true as const])) : undefined,
      });
    }
    api.updateScene({ collaborators });
  };
  const collaboratorsSoon = () => {
    collabFrame ||= requestAnimationFrame(showCollaborators);
  };

  const initial = asExcalidraw([...store.whiteboard.values()].sort(byIndex));
  const root = createRoot(host);
  root.render(
    e(
      Excalidraw,
      {
        excalidrawAPI: (a: ExcalidrawImperativeAPI) => {
          api = a;
          void loadFiles(initial).then((got) => got.length && api?.addFiles(got));
          collaboratorsSoon();
        },
        initialData: { elements: initial, appState: { viewBackgroundColor: '#ffffff' }, scrollToContent: true },
        onChange: (els) => noteChanges(els),
        onPointerUpdate: ({ pointer, button }) => {
          const now = performance.now();
          if (now - lastPointer < POINTER_MS) return;
          lastPointer = now;
          const selected = api ? Object.keys(api.getAppState().selectedElementIds).slice(0, 200) : undefined;
          send({ t: 'wb.pointer', x: pointer.x, y: pointer.y, tool: pointer.tool, button, selected });
        },
        isCollaborating: true,
        name,
        theme: 'light',
        langCode: 'en',
        autoFocus: true,
        aiEnabled: false,
        // Opening a file would replace the drawing for you alone; everything else in the menu works for everyone.
        UIOptions: { canvasActions: { loadScene: false, saveToActiveFile: false, changeViewBackgroundColor: false } },
      },
      e(
        MainMenu,
        null,
        e(MainMenu.DefaultItems.SaveAsImage),
        e(MainMenu.DefaultItems.Export),
        e(MainMenu.DefaultItems.SearchMenu),
        e(MainMenu.DefaultItems.Help),
        e(MainMenu.DefaultItems.ClearCanvas),
        e(MainMenu.Separator),
        e(MainMenu.DefaultItems.ToggleTheme),
      ),
      e(
        WelcomeScreen,
        null,
        e(WelcomeScreen.Hints.MenuHint),
        e(WelcomeScreen.Hints.ToolbarHint),
        e(WelcomeScreen.Hints.HelpHint),
        e(WelcomeScreen.Center, null, e(WelcomeScreen.Center.Heading, null, 'Draw together: everyone on this floor sees it live, and it stays up on the board')),
      ),
    ),
  );

  return {
    idle() {
      const s = api?.getAppState();
      if (!s) return true;
      return (
        !s.editingTextElement &&
        !s.newElement &&
        !s.multiElement &&
        !s.selectionElement &&
        !s.editingLinearElement &&
        !s.isCropping &&
        !s.openMenu &&
        !s.openPopup &&
        !s.openDialog &&
        !s.contextMenu &&
        s.showHyperlinkPopup !== 'editor' &&
        s.activeTool.type === 'selection'
      );
    },
    deselect() {
      if (!api || !Object.keys(api.getAppState().selectedElementIds).length) return false;
      api.updateScene({ appState: { selectedElementIds: {}, selectedGroupIds: {}, editingGroupId: null, selectedLinearElement: null }, captureUpdate: CaptureUpdateAction.NEVER });
      return true;
    },
    receive(msg) {
      switch (msg.t) {
        case 'wb.update':
          merge(msg.elements);
          break;
        case 'wb.pointer':
          pointers.set(msg.id, msg);
          collaboratorsSoon();
          break;
        case 'wb.people':
          for (const id of pointers.keys()) if (!msg.people.includes(id)) pointers.delete(id);
          collaboratorsSoon();
          break;
        case 'peer.update':
        case 'peer.leave':
          collaboratorsSoon();
          break;
      }
    },
    resync() {
      if (!api) return;
      merge([...store.whiteboard.values()]);
      noteChanges(api.getSceneElementsIncludingDeleted());
    },
    unmount() {
      flush();
      cancelAnimationFrame(collabFrame);
      api = null;
      root.unmount();
    },
  };
}
