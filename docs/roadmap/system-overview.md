# System overview

Back to the [README](../../README.md). This is the quick map of how a person, a project floor and its workers fit together. For implementation detail, see [How it works](../how-it-works.md) and [Code layout](../code-layout.md).

```mermaid
flowchart LR
  person[Teammate] -->|browser: HTTPS + WebSocket| client[Client<br/>HUD, 3D world, windows]
  client <-->|messages and state| office[Agent Office server<br/>Node.js]

  office --> floors[Floor manager]
  floors -->|one floor per project| project[Project checkout<br/>boards, queue, docs, settings]
  project -->|GitHub CLI| github[GitHub<br/>issues, pull requests, branches]

  office --> manager[Worker manager]
  manager -->|PTY or ACP session| agent[Agent CLI<br/>Claude, Codex, OpenCode, etc.]
  agent -->|reads and changes files| project
  agent -->|hooks / worker tools| hooks[Loopback hook server<br/>status, tasks, worker actions]
  hooks --> manager

  office --> storage[Office data<br/>accounts, floors, chat, settings]
  manager --> workerdata[Project data<br/>sessions, queue, worktrees]
  workerdata --> project

  client -->|live presence, chat, voice signaling| peers[Other teammates]
  office -->|WebRTC signaling| peers
```

## Typical task flow

```mermaid
sequenceDiagram
  actor Teammate
  participant Browser as Browser client
  participant Office as Agent Office server
  participant Floor as Project floor
  participant Worker as Agent worker
  participant GitHub

  Teammate->>Browser: Choose a project and assign work
  Browser->>Office: Send task over WebSocket
  Office->>Floor: Create worker and optional worktree
  Floor->>Worker: Start agent CLI in project directory
  Worker->>Floor: Read and edit project files
  Worker-->>Office: Report status through hooks or ACP
  Office-->>Browser: Stream status and terminal updates
  Worker->>GitHub: Push branch and open pull request
  GitHub-->>Floor: Pull request data is refreshed
  Floor-->>Browser: Show the PR on the board and worker desk
```

The project agent should keep this page aligned with the actual system when architecture changes. Mermaid source stays ordinary Markdown, so it can also be reviewed and edited in GitHub.
