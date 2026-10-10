import type { StationKind } from '../../shared/layout';
import type { PromptId } from '../../shared/prompts';
import { openPrompt, type PromptOptions } from './prompt';
import { officePrompt } from './prompts';

/** Board-specific actions plug into the ordinary request dialog and prompt editor. */
export const STATION_ACTIONS: Partial<Record<StationKind, { label: string; prompt: PromptId }[]>> = {
  issues: [{ label: '🧹 Reconcile issues', prompt: 'issues.reconcile' }],
};

export function openStationPrompt(kind: StationKind, opts: PromptOptions) {
  openPrompt({ ...opts, presets: STATION_ACTIONS[kind]?.map((action) => ({
    label: action.label, text: officePrompt(action.prompt),
  })) });
}
