// Starting things for the workers: which shell, where a command is, how to run one without
// blocking the office, and the install's own bin/ scripts and the commands that run them.
import { accessSync, chmodSync, constants, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WIN = process.platform === 'win32';

/** A script in bin/ of the install this office runs from (src/server/workers under tsx, dist/server/server/workers built). */
export function binScript(name: string): string | undefined {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  // One level deeper than server/ itself, so five tries reach the same folders four did from there.
  for (let i = 0; i < 5; i++, dir = path.dirname(dir)) {
    const file = path.join(dir, 'bin', name);
    if (existsSync(file)) return file;
  }
  return undefined;
}

/** The shell workers get when none is configured: $SHELL on Unix, cmd.exe on Windows. */
export function defaultShell(): string {
  return process.env.SHELL || (WIN ? process.env.COMSPEC || 'cmd.exe' : '/bin/bash');
}

/** How to have the default shell run one command line. */
export function shellRun(line: string): string[] {
  return WIN && !process.env.SHELL ? ['/d', '/s', '/c', line] : ['-l', '-i', '-c', line];
}

export function resolveCommand(cmd: string): string | null {
  // Windows runs files by extension: `claude` is really claude.exe / claude.cmd. An npm shim with
  // no extension is a sh script the console can't run, so only take it when asked for by name.
  const exts = WIN && !path.extname(cmd) ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  const usable = (p: string): string | null => {
    for (const ext of exts) {
      try {
        accessSync(p + ext, constants.X_OK);
        return p + ext;
      } catch {
        // keep looking
      }
    }
    return null;
  };
  if (cmd.includes('/') || (WIN && cmd.includes('\\'))) {
    const found = usable(cmd);
    return found && path.resolve(found);
  }
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const found = usable(path.join(dir, cmd));
    if (found) return found;
  }
  if (WIN && !process.env.SHELL) return null;
  try {
    const found = execFileSync(defaultShell(), ['-l', '-i', '-c', `command -v ${shq(cmd)}`], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })
      .trim()
      .split('\n')
      .pop();
    if (found && found.startsWith('/')) return found;
  } catch {
    // fall through
  }
  return null;
}

/** Runs a command without blocking the office (with `env`: as someone else); rejects with the last lines of its stderr. */
export function run(cmd: string, args: string[], cwd: string, timeout = 30_000, env?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024, env }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim().split('\n').filter(Boolean).slice(-2).join(' ') || `${cmd} failed`));
      else resolve(stdout.trim());
    });
  });
}

export function shq(s: string) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Writes the office-queue and office-workers commands into the data dir's bin/, each running its
 * script in bin/ with the office's own node, and returns that directory. Rewritten on every start,
 * so after an upgrade they run the new install's scripts.
 */
export function writeOfficeCommands(dataDir: string): string | undefined {
  const dir = path.join(dataDir, 'bin');
  let wrote = false;
  for (const [name, what] of [['office-queue', "Agent Office's task queue, for the board agents"], ['office-workers', "Agent Office's workers, for every worker"]]) {
    const script = binScript(`${name}.js`);
    if (!script) continue;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, name);
    writeFileSync(file, `#!/bin/sh\n# ${what} (see bin/${name}.js).\nexec ${shq(process.execPath)} ${shq(script)} "$@"\n`, { mode: 0o700 });
    chmodSync(file, 0o700);
    // cmd.exe and PowerShell find it by PATHEXT; Git Bash (Claude Code's shell there) runs the sh one.
    if (WIN) writeFileSync(`${file}.cmd`, `@"${process.execPath}" "${script}" %*\r\n`);
    wrote = true;
  }
  return wrote ? dir : undefined;
}
