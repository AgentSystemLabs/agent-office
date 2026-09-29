# Fly.io reference

The full story behind `deploy/fly.sh`. The short version is in the [README](../README.md#deploy-to-flyio).

You need an up-to-date **flyctl, logged in** (`fly auth login`; [install it](https://fly.io/docs/flyctl/install/) with `brew install flyctl` or `curl -L https://fly.io/install.sh | sh`, and update an old one with `fly version upgrade`), plus `ssh`, `curl`, Node.js and a clone of this repo:

```bash
git clone https://github.com/AgentSystemLabs/agent-office && cd agent-office
deploy/fly.sh up --claude-token "$(claude setup-token)"
```

After that:

```bash
deploy/fly.sh open      # tunnel to the office and open it in your browser
deploy/fly.sh update    # build this checkout again and redeploy it
deploy/fly.sh destroy   # delete the app, its volume and everything on it (asks first)
```

What `up` does, in a few minutes the first time:

1. Creates an SSH key pair (kept in `~/.config/agent-office/fly/<name>/`).
2. Creates a Fly app named after the office with a random suffix, like `agent-office-3f9a1c` (app names are unique across all of Fly.io; pick your own with `--app`). In more than one Fly organization? Pick one with `--org <slug>`.
3. Adds a **50 GB volume on `/data`** (`--disk` for another size) in the Fly region nearest you (`--region` for another; `fly platform regions` lists them). Everything the office keeps is on it (see below).
4. Gives the app a **dedicated IPv4 address**, with SSH on a random port, something like `137.66.12.34:31337`. That's the only way in. The app has no HTTP service, so nothing answers on `<app>.fly.dev`, and the office itself is never on the internet. The address is dedicated because Fly's shared IPv4 addresses only carry HTTP and TLS.
5. Builds this checkout with [`deploy/container/Dockerfile`](../deploy/container/Dockerfile) on Fly's remote builder: the same image as on [Railway](railway.md), with Node 22, git, the GitHub CLI, build tools and sshd. **Claude Code** is installed onto the volume the first time the office starts, so it keeps updating itself. It runs on one machine, a `shared-cpu-4x` with 8 GB (`--vm-size` and `--memory` change it). Fly never stops it for being idle, and its restart policy is *always*, so a crash brings it straight back.
6. Signs the GitHub CLI in with your local `gh auth token` (kept on the volume), and gives git your name and email.
7. Opens an SSH tunnel and your browser at `http://localhost:4600`. **The first page shows the office password once. Write it down.** The office then keeps only a hash of it.

The office listens on `127.0.0.1:4600` in its machine, and everyone reaches it through the tunnel. `localhost` counts as a secure origin, so voice and screen sharing work, with no certificates to manage. Your key logs in as `agentoffice`, the user that runs the office (`deploy/fly.sh ssh` gives you its shell). If the office's sshd is ever down, `fly ssh console -a <app>` still gets you a root shell through Fly's own SSH, which keeps port 22 in the machine (the office's sshd listens on 2222 there, and the app's public port leads to it). The office starts with no floors: ride the elevator and pick one of the repositories your GitHub token can see.

**What survives a restart.** A restart, a redeploy or a resize restarts the machine from a fresh copy of the image; the volume stays. On it:

| On the volume | What it holds |
| --- | --- |
| `/data/home/agent-office` | The office's own data: the password hash, accounts and invites, floors, chat, settings, arcade scores, each account's own Claude and GitHub sign-ins |
| `/data/home/workspace` | The projects, cloned as `<owner>/<repo>`, with the workers' worktrees |
| `/data/home/.local`, `.claude`, `.claude.json` | Claude Code itself, its sign-in, and the sessions workers resume |
| `/data/home/.config/gh`, `.gitconfig` | The GitHub CLI's sign-in and git's name and email |
| `/data/ssh` | The SSH host key, so ssh still trusts the office after a redeploy |
| `/data/team` | Teammates' SSH keys, from **👥 Invite teammates** |

`/data/home` is `agentoffice`'s home directory, so anything else a worker keeps in `~` is on the volume too. The rest of the machine (the office's code in `/opt/agent-office`, anything installed system-wide) comes fresh from the image each time. A restart or redeploy stops running workers; they come back at their desks when the office does. Fly also snapshots the volume every day and keeps the last five days of snapshots (`fly volumes snapshots list -a <app> <volume-id>`; `fly volumes list -a <app>` shows the ID).

**Inviting your team.** Teammates need neither a Fly account nor this repo, just `ssh`. In the office, click **👥 Invite teammates** in the **☰** menu and type their GitHub username, or run `deploy/fly.sh invite octocat`. Either way they get one command, like:

```
ssh -L 4600:localhost:4600 ssh://office@137.66.12.34:31337
```

They leave it running, open http://localhost:4600 and sign in. Their keys log in as the `office` user, which can **only** forward to the office's port: no shell, no other ports, no `-R`. The address answers any IP, but sshd accepts only your key and invited keys, and never a password. **🌐 Services** tunnels to workers' web servers work the same way (`deploy/fly.sh service 5173` for you).

```bash
deploy/fly.sh open                    # tunnel + open the office in your browser
deploy/fly.sh service 5173            # open a worker's web server from the 🌐 Services board
deploy/fly.sh invite <gh-user>        # let a teammate tunnel in (or: invite <name> <key.pub>)
deploy/fly.sh uninvite <name>         # remove their keys and drop open tunnels
deploy/fly.sh team                    # who's invited
deploy/fly.sh status                  # machine, SSH address, volume use, office up?, team
deploy/fly.sh update                  # build this checkout again and redeploy it
deploy/fly.sh restart                 # restart the machine without rebuilding
deploy/fly.sh resize performance-2x   # another machine size (memory: resize <size> 16gb)
deploy/fly.sh pause                   # stop the machine, and paying for its CPU and memory
deploy/fly.sh resume                  # start it again and open it
deploy/fly.sh reset-password          # new password, shown once; signs everyone out
deploy/fly.sh ssh | logs              # a shell in the machine / follow the office's logs
```

**Updating.** Pull the latest agent-office into your clone and run `deploy/fly.sh update`. **⬆️ Upgrade the office** in the **☰** menu is for servers set up with `deploy/provision.sh`: a Fly machine's code comes from its image.

**Machine size.** A `shared-cpu-4x` with 8 GB is plenty for a few workers. Shared CPUs are made for bursts, though, and Fly slows one down that stays busy for long. If workers build and test all day, move to dedicated CPUs: `deploy/fly.sh resize performance-2x` (memory stays, unless you add it: `resize performance-4x 16gb`). `fly platform vm-sizes` lists the sizes. The volume can grow too, never shrink: `fly volumes extend -a <app> <volume-id> -s 100`.

**Pausing.** `deploy/fly.sh pause` stops the machine, and workers stop with it. Fly then bills only the volume, the IP address and a little storage for the stopped machine. Nothing starts it again but `deploy/fly.sh resume`, which also opens the office.

**Claude sign-in.** Pass `--claude-token "$(claude setup-token)"` (your Claude subscription) or `--anthropic-api-key <key>`; either becomes a secret on the app. Or pass neither, and run `/login` in the first worker's terminal: that sign-in is kept on the volume.

**GitHub.** By default your local `gh auth token` signs the GitHub CLI in, in the office. Anyone who can use the office can use that token, so pass `--github-token <fine-grained token>` or `--no-github-token` if that's too much. Codex and OpenCode aren't in the image: add them to `deploy/container/Dockerfile` if you use them.

**Other settings.** The office reads the same environment variables as anywhere else ([configuration](configuration.md)). Set them as secrets on the app: `fly secrets set -a <app> AGENT_OFFICE_CITY="Portland, Oregon"`. That restarts the machine. Don't edit the `fly.toml` in `~/.config/agent-office/fly/<name>/`, because `deploy/fly.sh` writes it again before every deploy.

**Cost.** Fly bills the machine by the second while it runs, plus the volume, the dedicated IPv4 address and the volume's snapshots. Nothing pauses by itself: `deploy/fly.sh pause` stops the machine's share, and `deploy/fly.sh destroy` stops all of it. Destroying deletes the app with its machine, volume and address, and everything on them.

**Any other Docker host.** See [Railway's notes](railway.md): the image is the same.
