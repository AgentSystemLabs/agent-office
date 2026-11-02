// Finding the files a plugin ships: its settings page, and anything that page loads.
//
// A plugin brings its own settings UI as files in its own directory, which the office serves under
// /plugins/<id>/ (see http/routes/pages.ts). The office knows nothing about what they contain — that
// is what makes it generic: any plugin can bring its own settings, and one that brings none is never
// asked for.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { candidatePluginDirs, detectEntryPath } from './entry.js';

/** Where a plugin was loaded from, so its own files can be found next to it. */
export interface LoadedPlugin {
  id: string;
  /** The entry file it was loaded from, when it is a single file rather than a folder. */
  entry?: string;
  /** The file it names as its settings page, relative to itself. */
  settingsPage?: string;
}

/**
 * A path a plugin asks for, cleaned up and refused if it tries to leave the plugin's directory.
 *
 * Undefined for anything that isn't a plain relative name inside it: no plugin can make the office
 * serve a file from somewhere else.
 */
export function safePluginPath(relative: string): string | undefined {
  const page = relative.replace(/\\/g, '/').replace(/^\.\.?\//, '');
  if (!page || page.startsWith('/') || page.split('/').includes('..')) return undefined;
  return page;
}

/** A file inside `root`, wherever under it `from` is; never outside `root`. */
function fileUnder(from: string | undefined, root: string, rel: string): string | undefined {
  const at = from ? path.resolve(path.dirname(from), rel) : undefined;
  if (at && at.startsWith(root + path.sep) && existsSync(at)) return at;
  // A plugin's own files usually sit beside its built entry; they can also sit at the top of its
  // directory (with its package.json), which a build that cleans its output folder keeps.
  const top = path.resolve(root, rel);
  return top.startsWith(root + path.sep) && existsSync(top) ? top : undefined;
}

/**
 * Where a file the plugin ships is on disk, or undefined when it isn't one of the plugin's own.
 *
 * A plugin is found wherever it was loaded from: a folder of its own, or a single file the office was
 * pointed at, whose own files sit beside it.
 */
export function pluginFilePath(plugin: LoadedPlugin, pluginsDir: string, relative: string): string | undefined {
  const rel = safePluginPath(relative);
  if (!rel) return undefined;
  for (const dir of candidatePluginDirs(plugin.id, pluginsDir)) {
    if (!existsSync(dir)) continue;
    const root = path.resolve(dir);
    // Wherever the plugin's entry is (its built bundle), and the top of its directory.
    const found = fileUnder(detectEntryPath(dir) ?? undefined, root, rel);
    if (found) return found;
  }
  const loaded = plugin.entry ? (path.isAbsolute(plugin.entry) ? plugin.entry : path.resolve(process.cwd(), plugin.entry)) : undefined;
  if (loaded && existsSync(loaded) && path.extname(loaded)) return fileUnder(loaded, path.dirname(path.resolve(loaded)), rel);
  return undefined;
}

/** Where the plugin's own settings page is, when it ships one; otherwise undefined. */
export function pluginSettingsPagePath(plugin: LoadedPlugin, pluginsDir: string): string | undefined {
  return plugin.settingsPage ? pluginFilePath(plugin, pluginsDir, plugin.settingsPage) : undefined;
}
