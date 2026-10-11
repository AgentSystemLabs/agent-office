import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
export interface DevApkConfig {
  repo: string;
  sourceDir: string;
  buildDir: string;
  ref: string;
  apkName: string;
  launcher?: string;
  builders?: string[];
}
export class BuildError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function configFor(dataDir: string, repo: string | undefined): DevApkConfig | undefined {
  const file = path.join(dataDir, 'dev-apk.json');
  if (!repo || !existsSync(file)) return;
  const configs = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')).projects;
  if (!Array.isArray(configs)) throw new BuildError('Dev-APK-Konfiguration ist ungültig.', 503);
  const c = configs.find(c => c.repo?.toLowerCase() === repo.toLowerCase());
  if (!c) return;
  if (!path.isAbsolute(c.sourceDir ?? '') || !path.isAbsolute(c.buildDir ?? '') ||
    !/^origin\/[a-zA-Z0-9][a-zA-Z0-9._/-]{0,180}$/.test(c.ref ?? '') || c.ref.includes('..') ||
    !/^[a-zA-Z0-9_-]+\.apk$/.test(c.apkName ?? '') || (c.launcher && !path.isAbsolute(c.launcher)) ||
    (c.builders !== undefined && (!Array.isArray(c.builders) || c.builders.some((b: unknown) => typeof b !== 'string')))) throw new BuildError('Dev-APK-Konfiguration prüfen: absolute Ordner und gültiger origin-Branch erforderlich.', 503);
  const source = path.resolve(c.sourceDir), build = path.resolve(c.buildDir);
  const relative = path.relative(build, source);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw new BuildError('Build-Ordner darf den Quellordner nicht enthalten.', 503);
  return { ...c, sourceDir: source, buildDir: build };
}
