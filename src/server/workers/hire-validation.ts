import type { AgentChoice, AgentEffort, AgentProvider, WorkerInfo, WorkerKind } from '../../shared/protocol.js';
import { DESK_BY_ID, STATION_AGENT, deskBuilt } from '../../shared/layout.js';
import { validateWorkerModel, validateWorkerEffort } from '../agents.js';
import { providerAdapter } from '../providers/index.js';
import type { RepoSource, RunAs } from './types.js';
/** Maximum additional repositories accepted by a hire. */
export const MAX_REPOS = 8;

interface HireValidation {
  officeDefault: AgentChoice;
  wing: number;
  occupied: boolean;
  defaultProvider: AgentProvider;
  paused?: string;
  runAs?: RunAs;
  full?: string;
}

export function validateHireRequest(ctx: HireValidation, deskId: string, prompt: string | undefined, worktree: boolean, kind: WorkerKind, provider?: AgentProvider, model?: string, effort?: AgentEffort, meeting?: { id: string; worktree?: WorkerInfo['worktree'] }, owner?: string, repos: RepoSource[] = []): string | undefined {
  // Nobody picked (a board agent, say): the office's default worker, model and effort included.
  if (kind === 'agent' && provider === undefined) ({ provider, model, effort } = ctx.officeDefault);
  const selectedProvider = kind === 'agent' ? provider : undefined;
  const modelError = validateWorkerModel(kind, selectedProvider, model);
  if (modelError) return modelError;
  const effortError = validateWorkerEffort(kind, selectedProvider, effort);
  if (effortError) return effortError;
  const seat = DESK_BY_ID.get(deskId);
  if (!seat) return 'Unknown desk';
  if (!deskBuilt(seat, ctx.wing)) return `${seat.label} isn't built yet: expand the back office first`;
  if (ctx.occupied) return seat.station ? `The ${STATION_AGENT[seat.station].name} is already there` : `That ${seat.beanbag ? 'bean bag' : 'desk'} is taken`;
  if (kind === 'shell' && seat.station) return 'A board agent is always an agent, not a shell';
  if (seat.station && !prompt?.trim()) return 'Tell the board agent what to do';
  if (!seat.room !== !meeting) return seat.room ? 'Only a meeting seats workers at the meeting table: call one in the meeting room' : 'A meeting seats its workers at the meeting table';
  if (meeting && (kind !== 'agent' || worktree)) return 'A meeting seats agents, in its own worktree';
  if (repos.length && (kind !== 'agent' || !worktree || seat.station || meeting)) return 'Only a worker in its own worktree can work in other repositories too';
  if (repos.length > MAX_REPOS) return `A worker can take on at most ${MAX_REPOS} other repositories`;
  if (kind === 'shell' && provider !== undefined) return 'Shell workers do not have an agent provider';
  if (kind === 'agent' && selectedProvider === 'custom' && ctx.defaultProvider !== 'custom') return 'Custom is not the configured agent provider';
  if (kind === 'agent') {
    const paused = ctx.paused;
    if (paused) return paused;
  }
  const signIn = providerAdapter(selectedProvider)?.signIn;
  if (owner && signIn && ctx.runAs && !ctx.runAs.claudeReady(owner)) return ctx.runAs.why(signIn);
  const full = ctx.full;
  if (full) return full;
  return undefined;
}
