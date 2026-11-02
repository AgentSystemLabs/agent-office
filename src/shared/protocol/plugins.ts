// Manifest and configuration for Agent Office plugins.

import type { ProviderMeta } from '../providers.js';

export type PluginCapability = 'floors' | 'queue' | 'services' | 'agent' | 'issues' | 'pulls' | 'boards';

export interface PluginManifest {
  id: string;
  name: string;
  author?: string;
  description: string;
  capabilities: PluginCapability[];
  githubUrl?: string;
  agentProviderMeta?: ProviderMeta;
  /**
   * A file of the plugin's own (relative to its directory) holding its settings page, shown in
   * ⚙️ Settings → Plugins. The office serves the file and knows nothing about what is in it, so
   * every plugin can bring its own settings UI.
   */
  settingsPage?: string;
  installed?: boolean;
  status?: 'active' | 'inactive' | 'error';
  error?: string;
  version?: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  local?: boolean;
}

export interface PluginsState {
  plugins: PluginManifest[];
  store?: PluginManifest[];
  pluginsDir?: string;
}
