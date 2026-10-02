import { spawn, type ChildProcess } from 'node:child_process';
import type { Office } from './office.js';

// The SSH half of `agent-office tunnel office@<address>`: localhost:<port> here to the office's
// port on its machine, the one thing an invited key may forward to. Everything else the client
// does goes through that one forward. A tunnel that drops (the laptop slept, the Wi-Fi changed)
// is opened again.

/** How often to look whether the office answers through a tunnel that's opening. */
const LOOK_MS = 300;
const RETRY_MS = 2000;
const MAX_RETRY_MS = 30_000;

/** The ssh arguments that forward localhost:<localPort> to the office's port on its machine. */
export function sshArgs(target: string, localPort: number, officePort: number, extra: string[] = []): string[] {
  return [
    '-N',
    '-o', 'ExitOnForwardFailure=yes',
    // Notices within a minute that the other end is gone, so the tunnel can be opened again.
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-L', `${localPort}:localhost:${officePort}`,
    ...extra,
    target,
  ];
}

export interface SshEvents {
  /** It was open and isn't any more; it's being opened again. */
  dropped(): void;
  /** Open again after dropping. */
  back(): void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class SshTunnel {
  private child?: ChildProcess;
  private stopped = false;

  constructor(
    private args: string[],
    /** The office at the local end of the tunnel. */
    private office: Office,
    private events: SshEvents,
  ) {}

  /**
   * Opens the tunnel and keeps it open. Resolves to why it couldn't be opened, or '' once the office
   * answers through it. ssh asks for a passphrase, or whether to trust the server, in the terminal.
   */
  async open(): Promise<string> {
    const err = await this.once();
    if (!err) void this.keep();
    return err;
  }

  stop() {
    this.stopped = true;
    this.child?.kill();
  }

  /** One ssh: '' once the office answers through it, or why it never did. */
  private once(): Promise<string> {
    return new Promise((resolve) => {
      let over = false;
      const child = spawn('ssh', this.args, { stdio: ['ignore', 'inherit', 'inherit'] });
      this.child = child;
      const finish = (err: string) => {
        if (over) return;
        over = true;
        resolve(err);
      };
      child.on('error', (err) => finish((err as NodeJS.ErrnoException).code === 'ENOENT' ? "ssh isn't installed on this computer" : `couldn't run ssh: ${err.message}`));
      child.on('exit', (code) => finish(`ssh couldn't open the tunnel${code ? ` (it exited with ${code})` : ''}`));
      void (async () => {
        while (!over && !(await this.office.up())) await sleep(LOOK_MS);
        finish('');
      })();
    });
  }

  /** Waits for the tunnel to drop, then opens it again, for as long as it takes. */
  private async keep() {
    for (let wait = RETRY_MS; !this.stopped; ) {
      await exited(this.child!);
      if (this.stopped) return;
      this.events.dropped();
      for (;;) {
        await sleep(wait);
        if (this.stopped) return;
        if (!(await this.once())) break;
        wait = Math.min(wait * 2, MAX_RETRY_MS);
      }
      if (this.stopped) return;
      wait = RETRY_MS;
      this.events.back();
    }
  }
}

function exited(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.once('error', () => resolve());
  });
}
