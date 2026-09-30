// Every agent provider's adapter (see types.ts). Adding a provider: its adapter file, one line here
// and its entry in shared/providers.ts.
import type { AgentProvider } from '../../shared/providers.js';
import { claude } from './claude.js';
import { codex } from './codex.js';
import { custom } from './custom.js';
import { dsh } from './dsh.js';
import { grok } from './grok.js';
import { muse } from './muse.js';
import { opencode } from './opencode.js';
import { pi } from './pi.js';
import type { SomeAdapter } from './types.js';

export type { LaunchPlan, ProviderAdapter, ProviderFloor, SomeAdapter } from './types.js';

export const PROVIDERS: Record<AgentProvider, SomeAdapter> = {
  claude,
  opencode,
  codex,
  grok,
  muse,
  dsh,
  pi,
  custom,
};

/** The hook route /hooks/`route` serves, when it's one (see ProviderAdapter.hook). */
export function providerHook(route: string): SomeAdapter['hook'] {
  return providerAdapter(route)?.hook;
}

/** A terminal title that's only an agent's own name ("Claude Code"): not worth showing, whichever agent the worker runs. */
export function titleNoise(title: string): boolean {
  return Object.values(PROVIDERS).some((p) => p.titleNoise?.test(title));
}

/** The adapter of `provider`, when it's one (workers.json and the wire can hold anything). */
export function providerAdapter(provider: unknown): SomeAdapter | undefined {
  return typeof provider === 'string' && Object.hasOwn(PROVIDERS, provider) ? PROVIDERS[provider as AgentProvider] : undefined;
}
