// A floor's own layout on top of the office everyone shares: the signs hung over its desks, and how
// far its back office is built out (see WING in layout.ts). Saved by server/floorplan.ts.

import { DESKS, WING, WING_DESKS, wingLevel } from './layout.js';

/** A sign hanging from the ceiling over a desk, naming what it's for ("Operations", "Code cleanup"). */
export interface DeskLabel {
  text: string;
  /** One of SIGN_COLORS. */
  color: string;
  by: string;
  at: number;
}

export interface FloorPlan {
  /** How many rows the back office is built out (0 is just the room), up to WING.rows. */
  wing: number;
  /** Signs by desk id. */
  labels: Record<string, DeskLabel>;
}

export const EMPTY_PLAN: FloorPlan = { wing: 0, labels: {} };

/** The longest a sign's text may be, in characters. */
export const MAX_LABEL = 32;

/** What a sign can be painted: its board, and the ink its letters are in. */
export const SIGN_COLORS = [
  { color: '#2b2d42', ink: '#fffaf3', name: 'Navy' },
  { color: '#ef476f', ink: '#fffaf3', name: 'Pink' },
  { color: '#f78c6b', ink: '#2b2d42', name: 'Orange' },
  { color: '#ffd166', ink: '#2b2d42', name: 'Yellow' },
  { color: '#06d6a0', ink: '#2b2d42', name: 'Green' },
  { color: '#118ab2', ink: '#fffaf3', name: 'Blue' },
  { color: '#9b5de5', ink: '#fffaf3', name: 'Purple' },
] as const;

/** A few to start from, in the label window. */
export const LABEL_IDEAS = ['Operations', 'Code cleanup', 'Frontend', 'Backend', 'Bug fixes', 'Docs', 'Infra', 'Research'];

/** Desks that can have a sign: the room's and the back office's, not the bean bags, kiosks or meeting chairs. */
const LABELABLE = new Set([...DESKS, ...WING_DESKS].map((d) => d.id));

export function canLabel(deskId: string): boolean {
  return LABELABLE.has(deskId);
}

/** A sign's text as it's hung: one line, no control characters, at most MAX_LABEL characters. */
export function cleanLabel(text: unknown): string {
  if (typeof text !== 'string') return '';
  const flat = text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  return [...flat].slice(0, MAX_LABEL).join('').trim();
}

/** The paint a sign asked for, or the first one when it's none of SIGN_COLORS. */
export function signColor(color: unknown): string {
  return SIGN_COLORS.find((c) => c.color === color)?.color ?? SIGN_COLORS[0].color;
}

/** The ink for letters on a board painted `color`. */
export function signInk(color: string): string {
  return SIGN_COLORS.find((c) => c.color === color)?.ink ?? SIGN_COLORS[0].ink;
}

/** A plan read back from disk (or anywhere else it can't be trusted): what's valid of it. */
export function cleanPlan(raw: unknown): FloorPlan {
  const r = raw && typeof raw === 'object' ? (raw as Partial<Record<keyof FloorPlan, unknown>>) : {};
  const labels: Record<string, DeskLabel> = {};
  if (r.labels && typeof r.labels === 'object') {
    for (const [id, l] of Object.entries(r.labels as Record<string, unknown>)) {
      if (!canLabel(id) || !l || typeof l !== 'object') continue;
      const s = l as Partial<Record<keyof DeskLabel, unknown>>;
      const text = cleanLabel(s.text);
      if (!text) continue;
      labels[id] = { text, color: signColor(s.color), by: typeof s.by === 'string' ? s.by : '?', at: typeof s.at === 'number' ? s.at : 0 };
    }
  }
  return { wing: wingLevel(r.wing), labels };
}

/** The desks a row of the back office brings: `row` from 1. */
export function rowDesks(row: number) {
  return WING_DESKS.filter((d) => d.wing === row);
}

/** How many more rows the back office can take. */
export function roomToGrow(plan: FloorPlan): number {
  return WING.rows - plan.wing;
}
