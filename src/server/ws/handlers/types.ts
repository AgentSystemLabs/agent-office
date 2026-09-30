import type { Floor } from '../../floor.js';
import type { FloorView } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';

/**
 * A handler for every message type in `M`, each given the message of its own type. A domain's map
 * `satisfies HandlerMap<ItsClientMsg>`, so a missing or misspelled type is a compile error.
 */
export type HandlerMap<M extends { t: string }> = { [K in M['t']]: (ctx: Ctx, c: Client, msg: Extract<M, { t: K }>) => void };

/**
 * What a feature does when someone leaves a floor or the office, for the state it keeps per person
 * on a floor. The features run in the order ws/handlers/index.ts lists them.
 */
export interface FeatureHooks {
  /**
   * `c` is leaving `was` (undefined for the roof or the lobby) for somewhere else: let go of what's
   * theirs there. What it returns runs once they've arrived, after everyone has seen them go.
   */
  leaving?(ctx: Ctx, c: Client, was: Floor | undefined): (() => void) | void;
  /** `c` left the office (their socket closed): first this, for each feature... */
  closed?(ctx: Ctx, c: Client): void;
  /** ...then this, on every floor, for each feature. */
  closedOn?(ctx: Ctx, c: Client, floor: Floor): void;
}

/** A piece of what someone arriving on a floor is sent (see FloorView), or the lobby's when `floor` is undefined. */
export type ViewPieces = { [K in Exclude<keyof FloorView, 'floor'>]: (ctx: Ctx, floor: Floor | undefined) => FloorView[K] };
