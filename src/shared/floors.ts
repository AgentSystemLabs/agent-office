// The building: every project is a floor you ride the elevator to. Shared by the server (which
// assigns each floor its look) and the client (which paints it).

import type { CloneProgress } from './protocol.js';

/** The most project floors a building has, above its permanent public lobby. */
export const MAX_FLOORS = 16;

/** How a floor looks: its walls, their trim, and its planks. */
export interface FloorPalette {
  name: string;
  wall: string;
  trim: string;
  floor: string;
  floorAlt: string;
  /** The gaps between planks. */
  seam: string;
}

/** The first is the office as it always looked; every new floor takes the next one nobody has. */
export const FLOOR_PALETTES: FloorPalette[] = [
  { name: 'Maple', wall: '#fff6ea', trim: '#e8a87c', floor: '#f2d7b0', floorAlt: '#e9c89a', seam: '#d9b88c' },
  { name: 'Mint', wall: '#e3f6ec', trim: '#40a878', floor: '#cfe6d9', floorAlt: '#bcdcc9', seam: '#9fc6b0' },
  { name: 'Sky', wall: '#e7f0ff', trim: '#4f7fe0', floor: '#d6dde9', floorAlt: '#c5cedd', seam: '#aab5c8' },
  { name: 'Lavender', wall: '#f2eaff', trim: '#9470e0', floor: '#e1d7ef', floorAlt: '#d2c4e7', seam: '#b8a6d6' },
  { name: 'Peach', wall: '#ffefe6', trim: '#ea7352', floor: '#efc6a5', floorAlt: '#e5b48e', seam: '#cf9c76' },
  { name: 'Lemon', wall: '#fffbe0', trim: '#dcaa16', floor: '#e9d8a4', floorAlt: '#dec98b', seam: '#c8b271' },
  { name: 'Walnut', wall: '#f5eee5', trim: '#8b5e3c', floor: '#aa7650', floorAlt: '#9b6845', seam: '#7c5236' },
  { name: 'Slate', wall: '#edf1f5', trim: '#3d5a80', floor: '#b9c3cd', floorAlt: '#aab5c0', seam: '#8d99a6' },
  { name: 'Rose', wall: '#ffeaf0', trim: '#e0567f', floor: '#eed3da', floorAlt: '#e4c1cb', seam: '#cea5b2' },
  { name: 'Teal', wall: '#e1f7f6', trim: '#1a9a9a', floor: '#c3e2de', floorAlt: '#b0d7d2', seam: '#92c3bd' },
];

export function floorPalette(i: number): FloorPalette {
  return FLOOR_PALETTES[((i % FLOOR_PALETTES.length) + FLOOR_PALETTES.length) % FLOOR_PALETTES.length];
}

/**
 * `owner/repo` from what someone typed or pasted: owner/repo, a github.com URL (https, ssh or
 * git@), with or without .git. Undefined for anything else, so it can never become a CLI option,
 * a path or another host.
 */
export function normalizeRepo(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  let s = value.trim();
  if (s.length > 200) return undefined;
  s = s.replace(/^(?:https?:\/\/|ssh:\/\/)?(?:[\w.-]+@)?github\.com[/:]/i, '');
  s = s.replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\.git$/i, '');
  const parts = s.split('/');
  // A URL may go on past the repository (…/owner/repo/issues/12).
  if (parts.length < 2) return undefined;
  const [owner, repo] = parts;
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(owner)) return undefined;
  if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(repo) || repo === '.' || repo === '..') return undefined;
  return `${owner}/${repo}`;
}

export function sameRepo(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

/** What a floor's clone is doing: "Downloading 64%". */
export function cloneStep(p: CloneProgress | undefined): string {
  return `${p?.step ?? 'Cloning'}${p?.percent !== undefined ? ` ${p.percent}%` : '…'}`;
}

/** A floor's clone in a few words, for the floor lists: "⏳ Downloading 64%". */
export function cloneLabel(p: CloneProgress | undefined): string {
  return `⏳ ${cloneStep(p)}`;
}
