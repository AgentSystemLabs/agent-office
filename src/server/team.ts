import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { TeamState } from '../shared/protocol.js';

// Installed by deploy/provision.sh. It edits the `office` user's authorized_keys (root-owned), so
// it re-runs itself with sudo; the office only ever passes it a validated name and key text.
const HELPER = process.env.AGENT_OFFICE_TEAM_HELPER || '/usr/local/bin/agent-office-team';
const TEAM_USER = 'office';
const GITHUB_USER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
/** deploy/aws.sh and deploy/azure.sh also accept other names, for keys invited from a file. */
const MEMBER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,38}$/;

interface Run {
  code: number;
  out: string;
  err: string;
}

function helper(args: string[], input = ''): Promise<Run> {
  return new Promise((resolve) => {
    const child = execFile(HELPER, args, { timeout: 15_000, encoding: 'utf8' }, (err, out, errOut) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException).code === 'number' ? Number((err as NodeJS.ErrnoException).code) : 1) : 0;
      resolve({ code, out, err: errOut.trim() || (err ? err.message : '') });
    });
    child.stdin?.on('error', () => {}); // the helper may exit before reading everything
    child.stdin?.end(input);
  });
}

/**
 * Who may open the SSH tunnel to this office, for offices set up with deploy/provision.sh (or
 * deploy/aws.sh). On one that's on a Tailscale network, Tailscale decides who gets in instead:
 * the panel then says how to share the machine there.
 */
export class Team {
  private fingerprint?: string;

  constructor(
    private publicHost: string | undefined,
    private port: number,
    private tailnet?: string,
  ) {}

  /** Invites work when the office knows its public address and the helper is installed. */
  get available(): boolean {
    return !!this.publicHost && existsSync(HELPER);
  }

  /**
   * Where teammates tunnel to, when invites work: user@host, or ssh://user@host:port when the
   * public address has a port of its own (Railway's TCP proxy in front of port 22, a Fly.io app's IP
   * address, or the port a Dokploy or Coolify server publishes it on).
   */
  get ssh(): string | undefined {
    if (!this.available) return undefined;
    const [, host, port] = /^([^:]+):(\d+)$/.exec(this.publicHost!) ?? [];
    return port && port !== '22' ? `ssh://${TEAM_USER}@${host}:${port}` : `${TEAM_USER}@${host ?? this.publicHost}`;
  }

  async state(): Promise<TeamState> {
    const base = { port: this.port, members: [], tailnet: this.tailnet };
    if (!this.available) {
      if (this.tailnet) return base;
      return { ...base, unavailable: 'Invites work on offices set up with deploy/provision.sh or deploy/aws.sh (run it again on one made before invites).' };
    }
    this.fingerprint ??= (await helper(['fingerprint'])).out.trim() || undefined;
    const list = await helper(['list']);
    if (list.code) return { ...base, ssh: this.ssh, fingerprint: this.fingerprint, error: `Couldn't list the team: ${list.err}` };
    const members = list.out
      .split('\n')
      .map((l) => l.trim().split(/\s+/))
      .filter((p) => p.length === 2 && p[0])
      .map(([name, keys]) => ({ name, keys: Number(keys) || 0 }));
    return { ...base, ssh: this.ssh, fingerprint: this.fingerprint, members };
  }

  /** Installs the SSH keys on github.com/<user>.keys, each limited to opening the tunnel. */
  async invite(github: string): Promise<{ name: string; keys: number } | { error: string }> {
    if (!this.available) return { error: 'Invites work on offices set up with deploy/provision.sh or deploy/aws.sh' };
    const user = github.trim().replace(/^@/, '');
    if (!GITHUB_USER.test(user)) return { error: `"${github}" isn't a GitHub username` };
    let text: string;
    try {
      const res = await fetch(`https://github.com/${user}.keys`, { signal: AbortSignal.timeout(10_000) });
      if (res.status === 404) return { error: `There's no GitHub user called ${user}` };
      if (!res.ok) return { error: `GitHub answered ${res.status} for ${user}'s keys — try again` };
      text = (await res.text()).slice(0, 64 * 1024);
    } catch (err) {
      return { error: `Couldn't reach GitHub: ${(err as Error).message}` };
    }
    if (!text.trim()) return { error: `${user} has no SSH keys on GitHub — they can add one at github.com/settings/keys` };
    const r = await helper(['add', user], text);
    if (r.code === 65) return { error: `None of ${user}'s GitHub keys are a type SSH accepts here` };
    if (r.code) return { error: `Couldn't add ${user}'s keys: ${r.err}` };
    return { name: user, keys: Number(r.out.trim()) || 0 };
  }

  /** Removes their keys. Open tunnels drop for everyone (they just re-run the command). */
  async remove(name: string): Promise<string | undefined> {
    if (!this.available) return 'Invites work on offices set up with deploy/provision.sh or deploy/aws.sh';
    if (!MEMBER.test(name)) return `"${name}" isn't a teammate name`;
    const r = await helper(['remove', name]);
    if (r.code === 66) return `${name} isn't invited`;
    if (r.code) return `Couldn't remove ${name}: ${r.err}`;
    return undefined;
  }
}
