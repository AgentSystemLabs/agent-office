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

Everything goes through SSH, so there are no certificates to manage, and `localhost` counts as a secure origin, so voice and screen sharing work. Claude signs in from the office: the first worker asks you to type `/login` in its terminal. If GitHub isn't signed in yet, run `gh auth login` from a shell at any desk (**B**). To update, run the same line again, or use **⬆️ Upgrade the office** in the **☰** menu. Options go after `bash -s --`: `--project owner/repo` clones a first floor, and `--help` lists the rest.

**On your own domain.** Point a DNS record at the server, open ports 80 and 443, and add `--domain`:

```bash
curl -fsSL https://raw.githubusercontent.com/AgentSystemLabs/agent-office/main/deploy/provision.sh | bash -s -- --domain office.example.com
```

It installs [Caddy](https://caddyserver.com), which gets a certificate from Let's Encrypt by itself and serves the office on https://office.example.com. The claim link is then `https://office.example.com/claim?t=…`. Give teammates an invite link each from **🔑 Accounts**.

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

**Voice across strict NATs.** Peers connect directly using public STUN. If some teammates can't hear each other (common on corporate networks), run a TURN server such as coturn and pass `--turn turn:user:pass@turn.example.com:3478`.
