import path from 'node:path';
import { AGENT_PROVIDERS, PROVIDER_META, isAgentEffort, providerMeta, providerNames, type AgentProvider } from '../shared/providers.js';
import { L } from './i18n.js';

/**
 * Finds the provider represented by the configured executable.  Keep this deliberately based on
 * the final path component: --agent may be an absolute path, and Windows paths can be supplied
 * while the office itself is running under a POSIX shell. A Windows npm launcher (`pi.cmd`) counts as
 * its executable too.
 */
export function configuredProvider(command: string): AgentProvider {
  const base = path.basename(command.replaceAll('\\', '/')).toLowerCase().replace(/\.(?:exe|cmd|bat|com)$/, '');
  return AGENT_PROVIDERS.find((p) => PROVIDER_META[p].bin === base) ?? 'custom';
}

/** The providers an office started with `configured` can hire: the ones it knows, and a custom --agent only when that's what it was started with. */
export function agentProviders(configured: AgentProvider): AgentProvider[] {
  return AGENT_PROVIDERS.filter((p) => p !== 'custom' || configured === 'custom');
}

/** The command a provider's CLI runs as: the office's --agent when that's this provider, else its own executable. */
export function providerCommand(provider: AgentProvider, agentCmd: string): string {
  return configuredProvider(agentCmd) === provider ? agentCmd : (PROVIDER_META[provider].bin ?? agentCmd);
}

export function validateWorkerModel(kind: 'agent' | 'shell', provider: AgentProvider | undefined, model: unknown): string | undefined {
  if (model === undefined) return undefined;
  if (kind === 'shell') return L.srvAgents.shellNoModel;
  const meta = providerMeta(provider);
  if (!meta?.validModel) return L.srvAgents.modelsFor(providerNames((m) => !!m.validModel));
  return meta.validModel(model) ? undefined : (L.srvAgents.invalidModel[provider ?? ''] ?? meta.invalidModel);
}

/** Claude Code, Grok and Muse reasoning-effort flags; DSH advertises a reasoning_effort configuration option. */
export function validateWorkerEffort(kind: 'agent' | 'shell', provider: AgentProvider | undefined, effort: unknown): string | undefined {
  if (effort === undefined) return undefined;
  if (kind === 'shell') return L.srvAgents.shellNoEffort;
  if (!providerMeta(provider)?.takesEffort) return L.srvAgents.effortFor(providerNames((m) => !!m.takesEffort));
  return isAgentEffort(effort) ? undefined : L.srvAgents.badEffort;
}
