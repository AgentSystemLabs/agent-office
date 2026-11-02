import type { PluginsState } from '../../../shared/protocol';
import { registerAgentProvider } from '../../../shared/providers';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** Installed plugins in the office. */
    plugins: PluginsState;
  }
  interface Topics {
    plugins: true;
  }
}

function syncPluginProviders(state?: PluginsState) {
  if (!state?.plugins) return;
  for (const p of state.plugins) {
    if (p.agentProviderMeta && (p.status === 'active' || p.installed)) {
      registerAgentProvider(p.agentProviderMeta.name?.toLowerCase() || p.id, p.agentProviderMeta);
    }
  }
}

export const plugins: Slice = {
  init(s) {
    s.plugins = { plugins: [] };
  },
  on: {
    welcome(s, m) {
      if (m.plugins) {
        s.plugins = m.plugins;
        syncPluginProviders(m.plugins);
      }
      return ['plugins'];
    },
    plugins(s, m) {
      s.plugins = m.state;
      syncPluginProviders(m.state);
      return ['plugins'];
    },
  },
};
