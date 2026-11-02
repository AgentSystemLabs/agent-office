import type { GhIssue, GhPull } from '../../shared/protocol.js';

export const NOTE_COLORS = ['#fff7b0', '#ffd6e0', '#caffbf', '#bde0fe', '#ffe5b4'];
export const PINS = ['#ef476f', '#118ab2', '#06d6a0', '#ffd166'];
export const TILTS = ['-1.2deg', '0.8deg', '-0.4deg', '1.4deg', '0deg', '-0.9deg'];

export function postItTint(color: string): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
  if (!m) return color;
  const pr = Math.round(parseInt(m[1], 16) * 0.35 + 255 * 0.65);
  const pg = Math.round(parseInt(m[2], 16) * 0.35 + 255 * 0.65);
  const pb = Math.round(parseInt(m[3], 16) * 0.35 + 255 * 0.65);
  return `rgb(${pr}, ${pg}, ${pb})`;
}

export function itemNoteColor(it: GhIssue | GhPull): string {
  const c = (it as any).color || (it.labels?.length ? it.labels[0].color : undefined);
  return c ? postItTint(c) : NOTE_COLORS[it.number % NOTE_COLORS.length];
}
