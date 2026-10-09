/** Native Windows Cursor executes hooks via a Windows shell, not POSIX sh. */
export function cursorHookCommand(args: string[], windows = process.platform === 'win32'): string {
  if (!windows) return args.map((s) => "'" + s.replaceAll("'", "'\"'\"'") + "'").join(' ');
  const script = '& ' + args.map((s) => "'" + s.replaceAll("'", "''") + "'").join(' ');
  return 'powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ' + Buffer.from(script, 'utf16le').toString('base64');
}

/** Read our encoded command only to identify entries during replacement/cleanup. */
export function readableHookCommand(command: string): string {
  const match = /^powershell\.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ([A-Za-z0-9+/=]+)$/.exec(command);
  return match ? Buffer.from(match[1], 'base64').toString('utf16le') : command;
}

/** Registration lives in the command so cleanup also works after an office restart. */
export function cursorHookWorkers(command: string): string[] | undefined {
  const script = readableHookCommand(command);
  if (!script.includes('agent-office-cursor-hook.cjs')) return undefined;
  return / '([A-Za-z0-9_-]+(?:,[A-Za-z0-9_-]+)*)'$/.exec(script)?.[1].split(',');
}

/** Change only the validated worker list; keep the executable, path and shell quoting intact. */
export function withCursorHookWorkers(command: string, workers: string[]): string {
  if (!cursorHookWorkers(command) || !workers.length || workers.some((id) => !/^[A-Za-z0-9_-]+$/.test(id))) throw new Error('Invalid Cursor hook registration');
  const script = readableHookCommand(command).replace(/ '[A-Za-z0-9_,\-]+'$/, ` '${workers.join(',')}'`);
  return command.startsWith('powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ')
    ? 'powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ' + Buffer.from(script, 'utf16le').toString('base64')
    : script;
}
