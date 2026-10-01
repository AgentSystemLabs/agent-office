# Jarvis: personal Agent Office fork

This fork was pinned to upstream release `v0.1.177` (commit `665aeec571bc03f76cbd16de8d628dd169a48874`) when it was created. It does **not** sync upstream automatically. The checkout is `/home/ubuntu/agent-office-fork`; `origin` is `Ruben00alex/agent-office`, and `upstream` is `AgentSystemLabs/agent-office`. The running service uses the built files in this checkout, **not** the upstream release installer. Do not run `install.sh` to deploy edits: it hardcodes upstream releases and rewrites the separate `~/.local/bin/agent-office` launcher.

The systemd user unit `agent-office.service` has a `fork.conf` drop-in that overrides only `ExecStart`. It launches this checkout's `bin/agent-office.js` using Node, explicitly retaining the same data home (`/home/ubuntu/agent-office`), projects folder, loopback address (`127.0.0.1:4600`), proxy trust, Codex backend and five-worker limit. The original packaged release and launcher stay in place for rollback. Credentials and office data are **not** in this public repository; keep `~/.config/agent-office/office.env`, `~/agent-office/.agent-office/`, and `~/agent-office/<owner>/<repo>/` out of Git.

The drop-in at `~/.config/systemd/user/agent-office.service.d/fork.conf` is:

```ini
[Service]
ExecStart=
ExecStart=/home/ubuntu/.hermes/tools/node-26.7.0-linux-x64/bin/node /home/ubuntu/agent-office-fork/bin/agent-office.js --home /home/ubuntu/agent-office --projects /home/ubuntu/agent-office --host 127.0.0.1 --port 4600 --trust-proxy --agent codex --max-workers 5
```

Reload systemd after changing it (`systemctl --user daemon-reload`). Node's absolute path reflects the version installed on this VPS; update it if Node moves. The original unit still supplies the claim-token environment file, working directory, restart policy, and private umask.

The existing named Tailscale Service `svc:agent-office` at `https://agent-office.tail03240d.ts.net/` and the interim node-level `https://jarvis.tail03240d.ts.net:14443/` both proxy `127.0.0.1:4600`. Do not edit the Tailscale mapping when changing application code. Never run bare `tailscale serve clear` or `reset`, which removes unrelated services on this node. Tailnet access plus the office login gates a shell-capable application; only authorized users should have access.

## Edit, test, and deploy

```sh
cd ~/agent-office-fork
# Edit source as desired, then:
npm ci --no-audit --no-fund    # first time or when dependencies change; runs the build
npm run typecheck
npm test
npm run build                 # required after source changes; dist/ is ignored by Git
systemctl --user restart agent-office.service
curl -f http://127.0.0.1:4600/api/health
systemctl --user status agent-office.service
# Commit and publish your source edits separately:
git add <your-files>
git commit -m 'Describe your change'
git push origin main
```

Restarting the unit does not rebuild; build *before* restart. Do not work in `~/agent-office-source` (a separate, older reference clone) or edit the office's data/projects directory to change the application. Before upgrading from upstream deliberately, review changes and compatibility; no sync job is configured.

## Rollback to the preserved packaged release

```sh
systemctl --user revert agent-office.service   # removes the fork.conf override
systemctl --user daemon-reload
systemctl --user restart agent-office.service
curl -f http://127.0.0.1:4600/api/health
```

`revert` removes **all** unit drop-ins, not just `fork.conf`; check `systemctl --user cat agent-office.service` first if additional overrides were added later. The original unit still points to `~/.local/bin/agent-office` (packaged `v0.1.177`). Rollback leaves the Tailscale mappings and office data intact, but application data created by future fork changes may not be backward compatible—back up before schema-changing edits.
