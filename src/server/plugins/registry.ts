import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { PluginManifest, PluginsState } from '../../shared/protocol.js';

export const BUILTIN_PLUGINS: PluginManifest[] = [];

export class PluginRegistry {
  private file: string;
  public pluginsDir: string;
  private manifests: Map<string, PluginManifest> = new Map();

  constructor(dataDir?: string) {
    const baseDir = dataDir ? (dataDir.endsWith('.agent-office') ? dataDir : path.join(dataDir, '.agent-office')) : path.join(process.cwd(), '.agent-office');
    this.file = path.join(baseDir, 'plugins.json');
    this.pluginsDir = path.join(baseDir, 'plugins');
    this.load();
  }

  private load() {
    for (const p of BUILTIN_PLUGINS) {
      this.manifests.set(p.id, { ...p });
    }

    if (existsSync(this.file)) {
      try {
        const raw = JSON.parse(readFileSync(this.file, 'utf8'));
        if (Array.isArray(raw)) {
          for (const item of raw) {
            if (item && typeof item === 'object' && typeof item.id === 'string') {
              const prev = this.manifests.get(item.id);
              this.manifests.set(item.id, {
                ...prev,
                ...item,
                installed: true,
                status: 'active',
              });
            }
          }
        }
      } catch {
        // ignore malformed file
      }
    }
  }

  save() {
    try {
      const dir = path.dirname(this.file);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const installed = [...this.manifests.values()].filter((m) => m.installed !== false);
      writeFileSync(this.file, JSON.stringify(installed, null, 2), 'utf8');
    } catch {
      // ignore
    }
  }

  register(manifest: PluginManifest) {
    this.manifests.set(manifest.id, { ...manifest, installed: true });
  }

  /** Forgets a manifest by id (a placeholder the loaded plugin made its own). */
  unregister(id: string) {
    this.manifests.delete(id);
  }

  list(): PluginManifest[] {
    return [...this.manifests.values()];
  }

  get(id: string): PluginManifest | undefined {
    return this.manifests.get(id);
  }

  getState(): PluginsState {
    const all = this.list();
    const installed = all.filter((m) => m.installed === true);
    const store = all.filter((m) => m.installed !== true);
    return {
      plugins: installed,
      store,
      pluginsDir: this.pluginsDir,
    };
  }
}
