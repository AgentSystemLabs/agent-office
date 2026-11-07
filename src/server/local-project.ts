import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

/** Resolves a path from the office machine to an existing directory, or explains what's wrong. */
export function localProjectDir(input: string): { dir: string } | string {
  const entered = input.trim();
  if (!path.isAbsolute(entered)) return 'Enter an absolute path on the office machine';
  try {
    const dir = realpathSync(entered);
    if (!statSync(dir).isDirectory()) return `${dir} is not a folder`;
    accessSync(dir, constants.R_OK | constants.W_OK | constants.X_OK);
    return { dir };
  } catch {
    return `${entered} does not exist or cannot be opened`;
  }
}
