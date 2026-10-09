# Run it on a server for your team

Any Ubuntu or Debian server, with one line, or set up by hand behind Caddy or nginx. Back to the [README](../README.md).

Run this on any Ubuntu or Debian server, as root or as a user with sudo:

```bash
curl -fsSL https://raw.githubusercontent.com/AgentSystemLabs/agent-office/main/deploy/provision.sh | bash
```

Or run it from your computer without logging in first: `ssh root@203.0.113.7 'curl -fsSL https://raw.githubusercontent.com/AgentSystemLabs/agent-office/main/deploy/provision.sh | bash'`.

It takes a few minutes the first time:

1. Installs Node.js 22, git, the GitHub CLI and **Claude Code**. Run as root, it creates an `agentoffice` user and runs the office as that user, so workers never run as root.
2. Clones agent-office into `/opt/agent-office` and runs it under systemd. `Restart=always` brings it back after a crash or a reboot, and `KillMode=process` keeps workers running through a restart. It listens on `127.0.0.1:4600` only. The office keeps its data in `~/agent-office` and clones projects into `~/workspace/<owner>/<repo>`.
3. Sets up **👥 Invite teammates**. Teammates' SSH keys log in as a separate `office` user that can only forward to the office port: no shell, no other ports.
4. Offers to sign the GitHub CLI in, if it's running in a terminal.
5. Prints how to get in:

```
  On your computer, open a tunnel and leave it running:

    ssh -N -L 4600:localhost:4600 root@203.0.113.7

  then open http://localhost:4600/claim?t=…
  It shows the office password once: write it down.
```

Everything goes through SSH, so there are no certificates to manage, and `localhost` counts as a secure origin, so voice and screen sharing work. Claude signs in from the office: the first worker asks you to type `/login` in its terminal. If GitHub isn't signed in yet, run `gh auth login` from a shell at any desk (**B**). Do both while you're in on the office password: those are the machine's own sign-ins. Teammates you give [accounts](../README.md#add-users) sign in to their own Claude and GitHub in **☰ → 🔐 Your sign-ins**, and their workers run on their own plan. To update, run the same line again, or use **⬆️ Upgrade the office** in the **☰** menu. Options go after `bash -s --`: `--project owner/repo` clones a first floor, and `--help` lists the rest.

**On your own domain.** Point a DNS record at the server, open ports 80 and 443, and add `--domain`:

```bash
curl -fsSL https://raw.githubusercontent.com/AgentSystemLabs/agent-office/main/deploy/provision.sh | bash -s -- --domain office.example.com
```

It installs [Caddy](https://caddyserver.com), which gets a certificate from Let's Encrypt by itself and serves the office on https://office.example.com. The claim link is then `https://office.example.com/claim?t=…`. Give teammates an invite link each from **🔑 Accounts**.

**On your Tailscale network.** No domain, and no ports to open: add `--tailscale`, and the server joins your tailnet and serves the office on `https://agent-office.<your-tailnet>.ts.net` with [Tailscale Serve](https://tailscale.com/kb/1312/serve), which brings its own certificate:

```bash
curl -fsSL https://raw.githubusercontent.com/AgentSystemLabs/agent-office/main/deploy/provision.sh | bash -s -- --tailscale
```

It prints a link to add the machine to your tailnet (or pass `--tailscale-auth-key tskey-auth-…`), and the first time, one that turns on MagicDNS and HTTPS Certificates for the tailnet. It waits for each. `--tailscale-hostname` names the machine (`agent-office` by default). Then anyone on your tailnet opens the link, and workers' web servers get links of their own, `https://agent-office.<your-tailnet>.ts.net:<port>`, still behind the office sign-in. For someone outside your tailnet, share the machine with them from Tailscale's Machines page. Re-running the script keeps it on the tailnet. Turn off key expiry for the machine on that page, or it drops off after 180 days. The details, and what else the tailnet can reach on the machine, are in the [AWS reference](aws.md#tailscale), since `deploy/aws.sh up --tailscale` does the same thing.

**Setting it up by hand** (another distribution, or your own proxy): run `agent-office`, which listens on `127.0.0.1` only, and reach it through `ssh -L 4600:localhost:4600 you@server`. Or put it behind HTTPS on a domain, which voice and screen sharing need, with Caddy:

```caddy
# /etc/caddy/Caddyfile
office.example.com {
    reverse_proxy 127.0.0.1:4600
}
```

```bash
agent-office setup --projects ~/workspace --project owner/repo   # once; or pick projects in the office
agent-office --host 127.0.0.1 --trust-proxy --password "$(openssl rand -base64 18)"
```

Caddy proxies WebSockets out of the box. With nginx, forward the Host and Upgrade headers:

```nginx
location / {
    proxy_pass http://127.0.0.1:4600;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 1d;
}
```

To keep the office running, use a systemd unit:

```ini
# /etc/systemd/system/agent-office.service
[Unit]
Description=Agent Office
After=network.target

[Service]
User=dev
WorkingDirectory=/home/dev
# generate with: openssl rand -base64 24
Environment=AGENT_OFFICE_PASSWORD=<a long random password>
ExecStart=/usr/bin/env agent-office --host 127.0.0.1 --trust-proxy
Restart=on-failure
# Restarting the office leaves the workers' terminals running for the next one to pick up.
KillMode=process

[Install]
WantedBy=multi-user.target
```

If you don't have a domain, `--self-signed` serves HTTPS directly. Browsers will warn once per person.

**Voice across strict NATs.** Peers connect directly using public STUN. If some teammates can't hear each other (common on corporate networks), run a TURN server such as coturn and pass `--turn turn:user:pass@turn.example.com:3478`, or set `AGENT_OFFICE_TURN` (several separated by spaces), which is how an office in a container (Railway, Fly.io, Dokploy) gets one. When a call can't connect at all, the office says so in a toast instead of leaving people talking to silence.

## Publish an office running on your PC

The office and its workers can stay on your PC while a public Linux server handles HTTPS. The path is browser → nginx on the server → SSH reverse tunnel → `127.0.0.1:4600` on the PC. Your PC must remain awake, online and running the office. Hosting the entire office on the server instead removes that dependency; a private VPN is another option when public access is unnecessary.

1. Point an A record such as `office.example.com` at the server. With Cloudflare, start with **DNS only** until the origin certificate works. Do not add an AAAA record unless the server also serves this site over IPv6.
2. Run the office on the PC with `--host 127.0.0.1 --trust-proxy --no-open`. Keep using its existing `--home` so projects and accounts survive. Supply the office password privately through `AGENT_OFFICE_PASSWORD`, not a checked-in script. An environment/CLI password overrides the stored verifier for that run; keep the same private setting on subsequent starts.
3. Create a dedicated SSH key and a server account for forwarding. Pin the server host key after verifying it through an existing trusted connection. The account should have no interactive shell. Restrict its key with `restrict,port-forwarding,permitlisten="127.0.0.1:14600",command="/bin/false"` before the public key, and add this server configuration:

   ```sshconfig
   Match User office-tunnel
       AuthenticationMethods publickey
       PasswordAuthentication no
       KbdInteractiveAuthentication no
       AllowTcpForwarding remote
       GatewayPorts no
       PermitListen 127.0.0.1:14600
       AllowAgentForwarding no
       X11Forwarding no
       PermitTTY no
   Match all
   ```

   Validate with `sshd -t` before reloading SSH. From the PC, start:

   ```sh
   ssh -N -T -i /path/to/tunnel-key -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -R 127.0.0.1:14600:127.0.0.1:4600 office-tunnel@server.example.com
   ```

   Keep port 14600 bound to loopback. Do not open it in the firewall. A supervisor should restart SSH after it exits, with a delay, and start both the office and tunnel at login or boot. On Windows, use hidden PowerShell processes and Task Scheduler; a login trigger requires the user to sign in after reboot. Check task execution under the actual logged-in account and verify both processes after a restart.

4. Install an HTTPS certificate for the domain using the server's existing ACME tooling. Serve `/.well-known/acme-challenge/` from its webroot without authentication on port 80 and redirect every other HTTP request to HTTPS. Do not prompt for or submit passwords over HTTP.
5. Create a separate nginx password file with `htpasswd -cB /etc/nginx/office.htpasswd dev` (it prompts for the password). Use `-c` only for a new file, and make it readable by nginx but not other users. nginx uses `auth_basic`, not Apache `.htaccess`. In the HTTPS virtual host, use:

   ```nginx
   location / {
       auth_basic "Agent Office";
       auth_basic_user_file /etc/nginx/office.htpasswd;
       proxy_pass http://127.0.0.1:14600;
       proxy_http_version 1.1;
       proxy_set_header Host $host;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header X-Forwarded-For $remote_addr;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_set_header Authorization "";
       proxy_buffering off;
       proxy_read_timeout 1d;
   }
   ```

   This covers static files, API requests and WebSocket upgrades. The Basic password stays at nginx; the office still requires its own login. `X-Forwarded-For` is overwritten because nginx is the public edge. If you later enable Cloudflare proxying, configure trusted Cloudflare real-IP ranges before relying on visitor-IP rate limiting.

Validate `nginx -t` before reloading. Verify a trusted HTTPS certificate, HTTP-to-HTTPS redirect, 401 without Basic credentials or with wrong credentials, successful office login with both correct passwords, rejection of the old office password, and a WebSocket `101` handshake. Stop and restart the tunnel once to check recovery. Configure ACME renewal and an nginx reload hook. Keep credentials, private keys and local deployment logs out of Git.
