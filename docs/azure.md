# Azure reference

The full story behind `deploy/azure.sh`. The short version is in the [README](../README.md#deploy-to-azure).

It's the Azure twin of [`deploy/aws.sh`](aws.md): the same commands, the same [`deploy/provision.sh`](../deploy/provision.sh) on the machine, and the same rule that the office is only ever reached through an SSH tunnel. If you have the Azure CLI signed in (`az login`), one command gives you your own office on an Azure VM:

```bash
git clone https://github.com/AgentSystemLabs/agent-office && cd agent-office
deploy/azure.sh up
```

After that, the whole lifecycle is four more commands:

```bash
deploy/azure.sh open      # tunnel to the office and open it in your browser
deploy/azure.sh pause     # deallocate the VM to save money (asks first); only the disk and IP are billed
deploy/azure.sh resume    # start it again: same address, same files, then open it
deploy/azure.sh destroy   # delete the office's resource group and everything in it (asks first)
```

What `up` does, in a few minutes:

1. Checks that the VM size is offered to your subscription in the region, before it creates anything.
2. Creates a resource group of its own, `agent-office`, tagged `agent-office=agent-office`. Everything else goes in it, so `destroy` is one `az group delete`. The script won't use or delete a group it didn't make (one without that tag).
3. Creates an SSH key pair, kept in `~/.config/agent-office/azure/<name>/`. It's RSA, because Azure only accepts ED25519 keys for new VMs in preview.
4. Creates a network security group whose one inbound rule opens **only SSH (port 22), and only to your current IP**. The office itself is never on the internet.
5. Gives the machine a static public IP, so its address survives pauses and resizes.
6. Launches a **Standard_D4as_v5** VM (4 vCPU, 16 GiB) with Ubuntu 24.04 LTS, a 64 GiB Premium SSD and Trusted Launch (secure boot and a virtual TPM). You log in to it as `azureuser`.
7. Runs the same [`deploy/provision.sh`](../deploy/provision.sh) as [any server](self-hosting.md): Node 22, git, the GitHub CLI, **Claude Code** and the office, under systemd, listening on `127.0.0.1:4600` on the VM. The office keeps its data in `~/agent-office` on the VM and clones projects into `~/workspace/<owner>/<repo>`.
8. Opens an SSH tunnel and your browser at `http://localhost:4600`. **The first page shows the office password once. Write it down.** The office opens on its elevator: pick a repository and it becomes the first floor.

Keep the terminal open while you use the office; Ctrl-C closes the tunnel. Next time, run `deploy/azure.sh open`.

## The machine

**Why Standard_D4as_v5.** It's the same size as the t3.xlarge that `deploy/aws.sh` uses, 4 vCPUs and 16 GiB, at about the same price: around $0.17 an hour on demand in East US, against $0.166 for the t3.xlarge. Azure's closest twin of the t3 is the burstable `Standard_B4s_v2` ($0.166), but the two burst differently. A t3 runs *unlimited* by default: when it's out of CPU credits it keeps going and bills the extra. A B-series VM that's out of credits slows down to 40% of its CPUs, and a new one has less than an hour of full speed banked. Busy workers building and testing get there quickly, so the default is a size that never slows down.

| Size | vCPU | GiB | About $/hour | For |
| --- | --- | --- | --- | --- |
| `Standard_D4as_v5` (default) | 4 | 16 | 0.17 | A few workers at a time, at full speed |
| `Standard_B4s_v2` | 4 | 16 | 0.17 | The same, burstable: slows to 40% when its credits run out |
| `Standard_B4as_v2` | 4 | 16 | 0.15 | Burstable too, on AMD |
| `Standard_D8as_v5` | 8 | 32 | 0.34 | A team, or many workers at once |

(East US, on demand, from Azure's retail price list; other regions differ.)

Pick one with `up --size <size>`, or change it later with `deploy/azure.sh resize <size>`. Resizing deallocates the VM, changes its size and starts it again, which takes a few minutes. The address, the disk and everything on it stay. A paused office stays paused, as the new size. Azure refuses some changes, and `resize` checks for them before it stops anything: between Intel/AMD and Arm sizes, between a size with a local temp disk and one without (`Standard_B4ms` and `Standard_B4s_v2`, say), to a size without Trusted Launch or without Premium SSD (no `s` after the number, like `Standard_D8_v5`), or to one that only takes NVMe disks (most v6 sizes). For those, `destroy` and `up` again. If Azure can't start the VM as the new size (no room for it in the region just then), `resize` puts it back on the old one.

**Arm.** The Arm sizes have a `p` in their name. `up` takes the Cobalt ones, like `Standard_D4ps_v6`, and gives them the Arm build of Ubuntu. It turns down the older Ampere B-series ones (`Standard_B4ps_v2`), which can't run Trusted Launch.

**The disk.** Premium SSD is billed by tier, and every size from 33 to 64 GiB costs the same (P6), so the default is 64. `up --disk 128` makes a new office's disk the next tier up.

**Pausing.** `pause` *deallocates* the VM. Azure stops billing for a deallocated VM, but not for one that's only stopped (shut down from inside, or `az vm stop`), so the script always deallocates. While it's paused, the disk (about $10 a month for P6) and the static IP are all you pay for. `resume` starts it again at the same address, and workers come back asleep: press R at their desk.

## Your team

Everything in the [AWS reference](aws.md) about teammates works the same, with `deploy/azure.sh` in place of `deploy/aws.sh`. **👥 Invite teammates** in the **☰** menu installs their SSH keys from GitHub, and their keys log in as a locked-down `office` user that can only forward to the office port. From your terminal:

```bash
deploy/azure.sh invite octocat        # uses the SSH keys on github.com/octocat
deploy/azure.sh allow 203.0.113.7     # their IP (SSH answers only allowed IPs)
deploy/azure.sh allow anywhere        # or every IP: SSH still only takes your key and invited keys
deploy/azure.sh uninvite octocat      # remove their keys and drop open tunnels
deploy/azure.sh team                  # who's invited
deploy/azure.sh revoke 203.0.113.7    # take an IP back off the list
```

The office knows it was deployed with `deploy/azure.sh`, so the commands it suggests in **👥 Invite teammates** and on the **🌐 Services** board are the Azure ones.

Accounts work as in the [README](../README.md#add-users). To make an invite link from your terminal:

```bash
deploy/azure.sh ssh 'node /opt/agent-office/bin/agent-office.js accounts invite ada --dir "$(cat /etc/agent-office/home)"'
```

## Everything else

```bash
deploy/azure.sh open                     # tunnel + open the office in your browser
deploy/azure.sh service 5173             # open a worker's web server from the 🌐 Services board
deploy/azure.sh status                   # VM, address, office up?, team, allowed IPs
deploy/azure.sh resize Standard_D8as_v5  # bigger or smaller VM; same address, a few minutes of downtime
deploy/azure.sh update                   # install the latest agent-office and restart
deploy/azure.sh reset-password           # new password, shown once; signs everyone out
deploy/azure.sh ssh | logs               # get on the VM / follow the office logs
```

**⬆️ Upgrade the office** in the **☰** menu works too.

Useful options for `up`:

- `--location westeurope` picks the region for a new office (`--region` works too). Without it, `up` uses your Azure CLI's default location (`az config set defaults.location=westeurope`), else `eastus`. An office stays in the region it was created in.
- `--subscription <id or name>` uses another subscription than the Azure CLI's current one. The office's other commands remember it.
- `--size` and `--disk` set the VM size and disk size.
- `--project owner/repo` also clones that repo as the office's first floor.
- `--allow <ip>` lets more IPs reach SSH from the start.
- `--name <name>` runs several offices side by side, each in its own resource group, `agent-office-<name>`. Every other command then takes the same `--name`, before or after the command, and the commands the office itself suggests include it.
- `--claude-token "$(claude setup-token)"`, `--anthropic-api-key`, `--github-token` and `--no-github-token` work as they do on [AWS](aws.md).

**From a second computer.** The SSH key lives on the computer that ran `up`. On another one, signed in to the same subscription (or with `--subscription`), run `deploy/azure.sh connect`: it makes that computer a key, adds it to the VM with `az vm user update`, and lets its IP through the firewall. It changes nothing else, where `up` would also re-provision the VM with that computer's GitHub token and git name. Copying `~/.config/agent-office/azure/<name>/` across works too.

**Running `up` again** re-provisions the VM, which is how `--size`, `--project` or a new `--claude-token` get applied. Without `--claude-token` or `--anthropic-api-key`, it keeps the Claude sign-in it was given before.

**Settings.** Like on AWS, office settings go in `/etc/agent-office/env` on the VM (`deploy/azure.sh ssh`, then `sudo nano /etc/agent-office/env` and `sudo systemctl restart agent-office`). The VM's clock is UTC, so set `AGENT_OFFICE_CITY="Portland, Oregon"` there for the office's weather, and its holiday calendar, to be yours.

## When Azure says no

- **Quota.** *"Operation could not be completed as it results in exceeding approved … Cores quota"*: your subscription can't run that many vCPUs of that family in the region. Ask for more in the Azure portal under **Quotas → Compute** (for the default size, "Standard DASv5 Family vCPUs"), or run `up` again with another `--size`. To try another region, `destroy` first, since the office's resource group already lives in the first one. Free Trial and student subscriptions get 4 vCPUs per region and can't ask for more: the default size fits, but anything bigger needs a pay-as-you-go subscription.
- **Size not available.** `up` checks first and stops before creating anything. To list the sizes you can use in a region: `az vm list-skus -l eastus --resource-type virtualMachines --size Standard_B -o table`.
- **A half-made office.** If `up` stops partway (a quota, a lost connection), run it again: it reuses whatever it already made. `destroy` removes all of it. (Azure may also make a `NetworkWatcherRG` resource group of its own for the region. It's free, and it's not the office's to delete.)
- **SSH won't connect.** SSH only answers the IPs you allowed. On a new network, `open` says so; `deploy/azure.sh allow me` lets your new IP in.
