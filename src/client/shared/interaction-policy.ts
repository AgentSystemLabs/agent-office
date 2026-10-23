import type { DeskKey } from '../interaction';
import type { Interactable, InteractKind } from '../world/types';

/** Runtime policies can remove an action before the pointer starts its reach animation or sends an event. */
type Availability = (target: Interactable, key: DeskKey) => boolean;
const policies = new Map<InteractKind, Availability>();

export function registerInteractionPolicy(kind: InteractKind, allowed: Availability): () => void {
  policies.set(kind, allowed);
  return () => { if (policies.get(kind) === allowed) policies.delete(kind); };
}

export function interactionPermitted(target: Interactable, key: DeskKey): boolean {
  return policies.get(target.kind)?.(target, key) ?? true;
}
