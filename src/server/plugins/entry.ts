// Where a plugin is, and where its own files are: its entry, and the folder holding them.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Where a plugin's entry can be, in a folder of its own: its built bundle first. */
export const ENTRY_CANDIDATES = ['dist/index.js', 'index.js', 'plugin.js', 'dist/index.mjs', 'index.mjs'];

export function candidatePluginDirs(id: string, registryPluginsDir?: string): string[] {
  return [path.join(process.cwd(), '.agent-office', 'plugins', id), registryPluginsDir ? path.join(registryPluginsDir, id) : null, path.resolve(process.cwd(), '..', 'agent-office-plugins', `agentoffice-${id}`), path.resolve(process.cwd(), '..', 'agent-office-plugins', `${id}-plugin-for-agent-office`), path.resolve(process.cwd(), '..', 'agent-office-plugins', `agent-office-plugin-${id}`), path.resolve(process.cwd(), '..', 'agent-office-plugins', id), path.resolve(process.cwd(), 'agent-office-plugins', `agentoffice-${id}`), path.resolve(process.cwd(), 'agent-office-plugins', `${id}-plugin-for-agent-office`), path.resolve(process.cwd(), 'agent-office-plugins', `agent-office-plugin-${id}`), path.resolve(process.cwd(), 'agent-office-plugins', id)].filter(Boolean) as string[];
}

export function candidatePluginFiles(id: string, registryPluginsDir?: string): string[] {
  return [path.join(process.cwd(), `${id}.js`), registryPluginsDir ? path.join(registryPluginsDir, `${id}.js`) : null, registryPluginsDir ? path.join(registryPluginsDir, `${id}.mjs`) : null].filter(Boolean) as string[];
}

export function detectEntryPath(pluginDir: string): string | null {
  for (const candidate of ENTRY_CANDIDATES) {
    const p = path.join(pluginDir, candidate);
    if (existsSync(p)) return p;
  }
  const pkgPath = path.join(pluginDir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { main?: string; module?: string };
      const entry = pkg.main || pkg.module;
      if (entry) {
        const p = path.join(pluginDir, entry);
        if (existsSync(p)) return p;
      }
    } catch {}
  }
  return null;
}

export function parseGitUrl(url: string): { id: string; cloneUrl: string } | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const ALLOWED_PROTOCOLS = ['https:', 'http:', 'git:', 'ssh:'];
  try {
    const parsedUrl = new URL(trimmed);
    if (!ALLOWED_PROTOCOLS.includes(parsedUrl.protocol)) return null;
  } catch {
    if (!trimmed.includes('@') && !trimmed.startsWith('git://')) return null;
  }

  let cloneUrl = trimmed;
  if (cloneUrl.startsWith('-')) return null;
  if (cloneUrl.endsWith('/')) cloneUrl = cloneUrl.slice(0, -1);
  if (!cloneUrl.endsWith('.git')) cloneUrl += '.git';
  const match = /([^/]+?)(?:\.git)?$/.exec(cloneUrl);
  if (!match) return null;
  const id = match[1].toLowerCase().replace(/[^a-z0-9-_]/g, '-');
  return { id, cloneUrl };
}

export function getPluginDir(id: string, pluginsDir?: string): string {
  return path.join(pluginsDir ?? path.join(process.cwd(), '.agent-office', 'plugins'), id);
}

export function resolvePluginEntry(id: string, registryPluginsDir?: string, explicitEntry?: string): string | null {
  if (explicitEntry) {
    const resolved = path.isAbsolute(explicitEntry) ? explicitEntry : path.resolve(process.cwd(), explicitEntry);
    if (existsSync(resolved)) return resolved;
    if (registryPluginsDir) {
      const inReg = path.resolve(registryPluginsDir, path.basename(explicitEntry));
      if (existsSync(inReg)) return inReg;
    }
  }

  for (const dir of candidatePluginDirs(id, registryPluginsDir)) {
    if (existsSync(dir)) {
      const entry = detectEntryPath(dir);
      if (entry) return entry;
    }
  }

  for (const file of candidatePluginFiles(id, registryPluginsDir)) {
    if (existsSync(file)) return file;
  }

  return null;
}

export async function fetchLatestRelease(githubUrl: string): Promise<string | null> {
  try {
    const match = /github\.com\/([^/]+)\/([^/]+)/.exec(githubUrl);
    if (!match) return null;
    const [, owner, repo] = match;
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    const res = await fetch(apiUrl, { headers: { Accept: 'application/vnd.github.v3+json' } });
    if (!res.ok) return null;
    const data = (await res.json()) as { tag_name?: string };
    return data.tag_name ?? null;
  } catch {
    return null;
  }
}
