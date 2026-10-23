import { pocketRuntime } from './runtime';
import type { WorkerActionPolicy } from '../../features/workers/policy';

/** Source settings and session lifetime belong to the host, not the Office CLI. */
export function pocketWorkerActions(embedded = pocketRuntime()): WorkerActionPolicy {
  return embedded ? {
    requireInitialTask: true, conversationLabel: 'worker conversation', reviewFollowupDrafts: true,
    releaseOnly: true, shell: false, repositories: false, deskLabels: false, boardAgents: false, providerChoices: false,
  } : {};
}

const ACTIONS = new Set(['elevator', 'settings', 'help']);
const PANELS = new Set(['workers', 'people', 'chat', 'floor']);

/** Only advertise actions backed by the Pocket transport or local room controls. */
export function pocketHudActions<T extends { id: string }>(actions: T[], embedded = pocketRuntime()): T[] {
  return embedded ? actions.filter((action) => ACTIONS.has(action.id)) : actions;
}

/** CLI spend and provider-limit data do not exist in Pocket. Keep supported panel toggles. */
export function pocketHudPanel(id: string, embedded = pocketRuntime()): boolean {
  return !embedded || PANELS.has(id);
}
