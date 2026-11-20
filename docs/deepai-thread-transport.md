# A DeepAI Code worker that asks the app to run the turn

DeepAI Code's **model transport** is closed to anything the app didn't start: `startDeepAIModelTransport`
mints a `randomBytes(32)` capability per run and hands it only to its own Pi children
(`"DeepAI credentials never enter Pi's config or renderer"`). A worker the office spawns can never reach
its models — that is why the provider refuses the hire with a reason (see `src/server/deepai.ts`).

Its **orchestration** is not closed. The app publishes an OAuth 2.1 authorization server for MCP clients,
and an admin approves a pairing code once. With that bearer the office asks the app to run a turn in a
workspace — including a worktree the office made — and reads the transcript back. Nothing is reverse
engineered: it is the same "Agent sign-in" flow the app shows under Settings → Connections.

## What the spike proved (20 Nov 2026, app 0.3.42)

Measured end to end on this machine, then thrown away (project and worktree deleted):

| check | result |
|---|---|
| the thread starts | `deepai_thread_launch` → `mcp:4bb43a41…`, one run, `status: completed` |
| the transcript comes back | two items: the `user_message`, then `assistant_message: "fatto"` |
| it works in the worktree I chose | ran in `~/.deepai-code/worktrees/spike-office/t3-58f9b1ac`, wrote `hello.txt`; the project root stayed untouched |
| an **office** worktree is accepted | `existing_worktree` on `/tmp/spike-desk/desk-1` (a worktree made outside the app) → the run answered `/private/tmp/spike-desk/desk-1` |

The whole chain, as observed:

- `GET /.well-known/oauth-authorization-server` → `register`, `authorize`, `token`, PKCE `S256`, `none`
- `POST /oauth/mcp/register` (dynamic client registration) → `201` and a `client_id`
- `GET /oauth/mcp/authorize?…` → `302 /connect-agent?…`, the page that asks for a **pairing code**
  (`deepai auth pairing create`, or Settings → Connections) and a permission mode
- approve → `302 http://127.0.0.1:4599/callback?code=…`
- `POST /oauth/mcp/token` with the verifier → `access_token`, `expires_in: 2592000` (**30 days**),
  scope `orchestration:read orchestration:operate`
- the MCP handshake needs `mcp-protocol-version: 2025-06-18` on every call after `initialize`, and the
  `mcp-session-id` the app hands out; answers come back as JSON or as an SSE stream
- **88 tools** with that scope, among them `deepai_project_create`, `deepai_thread_launch`,
  `deepai_thread_send`, `deepai_thread_read`, `deepai_thread_wait`, `deepai_thread_interrupt`,
  `deepai_thread_configure`, `deepai_worktree_list`, `orchestrator_capabilities`
- the run used `deepai/glm-5.3-flash`: a free model, **0 Theos**

## Shape in the office

`ProviderAdapter.transport` already has a second value besides `'pty'`: `'acp'`, for DeepSeek Harness
(`src/server/workers/acp.ts`, `docs/dsh-acp-integration.md`). That is exactly this case — no child
process, the office draws the worker's terminal itself — so DeepAI Code gets a third: **`'thread'`**.

- `src/server/deepai-mcp.ts` (done): the MCP client (handshake, session, protocol header, SSE or JSON,
  `isError` → `DeepaiMcpError`), the credential file (`<dataDir>/deepai-mcp.json`, `0600`, expiry
  checked on read), and the pairing pieces (`registerDeepaiClient`, `deepaiAuthorizeUrl`,
  `exchangeDeepaiCode`, `pkce`, `loopbackRedirect`). Tests in `tests/deepai-mcp.test.ts` run against a
  fake MCP endpoint, so they need neither the app nor a token.
- `src/server/deepai-thread.ts` (next): `ThreadSession`, the same callback shape as `DshSession` —
  `output` (items rendered into the terminal), `status`, `usage`, `session` (the thread id), `exit`,
  `prompted`. It owns one thread: launch it, follow its runs, send follow-ups, interrupt.
- `src/server/workers/manager.ts` (next): one more branch next to `transport === 'acp'`
  (around line 699) that calls `launchThread` instead of `host.spawn`.
- `src/server/providers/deepai.ts` (next): `launch` no longer returns an argv; it hands the workspace,
  the model and the first prompt to the thread transport. `prepare` stops writing a launcher.

### How a desk maps onto a thread

| office | app |
|---|---|
| hire (first prompt) | `deepai_thread_launch` with `workspaceStrategy: {type:'existing_worktree', worktreePath: <desk cwd>}` and `message` |
| the desk's terminal | the run's items, rendered as text (commands, reasoning, the answer) |
| working / idle | `status` of the thread's run: running → working, completed → idle |
| Enter (send) | `deepai_thread_send` on the same thread |
| Esc | `deepai_thread_interrupt` |
| R (resume) | the thread still exists: send to it again, no new session |
| send home | nothing to kill: the worktree and branch are the office's, as with every provider |

The project the thread belongs to is the floor's checkout (`workspaceRoot`), registered on first use with
`deepai_project_create`; the desk's worktree is bound with `existing_worktree`, which the spike showed
works for a worktree the app did not create. This is the one thing to keep testing: the app must not
also make a worktree when one is given.

### Models

`orchestrator_capabilities` lists the `deepai` instance with 27 model ids (`deepai/glm-5.3-flash`,
`deepai/claude-sonnet-5-5`, …). The hire dialog should read them from there instead of `models.json`,
and the free/premier note stays what `theosPerRequest` says — free models cost nothing, so a worker
belongs on a free one.

### Limits worth knowing

- The bearer lasts **30 days**: pairing again is one click, and the desk says so when it lapses
  (`401` → "pair again"). If the app ever issues a refresh token, this becomes automatic.
- The thread lives in the app: it shows up in the app's own thread list, and its transcript is the
  app's. The office's copy is the worker's terminal, as with ACP.
- The endpoints are the app's; they can change with an update. They are a published OAuth contract with
  a discovery document, so a change is visible (`/.well-known/oauth-authorization-server`) instead of
  silent, which is what the model transport was.

## Where the old work is (backup, 20 Nov 2026)

Nothing of the closed road was thrown away, because it is what runs on this machine today:

- **`deepai-spawn-approach`** — tag on `6d35354`, the whole spawn-based provider: the `deepai-agent`
  launcher, `models.json` as the model catalogue, and the check that refuses a hire when the app's key
  is a variable only the app can fill. This is what `v0.1.212-deepai` (the install running here,
  `~/.local/share/agent-office/versions/v0.1.212-deepai`) still is, with its own `PATCH-NOTES.md`.
- **`deepai-checkpoint-2026-11-20`** — tag on `aa6ae11`, this checkpoint: MCP client, credential,
  pairing, tests, and this document.
- **The credential** the pairing issued: `~/.agent-office/deepai-mcp.json` (mode `0600`), 30 days,
  expires 20 Dec 2026. It is a secret: it is not in the repository, and it must not be.
- The reasoning, measured on the way (why the model transport is closed, what was tried, the numbers):
  `~/.Brain`-side skill `skills/agent-office-provider-nuovo.md` in the `ezio-brain` repository.
