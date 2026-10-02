# Coolify reference

The full story behind `deploy/coolify.sh`. The short version is in the [README](../README.md#deploy-to-coolify).

You need a **[Coolify](https://coolify.io) v4 server** with its API turned on, an **API token** for it, plus `ssh`, `curl`, `git`, Node.js and a clone of this repo:

- **API Access on.** On a self-hosted Coolify an admin turns it on under **Settings → Configuration → Advanced → API Access**. Until then every call gets `403 API is disabled`.
- **A token with read, write and deploy.** Make it under **Keys & Tokens → API tokens**, in the team the office should belong to, as an admin or owner of that team: Coolify gives a member's token read access only.
- **A free port on the server** for the office's SSH: 2222 unless you pick another with `--ssh-port`.
- **HEAD pushed to a public repository.** Coolify builds from git, never from your files (see below).

```bash
git clone https://github.com/AgentSystemLabs/agent-office && cd agent-office
export COOLIFY_API_TOKEN=<your token>
deploy/coolify.sh up --url https://coolify.example.com --claude-token "$(claude setup-token)"
```

Leave out `COOLIFY_API_TOKEN` and `up` asks for the token instead. After that:

```bash
deploy/coolify.sh open      # tunnel to the office and open it in your browser
deploy/coolify.sh update    # build this checkout's HEAD (pushed) and redeploy it
deploy/coolify.sh destroy   # delete the office, its volume and everything on it (asks first)
```

On Windows, run it from Git Bash or WSL, like the other deploy scripts.

**Coolify builds pushed commits, from public repositories.** Coolify can't take an upload: it clones a repository, without signing in, and checks out one commit. So `up` and `update` pin the office to this checkout's HEAD, in the repository your branch pushes to (its upstream), or in `--repo` (a URL, or a remote's name) and `--branch`. Before they touch Coolify, they ask that repository for the branch the way Coolify will, with no credentials, and stop with the `git push` to run when the repository isn't public, the branch isn't there, or HEAD isn't on it. Your uncommitted changes aren't in the build; the script says so. A `git@github.com:` remote is cloned over `https://`. To deploy changes of your own, push them to a public fork and pass `--repo https://github.com/<you>/agent-office --branch <branch>` (each time, or make that your branch's upstream).

What `up` does, in about five minutes the first time:

1. Creates an SSH key pair. It's kept in `~/.config/agent-office/coolify/<name>/`, with your Coolify's address and API token (readable only by you), so later commands need neither. The token is kept as the header curl reads from a file, so it never shows in `ps`.
2. Creates a Coolify project named after the office, with one application, `office`, in its `production` environment: a public repository built with the Dockerfile build pack. It runs on Coolify's own server, or with `--server <name>` on another of Coolify's servers (when Coolify has more than one, you have to pick).
3. Adds a **persistent storage on `/data`**: a Docker volume Coolify names after the application, like `x1y2z3…-data`. Everything the office keeps is on it (see below).
4. Publishes the container's SSH on **port 2222 of the server** (a ports mapping, `2222:22`; pick another port with `--ssh-port`). That's the only way in: the application has no domain (`up` turns Coolify's generated domain off, and takes off any domain added later), so Coolify's proxy never routes to it, and the office itself is never on the internet.
5. Sets the office's own environment variables as **runtime only**, never build variables, which Coolify passes to the build as arguments. It also adds `PORT` and `HOST` with runtime and build time both off: they reach nothing, but they keep Coolify from giving the container `PORT=22` and `HOST=0.0.0.0` of its own, which workers' dev servers would pick up.
6. Pins the application to HEAD's commit and has Coolify deploy it: Coolify clones the repository, builds [`deploy/container/Dockerfile`](../deploy/container/Dockerfile) (Node 22, git, the GitHub CLI, build tools and sshd) and starts the container. Its health check runs `curl -fs http://127.0.0.1:4600/api/health` in the container, so Coolify shows whether the office is up. **Claude Code** is installed onto the volume the first time the office starts, so it keeps updating itself.
7. Signs the GitHub CLI in with your local `gh auth token` (kept on the volume), and gives git your name and email.
8. Opens an SSH tunnel and your browser at `http://localhost:4600`. **The first page shows the office password once. Write it down.** The office then keeps only a hash of it.

Run `up` again at any time: it reuses the project, the application and the volume, and sets the application's settings back to the above.

The office listens on `127.0.0.1:4600` inside its container, and everyone reaches it through the tunnel. `localhost` counts as a secure origin, so voice and screen sharing work, with no certificates to manage. Your key logs in as `agentoffice`, the user that runs the office (`deploy/coolify.sh ssh` gives you its shell). The office starts with no floors: ride the elevator and pick one of the repositories your GitHub token can see.

**The SSH address.** You and your teammates SSH to the server's IP as Coolify knows it. Coolify knows its own server as `host.docker.internal`, so for that one the script uses your Coolify's address from `--url` instead. If that isn't the address to use (Coolify behind Cloudflare, a DNS name, a server behind NAT), pass `--ssh-host <host>` to `up`. Docker opens published ports past `ufw`, but a firewall in front of the server (Hetzner's, an AWS security group, DigitalOcean's) has to allow TCP on the SSH port. Don't pick a port something else holds: 22 is the server's own SSH, 80, 443 and 8080 are Coolify's proxy, and on Coolify's own server 8000, 6001 and 6002 are Coolify itself.

**What survives a restart.** Coolify replaces the container on every restart and deploy; the volume stays. On it:

| On the volume | What it holds |
| --- | --- |
| `/data/home/agent-office` | The office's own data: the password hash, accounts and invites, floors, chat, settings, arcade scores, each account's own Claude and GitHub sign-ins |
| `/data/home/workspace` | The projects, cloned as `<owner>/<repo>`, with the workers' worktrees |
| `/data/home/.local`, `.claude`, `.claude.json` | Claude Code itself, its sign-in, and the sessions workers resume |
| `/data/home/.config/gh`, `.gitconfig` | The GitHub CLI's sign-in and git's name and email |
| `/data/ssh` | The SSH host key, so ssh still trusts the office after a redeploy |
| `/data/team` | Teammates' SSH keys, from **👥 Invite teammates** |

`/data/home` is `agentoffice`'s home directory, so anything else a worker keeps in `~` is on the volume too. The rest of the container (the office's code in `/opt/agent-office`, anything installed system-wide) comes fresh from the image each time. A restart or deploy stops running workers; they come back at their desks when the office does. Because a port of the server is published, Coolify stops the old container before it starts the new one (it skips its rolling update), so two offices never share the volume.

**Inviting your team.** Teammates need neither a Coolify account nor this repo, just `ssh`. In the office, click **👥 Invite teammates** in the **☰** menu and type their GitHub username, or run `deploy/coolify.sh invite octocat`. Either way they get one command, like:

```
ssh -L 4600:localhost:4600 ssh://office@203.0.113.7:2222
```

They leave it running, open http://localhost:4600 and sign in. Their keys log in as the `office` user, which can **only** forward to the office's port: no shell, no other ports, no `-R`. The SSH port answers any IP, but sshd accepts only your key and invited keys, and never a password. **🌐 Services** tunnels to workers' web servers work the same way (`deploy/coolify.sh service 5173` for you).

```bash
deploy/coolify.sh open                 # tunnel + open the office in your browser
deploy/coolify.sh service 5173         # open a worker's web server from the 🌐 Services board
deploy/coolify.sh invite <gh-user>     # let a teammate tunnel in (or: invite <name> <key.pub>)
deploy/coolify.sh uninvite <name>      # remove their keys and drop open tunnels
deploy/coolify.sh team                 # who's invited
deploy/coolify.sh status               # its page in Coolify, last deployment, SSH address, office up?, team
deploy/coolify.sh update               # build this checkout's HEAD (pushed) and redeploy it
deploy/coolify.sh restart              # a new container from the same image, without rebuilding
deploy/coolify.sh reset-password       # new password, shown once; signs everyone out
deploy/coolify.sh ssh | logs           # a shell in the container / follow the office's logs
```

**Updating.** Pull the latest agent-office into your clone (or commit your own changes), push, and run `deploy/coolify.sh update`. It pins the application to the new HEAD, and Coolify builds it (or, when it has that commit's image already, just starts it again). **⬆️ Upgrade the office** in the **☰** menu is for servers set up with `deploy/provision.sh`: a container's code comes from its image. Automatic deploys on push are off, since the script pins the commit. Coolify's own **Redeploy** and **Restart** buttons work too, for the pinned commit.

**Claude sign-in.** Pass `--claude-token "$(claude setup-token)"` (your Claude subscription) or `--anthropic-api-key <key>`; either becomes a runtime environment variable of the application. Or pass neither, and run `/login` in the first worker's terminal: that sign-in is kept on the volume.

**GitHub.** By default your local `gh auth token` signs the GitHub CLI in, in the office: it goes over SSH, never into an environment variable. Anyone who can use the office can use that token, so pass `--github-token <fine-grained token>` or `--no-github-token` if that's too much. Codex and OpenCode aren't in the image: add them to `deploy/container/Dockerfile` if you use them.

**Other settings.** The office reads the same environment variables as anywhere else ([configuration](configuration.md)). Add them on the application's **Environment Variables** tab in Coolify, like `AGENT_OFFICE_CITY=Portland, Oregon`, leave **Build Variable** off for anything secret, then run `deploy/coolify.sh restart`. `up` sets only its own variables there and keeps the rest.

**Several offices.** `--name <name>` (3 characters or more) gives each its own project, application, volume and state directory; give each its own `--ssh-port` too.

**Troubleshooting.**

- **`403`: its API is off.** An admin turns on API Access under **Settings → Configuration → Advanced**. If Coolify says it only lets some IP addresses in, add yours there too.
- **`403`: Missing required permissions** (or permissions that exceed your role). The token needs read, write and deploy, from an admin or owner of the team. Make a new one and run the command again with `COOLIFY_API_TOKEN=<token>`: a token given that way replaces the remembered one.
- **`401`: Coolify refused the API token.** It was revoked, or it's from another Coolify. The script forgets it, so the next run asks again (or takes `COOLIFY_API_TOKEN`).
- **HEAD isn't on the branch, or the repository can't be read without signing in.** Push HEAD (the message says the exact `git push`), or pass `--repo` and `--branch` for a public repository that has it.
- **Coolify has more than one server.** Pick one with `--server <name>` (`deploy/coolify.sh status` shows which one an office is on).
- **The build failed.** The script prints a link to the deployment's log in Coolify. (It can't read build logs itself: that takes a token that can read sensitive data, which it doesn't need otherwise.)
- **The office didn't come up.** Run `deploy/coolify.sh logs`. If it's running, check that the SSH port is free on the server and open in any firewall in front of it, and that `--ssh-host` is the server's address.

**Cost.** The office runs on your Coolify server, beside whatever else is there. Give it room for the workers: 4 vCPUs and 8 to 16 GB of memory is comfortable. `deploy/coolify.sh destroy` deletes the application with its volume, and waits until Coolify has it gone; Coolify then stops and removes the container, the volume and the application's files on the server in the background, and cleans up unused images. Last it deletes the project, if nothing else is in it.
