# AWS reference

The full story behind `deploy/aws.sh`. The short version is in the [README](../README.md#deploy-to-aws-ec2).

If you have the AWS CLI logged in, one command gives you your own office on EC2. No Terraform needed:

```bash
git clone https://github.com/AgentSystemLabs/agent-office && cd agent-office
deploy/aws.sh up
```

After that, the whole lifecycle is four more commands:

```bash
deploy/aws.sh open      # tunnel to the office and open it in your browser
deploy/aws.sh pause     # stop the machine to save money (asks first); only the disk and IP are billed
deploy/aws.sh resume    # start it again: same address, same files, then open it
deploy/aws.sh destroy   # delete the machine, disk, IP, security group and key pair (asks first)
```

On Tailscale? `up --tailscale` puts the office on your tailnet instead of behind SSH tunnels: see [Tailscale](#tailscale).

What `up` does, in about 2 minutes:

1. Creates an SSH key pair (kept in `~/.config/agent-office/aws/<name>/`).
2. Creates a security group that opens **only SSH (port 22), and only to your current IP**. The office itself is never on the internet.
3. Gives the machine a fixed Elastic IP and launches a **t3.xlarge** (4 vCPU, 16 GiB) Ubuntu 24.04 instance with a 50 GiB disk.
4. Runs the same [`deploy/provision.sh`](../deploy/provision.sh) as [any server](self-hosting.md): it installs Node 22, git, the GitHub CLI and **Claude Code**, clones the latest agent-office from GitHub and runs `npm i`. The office keeps its data in `~/agent-office` on the machine and clones projects into `~/workspace/<owner>/<repo>`.
5. Runs the office under systemd with `Restart=always`, so it comes back after a crash or a reboot, and `KillMode=process`, so restarting it leaves the workers running. It listens on `127.0.0.1:4600` on the machine, so the only way in is an SSH tunnel.
6. Opens an SSH tunnel and your browser at `http://localhost:4600`. **The first page shows the office password once. Write it down.** The server then keeps only a hash, so nobody can display the password again.
7. The office opens on its elevator with no floors yet. It lists every repository your GitHub token can see: pick one and it becomes the first floor.

Everything goes through SSH, so there are no certificate warnings, and `localhost` counts as a secure origin: voice and screen sharing just work. Keep the terminal open while you use the office; Ctrl-C closes the tunnel. Next time, run `deploy/aws.sh open`. If port 4600 is taken on your machine, it picks the next free one.

**Inviting your team.** Teammates don't need AWS access or this repo, just `ssh`. In the office, click **👥 Invite teammates** in the **☰** menu and type their GitHub username. That installs the SSH keys from `github.com/<username>.keys`. The panel then gives you one command to send them, for macOS, Linux or Windows. It opens the tunnel and, once it's up, the office in their browser:

```
ssh -o ExitOnForwardFailure=yes -o PermitLocalCommand=yes -o LocalCommand="open http://localhost:4600" -L 4600:localhost:4600 office@<your-office-ip>
```

**Copy invite message** copies the command, plus the server fingerprint to check on first connect. The panel also lists who's invited and can remove them. The same works from your terminal:

```bash
deploy/aws.sh invite octocat        # uses the SSH keys on github.com/octocat
deploy/aws.sh allow 203.0.113.7     # their IP (SSH answers only allowed IPs)
```

They leave that command running and sign in with the office password. Their keys log in as a separate `office` user that can **only** forward to the office port. It has no shell, no other ports, no `-R`, and no agent forwarding. So a leaked teammate key still doesn't get past the office password.

**Reviewing what workers build.** Every web server a worker runs is listed on the **🌐 Services** board. Clicking a row copies a command like this one:

```
ssh -N -o ExitOnForwardFailure=yes -o PermitLocalCommand=yes -o LocalCommand="open http://localhost:5173" -L 5173:localhost:4600 office@<your-office-ip>
```

It opens http://localhost:5173 on their computer. The tunnel ends at the office's own port, and the office relays it to the worker's server on 5173. So the same invited keys work, nothing new is opened on the machine, and every page still asks for the office password (anyone signed in to the office already is). Keep one terminal per service open while you look. You set the office up yourself? Run `deploy/aws.sh service 5173` instead.

If chasing teammates' IPs gets old, `deploy/aws.sh allow anywhere` opens SSH to every IP. That's a reasonable trade: SSH only accepts your key and invited keys, and the office stays behind the tunnel.

```bash
deploy/aws.sh open                 # tunnel + open the office in your browser
deploy/aws.sh service 5173         # open a worker's web server from the 🌐 Services board
deploy/aws.sh invite <gh-user>     # let a teammate tunnel in (or: invite <name> <key.pub>)
deploy/aws.sh uninvite <name>      # remove their keys and drop open tunnels
deploy/aws.sh team                 # who's invited
deploy/aws.sh allow 203.0.113.7    # let an IP reach SSH (CIDR ok; "me", "anywhere")
deploy/aws.sh revoke 203.0.113.7   # …and take it back
deploy/aws.sh status               # instance, address, office up?, team, allowed IPs
deploy/aws.sh resize t3.2xlarge    # bigger or smaller machine; same address, ~1-2 min of downtime
deploy/aws.sh update               # install the latest agent-office and restart
deploy/aws.sh reset-password       # new password, shown once; signs everyone out
deploy/aws.sh ssh | logs           # get on the box / follow the office logs
```

**Upgrading from the office.** **⬆️ Upgrade the office** in the **☰** menu checks GitHub for new commits on the branch the office was installed from. When there are any, an orange **⬆️ Update** button shows up on the top bar, and it lists them. **Upgrade now** builds the new version next to the running one. Meanwhile the office keeps working and everyone sees a banner. A failed build changes nothing. Once the build succeeds, the office swaps it in and restarts, and everyone gets a *"🛠️ Upgrading the office"* dialog. A few seconds later their page reloads on the new version. Workers keep working through it: their terminals run in a process of their own, which the new version picks back up. (An office set up before this lets them keep running from its next upgrade on; the first one resumes them with *continue*.)

An office created before the SSH tunnel served HTTPS on port 443 with a self-signed certificate. Run `deploy/aws.sh up` once to move it over: 443 closes and the office moves behind the tunnel. Offices created before **👥 Invite teammates** and **⬆️ Upgrade the office** also need one `deploy/aws.sh up` before those show up in the **☰** menu. `update` alone isn't enough, because `up` installs the key helper and turns on self-upgrade in the systemd unit.

Useful options for `up`:

- `--project owner/repo` also clones that repo as the office's first floor. Without it, you pick projects in the elevator. (Before, the office was started in the GitHub origin of the directory you ran `up` from, which is usually agent-office itself. An office set up that way keeps its data in that checkout after `up`, and you can take agent-office off the building in the elevator.)
- `--instance-type`, `--disk` and `--region` set the machine size, disk size and region.
- `--allow <ip>` lets more IPs reach SSH from the start.
- `--name <name>` runs several offices side by side.

**Claude sign-in.** Workers run Claude Code on the machine, so it has to be signed in there. You can do this either way:

- Pass `--claude-token "$(claude setup-token)"`, which uses your Claude subscription, or `--anthropic-api-key <key>`.
- Do nothing, and the first worker jumps with *"Claude isn't signed in — type /login"*. Open its terminal and run `/login`.

That's the office's own sign-in, which workers use while you're in on the office password. Once teammates have [accounts](../README.md#add-users), each of them signs in to their own Claude in **☰ → 🔐 Your sign-ins**, and their workers run on their own plan. Admins can pick the office's own there instead.

**GitHub.** By default, your local `gh auth token` is used to sign in the GitHub CLI on the machine. The office uses it to list and clone your repos and to read the issue and PR boards, so it needs access to them. On the office password, commenting, merging, pushing and opening PRs use it too. People with accounts do those as themselves, with the GitHub account they sign in to in **🔐 Your sign-ins**. Every worker runs as the same user on the machine, so anyone who can use the office can get at that token: pass `--github-token <fine-grained token>` or `--no-github-token` if that's too much.

## Tailscale

If your team is on [Tailscale](https://tailscale.com), the office can live on your tailnet instead of behind SSH tunnels:

```bash
deploy/aws.sh up --tailscale
```

On top of everything above, `up` then:

1. Installs Tailscale on the machine and adds it to your tailnet as `agent-office` (`agent-office-<name>` with `--name`). Without a key it opens Tailscale's page to add the machine, and waits up to 15 minutes. To skip that, make an auth key on the [Keys](https://login.tailscale.com/admin/settings/keys) page of Tailscale's admin console and pass `--tailscale-auth-key tskey-auth-…` (or set `TS_AUTHKEY`). The key goes to the machine in a file and is deleted once it has been used, so it never shows up in `ps`.
2. Serves the office on `https://agent-office.<your-tailnet>.ts.net` with [Tailscale Serve](https://tailscale.com/kb/1312/serve). Serve needs MagicDNS and HTTPS Certificates turned on for the tailnet. The first time, `up` opens the page that turns them on, then carries on. Tailscale gets the certificate from Let's Encrypt, so browsers trust it, and voice and screen sharing work. Turning HTTPS on publishes your machine names in the public certificate transparency logs, so don't give the machine a name you'd mind being seen.
3. Starts the office with `--trust-proxy`, like behind Caddy. Serve says each visitor came over https and from which tailnet address, so cookies are `Secure` and sign-in limits count each person separately.

Nothing new is opened in the security group: Tailscale only makes outgoing connections, and falls back to its relays when a direct one isn't possible. SSH stays open to your IP, for `deploy/aws.sh` itself.

Anyone on your tailnet opens the link. There's no terminal to keep open, and no SSH keys or IPs to add. For someone who isn't on your tailnet, [share the machine](https://tailscale.com/kb/1084/sharing) from the [Machines](https://login.tailscale.com/admin/machines) page (**⋯ → Share…**). They accept it in their own Tailscale and reach this one machine, nothing else of yours. Or [invite them](https://login.tailscale.com/admin/users) to your tailnet. **☰ → 👥 Invite teammates** in the office, and `deploy/aws.sh invite` with no username, both say how, and give you an invite message to send. Everyone still signs in to the office itself, with the password or an account from **🔑 Accounts**.

**Workers' servers.** Each one on the **🌐 Services** board gets its own link on the tailnet, `https://agent-office.<your-tailnet>.ts.net:5173`, instead of a tunnel command. When a worker starts a server, the office asks Serve for that port through `/usr/local/bin/agent-office-serve`, a small root helper that only ever points a port at the office. The office then checks the visitor is signed in and relays to the worker's server, just like a service tunnel. When the server stops, the port closes again. `deploy/aws.sh service 5173` opens that link too.

**The rest of the commands** know about the tailnet:

- `open` opens the tailnet link when this computer can reach it, and otherwise warns and falls back to the SSH tunnel. The same goes for `resume` and `reset-password`.
- `status` shows the link.
- `destroy` signs the machine out of your tailnet before it deletes it. If it's still listed on the Machines page, remove it there.

**Key expiry.** Tailscale expires a machine's key after 180 days, and then the office drops off your tailnet. On the Machines page, pick the machine, then **⋯ → Disable key expiry**. An auth key with a tag avoids this too, because tagged machines don't expire (the tag has to be in your policy's `tagOwners`).

**Moving an existing office over.** Run `deploy/aws.sh up --tailscale` on it. Running `up` later keeps it on the tailnet, even without the flag. People you invited by SSH key can still tunnel in until you remove them in **👥 Invite teammates**.

**What your tailnet can reach.** The security group doesn't apply to traffic that comes over Tailscale. Whoever your [access controls](https://tailscale.com/kb/1018/acls) let reach the machine can connect to any port something on it listens on across all interfaces. That includes a worker's `vite --host`, or a database it started, and not only the office. The default policy lets everyone on the tailnet reach every machine. Tighten it if that's more than you want. People you shared the machine with can reach only that one machine.

The same thing works on any Ubuntu or Debian server with [`deploy/provision.sh --tailscale`](self-hosting.md).
