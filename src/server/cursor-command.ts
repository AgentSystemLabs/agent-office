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
