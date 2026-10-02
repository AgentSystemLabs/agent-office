# Dokploy reference

The full story behind `deploy/dokploy.sh`. The short version is in the [README](../README.md#deploy-to-dokploy).

You need a **[Dokploy](https://dokploy.com) server** and an **API key** for it, plus `ssh`, `curl`, `git`, Node.js and a clone of this repo. Make the key in Dokploy under **Settings → Profile → API/CLI Keys**, and leave its rate limiting off: the script checks on the build every few seconds.

```bash
git clone https://github.com/AgentSystemLabs/agent-office && cd agent-office
export DOKPLOY_API_KEY=<your key>
deploy/dokploy.sh up --url https://dokploy.example.com --claude-token "$(claude setup-token)"
```

After that:

```bash
deploy/dokploy.sh open      # tunnel to the office and open it in your browser
deploy/dokploy.sh update    # upload this checkout again, build it and redeploy it
deploy/dokploy.sh destroy   # delete the office, its volume and everything on it (asks first)
```

What `up` does, in about five minutes the first time:

1. Creates an SSH key pair. It's kept in `~/.config/agent-office/dokploy/<name>/`, with your Dokploy's address and API key (readable only by you), so later commands need neither.
2. Creates a Dokploy project named after the office, with one application, `office`. It runs on Dokploy's own server, or on one of its remote servers with `--server <name>` (on Dokploy Cloud, you need one).
3. Mounts a **Docker volume on `/data`**. Everything the office keeps is on it (see below).
4. Publishes the container's SSH on **port 2222 of the server** (pick another with `--ssh-port`). That's the only way in: the application has no domain, so Traefik never routes to it, and the office itself is never on the internet.
5. Zips this checkout and uploads it, and Dokploy builds it with [`deploy/container/Dockerfile`](../deploy/container/Dockerfile): Node 22, git, the GitHub CLI, build tools and sshd. The zip holds what `git add -A` would see: your uncommitted changes and new files included, anything `.gitignore` leaves out left out, and no `.env` files or keys. **Claude Code** is installed onto the volume the first time the office starts, so it keeps updating itself. Docker Swarm restarts the container if it crashes.
6. Signs the GitHub CLI in with your local `gh auth token` (kept on the volume), and gives git your name and email.
7. Opens an SSH tunnel and your browser at `http://localhost:4600`. **The first page shows the office password once. Write it down.** The office then keeps only a hash of it.

The office listens on `127.0.0.1:4600` inside its container, and everyone reaches it through the tunnel. `localhost` counts as a secure origin, so voice and screen sharing work, with no certificates to manage. Your key logs in as `agentoffice`, the user that runs the office (`deploy/dokploy.sh ssh` gives you its shell). The office starts with no floors: ride the elevator and pick one of the repositories your GitHub token can see.

**The SSH address.** You and your teammates SSH to the server's IP as Dokploy knows it: the remote server's IP, or for Dokploy's own server the one under **Settings → Web Server**. If that isn't the address to use (a DNS name, or a server behind NAT), pass `--ssh-host <host>` to `up`. Docker opens published ports past `ufw`, but a firewall in front of the server (Hetzner's, an AWS security group, DigitalOcean's) has to allow TCP on the SSH port. Don't pick port 22: that's the server's own SSH.

**What survives a restart.** Dokploy replaces the container on every restart and deploy; the volume stays. It's named after the application, like `agent-office-x1y2z3-data`. On it:

| On the volume | What it holds |
| --- | --- |
| `/data/home/agent-office` | The office's own data: the password hash, accounts and invites, floors, chat, settings, arcade scores, each account's own Claude and GitHub sign-ins |
| `/data/home/workspace` | The projects, cloned as `<owner>/<repo>`, with the workers' worktrees |
| `/data/home/.local`, `.claude`, `.claude.json` | Claude Code itself, its sign-in, and the sessions workers resume |
| `/data/home/.config/gh`, `.gitconfig` | The GitHub CLI's sign-in and git's name and email |
| `/data/ssh` | The SSH host key, so ssh still trusts the office after a redeploy |
| `/data/team` | Teammates' SSH keys, from **👥 Invite teammates** |

`/data/home` is `agentoffice`'s home directory, so anything else a worker keeps in `~` is on the volume too. The rest of the container (the office's code in `/opt/agent-office`, anything installed system-wide) comes fresh from the image each time. A restart or deploy stops running workers; they come back at their desks when the office does. Dokploy normally starts the new container before stopping the old one; `up` switches the office to stop-first, so two offices never share the volume.

**Inviting your team.** Teammates need neither a Dokploy account nor this repo, just `ssh`. In the office, click **👥 Invite teammates** in the **☰** menu and type their GitHub username, or run `deploy/dokploy.sh invite octocat`. Either way they get one command, like:

```
ssh -L 4600:localhost:4600 ssh://office@203.0.113.7:2222
```

They leave it running, open http://localhost:4600 and sign in. Their keys log in as the `office` user, which can **only** forward to the office's port: no shell, no other ports, no `-R`. The SSH port answers any IP, but sshd accepts only your key and invited keys, and never a password. **🌐 Services** tunnels to workers' web servers work the same way (`deploy/dokploy.sh service 5173` for you), and [`agent-office tunnel`](tunnel.md) opens every one of them on your computer by itself.

```bash
deploy/dokploy.sh open                 # tunnel + open the office in your browser
deploy/dokploy.sh service 5173         # open a worker's web server from the 🌐 Services board
deploy/dokploy.sh invite <gh-user>     # let a teammate tunnel in (or: invite <name> <key.pub>)
deploy/dokploy.sh uninvite <name>      # remove their keys and drop open tunnels
deploy/dokploy.sh team                 # who's invited
deploy/dokploy.sh status               # its page in Dokploy, last deployment, SSH address, office up?, team
deploy/dokploy.sh update               # upload this checkout again, build it and redeploy it
deploy/dokploy.sh restart              # restart the container without rebuilding
deploy/dokploy.sh reset-password       # new password, shown once; signs everyone out
deploy/dokploy.sh ssh | logs           # a shell in the container / follow the office's logs
```

**Updating.** Pull the latest agent-office into your clone and run `deploy/dokploy.sh update`. **⬆️ Upgrade the office** in the **☰** menu is for servers set up with `deploy/provision.sh`: a container's code comes from its image. If a build fails, its log is on the application's **Deployments** tab in Dokploy (`status` prints the link).

**Claude sign-in.** Pass `--claude-token "$(claude setup-token)"` (your Claude subscription) or `--anthropic-api-key <key>`; either becomes an environment variable of the application. Or pass neither, and run `/login` in the first worker's terminal: that sign-in is kept on the volume.

**GitHub.** By default your local `gh auth token` signs the GitHub CLI in, in the office. Anyone who can use the office can use that token, so pass `--github-token <fine-grained token>` or `--no-github-token` if that's too much. Codex and OpenCode aren't in the image: add them to `deploy/container/Dockerfile` if you use them.

**Other settings.** The office reads the same environment variables as anywhere else ([configuration](configuration.md)). Add them on the application's **Environment** tab in Dokploy, like `AGENT_OFFICE_CITY=Portland, Oregon`, then run `deploy/dokploy.sh restart`. `up` sets only its own variables there and keeps the rest.

**Several offices.** `--name <name>` gives each its own project, application, volume and state directory; give each its own `--ssh-port` too.

**Cost.** The office runs on your Dokploy server, beside whatever else is there. Give it room for the workers: 4 vCPUs and 8 to 16 GB of memory is comfortable. `deploy/dokploy.sh destroy` deletes the application, then its volume, then the project if nothing else is in it. The image Dokploy built stays in Docker until its next cleanup. Older Dokploy versions can't delete a volume through their API; the script then prints the `docker volume rm` to run on the server.
