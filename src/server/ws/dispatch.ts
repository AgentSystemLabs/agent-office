import type { ClientMsg } from '../../shared/protocol.js';
import type { Ctx } from '../office/context.js';
import type { Client } from '../office/client.js';
import { handlers } from './handlers/index.js';

type AnyHandler = (ctx: Ctx, c: Client, msg: ClientMsg) => void;

/**
 * Hands a message to the handler for its type. Only the map's own keys are types, so a message that
 * says it's a `constructor` or a `__proto__` goes nowhere, like one of a type nobody handles.
 */
export function dispatch(ctx: Ctx, c: Client, msg: ClientMsg): boolean {
  if (!Object.hasOwn(handlers, msg.t)) return false;
  (handlers[msg.t] as AnyHandler)(ctx, c, msg);
  return true;
}
