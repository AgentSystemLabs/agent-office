import { spawn } from 'node:child_process';

/**
 * Opens a page in this computer's browser. Not over SSH, in CI, or on a Linux box without a
 * desktop: nobody would see it there.
 */
export function openBrowser(url: string): boolean {
  if (process.env.SSH_CONNECTION || process.env.SSH_TTY || process.env.CI) return false;
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return false;
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true })
    .on('error', () => {})
    .unref();
  return true;
}
