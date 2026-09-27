// The whiteboard: an Excalidraw drawing everyone on a floor draws on together. The server keeps
// each floor's elements and passes every change on; browsers merge them the way Excalidraw's own
// live collaboration does, by each element's version (see `newer`).

/**
 * An Excalidraw element, as far as the office needs to know: what it takes to merge two copies.
 * Everything else about it (its shape, points, text, colors…) rides along untouched.
 */
export interface WbElement {
  id: string;
  type: string;
  /** Goes up by one with every change to the element. */
  version: number;
  /** Random, changed with the version: breaks the tie when two people change it at once. */
  versionNonce: number;
  isDeleted?: boolean;
  /** Its place in the stacking order, a fractional index that sorts as a plain string. */
  index?: string | null;
  /** When it last changed (epoch ms). */
  updated?: number;
  fileId?: string | null;
  [k: string]: unknown;
}

/** A picture on the whiteboard: Excalidraw's BinaryFileData. */
export interface WbFile {
  id: string;
  mimeType: string;
  dataURL: string;
  created: number;
}

/** Where someone's mouse is on the whiteboard, in the drawing's own coordinates. */
export interface WbPointer {
  x: number;
  y: number;
  tool: 'pointer' | 'laser';
  button: 'up' | 'down';
}

/** A floor's whiteboard, for whoever arrives there. */
export interface WhiteboardView {
  /** Every element, deleted ones too, so a deletion reaches whoever still has the element. */
  elements: WbElement[];
  /** Who has the whiteboard open right now (client ids). */
  people: string[];
}

/** The most elements a board keeps, deleted ones included. */
export const WB_MAX_ELEMENTS = 20_000;
/** One element as JSON: a long freehand stroke is the biggest. */
export const WB_MAX_ELEMENT_BYTES = 512 * 1024;
/** The whole drawing as JSON. */
export const WB_MAX_BYTES = 16 * 1024 * 1024;
/** One picture, as a data: URL. */
export const WB_MAX_FILE_BYTES = 6 * 1024 * 1024;
/** Every picture on a board together. */
export const WB_MAX_FILES_BYTES = 64 * 1024 * 1024;
/** What a picture may be: Excalidraw's image types. */
export const WB_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp', 'image/x-icon', 'image/avif', 'image/jfif'];

const ID_RE = /^[\w-]{1,100}$/;

/**
 * Whether `a` should replace `b`: it's a later version, or the same version with the lower nonce.
 * That's Excalidraw's rule, so every copy of the board settles on the same element.
 */
export function newer(a: Pick<WbElement, 'version' | 'versionNonce'>, b: Pick<WbElement, 'version' | 'versionNonce'> | undefined): boolean {
  return !b || a.version > b.version || (a.version === b.version && a.versionNonce < b.versionNonce);
}

/** An element as someone sent it, if it has what merging needs; anything else is dropped. */
export function checkElement(raw: unknown): WbElement | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const e = raw as Record<string, unknown>;
  if (typeof e.id !== 'string' || !ID_RE.test(e.id)) return undefined;
  if (typeof e.type !== 'string' || !e.type || e.type.length > 32 || e.type === 'selection') return undefined;
  if (!Number.isSafeInteger(e.version) || (e.version as number) < 1) return undefined;
  if (typeof e.versionNonce !== 'number' || !Number.isFinite(e.versionNonce)) return undefined;
  if (e.isDeleted !== undefined && typeof e.isDeleted !== 'boolean') return undefined;
  if (e.index !== undefined && e.index !== null && (typeof e.index !== 'string' || e.index.length > 200)) return undefined;
  if (e.fileId !== undefined && e.fileId !== null && (typeof e.fileId !== 'string' || !ID_RE.test(e.fileId))) return undefined;
  return e as WbElement;
}

/** A picture as someone sent it, or why it can't go on the board. */
export function checkFile(raw: unknown): WbFile | string {
  if (!raw || typeof raw !== 'object') return 'Bad picture';
  const f = raw as Record<string, unknown>;
  if (typeof f.id !== 'string' || !ID_RE.test(f.id)) return 'Bad picture id';
  if (typeof f.mimeType !== 'string' || !WB_IMAGE_TYPES.includes(f.mimeType)) return 'The whiteboard only takes pictures (PNG, JPEG, GIF, WebP, SVG…)';
  if (typeof f.dataURL !== 'string' || !f.dataURL.startsWith(`data:${f.mimeType}`)) return 'Bad picture data';
  if (f.dataURL.length > WB_MAX_FILE_BYTES) return `That picture is too big for the whiteboard (over ${WB_MAX_FILE_BYTES / 1024 / 1024} MB)`;
  const created = typeof f.created === 'number' && Number.isFinite(f.created) ? f.created : Date.now();
  return { id: f.id, mimeType: f.mimeType, dataURL: f.dataURL, created };
}

/** Elements in stacking order, bottom first: by fractional index, which compares as a plain string. */
export function byIndex(a: WbElement, b: WbElement): number {
  const x = a.index ?? '';
  const y = b.index ?? '';
  if (x === y) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  // Elements without an index go on top; Excalidraw gives them one when it loads them.
  if (!x) return 1;
  if (!y) return -1;
  return x < y ? -1 : 1;
}
