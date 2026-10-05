// A helper: a second agent someone walks over to a stuck worker's desk, which reads what that worker
// is doing, works out what's going wrong, tells the worker, and goes home. See docs/helper-plan.md.
//
// The office's own words for this are deliberately small. A helper is a worker like any other, so it
// gets a real terminal, real hooks, real status and real cost, and anyone can open it and type into
// it. What it doesn't get is a chair: it has no seat of its own, no task on the queue, no branch and
// no pull request, which is what stops it taking the work over rather than helping with it. It works
// in its host's checkout, on its host's branch, and it reports to its host.

import { deskPoint, type Pt } from './nav.js';
import type { DeskDef } from './layout.js';

/** The id a helper at `deskId` is addressed by: 'helper:desk-3'. Its host's desk is part of its name. */
export function helperId(deskId: string): string {
  return `helper:${deskId}`;
}

/** The desk a helper is helping at, or undefined when the id isn't a helper's. */
export function helperHost(id: string): string | undefined {
  return id.startsWith('helper:') ? id.slice('helper:'.length) : undefined;
}

/** Whether `id` is a helper's id rather than a seat's. */
export function isHelperId(id: string): boolean {
  return id.startsWith('helper:');
}

/**
 * Where its helper stands: at the side of the host's desk, on the same side as the chair so it isn't
 * standing in the walkway, and turned to face the desk. A desk is back-to-back with its partner, so
 * this is beside the top rather than in front of the worker sitting at it.
 */
export function helperSpot(host: DeskDef): { at: Pt; face: number } {
  const side = host.rotY;
  // Beside the desk, a little back from its front edge: out of the chair, out of the aisle.
  const at = deskPoint(host, 0.95, 1.15);
  return { at, face: side };
}

/**
 * A helper's desk, built from its host's so everything that looks a seat up (launch(), the client
 * asking plan().byId) finds one. It carries no seat of its own: the id says `helper:` and the
 * standing spot is where the helper is drawn, so there is no chair here for anyone to sit in.
 */
export function helperDesk(host: DeskDef, label: string): DeskDef {
  const spot = helperSpot(host);
  return {
    ...host,
    id: helperId(host.id),
    label,
    // Standing where the helper stands, turned to face the desk it is helping at.
    x: spot.at[0],
    z: spot.at[1],
    rotY: spot.face,
    // A visitor, so it is not one of the floor's desks: no wing row of its own, nothing to build.
    wing: undefined,
  };
}

/** What a helper is doing, for its card and the walk that gets it there. */
export type HelperPhase = 'walking' | 'reading' | 'reporting' | 'leaving';

/** How many lines of a helper's own terminal count as what it found. */
export const FINDING_LINES = 60;

const ANSI = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

/** A terminal's output as plain text, for putting into a prompt: no escape sequences, tidy spacing. */
export function plainText(raw: string): string {
  return raw
    .replace(ANSI, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A helper on its way to a desk, or standing at it: the path is the server's, as it is for the dog. */
export interface HelperState {
  /** The worker whose desk it is walking to. */
  hostId: string;
  /** Its id, so a browser can match it to the worker it is drawing. */
  workerId: string;
  /** The way from the door to where it stands, the last point being where it stops. */
  path: Pt[];
  /** Metres a second along the path. */
  speed: number;
  /** Which way it faces there: radians, 0 is +z. */
  face: number;
  /** What it's doing, for its card. */
  phase: HelperPhase;
}
