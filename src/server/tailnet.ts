import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';

// On an office set up with `deploy/provision.sh --tailscale`, Tailscale Serve puts the office on
// https://<office>.ts.net for everyone on the tailnet. Each worker's web server gets its own port
// there too, https://<office>.ts.net:5173, which Serve also points at the office's port: the office
// checks the visitor is signed in and relays it by that port (relay.ts), like a service tunnel.
// Changing Tailscale's settings takes root, so this goes through a helper provision.sh installs
// (with a sudoers line) that only ever points a port at the office.
const HELPER = process.env.AGENT_OFFICE_SERVE_HELPER || '/usr/local/bin/agent-office-serve';
/** Long enough for the first scan of workers' servers to land, so a restart doesn't drop them for a moment. */
const FIRST_SYNC_MS = 10_000;

export class Tailnet {
  /** The ports Serve points at the office, as last set; null until the first sync. */
  private served: string | null = null;
  private wanted: number[] = [];
  private busy = false;
  private lastError = '';
  private timer?: NodeJS.Timeout;

  constructor(
    /** e.g. agent-office.tail1234.ts.net, or undefined when the office isn't on a tailnet. */
    readonly host: string | undefined,
  ) {}

  /** Once the workers' servers are known, drop ports a previous office left behind. */
  start(ports: () => number[]) {
    if (!this.host) return;
    this.timer = setTimeout(() => this.sync(ports()), FIRST_SYNC_MS);
    this.timer.unref();
  }

  stop() {
    clearTimeout(this.timer);
  }

  /** Serve exactly these workers' ports on the tailnet, and stop serving any others. */
  sync(ports: number[]) {
    if (!this.host || !existsSync(HELPER)) return;
    this.wanted = [...new Set(ports)].sort((a, b) => a - b);
    void this.flush();
  }

  private async flush() {
    if (this.busy) return;
    this.busy = true;
    try {
      // The list can change while the helper runs (each Serve change takes a moment).
      while (this.wanted.join(' ') !== this.served) {
        const want = this.wanted.join(' ');
        const err = await helper(['sync', ...this.wanted.map(String)]);
        if (err) {
          if (err !== this.lastError) console.warn(`[agent-office] couldn't serve workers' servers on the tailnet: ${err}`);
          this.lastError = err;
          break; // the next change tries again
        }
        this.lastError = '';
        this.served = want;
      }
    } finally {
      this.busy = false;
    }
  }
}

/** Runs the helper; resolves to its error, or '' when it worked. */
function helper(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(HELPER, args, { timeout: 60_000, encoding: 'utf8' }, (err, _out, errOut) => {
      resolve(err ? errOut.trim() || err.message : '');
    });
  });
}
