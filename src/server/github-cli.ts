import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';

/** Find gh even when a Windows launcher still has the PATH from before its installation. */
export function findGitHubCli(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string | undefined {
  if (platform !== 'win32') return undefined;
  const variable = (name: string) => Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  const onPath = (variable('PATH') ?? '').split(';').filter(Boolean).map((dir) => path.join(dir.replace(/^"|"$/g, ''), 'gh.exe'));
  const installed: string[] = [];
  for (const name of ['ProgramFiles', 'ProgramFiles(x86)']) {
    const dir = variable(name);
    if (dir) installed.push(path.join(dir, 'GitHub CLI', 'gh.exe'));
  }
  const local = variable('LOCALAPPDATA');
  if (local) installed.push(path.join(local, 'Programs', 'GitHub CLI', 'gh.exe'), path.join(local, 'Microsoft', 'WinGet', 'Links', 'gh.exe'));
  for (const file of [...onPath, ...installed]) {
    try {
      if (!statSync(file).isFile()) continue;
      accessSync(file, constants.X_OK);
      return file;
    } catch {
      // An installation can disappear or a PATH entry can be inaccessible: try the next one.
    }
  }
  return undefined;
}

/** Keep normal command lookup on Unix and when no Windows installation was found. */
export function githubCli(env?: NodeJS.ProcessEnv): string {
  return findGitHubCli(env) ?? 'gh';
}
