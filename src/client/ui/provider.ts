import type { AgentProvider, ProjectInfo, Usage } from '../../shared/protocol';
import { h } from './dom';

const PROVIDER_KEY = 'agent-office.provider';

export const PROVIDER_LABEL: Record<AgentProvider, string> = {
  claude: 'Claude Code',
  opencode: 'OpenCode',
  custom: 'Custom',
};

/** Providers the server says this project can start. */
export function supportedProviders(project: ProjectInfo | null): AgentProvider[] {
  const values = project?.agentProviders?.filter((p): p is AgentProvider => p === 'claude' || p === 'opencode' || p === 'custom') ?? [];
  if (values.length) return [...new Set(values)];
  return project?.defaultProvider && PROVIDER_LABEL[project.defaultProvider] ? [project.defaultProvider] : ['claude'];
}

/** Resolve old workers/tasks that have no provider metadata to the configured default. */
export function resolvedProvider(provider: AgentProvider | undefined, project: ProjectInfo | null): AgentProvider {
  // A worker/task keeps its identity even if the office was later restarted with a
  // configuration that no longer offers that provider.
  if (provider && PROVIDER_LABEL[provider]) return provider;
  const configured = project?.defaultProvider;
  return configured && PROVIDER_LABEL[configured] ? configured : supportedProviders(project)[0];
}

export function providerLabel(provider: AgentProvider | undefined, project: ProjectInfo | null): string {
  return PROVIDER_LABEL[resolvedProvider(provider, project)];
}

export function providerUsageTracked(provider: AgentProvider | undefined, project: ProjectInfo | null, usage?: Usage): boolean {
  const selected = resolvedProvider(provider, project);
  return selected === 'claude' || (selected === 'custom' && usage !== undefined);
}

export function providerUsageNote(provider: AgentProvider): string {
  if (provider === 'claude') return 'Office usage and budget track Claude Code.';
  if (provider === 'custom') return 'Usage is untracked unless compatible Claude Code hooks report it.';
  return 'Usage is untracked; office budget and totals cover Claude Code only.';
}

function preferredProvider(options: AgentProvider[], fallback: AgentProvider): AgentProvider {
  try {
    const saved = localStorage.getItem(PROVIDER_KEY);
    if (saved && options.includes(saved as AgentProvider)) return saved as AgentProvider;
  } catch {
    // storage blocked
  }
  return options.includes(fallback) ? fallback : options[0];
}

export interface ProviderPicker {
  element: HTMLElement;
  value(): AgentProvider;
}

/** A provider selector that never offers a provider outside the server's metadata. */
export function providerPicker(project: ProjectInfo | null, id: string, label = 'Worker provider'): ProviderPicker {
  const options = supportedProviders(project);
  const fallback = resolvedProvider(project?.defaultProvider, project);
  const select = h('select.provider-select', { id, 'aria-label': 'Worker provider' }) as HTMLSelectElement;
  for (const provider of options) select.append(h('option', { value: provider }, PROVIDER_LABEL[provider]));
  select.value = preferredProvider(options, fallback);
  const note = h('small.provider-note', {}, providerUsageNote(select.value as AgentProvider));
  select.addEventListener('change', () => {
    const provider = select.value as AgentProvider;
    note.textContent = providerUsageNote(provider);
    if (options.includes(provider)) {
      try {
        localStorage.setItem(PROVIDER_KEY, provider);
      } catch {
        // storage blocked
      }
    }
  });
  return {
    element: h('div.provider-choice', {}, h('label', { for: id }, label), select, note),
    value: () => (options.includes(select.value as AgentProvider) ? (select.value as AgentProvider) : fallback),
  };
}
