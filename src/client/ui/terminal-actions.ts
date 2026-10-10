import type { WorkerInfo } from '../../shared/protocol';
import { playtestIssueButton } from './playtests/triage';

/** Feature-owned actions shown beside a worker's terminal controls. */
const actions = [playtestIssueButton];
export function terminalActions(worker: WorkerInfo): HTMLElement[] {
  return actions.map(action => action(worker)).filter((el): el is HTMLButtonElement => el !== null);
}
