# Google Cloud reference

The full story behind `deploy/gcp.sh`. The short version is in the [README](../README.md#deploy-to-google-cloud).

It's the Google Cloud twin of [`deploy/aws.sh`](aws.md) and [`deploy/azure.sh`](azure.md): the same commands, the same [`deploy/provision.sh`](../deploy/provision.sh) on the machine, and the same rule that the office is only ever reached through an SSH tunnel. If you have the gcloud CLI signed in (`gcloud auth login`) and a project with billing, one command gives you your own office on a Compute Engine VM:

```bash
git clone https://github.com/AgentSystemLabs/agent-office && cd agent-office
deploy/gcp.sh up
```

After that, the whole lifecycle is four more commands:

```bash
deploy/gcp.sh open      # tunnel to the office and open it in your browser
deploy/gcp.sh pause     # stop the VM to save money (asks first); only the disk and IP are billed
deploy/gcp.sh resume    # start it again: same address, same files, then open it
deploy/gcp.sh destroy   # delete the VM, its disk, address (or NAT), firewall rule and network (asks first)
```

What `up` does, in a few minutes:

1. Turns the Compute Engine API on in the project, if it isn't yet, and checks that the machine type is offered in the zone, before it creates anything.
2. Creates an SSH key pair, kept in `~/.config/agent-office/gcp/<name>/`.
3. Creates a VPC network of the office's own, `agent-office-net`. The project's `default` network comes with a rule that lets SSH in from everywhere, on every VM in it, and some organizations' projects have no `default` network at all. An own network has neither problem, and costs nothing.
4. Creates one firewall rule on it, `agent-office-ssh`, that opens **only SSH (port 22), and only to your current IP**, on VMs tagged `agent-office`. The office itself is never on the internet.
5. Reserves a static external IP, `agent-office`, so the address survives pauses and resizes.
6. Launches an **e2-standard-4** VM (4 vCPU, 16 GiB) named `agent-office` with Ubuntu 24.04 LTS, a 50 GiB balanced persistent disk and Shielded VM (secure boot and a virtual TPM). It has **no service account**: the office needs no Google API, and that keeps a cloud credential off a machine that runs agents. Your key goes in the VM's `ssh-keys` metadata for the `ubuntu` user, with project-wide keys blocked and OS Login off, so nothing but your key (and the keys you invite) gets in.
7. Runs the same [`deploy/provision.sh`](../deploy/provision.sh) as [any server](self-hosting.md): Node 22, git, the GitHub CLI, **Claude Code** and the office, under systemd, listening on `127.0.0.1:4600` on the VM. The office keeps its data in `~/agent-office` on the VM and clones projects into `~/workspace/<owner>/<repo>`.
8. Opens an SSH tunnel and your browser at `http://localhost:4600`. **The first page shows the office password once. Write it down.** The office opens on its elevator: pick a repository and it becomes the first floor.

Keep the terminal open while you use the office; Ctrl-C closes the tunnel. Next time, run `deploy/gcp.sh open`.

Everything the script makes is named `agent-office` (or `agent-office-<name>` with `--name`) and described as `Agent Office <name>`, and the VM carries an `agent-office=<name>` label. The script won't touch, or delete, a resource of those names it didn't make.

## A private office

Company projects often come with two organization policies: `constraints/compute.vmExternalIpAccess` (no VM may have a public address) and `constraints/compute.requireOsLogin` (SSH keys go through [OS Login](https://cloud.google.com/compute/docs/oslogin), not instance metadata). `up` reads both before it creates anything, and when either is on it makes a **private office** instead. `up --private` makes one anywhere.

A private office differs from the one above in four ways:

1. **No public address.** The VM only has an address inside its own network. For its own way to the internet (apt, GitHub, npm, Claude), `up` adds a Cloud Router with [Cloud NAT](https://cloud.google.com/nat/docs/overview) to the network, `agent-office-router` and `agent-office-nat`. NAT costs about $0.045 an hour plus a little per GiB, which is more than the static address it replaces.
2. **SSH through an [IAP tunnel](https://cloud.google.com/iap/docs/using-tcp-forwarding).** The firewall rule opens port 22 to Google's IAP range (`35.235.240.0/20`) only, and every ssh the script runs goes through `gcloud compute start-iap-tunnel` as its ProxyCommand. So `open`, `ssh`, `logs` and the rest work the same, a few seconds slower per connection, and nothing on the VM is reachable from the internet at all. Who may open a tunnel is an IAM role, the **IAP-secured Tunnel User** (`roles/iap.tunnelResourceAccessor`), rather than a list of IPs: `allow` and `revoke` say so instead of doing anything.
3. **Your key on your OS Login profile.** `up` adds the key to your Google account's OS Login profile (`gcloud compute os-login ssh-keys add`), which every VM with OS Login honours, and signs in as the username that comes with it (`jane_example_com`, say). You need **Compute OS Admin Login** (`roles/compute.osAdminLogin`) in the project for the sudo that provisioning needs. `connect` from a second computer adds that computer's key to the same profile.
4. **Teammates need gcloud.** They still get a locked-down `office` user and tunnel to the office port, but through IAP, so each needs the gcloud CLI signed in to a Google account with the IAP-secured Tunnel User role in the project. `deploy/gcp.sh invite octocat` installs their GitHub keys and prints the command to send them, with the ProxyCommand in it, and the IAM command that gives them the role. The **👥 Invite teammates** panel in the office shows the plain `ssh office@<address>` command, which doesn't reach a private office: send them the one from `invite` instead.

`status` says whether an office is private, and `destroy` deletes the Cloud Router and NAT along with the rest, and takes this computer's key off your OS Login profile.

## The project

`up` needs a Google Cloud project with a billing account. If you don't have one to spare, three commands make one (the project ID has to be unique across Google Cloud):

```bash
gcloud projects create my-agent-office               # add --organization <id> or --folder <id> if you're in one
gcloud billing accounts list                         # the ID of your billing account
gcloud billing projects link my-agent-office --billing-account 012345-6789AB-CDEF01
deploy/gcp.sh up --gcp-project my-agent-office       # turns the Compute Engine API on by itself
```

**`--project`.** Every other deploy script takes `--project owner/repo` for the office's first floor, while on Google Cloud `--project` is how everyone names the project. Both work here: a value with a slash in it is the GitHub repo, one without is the project ID (which can't have one). `--repo owner/repo` and `--gcp-project <id>` are the unambiguous spellings. Without `--gcp-project`, `up` uses the gcloud CLI's current project (`gcloud config set project <id>`), and the office's other commands remember the one `up` used.

## The machine

**Why e2-standard-4.** It's the same size as the t3.xlarge that `deploy/aws.sh` uses and the Standard_D4as_v5 of `deploy/azure.sh`, 4 vCPUs and 16 GiB, for less: around $0.13 an hour on demand in us-central1, against $0.166 and $0.17. The Azure script steers away from Azure's burstable B-series, which slows to 40% once its CPU credits run out. E2 has no credits to run out of: Google places E2 VMs on whatever hardware has room and may oversubscribe it a little, so single-thread speed is a bit less even than on N2 or C3, but an `e2-standard-4` always gets its four vCPUs. Only `e2-micro`, `e2-small` and `e2-medium` share their cores with other VMs, and `up` warns if you pick one of those.

| Type | vCPU | GiB | About $/hour | For |
| --- | --- | --- | --- | --- |
| `e2-standard-4` (default) | 4 | 16 | 0.13 | A few workers at a time |
| `n2d-standard-4` | 4 | 16 | 0.17 | The same on dedicated AMD cores |
| `n2-standard-4` | 4 | 16 | 0.19 | The same on dedicated Intel cores |
| `t2a-standard-4` | 4 | 16 | 0.15 | The same on Arm (Ampere Altra; fewer zones have it) |
| `e2-standard-8` | 8 | 32 | 0.27 | A team, or many workers at once |

(us-central1, on demand, from Google's price list, rounded; other regions differ.)

Pick one with `up --machine-type <type>`, or change it later with `deploy/gcp.sh resize <type>`. Resizing stops the VM, changes its type and starts it again, which takes a minute or two. The address, the disk and everything on it stay. A paused office stays paused, as the new type. The one change Google refuses is between Intel/AMD and Arm types, and `resize` checks for it before it stops anything; for that, `destroy` and `up` again. If Google can't start the VM as the new type (no room for it in the zone just then), `resize` puts it back on the old one.

**Arm.** The Arm types are `t2a-*` (Ampere Altra) and `c4a-*` (Google's Axion). `up` gives them the Arm build of Ubuntu. T2A VMs can't be Shielded VMs, so those are made without secure boot.

**The disk.** 50 GiB of balanced persistent disk (`pd-balanced`), about $5 a month, like the 50 GiB gp3 on AWS. `up --disk 100` makes a new office's disk bigger. The newest machine families (C4, C4A, N4 and the like) only take Hyperdisk, and `up` gives them `hyperdisk-balanced` instead; you can't `resize` between a type that takes Hyperdisk and one that doesn't.

**Pausing.** `pause` stops the VM (`TERMINATED`, in Google's words). Google doesn't bill for a stopped VM's CPU and memory; the disk (about $5 a month) and the reserved IP (about $7 a month while nothing is using it) are all you pay for. `resume` starts it again at the same address, and workers come back asleep: press R at their desk.

**The zone.** A new office goes in `--zone` (`europe-west1-b`, say). Without it, `up` uses the gcloud CLI's default zone (`gcloud config set compute/zone europe-west1-b`), else `us-central1-a`. `--region europe-west1` picks that region's first zone. An office stays in the zone it was created in; the other commands find it by name.

## Your team

Everything in the [AWS reference](aws.md) about teammates works the same, with `deploy/gcp.sh` in place of `deploy/aws.sh`. **👥 Invite teammates** in the **☰** menu installs their SSH keys from GitHub, and their keys log in as a locked-down `office` user that can only forward to the office port. From your terminal:

```bash
deploy/gcp.sh invite octocat        # uses the SSH keys on github.com/octocat
deploy/gcp.sh allow 203.0.113.7     # their IP (SSH answers only allowed IPs)
deploy/gcp.sh allow anywhere        # or every IP: SSH still only takes your key and invited keys
deploy/gcp.sh uninvite octocat      # remove their keys and drop open tunnels
deploy/gcp.sh team                  # who's invited
deploy/gcp.sh revoke 203.0.113.7    # take an IP back off the list
```

The office knows it was deployed with `deploy/gcp.sh`, so the commands it suggests in **👥 Invite teammates** and on the **🌐 Services** board are the Google Cloud ones. To get every worker's web server on your own computer without a command for each, run [`agent-office tunnel`](tunnel.md) there.

Accounts work as in the [README](../README.md#add-users). To make an invite link from your terminal:

```bash
deploy/gcp.sh ssh 'node /opt/agent-office/bin/agent-office.js accounts invite ada --dir "$(cat /etc/agent-office/home)"'
```

## Everything else

```bash
deploy/gcp.sh open                     # tunnel + open the office in your browser
deploy/gcp.sh service 5173             # open a worker's web server from the 🌐 Services board
deploy/gcp.sh status                   # VM, address, office up?, team, allowed IPs
deploy/gcp.sh resize e2-standard-8     # bigger or smaller VM; same address, a minute or two of downtime
deploy/gcp.sh update                   # install the latest agent-office and restart
deploy/gcp.sh reset-password           # new password, shown once; signs everyone out
deploy/gcp.sh ssh | logs               # get on the VM / follow the office logs
```

**⬆️ Upgrade the office** in the **☰** menu works too.

Useful options for `up`:

- `--gcp-project <id>` puts the office in that project rather than the gcloud CLI's current one. The office's other commands remember it.
- `--zone <zone>` or `--region <region>` picks where a new office goes.
- `--machine-type` and `--disk` set the machine type and disk size.
- `--project owner/repo` (or `--repo`) also clones that repo as the office's first floor.
- `--allow <ip>` lets more IPs reach SSH from the start.
- `--private` makes a [private office](#a-private-office) even where a public one is allowed.
- `--name <name>` runs several offices side by side, each with resources of its own: `agent-office-<name>`, `agent-office-<name>-net`, `agent-office-<name>-ssh` (and `-router`, `-nat` when private). Every other command then takes the same `--name`, before or after the command, and the commands the office itself suggests include it.
- `--claude-token "$(claude setup-token)"`, `--anthropic-api-key`, `--github-token` and `--no-github-token` work as they do on [AWS](aws.md).

**From a second computer.** The SSH key lives on the computer that ran `up`. On another one, signed in to the same project (or with `--gcp-project`), run `deploy/gcp.sh connect`: it makes that computer a key, adds it to the VM's `ssh-keys` metadata, and lets its IP through the firewall. It changes nothing else, where `up` would also re-provision the VM with that computer's GitHub token and git name. Copying `~/.config/agent-office/gcp/<name>/` across works too.

**Running `up` again** re-provisions the VM, which is how `--machine-type`, `--project` or a new `--claude-token` get applied. Without `--claude-token` or `--anthropic-api-key`, it keeps the Claude sign-in it was given before.

**Settings.** Like on AWS, office settings go in `/etc/agent-office/env` on the VM (`deploy/gcp.sh ssh`, then `sudo nano /etc/agent-office/env` and `sudo systemctl restart agent-office`). The VM's clock is UTC, so set `AGENT_OFFICE_CITY="Portland, Oregon"` there for the office's weather, and its holiday calendar, to be yours.

## When Google says no

- **Billing.** *"Billing account for project … is not found"* or *"billing must be enabled"* when `up` turns the Compute Engine API on: link one with `gcloud billing projects link <project> --billing-account <id>` (`gcloud billing accounts list` has the IDs). A free-trial account works; it comes with a few hundred dollars of credit and a quota of 8 vCPUs per region, which the default type fits.
- **Quota.** *"Quota 'CPUS' exceeded"*: the project can't run that many vCPUs in the region. Ask for more in the console under **IAM & Admin → Quotas** (the `CPUS` quota for the region, or the family's own, like `E2_CPUS`), or run `up` again with a smaller `--machine-type`. A brand-new project's regional quota is often 8 to 12 vCPUs: one `e2-standard-4` fits, an `e2-standard-8` may not.
- **Type not available.** `up` checks first and stops before creating anything. To list the types in a zone: `gcloud compute machine-types list --zones us-central1-a --filter='name~^e2-standard'`.
- **No room.** *"ZONE_RESOURCE_POOL_EXHAUSTED"* means the zone is out of that type just then. Try another `--zone`, or another type.
- **Organization policies.** `constraints/compute.requireOsLogin` and `constraints/compute.vmExternalIpAccess` turn the office [private](#a-private-office), which `up` does by itself when it can read them. If it can't (the account lacks `orgpolicy.policy.get`), a public `up` fails at the VM (*"Constraint constraints/compute.vmExternalIpAccess violated"*) or at SSH (*"Permission denied (publickey)"* on a fresh VM is OS Login): run `up --private`. `skipDefaultNetworkCreation` doesn't get in the way, since the office brings its own network. On a private office, *"failed to connect to backend"* from the tunnel means the VM is still booting, and *"Permission denied"* means the account lacks the IAP-secured Tunnel User or Compute OS Admin Login role.
- **A half-made office.** If `up` stops partway (a quota, a lost connection), run it again: it reuses whatever it already made. `destroy` removes all of it.
- **SSH won't connect.** SSH only answers the IPs you allowed. On a new network, `open` says so; `deploy/gcp.sh allow me` lets your new IP in.
