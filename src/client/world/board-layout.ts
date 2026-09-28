// Where things sit on the issues wall board's canvas, and what a point on it lands on. Pure, so
// tests can load it in Node (see world/boards.ts for the drawing).

/** Which view the issues wall board shows: the forge's issues, or the floor's Jira epic. */
export type WallTab = 'issues' | 'jira';

/** Something on the wall board you can point at other than an issue note. */
export type BoardSpot = { kind: 'tab'; tab: WallTab } | { kind: 'ticket'; key: string };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The tab strip across the top of the board, when the floor has a Jira epic. */
export const TAB_H = 64;
const TAB_W = 360;
const TAB_GAP = 12;
const TAB_PAD = 20;

export function tabRects(): Record<WallTab, Rect> {
  return {
    issues: { x: TAB_PAD, y: 8, w: TAB_W, h: TAB_H - 16 },
    jira: { x: TAB_PAD + TAB_W + TAB_GAP, y: 8, w: TAB_W, h: TAB_H - 16 },
  };
}

/** The Jira view's three columns and the cards in them, top to bottom, with how many didn't fit. */
export interface JiraLayout {
  columns: { rect: Rect; cards: Rect[]; hidden: number }[];
}

const COL_GAP = 18;
const COL_HEAD = 50;
const CARD_H = 92;
const CARD_GAP = 10;
/** Room under the last card for "+N more". */
const MORE_H = 30;

/** Lays out columns holding `counts[i]` tickets inside the canvas below `top`. */
export function jiraLayout(counts: number[], width: number, height: number, top: number): JiraLayout {
  const n = counts.length;
  const colW = (width - COL_GAP * (n + 1)) / n;
  const colH = height - top - COL_GAP;
  const room = colH - COL_HEAD - 8;
  const fit = Math.max(0, Math.floor((room + CARD_GAP) / (CARD_H + CARD_GAP)));
  return {
    columns: counts.map((count, i) => {
      const x = COL_GAP + i * (colW + COL_GAP);
      const rect = { x, y: top, w: colW, h: colH };
      // All of them if they fit; otherwise one fewer, to leave room for "+N more".
      const shown = count <= fit ? count : Math.max(0, Math.floor((room - MORE_H + CARD_GAP) / (CARD_H + CARD_GAP)));
      const cards = Array.from({ length: shown }, (_, j) => ({ x: x + 10, y: top + COL_HEAD + j * (CARD_H + CARD_GAP), w: colW - 20, h: CARD_H }));
      return { rect, cards, hidden: count - shown };
    }),
  };
}

export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}
