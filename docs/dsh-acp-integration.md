# DeepSeek Harness (DSH) as a fourth provider, over ACP

Status: **implemented** (Phases 1–4; Phase 0 measurements, and the one item still open, are recorded
at the end). Target: agent-office `main`, DSH `0.1.7-rc.2`.

## Summary

agent-office runs one agent CLI in a PTY per worker and mirrors that terminal to everyone in the
room. Claude Code, OpenCode and Codex all fit that shape; **DSH does not**, because it has no
interactive terminal. Its interactive surface is a browser app.

This document proposes integrating DSH through its **ACP profile** (`dsh acp`), a JSON-RPC stdio
protocol, instead of a PTY. ACP hands the office structured sessions, prompts, tool lifecycles,
permission requests, usage and resume — the same facts the office currently reconstructs by
scraping hooks and transcript files, but delivered directly and with fewer gaps.

The ACP worker keeps the office's terminal window, scrollback and sharing by **rendering the
transcript into the existing headless terminal**, so the client needs almost no new UI.

## Why this needs a decision at all

`dsh` is a profile launcher, not a terminal agent:

```
dsh [--profile] <name> [options] [app-args...]
```

The shipped profile templates are exactly `acp`, `web`, `headless`, `sdk` and `sdk-minimal`
(`PROFILE_TEMPLATES` in `@deepseek-ai/dsh-app-boot`). There is no `tui` profile, and no
readline/Ink/blessed dependency anywhere in the installed tree. A profile directory only appears
once created, under `$DSH_HOME/profiles/<name>`.

So "add DSH as a provider" cannot mean "spawn `dsh` in the PTY at the desk" the way the other
three work. Something has to change; the only question is what.

### Surface comparison

| Surface | What it gives | Fit as a worker |
|---|---|---|
| `dsh acp` | ACP v1 over stdio: sessions, prompts, tool lifecycle, permissions, usage, resume | **Chosen.** Structured, complete, testable without a DSH install |
| `dsh web` | HTTP server + browser GUI | PTY would only show a URL; needs a new embed window and a framing/CSP audit |
| `dsh headless` | One task, print result, exit | Fine for a queue task, wrong for an interactive worker |

## Alternatives considered

### Reusing the shipped hook bridges

DSH ships `@deepseek-ai/dsh-hooks-claude-code` and `@deepseek-ai/dsh-hooks-codex`. Each mounts a
bridge that runs an existing Claude Code `hooks.json` or Codex hook config on DSH's interception
seams. Pointing one at the office's own generated config (`claude-hooks.json`, written in
`workers.ts`) looks almost free: the hooks are shell commands that `curl` the office's loopback
endpoint carrying `$AGENT_OFFICE_HOOK_URL`, `$AGENT_OFFICE_HOOK_TOKEN` and
`$AGENT_OFFICE_WORKER_ID`, all of which the office already sets on the child environment.

Two documented gaps rule it out as a foundation:

- **No `PermissionRequest` and no `Notification`.** The Claude bridge supports only
  `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStart` and
  `SubagentStop`; the Codex bridge supports five events and no permission event at all. The office
  derives `needs_input` from exactly those missing events (`handleHook`, `handleCodexHook`), so a
  DSH worker could never signal that it is waiting on a human — the jump, the ding and the antenna
  bulb would not fire.
- **`transcript_path` is never populated** — empty string in the Claude bridge, `null` in the Codex
  bridge, because DSH's session log is Zstandard-compressed and not readable by hook scripts. That
  breaks both Claude-style transcript costing and the Codex rollout reader, so usage goes dark.

The bridges remain useful as a status-only stopgap, but they cannot carry `needs_input` or usage.

### Driving `dsh web` per worker

Each worker would get its own `dsh web` server on a loopback port, with the office embedding the
GUI. This preserves DSH's real interface, but it costs a new window type, an iframe (whose
framing/CSP behaviour is untested), per-worker port and lifetime management, and it still leaves
status and usage to the hook bridges above. Rejected as the primary path; see Phase 5.

## The ACP surface

`dsh --profile acp` speaks ACP v1 over newline-delimited JSON-RPC on stdio. The client library is
`@agentclientprotocol/sdk` (1.4.0), a public npm package that agent-office would add as a
dependency.

Supported calls, from the `dsh-acp` contract:

| Call | What it gives |
|---|---|
| `initialize` | ACP v1 plus `session/list`, `session/resume`, `session/close` |
| `session/new` | A fresh persistent agent for an absolute `cwd`, plus its complete configuration-option state |
| `session/list` | Newest-first pages of persisted, resumable root sessions, with an optional absolute `cwd` filter |
| `session/resume` | A persisted inactive session, log restored without replaying old updates |
| `session/set_config_option` | Serialized update to the advertised `model` or `reasoning_effort` |
| `session/prompt` | One prompt at a time per session; settlement follows agent idle and ordered update delivery |
| `session/cancel` | The prompt-owned cancellation path |
| `session/update` | Committed assistant messages and thoughts, generic tool lifecycle, configuration changes, context usage |
| `session/request_permission` | A permission prompt with one-shot allow/reject choices |
| `session/close` | Quiescent cancellation, update draining, persistence flush |

Explicitly **unsupported**, and therefore not available to a DSH worker: `session/load`, session
deletion and fork, additional directories, modes, commands, plans, terminals, client filesystem
operations and elicitation. The practical loss is slash-commands such as `/compact`, which the
other three providers expose through their terminals. See Risks.

## Mapping onto agent-office

### Provider seams

Adding a provider touches a known, finite set of places. `'dsh'` joins the
`AgentProvider` union in `src/shared/protocol.ts` and is threaded through:

| Concern | File |
|---|---|
| Union, `isAgentProvider`, persistence allowlist | `src/shared/protocol.ts`, `src/server/workers.ts` |
| Executable → provider, model and effort validation | `src/server/agents.ts` |
| Which providers a floor offers | `src/server/floor.ts` |
| Labels, badges, usage state and notes | `src/client/ui/provider.ts` |
| Usage labels | `src/client/ui/terminal.ts`, `hud.ts`, `queue.ts`, `usage.ts` |
| Queue and meeting model plumbing | `src/server/queue.ts`, `src/server/meetings.ts` |

Two validation rules need real changes rather than a new case:

- `validateWorkerEffort` currently answers `"Reasoning effort can only be selected for Claude Code
  workers"`. DSH advertises a `reasoning_effort` config option, so DSH must join Claude here.
- `validateWorkerModel` allows Claude aliases and OpenCode `provider/model` ids. DSH's admissible
  models are **opaque option ids from the live catalog** (`session/new` configuration-option
  state), not a pattern the office can validate syntactically. DSH model validation should be
  length-and-control-character bounded only, and the UI should prefer the advertised choices.

### Worker status

`WorkerStatus` already has every state DSH needs, so the union does not change. Derivation:

| Status | ACP trigger |
|---|---|
| `starting` | Child spawned, before `initialize` / session ready |
| `idle` | Session ready and no prompt in flight; first prompt not yet given |
| `working` | A `session/prompt` request is in flight |
| `needs_input` | A `session/request_permission` is outstanding |
| `done` | The prompt settled with a `stopReason` |
| `exited` | The child process ended |
| `offline` | Restored from disk after a restart, then `session/resume` |

This is a better model than the hook path: `session/request_permission` is a *request the office
must answer*, not a fire-and-forget notification, so `needs_input` is authoritative rather than
inferred.

### Worker actions

`src/shared/actions.ts` maps a tool *name* to a `WorkerAction`. ACP instead supplies a semantic
`ToolKind` (`read`, `edit`, `delete`, `move`, `search`, `execute`, `think`, `fetch`,
`switch_mode`, `other`), which is more reliable than name matching. Add a parallel mapper:

| ACP `ToolKind` | `WorkerAction` |
|---|---|
| `read` | `read` |
| `edit`, `delete`, `move` | `edit` |
| `execute` | `commandAction(rawInput.command)` — `test` or `read`, else plain typing |
| `search` | `read` (code search); inspect `title`/`rawInput` to route web search to `web` |
| `fetch` | `web` |
| `think`, `switch_mode`, `other` | none (plain typing) |

`failing` comes from a `tool_call_update` whose `status` is `failed`, in place of the current
`outputFailed` scan — or in addition to it, from `rawOutput`.

### Usage

ACP's `usage_update` carries `used` (tokens in context), `size` (context window) and an optional
cumulative `cost`. That is context pressure plus, possibly, spend — not the
input/output/cacheWrite/cacheRead split the office's `Usage` type wants.

Two options, decided by the Phase 0 spike:

1. **If `cost` is populated**, wire it straight into `Usage.cost` and leave the token breakdown
   unavailable, the way Codex already reports cost as unavailable.
2. **Otherwise**, set the profile's `session-persistence-jsonl` row to `compression: 'none'` with an
   office-owned `root`, then fold token records out of the plain JSONL log — the same shape of work
   as `src/server/usage.ts` does for Claude transcripts.

The office's `--budget` is deliberately Claude-only today. Whether DSH spend joins it is a product
decision, not a technical one; the doc defaults to **not** joining it, matching OpenCode and Codex.

## Architecture

```
                        ┌──────────────────────────────────────────┐
                        │ office server                            │
                        │                                          │
   browser ── ws ──────▶│  Workers                                 │
                        │   ├─ PTY workers ──▶ ptyhost ──▶ claude  │
                        │   │                   (out of process)   │
                        │   └─ DSH worker ───▶ DshSession          │
                        │                        │ ACP/stdio       │
                        │                        ▼                 │
                        │                   dsh --profile acp      │
                        │                        │                 │
                        │              .agent-office/dsh-sessions  │
                        └──────────────────────────────────────────┘
```

The key design choice: **a DSH worker still has a headless terminal.** ACP updates are rendered
into it as ANSI lines. Everything downstream — `screenSnapshot`, `SCROLLBACK`, scrollback
persistence, `worker.attach` broadcasting, search, reconnection — keeps working with no changes.

### New module: `src/server/dsh.ts`

Mirrors the role of `src/server/opencode.ts` and `src/server/codex.ts`:

- Locate the `dsh` executable and the profile name (`--dsh-profile`, env
  `AGENT_OFFICE_DSH_PROFILE`, default `acp`).
- Spawn the child with the worker's `cwd`, the shared `AGENT_OFFICE_*` environment and, for board
  agents, `office-queue` first on `PATH` — the existing environment block in `workers.ts` already
  does both, so it carries over unchanged.
- Own the ACP connection: `initialize`, `session/new`, `session/prompt`, `session/cancel`,
  `session/set_config_option`, `session/list`, `session/resume`, `session/close`.
- Translate `session/update` and `session/request_permission` into the office's status, action and
  usage vocabulary.
- Render transcript lines into the worker's headless terminal.

### Integration points

| Behaviour | Today | For DSH |
|---|---|---|
| Spawn | `workers.ts` builds argv per provider, hands to `host.spawn` | Build no argv; start a `DshSession` instead |
| Terminal input | `term.input` → `workers.write` → PTY | Branch in `write`: buffer bytes to a line, submit on Enter via `session/prompt`; Esc/Ctrl+C → `session/cancel` |
| Resize | `workers.resize` → PTY | ACP has no terminal size; only the office's headless terminal is resized, so the transcript fills the window |
| Status | `handleHook` / `handleCodexHook` / `handleOpenCodeHook` | New `DshSession` event handler calling the same `setStatus` |
| Resume (R) | `--resume` / `--session` / `codex resume` argv | `session/resume` with the worker's stored session id; a fresh `session/new` if the harness no longer has it (never another desk's newest session: desks without a worktree share the checkout) |
| Send home / stop | Kill the PTY | `session/cancel`, then `session/close`, then end the child |
| Restart survival | `ptyhost` keeps the PTY alive out of process | **Different.** The ACP child dies with the server; mark the worker `offline` on boot and resume via `session/resume` against the on-disk persistence root |

The restart difference is worth stating plainly: DSH workers do **not** keep working through an
office restart the way PTY workers do. They come back resumable, which is the same user-visible
affordance as R on an exited Claude worker, but the agent is not running in the meantime.

### Profile configuration

The office should not depend on the user's `~/.dsh` profile being set up. Two mechanisms:

- `--patch <path>` applies an extra overlay after the profile layer. The office writes a per-worker
  patch that sets the persistence `root` under `<dir>/.agent-office/dsh-sessions` (and
  `compression: 'none'` if Phase 3 needs the log) and pins the model/provider rows.
- `session/set_config_option` handles per-worker model and reasoning effort at runtime, so the
  patch does not need to vary per worker for those.

## Phases

### Phase 0 — spike (throwaway)

Goal: replace assumptions with measurements before committing estimates.

- [x] Boot `dsh --profile acp` and complete `initialize` + `session/new` with an absolute `cwd`.
- [ ] Confirm `session/prompt` streams `session/update`, and record the exact update variants DSH emits.
- [ ] Determine whether `usage_update.cost` is populated, and what `used`/`size` contain.
- [~] Provoke a `session/request_permission` and answer it; confirm it blocks until answered.
- [x] Confirm `session/list` + `session/resume` work across a process restart.
- [x] Confirm the advertised configuration options include `model` and `reasoning_effort`.
- [x] Decide shipped `acp` profile vs. an office-owned profile directory.

Output: a short findings note appended to this document, and a decision on usage (option 1 or 2).

### Phase 1 — provider plumbing

- [x] Add `'dsh'` to `AgentProvider` and `isAgentProvider`; update the persistence allowlists.
- [x] Map the `dsh` executable in `configuredProvider`; add `validateWorkerModel` and
      `validateWorkerEffort` rules.
- [x] Add `'dsh'` to `agentProviders` in `floor.ts`.
- [x] Add `PROVIDER_LABEL.dsh = 'DeepSeek Harness'` and cover `supportedProviders`, `modelBadge`,
      `providerUsageTracked`, `providerUsageState`, `providerUsageNote`.
- [x] Cover the usage-label branches in `terminal.ts`, `hud.ts`, `queue.ts`, `usage.ts`
      (a shared `providerWaitingLabel` replaces the per-provider ternaries).
- [x] Thread provider/model through `queue.ts` and `meetings.ts`.
- [x] Tests: extend `tests/agents.test.ts`, `tests/queue.test.ts` (worker persistence is covered in
      `tests/dsh.test.ts`, since the PTY-based `tests/workers.test.ts` cannot run without a PTY).

### Phase 2 — the ACP worker runtime

- [x] `src/server/dsh.ts`: locate `dsh`, spawn the child, own the ACP connection.
- [x] Status derivation from `session/new`, `session/prompt` settlement and `session/request_permission`.
- [x] Action mapping from `ToolKind`, alongside the existing name-based mapper.
- [x] Render transcript into the headless terminal; keep scrollback, sharing and search working.
- [x] Branch `workers.write` for line-oriented input; Esc/Ctrl+C to `session/cancel`.
- [x] Resume via `session/resume` with the worker's stored id; wire the R affordance.
- [x] Restart path: mark DSH workers `offline` on boot and resume from the persistence root.
- [x] Config: `--dsh-profile`, `AGENT_OFFICE_DSH_PROFILE`, per-floor patch with an office-owned
      persistence root, `--agent dsh` as a default.
- [x] Tests: `tests/dsh.test.ts` driving a fake ACP agent over stdio, so the suite needs no DSH
      install. Cover status transitions, permission → `needs_input`, tool kinds → actions, cancel,
      and resume.

### Phase 3 — usage and budget

- [x] Wire `usage_update` into `Usage` per the Phase 0 decision (option 1: context occupancy, cost
      only when the harness sends one).
- [x] ~~If needed, read the plain JSONL session log for the token breakdown.~~ Not needed: the office
      sets only the persistence `root`, leaving DSH's own compression alone.
- [x] Update the usage labels and notes added in Phase 1 from "untracked" to accurate states.
- [x] Decide budget participation: DSH stays out of `--budget`, matching OpenCode and Codex, and the
      README says so.

### Phase 4 — polish

- [x] README: provider list, hire flow, status, usage, resume, provider-specific section.
- [x] `--help` text in `config.ts`.
- [x] `install.sh` / `install.ps1`: include DSH in the "no provider found" hint.
- [ ] Model catalogue endpoint mirroring `/api/agents/opencode/models`, if DSH exposes one.
      (It does expose a catalog, in `session/new`'s options; see findings. The picker still takes a
      typed id and resolves it against that catalog at launch.)
- [x] `deploy/aws.sh` note.

### Phase 5 — optional web-embed mode

Unchanged, not started.

A window that hosts the real `dsh web` GUI for a worker, for people who prefer it to the
transcript view. Requires a framing/CSP audit, per-worker port and lifetime management, and a
client window type. Independent of Phases 1–4.

## Risks and open questions

1. **DSH is a release candidate.** `0.1.7-rc.2`. The ACP profile, its configuration rows and the
   hook bridges can all move. Pin a tested version and note it in the README, as the Codex support
   already does (verified against CLI 0.154.0).
2. **Slash-commands are unavailable.** ACP exposes no command surface, so `/compact` and friends
   cannot be typed. Mitigation: office buttons for cancel and compact, or an office-owned profile
   that mounts a small plugin. Needs a decision before Phase 2 closes.
3. **Restart semantics differ from every other provider.** Documented above; the README currently
   promises agents keep working through a restart, and that sentence needs a DSH exception.
4. **Usage fidelity is unknown until the spike.** If `cost` is absent *and* the JSONL log lacks a
   priceable token record, DSH shows context occupancy and nothing else.
5. **Opaque model ids.** The office can no longer validate a model syntactically, so a stale saved
   model must degrade gracefully at `session/new` rather than fail the launch.
6. **`dsh` on `PATH`.** Like the other providers, DSH must be installed and configured as the user
   running the office. The office's `resolveCommand` fallback (a login shell) already covers nvm and
   asdf installs.
7. **One prompt at a time.** ACP serializes prompts per session. If two people type at once, the
   second must queue or be rejected; decide which, and show it in the terminal.

## Testing strategy

The office's suite runs with `node --test` over `tests/*.test.ts` and never needs a real agent
installed — `tests/opencode.test.ts` and `tests/codex.test.ts` test the generated bridge and
payload normalisation, not the upstream CLI. DSH should follow that convention:

- **`tests/dsh.test.ts`** — a fake ACP agent process speaking JSON-RPC over stdio, driven through
  the real `DshSession`. Assert status transitions, permission handling, tool-kind to action
  mapping, cancel and resume.
- **`tests/agents.test.ts`** — the new provider and validation rules.
- **`tests/workers.test.ts`** — persistence and restore of a `dsh` worker, including the `offline`
  boot path.
- Keep all new parsing defensive and non-fatal, matching `actions.ts` and `usage.ts`: an update the
  office does not understand is skipped, never fatal.

## Appendix: evidence

| Claim | Source |
|---|---|
| `dsh` is a profile launcher; templates are `acp`, `web`, `headless`, `sdk`, `sdk-minimal` | `dsh --help`; `PROFILE_TEMPLATES` in `@deepseek-ai/dsh-app-boot/lib/index.js` |
| No interactive terminal exists | No `tui` template; no readline/Ink/blessed in any installed `package.json` |
| ACP call matrix and unsupported surfaces | `@deepseek-ai/dsh-acp/README.md` |
| `ToolKind` values | `@agentclientprotocol/sdk/dist/schema/types.gen.d.ts` |
| `UsageUpdate` fields (`used`, `size`, `cost?`) | same |
| Claude bridge supports no `PermissionRequest`/`Notification`; `transcript_path` always empty | `@deepseek-ai/dsh-hooks-claude-code/README.md` |
| Codex bridge supports five events; `transcript_path` always `null` | `@deepseek-ai/dsh-hooks-codex/README.md` |
| Session logs can be uncompressed JSONL with a configurable root | `@deepseek-ai/dsh-session-persistence-jsonl/README.md` |
| Office hook env vars and endpoint shape | `src/server/workers.ts`, `src/server/codex.ts`, `src/server/opencode.ts` |

## Phase 0 findings (measured 2026-xx, DSH 0.1.7-rc.2, Node 24)

Where the wire was measured, and against what:

| Question | Answer | How |
|---|---|---|
| `initialize` → `session/new` with an absolute cwd | Works. `agentInfo` is `deepseek-harness-acp 0.0.1`; capabilities advertise `sessionCapabilities: {close, list, resume}`, MCP `http: true`, no image prompts | Office's `DshSession` against real `dsh` |
| `session/list` + `session/resume` across a process restart | Works. A second process found the first process's session through `session/list` and resumed it by id | Office's `DshSession` against real `dsh` |
| Advertised configuration options | Exactly `model` and `reasoning_effort`, both `type: "select"` | Office's client; raw JSON-RPC |
| Model option shape | **Not a plain id.** Values are JSON route tuples — `"[\"deepseek-official\",\"deepseek-v4-pro\"]"` — and `options` is **grouped** by provider (`[{group, name, options:[…]}]`) | `session/new` response |
| Effort option shape | `off`, `low`, `high`, `max`. The office's `medium`/`xhigh` do **not** exist, so the office maps onto the nearest rung | `session/new` response |
| `session/prompt` failure mode | A provider failure comes back as a **JSON-RPC error** (`-32603`), not a `stopReason`, so the office renders it and settles the desk as *done* rather than hanging | Real `dsh`, no credentials in an isolated `DSH_HOME` |
| Persistence root override | Works: sessions land under the patched root, in a `--<normalized-cwd>--` directory | `--patch` with `session-persistence-jsonl.root` |
| `--help` claims no stdio | Confirmed: `dsh acp --help` prints the app's help and exits | Real `dsh` |

New findings that change the design:

1. **`dsh` writes to its own profile directory on every boot** (`$DSH_HOME/profiles/<name>/cordis.yml`
   is regenerated by `prepareProfile`). The office therefore needs *write* access to `$DSH_HOME`, and a
   read-only home, an unwritable profile, or a different user's `~/.dsh` fails the launch with
   `EACCES` before any ACP frame is exchanged. Worth a README line; not something the office can work
   around.
2. **Model selection needs the live catalog.** Because values are route tuples, the office resolves
   what a person types (exact value, option label, or the bare model id inside the tuple) against
   `session/new`'s options before calling `session/set_config_option`. A typed id therefore works;
   an unknown one is passed through and degrades to the profile default with a line in the terminal.
3. **Effort needs a mapping.** The office's five levels map to DSH's four: `low→low`,
   `medium→high`, `high→high`, `xhigh→max`, `max→max`.
4. **A JSON-RPC error from `session/prompt` is a normal outcome** (a failed turn), so it must not be
   treated as a dead session.

### Transcript rendering (added after the first run looked wrong)

Rendering ACP into a terminal is a translation, not a mirror. What the first implementation got
wrong, and what it does now:

| Symptom | Cause | Now |
|---|---|---|
| Wrapped lines staircase further right on every row | streamed text was written with bare `LF` | text is line-buffered and every emitted line ends `CRLF` |
| `## headings` and `**bold**` printed raw | model markdown went straight to the terminal | a small markdown renderer (headings, bold, italic, inline code, bullets, quotes, rules, links, fenced blocks) |
| `✔ call_00_IP67…` lines | `tool_call_update` carries only a tool-call id | tool rows are remembered by id; updates reuse the title and summary already shown |
| Tool rows said `bash` twice per call, and every result | no presentation model | one row per call, titled and summarized the way the harness does it |
| Reasoning ran into the answer | no block structure | a `✻ Think` heading and a ruled body, closed by a blank line |

The palette is the harness's own dark-theme tokens (`body[data-ds-dark-theme]` in
`dsh-client-ui-theme`): `label-primary` #f9fafb for prose, `label-secondary` #cfd3d6 for a tool
title, `label-tertiary` #adb2b8 for reasoning and summaries, `label-caption` #81858c for the dot,
`link` #7aaaff for notices, `state-success-primary` #22c55e, `state-error-primary` #f25a5a,
`state-warn-primary` #f59e0b with `-secondary` #f7ad31, and the code blocks' #292929/#1b1b1c.

Three conventions come from reading `dsh-client-ui-tool` and `dsh-client-ui-approval` rather than
guessing: the chat has **no per-`ToolKind` icon table** (it picks a title and a summary key list by
the tool's *wire name*, with `bash`/`read`/`search`/`write`/`edit`/`code`/generic variants), a
**finished tool call is left collapsed with no check mark**, and the approval card binds **Enter to
"Allow once" and Escape to "Reject"**. The office follows all three — Esc rejects the tool without
ending the turn, an empty Enter allows once, and only a tool offering no reject choice cancels.
Enter never picks anything but an allow-once choice (a request offering only "always" needs its
number typed), a blank line inside a paste is not an Enter, and the card shows the command being
approved in full, from the tool call's own row when the request names only its id.

Glyphs stand in for the chat's SVGs (`❯` bash, `▤` read, `⌕` search, `✎` edit, `{ }` code, `⇅` fetch,
`✦` unknown, `✻` think); the real UI draws icons and has no unicode equivalents.

Decisions:

- **Usage: option 1.** `usage_update` is wired straight into `Usage` as context occupancy
  (`input`/`totalTokens`, plus `contextSize` for the window) with `cost` only when the harness
  supplies one, and `costKnown: false` otherwise. The JSONL reader (option 2) is not built, so the
  office sets only the persistence `root` and leaves DSH's own compression alone.
- **Budget: DSH stays out of `--budget`**, matching OpenCode and Codex.
- **Profile: the shipped `acp` profile**, not an office-owned directory. The office only adds a
  per-floor `--patch` overlay for the session root.

Still open (needs a DSH install with working credentials — the sandbox used for this work has no
`DEEPSEEK_API_KEY` and cannot write to the real `~/.dsh`):

- The concrete `session/update` variants DSH emits for a real turn, and the exact
  `usage_update.used`/`size` numbers, including **whether `cost` is ever populated**. The office's
  behaviour is the same either way: cost appears only if it arrives.
- A real `session/request_permission` (the blocking behaviour was verified against the office's own
  client driving a fake ACP agent, which is what the shipped test suite covers).
