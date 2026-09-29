# Railway reference

The full story behind `deploy/railway.sh`. The short version is in the [README](../README.md#deploy-to-railway).

You need the **Railway CLI 5 or newer, logged in** (`railway login`; update an older one with `railway upgrade` or `brew upgrade railway`), plus `ssh`, `curl`, Node.js and a clone of this repo:

```bash
git clone https://github.com/AgentSystemLabs/agent-office && cd agent-office
deploy/railway.sh up --claude-token "$(claude setup-token)"
```

After that:

```bash
deploy/railway.sh open      # tunnel to the office and open it in your browser
deploy/railway.sh update    # build this checkout again and redeploy it
deploy/railway.sh destroy   # delete the project, its volume and everything on it (asks first)
```

What `up` does, in about five minutes the first time:

1. Creates an SSH key pair (kept in `~/.config/agent-office/railway/<name>/`).
2. Creates a Railway project named after the office, with one service, `office`. In more than one Railway workspace? Pick one with `--workspace <name>`.
3. Adds a **volume on `/data`**. Everything the office keeps is on it (see below).
4. Adds a **TCP proxy** in front of the container's port 22, something like `zephyr.proxy.rlwy.net:17738`. That's the only way in: the service never gets an HTTP domain, so the office itself is never on the internet.
5. Builds this checkout with [`deploy/container/Dockerfile`](../deploy/container/Dockerfile): Node 22, git, the GitHub CLI, build tools and sshd. **Claude Code** is installed onto the volume the first time the office starts, so it keeps updating itself. The restart policy is *Always*, so a crash brings it straight back.
6. Signs the GitHub CLI in with your local `gh auth token` (kept on the volume), and gives git your name and email.
7. Opens an SSH tunnel and your browser at `http://localhost:4600`. **The first page shows the office password once. Write it down.** The office then keeps only a hash of it.

The office listens on `127.0.0.1:4600` inside its container, and everyone reaches it through the tunnel. `localhost` counts as a secure origin, so voice and screen sharing work, with no certificates to manage. Your key logs in as `agentoffice`, the user that runs the office (`deploy/railway.sh ssh` gives you its shell). The office starts with no floors: ride the elevator and pick one of the repositories your GitHub token can see.

**What survives a restart.** Railway replaces the container on every restart and redeploy; the volume stays. On it:

| On the volume | What it holds |
| --- | --- |
| `/data/home/agent-office` | The office's own data: the password hash, accounts and invites, floors, chat, settings, arcade scores, each account's own Claude and GitHub sign-ins |
| `/data/home/workspace` | The projects, cloned as `<owner>/<repo>`, with the workers' worktrees |
| `/data/home/.local`, `.claude`, `.claude.json` | Claude Code itself, its sign-in, and the sessions workers resume |
| `/data/home/.config/gh`, `.gitconfig` | The GitHub CLI's sign-in and git's name and email |
| `/data/ssh` | The SSH host key, so ssh still trusts the office after a redeploy |
| `/data/team` | Teammates' SSH keys, from **👥 Invite teammates** |

`/data/home` is `agentoffice`'s home directory, so anything else a worker keeps in `~` is on the volume too. The rest of the container (the office's code in `/opt/agent-office`, anything installed system-wide) comes fresh from the image each time. A restart or redeploy stops running workers; they come back at their desks when the office does.

**Inviting your team.** Teammates need neither a Railway account nor this repo, just `ssh`. In the office, click **👥 Invite teammates** in the **☰** menu and type their GitHub username, or run `deploy/railway.sh invite octocat`. Either way they get one command, like:

```
ssh -L 4600:localhost:4600 ssh://office@zephyr.proxy.rlwy.net:17738
```

They leave it running, open http://localhost:4600 and sign in. Their keys log in as the `office` user, which can **only** forward to the office's port: no shell, no other ports, no `-R`. Railway's TCP proxy answers any IP, but sshd accepts only your key and invited keys, and never a password. **🌐 Services** tunnels to workers' web servers work the same way (`deploy/railway.sh service 5173` for you).

```bash
deploy/railway.sh open                 # tunnel + open the office in your browser
deploy/railway.sh service 5173         # open a worker's web server from the 🌐 Services board
deploy/railway.sh invite <gh-user>     # let a teammate tunnel in (or: invite <name> <key.pub>)
deploy/railway.sh uninvite <name>      # remove their keys and drop open tunnels
deploy/railway.sh team                 # who's invited
deploy/railway.sh status               # deployment, SSH address, volume use, office up?, team
deploy/railway.sh update               # build this checkout again and redeploy it
deploy/railway.sh restart              # restart the container without rebuilding
deploy/railway.sh reset-password       # new password, shown once; signs everyone out
deploy/railway.sh ssh | logs           # a shell in the container / follow the office's logs
```

**Updating.** Pull the latest agent-office into your clone and run `deploy/railway.sh update`. **⬆️ Upgrade the office** in the **☰** menu is for servers set up with `deploy/provision.sh`: a container's code comes from its image.

**Claude sign-in.** Pass `--claude-token "$(claude setup-token)"` (your Claude subscription) or `--anthropic-api-key <key>`; either becomes a variable on the service. Or pass neither, and run `/login` in the first worker's terminal: that sign-in is kept on the volume.

**GitHub.** By default your local `gh auth token` signs the GitHub CLI in, in the office. Anyone who can use the office can use that token, so pass `--github-token <fine-grained token>` or `--no-github-token` if that's too much. Codex and OpenCode aren't in the image: add them to `deploy/container/Dockerfile` if you use them.

**Other settings.** The office reads the same environment variables as anywhere else ([configuration](configuration.md)). Set them on the service from `~/.config/agent-office/railway/<name>/`, which is linked to it: `cd ~/.config/agent-office/railway/agent-office && railway variable set AGENT_OFFICE_CITY="Portland, Oregon"`. Setting a variable redeploys the office.

**Cost.** Railway bills the container's CPU and memory while it runs, plus the volume. Nothing pauses by itself: `deploy/railway.sh destroy` is how to stop paying. It deletes the project with the volume and everything on it; the office stops at once, and Railway purges the project a couple of days later.

**Any other Docker host.** The image isn't Railway-specific: [`deploy/fly.sh`](fly.md) runs it on Fly.io and [`deploy/dokploy.sh`](dokploy.md) on Dokploy. Build it from the repository root with `docker build -f deploy/container/Dockerfile .`, mount a volume on `/data`, publish port 22, and set `AGENT_OFFICE_ADMIN_KEYS` (your public key), `AGENT_OFFICE_CLAIM_TOKEN` (any random string: open `/claim?t=<it>` through the tunnel) and `AGENT_OFFICE_PUBLIC_HOST` (`host:port` teammates SSH to).
