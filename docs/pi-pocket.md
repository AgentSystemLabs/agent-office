# Pi Pocket runtime integration

Back to the [README](../README.md).

Office v2 can run as a **Pi Pocket extension**, without starting the Agent Office Node server or any CLI worker. A native Pocket room supplies participants, desks, appearance preferences, and agent controls. The original 3D world is an optional view of that same room, not a prerequisite. Pocket supplies authentication, real linked sessions, models, tool execution, approval controls, durable history, and team-budget enforcement.

This is an initial integration, not feature parity with the CLI office.

## Runtime boundary

```text
Pocket extension panel
  ├─ native room, participants, desks, hire and appearance sheets
  ├─ optional 3D world in a same-origin srcdoc frame
  │    └─ bounded, origin/window/channel-checked message bridge
  └─ public pocket SDK + this extension's routes
       ├─ ephemeral shared presence (15-second lease)
       ├─ durable source-scoped desk bindings and chat
       └─ linkedSessions.start/list → real Pocket sessions
```

There is no second Office login, credential copy, Office WebSocket, PTY host, or provider CLI in this path. Do **not** run `agent-office` to start Pocket mode. The ordinary CLI deployment remains available separately and is not changed into a Pocket service.

The iframe separates Office's DOM, styles, and input from Pocket's UI. It is **trusted same-origin code, not a security sandbox**. Review the complete browser bundle before enabling the extension.

The browser bridge uses an exact window, origin, and random per-mount channel. It fixes the source conversation outside iframe requests. Every server action still receives independent Pocket authorization. The channel is not an authorization token.

The legacy Office `/api` requests fail locally in Pocket mode. The bridge uses only `pocket`, the module's own routes, and packaged local assets. It never calls Pocket's internal HTTP APIs.

## What works

- Open the Office v2 panel beside a root conversation.
- Share a source-scoped office with authorized collaborators.
- Enter immediately with your authenticated Pocket identity; no Office login or character-selection gate.
- See participants and desks without downloading the 3D application or requiring WebGL.
- Customize your account's saved appearance after entry, across devices and conversations.
- Optionally enter 3D for shared avatars, movement, and durable office chat.
- Hire an agent at a supported desk with an initial task.
- Start a real Pocket linked session using the source's model, thinking, folder, and copied agent settings.
- See authorized busy/idle desk status through the public linked-session API.
- Open a desk in native Pocket chat for messages, tool activity, questions, and approvals.
- Prepare a follow-up draft in that chat. The person reviews and sends it; opening a desk does not submit a message.
- Release a desk without deleting or stopping its session.

Linked sessions do not inherit the source's history or receive separate worktrees automatically. Pocket's root team budget covers their spend. A linked child cannot hire another child; use a root conversation as the office workspace.

The workspace stays bound to its selected source when a desk opens a child, including after browser refresh. The last authorized workspace selection is an optional, per-account browser preference; the server rechecks access. Use **Use this conversation** only to deliberately switch it.

## Identity and startup

The parent first reads the signed-in Pocket person and module-owned avatar preferences. Defaults are deterministic per account. Names always come from Pocket and cannot be edited through Office. Preferences are stored by the server under that person's authenticated ID, not in the standalone `agent-office.profile` browser key. Editing your appearance requires no model, source turn, or model work.

Next, the parent reads an authorized source snapshot and renders the native room. Hiring and all desk actions use conversation-bound public routes. Native chat, model settings, credentials, approvals, and tool execution remain Pocket-owned. The room lists accounts once even when multiple tabs have presence.

Only **3D office (optional)** fetches the Office bundle. Before creating its iframe, the parent injects a validated startup contract containing the authenticated person, saved avatar, and authorized source snapshot. The 3D branch initializes the avatar before creating the scene, emits its initial welcome from that snapshot, and refreshes authorization through the bridge. It does not run standalone login, character selection, saved-position restoration, floor selection, or dog-loading prerequisites. Readiness uses a source welcome and a first rendered frame. Office audio defaults to muted, and notifications default to off.

Optional 3D browser preferences use `x.office-v2.<userId>.*` keys. They do not read another account's standalone preferences. Native room participants do not appear as ghost 3D avatars. A 3D load failure does not remove the native room or its controls.

## Deliberate limits

Pocket's public extension API currently exposes linked-session creation, listing, and native navigation. It does **not** expose complete message streams, detailed tool/approval status, or human submit/abort/approval methods.

Therefore:

- Exact session activity and approvals stay in native Pocket chat.
- `idle` does not mean task success. Unknown status is not completion.
- Cost is unknown in Office; native Pocket is authoritative.
- Shell hiring, terminal input, CLI model/provider settings, Office-managed worktrees, multi-repository tasks, queue automation, meetings, GitHub mutation, floor cloning, and Office administration are unsupported.
- The native room is the default on desktop and phones. Optional 3D needs a capable WebGL browser. Automatic navigation to the standalone `/lite` app is disabled; it is not a Pocket fallback.
- Presence is polled and coalesced, not real-time WebSocket movement. A disappeared tab expires after 15 seconds.
- Office chat and desk mutations require the source turn. Presence reads need source visibility and do not take the turn.
- The extension is for the owner and guests allowed to steer all sessions. Session-only invitees and viewers do not load it.
- Audience-safe metadata rules can hide workers. The extension must not reveal private session IDs or details to fill those gaps.

## Build

Requirements: Node compatible with the installed Pocket release, this checkout's dependencies, and Pi Pocket 0.19.0 or later.

```sh
npm ci --include=dev --ignore-scripts
npm run typecheck
npm test
npm run build
npm run build:pocket
```

`build:pocket` uses relative asset paths and packages public assets under:

```text
integrations/pi-pocket/
  office-v2.ts
  _pocket.d.ts
  office-v2-client/
    index.js
    bridge.js
    views.js
    frame-errors.js
    style.css
    office-document.json  # generated public HTML template as JSON
    world/                # generated Office bundle and local assets
```

The package renames local binary GLB assets with `.glb.png` suffixes and rewrites their references. Pocket's extension server permits this image suffix. `GLTFLoader` reads the unchanged GLB header and binary content. No assets come from a CDN.

`package.mjs` copies the installed Pocket public type declarations from `/opt/pi-pocket`. This path is local build tooling, not a runtime dependency of the installed extension.

## Test without real AI requests

On the Pocket host:

```sh
npm run test:pocket
node integrations/pi-pocket/preview.mjs
```

The tests and preview use Pocket's temporary-data helpers and a scripted model. They do not use live conversations or provider subscriptions. Set `PI_POCKET_ROOT` for the preview if Pocket is not at `/opt/pi-pocket`.

The preview prints a separate host, temporary sign-in links, and its PID. To run the browser acceptance check, capture the preview output in `/tmp/office-v2-pocket-preview.log`, then run `node integrations/pi-pocket/browser-check.mjs` in another terminal. It uses Chromium (`CHROMIUM_PATH` overrides the executable), two users, fresh browser contexts, and no renderer patches. It checks native entry, account appearance persistence, shared real desks, native navigation, refresh-safe workspace selection, and zero 3D downloads or Office WebSockets. Screenshots are written to `dist/screenshots/`.

Open the owner link, then Office v2. Follow the printed stop command to close the preview and remove its temporary data. It is not a production service.

## Install — owner approval required

1. Build the package and review **all** server and browser files, including generated Office assets and third-party dependencies.
2. Test on an isolated Pocket copy first. Review dependency advisories before production use.
3. With owner approval, copy `office-v2.ts` and its complete adjacent `office-v2-client/` folder into Pocket's data `extensions/` folder. Use regular files, not symlinks. Do not overwrite another extension or client folder.
4. The owner opens **Menu → Extensions** and enables **Office v2**. Do not edit Pocket's data files to enable it.
5. Open a root conversation with the desired model, thinking, workspace folder, tools, and budget. Open **Office v2** on the rail.
6. Hire 1 worker with a small explicit task. Verify native chat and approvals before inviting collaborators.

No Pocket core code or server restart is required. The live extension must not be enabled by a test script.

## Recovery

Close/reconnect the panel to replace its bridge and frame. A failed bridge never falls back to a CLI worker. Desk bindings survive frame reloads and server restarts; ephemeral presence does not.

Hiring reserves a desk before starting a session. A stable, actor-bound receipt key prevents duplicate initial work during supported retries. A pending start must be recovered with its original key, not replaced with a fresh key. Receipt retention is finite; do not treat it as permanent identity.

Releasing a desk is not cancellation. If a start was admitted before a disconnect, its session can continue even if final binding or UI work failed. Inspect native sessions before starting replacement work.

Disable the extension through **Menu → Extensions**. If its browser code fails, open Pocket with `?noext=1`, then disable it. This does not delete any linked session.
