import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FloorDef } from '../building.js';
import type { Floor } from '../floor.js';
import type { FloorInfo, GhIssue, GhPull, PluginManifest, PluginsState, ServiceInfo, WorkerInfo } from '../../shared/protocol.js';
import type { Ctx } from '../office/context.js';
import { PluginRegistry } from './registry.js';
import { candidatePluginDirs, candidatePluginFiles, detectEntryPath, parseGitUrl, getPluginDir, resolvePluginEntry, fetchLatestRelease } from './entry.js';
import { pluginFilePath, pluginSettingsPagePath } from './plugin-files.js';
import type { AgentProviderPlugin, BoardAdapter, FloorProvider, IssuesAdapter, OfficePlugin, ProjectConfig, ProjectsProvider, PullsAdapter, QueueAdapter, ServicesProvider } from './types.js';
import type { AgentProvider } from '../../shared/providers.js';
import { PROVIDER_META, registerAgentProvider, unregisterAgentProvider } from '../../shared/providers.js';
import { registerAgentProviderAdapter, unregisterAgentProviderAdapter } from '../providers/index.js';


export class PluginManager {
  private registry: PluginRegistry;
  private plugins: Map<string, OfficePlugin> = new Map();
  public ctx?: Ctx;

  constructor(projectsDir?: string) {
    this.registry = new PluginRegistry(projectsDir);
  }

  async install(id: string): Promise<boolean> {
    const manifest = this.registry.get(id);
    if (!manifest) return false;

    let entryPath = resolvePluginEntry(manifest.id, this.registry.pluginsDir, (manifest as any).entry);
    if (!entryPath && manifest.githubUrl) {
      const cloneRes = await this.installFromGit(manifest.githubUrl);
      if (!cloneRes.ok) {
        manifest.status = 'error'; manifest.error = cloneRes.error ?? 'Git clone failed';
        this.registry.save(); return false;
      }
      entryPath = resolvePluginEntry(manifest.id, this.registry.pluginsDir, (manifest as any).entry);
    }

    if (!entryPath && this.ctx) {
      manifest.status = 'error'; manifest.error = `Plugin entry not found for ${manifest.id}`;
      this.registry.save(); return false;
    }

    manifest.installed = true;
    (manifest as any).enabled = true;
    manifest.status = 'active';
    if (this.ctx) {
      const loaded = await this.loadPlugin(manifest, this.ctx);
      if (!loaded) {
        manifest.installed = false; (manifest as any).enabled = false; manifest.status = 'error';
        this.registry.save(); return false;
      }
    }
    this.registry.save();
    return true;
  }

  async uninstall(id: string): Promise<boolean> {
    const manifest = this.registry.get(id);
    if (!manifest) return false;
    manifest.installed = false;
    (manifest as any).enabled = false;
    manifest.status = 'inactive';
    this.registry.save();
    const plugin = this.plugins.get(id);
    if (plugin) {
      if (plugin.agentProvider) {
        this.unregisterAgentProvider(plugin.agentProvider.id);
      }
      try {
        await plugin.shutdown?.();
      } catch {
        /* ignore */
      }
      this.plugins.delete(id);
    }
    return true;
  }

  async installFromGit(url: string): Promise<{ ok: boolean; id?: string; error?: string }> {
    const parsed = parseGitUrl(url);
    if (!parsed) return { ok: false, error: 'Invalid Git URL' };
    const { id, cloneUrl } = parsed;
    const pluginDir = getPluginDir(id, this.registry.pluginsDir);
    if (existsSync(pluginDir)) return { ok: false, error: `Plugin "${id}" is already installed` };
    mkdirSync(pluginDir, { recursive: true });
    try {
      execFileSync('git', ['clone', '--depth', '1', '--', cloneUrl, pluginDir], { stdio: 'pipe', timeout: 60_000 });
    } catch (err) {
      rmSync(pluginDir, { recursive: true, force: true });
      return { ok: false, error: `Git clone failed: ${(err as Error).message}` };
    }
    const entryPath = detectEntryPath(pluginDir);
    if (!entryPath) {
      rmSync(pluginDir, { recursive: true, force: true });
      return { ok: false, error: `Plugin entry not found in ${pluginDir}` };
    }
    const manifest: PluginManifest = {
      id,
      name: id,
      description: `Installed from ${cloneUrl}`,
      capabilities: [],
      installed: true,
      status: 'active',
      local: true,
    };
    this.registry.register(manifest);
    this.registry.save();
    if (this.ctx) {
      await this.loadPlugin(manifest, this.ctx);
    }
    return { ok: true, id };
  }

  async updatePlugin(id: string): Promise<{ ok: boolean; error?: string }> {
    const pluginDir = getPluginDir(id, this.registry.pluginsDir);
    if (!existsSync(pluginDir)) return { ok: false, error: `Plugin "${id}" is not installed from Git` };
    try {
      execFileSync('git', ['pull'], { cwd: pluginDir, stdio: 'pipe', timeout: 30_000 });
    } catch (err) {
      return { ok: false, error: `Git pull failed: ${(err as Error).message}` };
    }
    const manifest = this.registry.get(id);
    if (manifest && this.ctx) {
      const plugin = this.plugins.get(id);
      if (plugin) {
        try {
          await plugin.shutdown?.();
        } catch {
          /* ignore */
        }
        this.plugins.delete(id);
      }
      await this.loadPlugin(manifest, this.ctx);
    }
    return { ok: true };
  }

  async checkUpdates(): Promise<void> {
    const installed = this.registry.list().filter((m) => m.installed === true);
    await Promise.all(
      installed.map(async (m) => {
        if (!m.githubUrl) {
          if (!m.version) m.version = 'local';
          m.latestVersion = undefined;
          m.updateAvailable = false;
          return;
        }
        const latest = await fetchLatestRelease(m.githubUrl);
        if (latest) {
          m.latestVersion = latest;
          m.updateAvailable = m.version !== latest;
        }
      }),
    );
  }

  openFolder(id?: string): void {
    let targetDir = this.registry.pluginsDir;
    if (id) {
      for (const dir of candidatePluginDirs(id, this.registry.pluginsDir)) {
        if (existsSync(dir)) {
          targetDir = dir;
          break;
        }
      }
      if (targetDir === this.registry.pluginsDir) {
        const parentContainers = [
          path.resolve(process.cwd(), '..', 'agent-office-plugins'),
          path.resolve(process.cwd(), 'agent-office-plugins'),
        ];
        for (const parent of parentContainers) {
          if (existsSync(parent)) {
            try {
              const entries = readdirSync(parent, { withFileTypes: true });
              for (const entry of entries) {
                if (entry.isDirectory()) {
                  const candidate = path.join(parent, entry.name);
                  if (entry.name.toLowerCase().includes(id.toLowerCase())) {
                    targetDir = candidate;
                    break;
                  }
                  const pkgPath = path.join(candidate, 'package.json');
                  if (existsSync(pkgPath)) {
                    try {
                      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
                      if (pkg.name?.toLowerCase().includes(id.toLowerCase())) {
                        targetDir = candidate;
                        break;
                      }
                    } catch {}
                  }
                }
              }
              if (targetDir !== this.registry.pluginsDir) break;
            } catch {}
          }
        }
      }
      if (targetDir === this.registry.pluginsDir) {
        for (const file of candidatePluginFiles(id, this.registry.pluginsDir)) {
          if (existsSync(file)) {
            targetDir = path.dirname(file);
            break;
          }
        }
      }
    } else {
      const fallbackDirs = [
        path.resolve(process.cwd(), '..', 'agent-office-plugins'),
        path.resolve(process.cwd(), 'agent-office-plugins'),
        this.registry.pluginsDir,
      ];
      targetDir = fallbackDirs.find((d) => existsSync(d)) || targetDir;
    }
    if (!existsSync(targetDir)) {
      try {
        mkdirSync(targetDir, { recursive: true });
      } catch {
        /* ignore */
      }
    }
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    execFile(cmd, [targetDir], () => {});
  }

  async loadPlugin(manifest: PluginManifest, ctx: Ctx): Promise<OfficePlugin | null> {
    const entryPath = resolvePluginEntry(manifest.id, this.registry.pluginsDir, (manifest as any).entry);
    if (!entryPath) {
      manifest.status = 'error';
      manifest.error = `Plugin entry not found for ${manifest.id}`;
      return null;
    }
    try {
      const fileUrl = pathToFileURL(entryPath).href;
      const mod = await import(fileUrl);
      const factory = mod.createPlugin || mod.default || mod;
      const plugin: OfficePlugin = typeof factory === 'function' ? factory() : factory;
      if (plugin && plugin.manifest) {
        manifest.status = 'active';
        manifest.capabilities = plugin.manifest.capabilities ?? manifest.capabilities;
        manifest.name = plugin.manifest.name ?? manifest.name;
        manifest.description = plugin.manifest.description ?? manifest.description;
        manifest.version = plugin.manifest.version ?? manifest.version;
        manifest.author = plugin.manifest.author ?? manifest.author;
        manifest.githubUrl = plugin.manifest.githubUrl ?? manifest.githubUrl;
        manifest.settingsPage = plugin.manifest.settingsPage ?? manifest.settingsPage;
        this.plugins.set(manifest.id, plugin);
        if (plugin.manifest.id) {
          this.plugins.set(plugin.manifest.id, plugin);
          // The plugin may name itself differently from the id the office filed it under; the rest of
          // the office (and Settings) addresses it by the name it gives itself.
          const own = plugin.manifest.id;
          const regItem = this.registry.get(own);
          if (regItem && regItem !== manifest) {
            regItem.status = 'active';
            regItem.installed = true;
            (regItem as { entry?: string }).entry = (manifest as { entry?: string }).entry;
            regItem.version = plugin.manifest.version ?? regItem.version;
            regItem.author = plugin.manifest.author ?? regItem.author;
            regItem.githubUrl = plugin.manifest.githubUrl ?? regItem.githubUrl;
            regItem.settingsPage = plugin.manifest.settingsPage ?? regItem.settingsPage;
          } else if (!regItem) {
            this.registry.register({
              ...plugin.manifest,
              installed: true,
              status: 'active',
              entry: (manifest as { entry?: string }).entry,
              local: true,
            } as PluginManifest);
          }
          // The id it was filed under by its file name is not who it is now that the plugin has said:
          // that placeholder goes, so Settings shows the plugin's own card and nothing beside it.
          if (manifest.id !== own && manifest.local) this.registry.unregister(manifest.id);
        }
        await plugin.init?.(ctx);
        return plugin;
      }
    } catch (err) {
      manifest.status = 'error';
      manifest.error = (err as Error).message;
      console.error(`Failed to load plugin ${manifest.id}:`, err);
    }
    return null;
  }

  async init(ctx: Ctx) {
    this.ctx = ctx;

    const envPlugin = process.env.AGENT_OFFICE_PLUGIN;
    if (envPlugin && existsSync(envPlugin)) {
      const id = path.basename(envPlugin, path.extname(envPlugin));
      const existing = this.registry.get(id);
      if (existing) {
        existing.installed = true;
        (existing as any).entry = envPlugin;
      } else {
        this.registry.register({
          id,
          name: id,
          description: `Plugin loaded from ${envPlugin}`,
          capabilities: [],
          installed: true,
          status: 'active',
          local: true,
          entry: envPlugin,
        } as any);
      }
      // The plugin may name itself differently (its `manifest.id`); loadPlugin also registers that
      // one, so Settings and the rest address it by the name it gives itself.
    }

    for (const manifest of this.registry.list()) {
      if (manifest.installed) {
        await this.loadPlugin(manifest, ctx);
      }
    }

    // One plugin can be filed under more than one id (its own, and the one the office knew it by);
    // each plugin is registered once, whatever it is called here.
    for (const plugin of new Set(this.plugins.values())) {
      if (plugin.agentProvider) {
        this.registerAgentProvider(plugin.agentProvider);
      }
    }
  }

  private registerAgentProvider(agentProvider: AgentProviderPlugin): void {
    const { id, meta, adapter } = agentProvider;
    if (PROVIDER_META[id as AgentProvider]) {
      console.warn(`Agent provider "${id}" already registered, skipping plugin provider`);
      return;
    }
    registerAgentProvider(id, meta);
    registerAgentProviderAdapter(id, adapter);
  }

  private unregisterAgentProvider(id: string): void {
    unregisterAgentProvider(id);
    unregisterAgentProviderAdapter(id);
  }

  async shutdown() {
    for (const p of this.plugins.values()) {
      try {
        await p.shutdown?.();
      } catch {
      }
    }
    this.plugins.clear();
  }

  /** Where a plugin's settings page is on disk, when it ships one (see plugin-files.ts). */
  settingsPagePath(id: string): string | undefined {
    const m = this.registry.get(id);
    return m ? pluginSettingsPagePath(m, this.registry.pluginsDir) : undefined;
  }

  /** Where a file a plugin ships is, for serving it under /plugins/<id>/; never outside its directory. */
  settingsPagePathOf(id: string, relative: string): string | undefined {
    const m = this.registry.get(id);
    return m ? pluginFilePath(m, this.registry.pluginsDir, relative) : undefined;
  }

  /** Whether the office has a loaded plugin by that id. */
  has(id: string): boolean {
    return this.plugins.has(id);
  }

  getFloorProvider(): FloorProvider | null {
    for (const p of this.plugins.values()) {
      if (p.floorProvider) return p.floorProvider;
    }
    return null;
  }

  getIssuesAdapter(): IssuesAdapter | null {
    const adapters = [...new Set([...this.plugins.values()].map((p) => p.issuesAdapter))].filter(Boolean) as IssuesAdapter[];
    if (!adapters.length) return null;
    if (adapters.length === 1) return adapters[0];
    return {
      async listIssues(floor: Floor) {
        const results = await Promise.allSettled(adapters.map((a) => a.listIssues(floor)));
        const all: GhIssue[] = [];
        for (const r of results) {
          if (r.status === 'fulfilled' && Array.isArray(r.value)) {
            all.push(...r.value);
          }
        }
        return all;
      },
      async issueDetail(floor: Floor, n: number, me?: string) {
        for (const a of adapters) {
          if (a.issueDetail) {
            const res = await a.issueDetail(floor, n, me);
            if (res) return res;
          }
        }
        return null;
      },
    };
  }

  getPullsAdapter(): PullsAdapter | null {
    const adapters = [...new Set([...this.plugins.values()].map((p) => p.pullsAdapter))].filter(Boolean) as PullsAdapter[];
    if (!adapters.length) return null;
    if (adapters.length === 1) return adapters[0];
    return {
      async listPulls(floor: Floor) {
        const results = await Promise.allSettled(adapters.map((a) => a.listPulls(floor)));
        const all: GhPull[] = [];
        for (const r of results) {
          if (r.status === 'fulfilled' && Array.isArray(r.value)) {
            all.push(...r.value);
          }
        }
        return all;
      },
      async pullDetail(floor: Floor, n: number, me?: string) {
        for (const a of adapters) {
          if (a.pullDetail) {
            const res = await a.pullDetail(floor, n, me);
            if (res) return res;
          }
        }
        return null;
      },
      async pullDiff(floor: Floor, n: number) {
        for (const a of adapters) {
          if (a.pullDiff) {
            const res = await a.pullDiff(floor, n);
            if (res !== null && res !== undefined) return res;
          }
        }
        return null;
      },
    };
  }

  getQueueAdapter(): QueueAdapter | null {
    for (const p of this.plugins.values()) {
      if (p.queueAdapter) return p.queueAdapter;
    }
    return null;
  }

  getServicesProvider(): ServicesProvider | null {
    for (const p of this.plugins.values()) {
      if (p.servicesProvider) return p.servicesProvider;
    }
    return null;
  }

  listBoardAdapters(): BoardAdapter[] {
    return [...this.plugins.values()].flatMap((p) => p.boardAdapters || []);
  }

  getBoardAdapter(boardId: string): BoardAdapter | null {
    return this.listBoardAdapters().find((a) => a.getBoardDef().id === boardId) ?? null;
  }

  decorateFloor(floor: Floor, info: FloorInfo): void {
    for (const p of this.plugins.values()) {
      p.floorProvider?.decorateFloorInfo?.(floor, info);
    }
  }

  sortFloors(floors: FloorInfo[]): FloorInfo[] {
    const provider = this.getFloorProvider();
    if (provider?.sortFloors) {
      return provider.sortFloors(floors);
    }
    return floors;
  }

  async listFloorDefs(): Promise<FloorDef[] | null> {
    const provider = this.getFloorProvider();
    if (provider) {
      return await provider.listFloors();
    }
    return null;
  }

  async createFloor(req: { repo?: string; dir?: string }): Promise<{ repo: string; dir: string; name: string } | null> {
    const provider = this.getFloorProvider();
    if (provider?.createFloor) {
      return await provider.createFloor(req);
    }
    return null;
  }

  async listServices(floor: Floor): Promise<ServiceInfo[] | null> {
    const provider = this.getServicesProvider();
    if (provider) {
      return await provider.listServices(floor);
    }
    return null;
  }

  async startService(floor: Floor | undefined, serviceName?: string): Promise<boolean> {
    const provider = this.getServicesProvider();
    if (!provider?.startService || !floor) return false;
    try {
      await provider.startService(floor, serviceName);
      return true;
    } catch {
      return false;
    }
  }

  async stopService(floor: Floor | undefined, serviceName?: string): Promise<boolean> {
    const provider = this.getServicesProvider();
    if (!provider?.stopService || !floor) return false;
    try {
      await provider.stopService(floor, serviceName);
      return true;
    } catch {
      return false;
    }
  }

  async getServiceLogs(floor: Floor | undefined, serviceName?: string, lines?: number): Promise<string[]> {
    const provider = this.getServicesProvider();
    if (!provider?.getServiceLogs || !floor) return [];
    try {
      return (await provider.getServiceLogs(floor, serviceName, lines)) ?? [];
    } catch {
      return [];
    }
  }

  getProjectsProvider(floor?: Floor): ProjectsProvider | null {
    for (const p of this.plugins.values()) {
      if (p.projectsProvider) return p.projectsProvider;
    }
    return null;
  }

  /**
   * The projects a plugin's provider lists for a floor, or null when no plugin has one there.
   *
   * A plugin can bring its own settings UI (see settingsPage) and this is how that page asks: the
   * office holds the seam, the plugin holds the list.
   */
  async listPluginProjects(id: string, floor: Floor | undefined): Promise<ProjectConfig[] | null> {
    const provider = floor && this.plugins.get(id)?.projectsProvider;
    if (!provider || !floor) return null;
    try {
      return (await provider.listProjects?.(floor)) ?? null;
    } catch {
      return null;
    }
  }

  /** Hands a floor's projects to the plugin that lists them; says whether one took them. */
  async savePluginProjects(id: string, floor: Floor | undefined, projects: ProjectConfig[]): Promise<boolean> {
    const provider = floor && this.plugins.get(id)?.projectsProvider;
    if (!provider?.saveProjects || !floor) return false;
    try {
      await provider.saveProjects(floor, projects);
      return true;
    } catch {
      return false;
    }
  }

  getState(): PluginsState {
    const all = this.registry.getState();
    const installed = all.plugins.map((m) => {
      const active = this.plugins.has(m.id);
      const plugin = this.plugins.get(m.id);
      return {
        ...m,
        installed: true,
        version: plugin?.manifest?.version ?? m.version,
        author: plugin?.manifest?.author ?? m.author,
        settingsPage: plugin?.manifest?.settingsPage ?? m.settingsPage,
        agentProviderMeta: plugin?.agentProvider?.meta,
        status: (m.status === 'error' ? 'error' : active ? 'active' : 'inactive') as 'active' | 'inactive' | 'error',
      };
    });
    const store = (all.store ?? []).map((m) => {
      const plugin = this.plugins.get(m.id);
      return {
        ...m,
        version: plugin?.manifest?.version ?? m.version,
        author: plugin?.manifest?.author ?? m.author,
        settingsPage: plugin?.manifest?.settingsPage ?? m.settingsPage,
        installed: false,
        status: 'inactive' as const,
      };
    });
    return { plugins: installed, store, pluginsDir: this.registry.pluginsDir };
  }
}
