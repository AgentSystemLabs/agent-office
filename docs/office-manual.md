# Agent Office: startup and user manual

This guide covers running Agent Office on your computer, adding GitHub projects, hiring coding agents, and reading the Codex account usage clocks.

## 1. Prepare the host computer

The computer that runs the office needs:

- Node.js 20 or newer.
- Git and the GitHub CLI (`gh`). Sign in with `gh auth login` and make sure that account can clone every repository you want to add. Private repositories require access too.
- At least one supported agent CLI installed and signed in. For this guide, install Codex CLI and sign it in with the ChatGPT account whose allowance you want to monitor. Other supported providers include Claude Code, OpenCode, Grok, Muse, DeepSeek Harness and Pi.

Agent Office runs on this host. The host runs the agent processes, stores project checkouts and reads the Codex account allowance. The browser is the 3D control panel.

## 2. Install and start the office

On Windows, open PowerShell and install the latest release:

```powershell
irm https://raw.githubusercontent.com/AgentSystemLabs/agent-office/main/install.ps1 | iex
```

On macOS or Linux, use:

```sh
curl -fsSL https://raw.githubusercontent.com/AgentSystemLabs/agent-office/main/install.sh | bash
```

After installation, start the office from a terminal:

```sh
agent-office
```

Keep this terminal open while you use the office. It runs the server and prints startup status and the sign-in information. The office listens only on this computer by default.

On first start, the terminal setup asks where projects should be cloned, checks GitHub CLI sign-in, and lets you choose a first repository. Press Enter to skip a question and finish setup in the browser instead. The office opens a browser session already signed in; save the printed office password for signing in from another browser. You can run `agent-office setup` later while the office is stopped to repeat the walkthrough.

Common launch options:

```sh
agent-office --port 4700          # use another local port
agent-office --password 'phrase'  # choose an office password
agent-office --no-open            # print the sign-in link without opening a browser
agent-office ~/code/my-project    # open an existing checkout as a project floor
```

For a shared office that teammates can reach, follow the deployment and user-invitation guides in the [README](../README.md). Do not expose the default local server directly to the internet.

## 3. Add projects to the building

Each GitHub repository is a project floor. In the browser, open the elevator (press **E** or use the elevator control), search for a repository, and add it. Agent Office clones it under the configured project folder as `<folder>/<owner>/<repo>`. Wait for cloning to finish; the new floor then appears in the building.

Add one floor for each repository you want to work on. Workers, terminals and project boards on a floor use that repository's checkout. If the office cannot find a private repository, verify the host's `gh` sign-in and repository permissions, then refresh the repository list.

## 4. Hire and work with an agent

1. Go to the project floor with the elevator.
2. Walk to an empty desk and press **E**.
3. Choose a provider such as **Codex**. Choose a model or effort if the hiring panel offers those settings; otherwise the provider default is used.
4. Open the worker's laptop/terminal. On a first Codex run, complete its sign-in if requested and review the office hook commands with `/hooks`. Approve the hooks in Codex when prompted so the office can track the worker's status. Agent Office preserves Codex's native sandbox and permission prompts.
5. Give the worker a task in its terminal, from an issue or pull-request board, or through the task queue. Watch its status at the desk and open the terminal whenever it needs your input or approval.

Use **N** to jump to the worker that has waited longest for you. The **Workers** panel shows what each desk is doing. Issues, pull requests, task queue, whiteboard and other panels are available from the **☰** menu.

## 5. Read the Codex percentage clocks

Open **☰ → Codex limits** to show the HUD panel. It reports the Codex account signed in on the office host, the plan name, the 5-hour and weekly allowance percentages, and reset times. Click the panel to request a refresh; automatic polling runs every two minutes while someone is connected. Manual refresh has a short cooldown.

The percentage clocks show plan allowance, not worker token totals or API spend. They are shared host-account data: everyone signed in to this office sees the same allowance. The host must have Codex CLI installed and signed in with a ChatGPT plan. API-key-only sign-ins do not provide these plan limits. If the panel says the limits are unavailable, check Codex sign-in on the host and refresh after reconnecting.

## 6. Organize the departments in the ASTERO office plan

The supplied department chart is a useful way to divide tasks across the office. In the current Agent Office model, repositories are floors and agents are hired at desks; the chart's departments are not automatically created as separate rooms or teams. Use department names in task titles, issue labels, queue items and worker prompts to make assignments clear:

| Department | Work categories from the chart |
| --- | --- |
| E-Marketing | Online marketing and traffic; CRM and community; content and design; research and development |
| Supply & Demand | Procurement; fulfilment and logistics; research and development |
| E-Commerce | Webshop management; omnichannel; UX and product; account management |
| E-ICT / Data | Front- and back-end development; architecture; web analytics; business analysis; data modelling |
| E-Legal / Admin | Business administration; IT law and product certification |

For example, title a queue task `E-ICT / Data — add weekly analytics export`, select the project floor that contains the relevant repository, and hire the provider suited to that work. Cross-project work can be coordinated through linked tasks and meetings; keep each worker on the floor that contains its checkout.

## 7. Stop and restart

Stop the office with **Ctrl+C** in the terminal that started it. Project checkouts and office data remain on the host. Start it again with `agent-office`; the office will reopen on the configured port. A deployed office runs as a service and is managed using its deployment-specific commands instead.

For the complete feature, provider, account and deployment references, see [Features](features.md), [Agents](agents.md), [Configuration](configuration.md), and the [README](../README.md).
