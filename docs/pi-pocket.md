# Office v2: chat-backed 3D floors in Pi Pocket

Back to the [README](../README.md).

Office v2 is a Pocket extension. Its primary interface is the original **desktop** 3D office. Its own page fills the window and can also enter browser fullscreen. It does not use a phone-style extension panel, bottom sheet, or mobile fallback. A computer window of at least 1024 × 600 is required. There is no Office Node backend, PTY service, provider CLI, separate login, or credential copy.

**This redesign requires the experimental Pocket conversation SDK additions ([Pocket PR #129](https://github.com/TannerMidd/pi-pocket/pull/129)). Stock Pocket 0.19.0 is not sufficient.** The extension checks capabilities rather than pretending that a larger window provides missing runtime APIs. Do not replace a live installation until the Pocket SDK update and the complete extension workflow have passed isolated tests.

## Room model

- Each ordinary root Pocket chat is a floor. Its title is the floor's name.
- The elevator lists authorized, unarchived root chats. Search and refresh stay in the 3D elevator.
- The current floor's root chat is its **master**, represented separately from hired children at a raised desk.
- Regular desks bind real child Pocket conversations to that root chat.
- Switching floors changes your room. It does not move another person or move/delete/restart agents.
- Teammates who choose the same chat floor share its presence, desks, and office chat.
- A child's model, thinking, tools, instructions, working folder, and team budget inherit through Pocket's linked-session mechanism.
- A child does **not** inherit the root transcript or another child's context. Shared files and explicit team messages are not automatic shared memory.

GitHub and repository-per-floor workflows are outside this redesign's scope. A floor is a chat, not a repository clone.

## Fullscreen and worker inspection

The fullscreen element belongs to the extension and contains both:

1. the trusted Office world iframe;
2. the worker-inspector overlay, rendered with public `pocket.Conversation`.

Fullscreen does not apply to the world iframe alone. Otherwise native chat would appear outside the fullscreen element and become unreachable.

On detected software WebGL, Office disables multisample antialiasing, shadows, and outlines, lowers pixel resolution, and draws at most 5 frames per second. It budgets idle time after submission and pauses expensive drawing behind dialogs. Simulation, network synchronization, and real session activity continue. Normal hardware keeps the original rendering settings. This fallback is not a phone layout or a substitute renderer.

Clicking a worker or master first refreshes its authorized binding through the extension route. The inspector then embeds the **native Pocket conversation**, with its own document, store, connection, and conversation ID. It does not navigate or retarget the parent chat. Messages, thinking, tools, approvals, the human composer, and stopping work remain core-owned controls. Drafts are never automatically sent. Opening a worker never approves a tool, takes the turn, changes a model, or starts new work.

Closing the inspector disposes its embedded connection and restores the world's input lifecycle. A parent-to-world control message pauses movement and clears held keys while the inspector is open. Its source window, origin, channel, and boolean payload are checked.

## Core mechanism versus extension workflow

```text
Office v2 extension page / fullscreen host
  ├─ trusted Office 3D iframe
  │    └─ bounded origin/window/channel-checked bridge
  ├─ native Pocket conversation component in the inspector
  │    └─ core-owned transcript, composer, tools, approvals, authorization
  └─ public SDK + module-owned routes
       ├─ conversations.list → authorized root chat floors
       ├─ ephemeral per-floor presence and avatar events
       ├─ durable source-scoped desk bindings and office chat
       └─ linkedSessions.start/list → real Pocket children
```

The reusable mechanisms belong to Pocket core:

- `WebRequest.conversations.list({ rootsOnly, includeArchived })` returns current actor-authorized metadata. It requires no model request or durable write.
- `pocket.Conversation({ conversationId, draft?, title?, onClose? })` renders a scoped native conversation. Each embed remains independent of the parent's selection.

Both additions are experimental for unreleased Pocket 0.20.0. They require an explicit Pocket update and, for server changes, an owner-managed restart. The workflow, 3D assets, floor selection, master desk, worker desks, and presentation stay in the extension.

Production extension code uses only public SDK methods, its own routes, and its own packaged assets. It does not import Pocket internals, read core documents, call private HTTP APIs, copy sign-ins, or bypass approvals. Tests can use Pocket's internal helpers only in isolated temporary data.

## Identity and bootstrap

The parent establishes the signed-in Pocket person, account-owned avatar preferences, authorized root chat list, and authorized source snapshot **before** starting the world. It injects `{ person, profile, snapshot, floors }`; the source must occur in that floor list.

Names always come from Pocket. Defaults are deterministic per account. The server stores avatar preferences by the authenticated person, not in the standalone `agent-office.profile` browser key. Customization requires no source turn or model work. Its overlay is inside the fullscreen host.

The Pocket branch skips standalone login, character selection, saved standalone position, repository/floor creation, and dog-loading prerequisites. Its readiness uses a source welcome and first rendered frame. Audio defaults to muted and notifications to off. Per-user browser preferences use `x.office-v2.<userId>.*` keys. A remembered floor grants no authority: access is checked again.

The iframe is **trusted same-origin code, not a security sandbox**. Review the complete bundle before enabling it. Bridge channels bind messages to a frame; server authorization remains independent. Legacy Office API calls fail locally rather than falling back to a CLI backend.

## Presence and safety

Presence is a 15-second ephemeral lease, separate from durable sessions and desks. Movement is coalesced and polled, not an Office WebSocket. Account profiles remain authoritative.

Avatar `act`, emotes, seating, and activity/reading presence use bounded ephemeral state/events. A fieldless `act` is a one-shot reach. It is not an unsupported worker command. Events have sequence numbers, finite retention, and replay suppression. Seat conflicts produce private refusals.

Do not imply full legacy feature parity from the scene alone. GitHub is intentionally excluded. Voice/RTC, issue-card carrying, shared game simulation, shell workers, CLI provider settings, Office-managed worktrees, and automation without an implemented Pocket adapter remain unverified or unavailable. UI controls must not advertise a successful operation that the runtime did not perform.

Idle is not task success. Unknown activity/model/cost is not invented. Exact worker activity comes from the native Pocket inspector. Actor and audience checks filter bindings on every fresh request.

## Build

Use a Pocket checkout containing the experimental SDK additions:

```sh
npm ci --include=dev --ignore-scripts
npm run typecheck
node --import tsx --import=#tests/css --test --test-concurrency=4 tests/*.test.ts
npm run build
PI_POCKET_ROOT=/path/to/updated/pi-pocket npm run build:pocket
```

`build:pocket` packages assets under `integrations/pi-pocket/office-v2-client/world/` and writes `office-document.json`. It copies public types from `PI_POCKET_ROOT` (default `/opt/pi-pocket`). These are build-tool paths, not production imports. Never package credentials or temporary test data.

Local GLB files receive `.glb.png` suffixes for Pocket's extension asset allowlist; their binary data is unchanged. Assets are local, not CDN dependencies, and each must fit Pocket's 8 MiB limit. The complete client folder and `office-v2.ts` form the deployment.

## Isolated verification

```sh
PI_POCKET_ROOT=/path/to/updated/pi-pocket npm run test:pocket
PI_POCKET_ROOT=/path/to/updated/pi-pocket node integrations/pi-pocket/preview.mjs
node integrations/pi-pocket/responsive-check.mjs
PI_POCKET_ROOT=/path/to/updated/pi-pocket node integrations/pi-pocket/browser-check.mjs
```

The preview and fullscreen acceptance harness use temporary Pocket helpers and a scripted model, never live conversations or subscriptions. The acceptance harness starts and stops its own preview. Its tool probe runs only `printf` in the temporary folder; its approval probe exercises the native approval UI in isolated data. It prints isolated sign-in links on `127.0.0.2`. Do not publish those links. Follow its printed stop command when finished.

The layout fixture opens the real desktop Office DOM and styles without a renderer or backend. It checks dialogs, close targets, HUD, menu, and overflow at 1280×800, 1440×900, 1024×768, and 1920×1080. It verifies layout, not WebGL rendering. Small windows show a desktop-size requirement instead of switching to an iPhone interface.

End-to-end acceptance must separately verify the real 3D world, two users, elevator switching between two chats, the master desk, child hiring, live inspector activity, human follow-ups, approvals, correct source/target isolation, reconnect/recovery, and desktop screenshots. The native inspector must also retain a computer-width viewport. Do not report readiness from a layout fixture alone.

### Verified desktop browser workflow

The complete `browser-check.mjs` run has passed in isolated data with real software WebGL and a scripted model:

- Two authenticated users, real WASD movement, required-task rejection, and exactly one linked child at a shared desk.
- Native child chat, human follow-up, an unsent review draft, explicit Send, and a real isolated `bash`/`printf` result.
- The native Allow approval, unchanged parent URL, and a continuously fullscreen host.
- Master-chat isolation and elevator switching without transferring workers or teammates.
- Account-owned appearance in a fresh browser, desktop inspector bounds, small-window rejection, and Escape cleanup.
- No browser exceptions and no Office WebSocket backend.

Screenshots are written to `dist/screenshots/office-v2-*.png`. The CPU-only WebGL run can take several minutes. This acceptance result does not install the extension, update live Pocket, or replace the owner-approved live smoke check. Receipt recovery and authorization edge cases also have integration coverage.

## Install and recovery

1. Review the Pocket SDK and extension changes separately. Test both together in isolated data.
2. Apply the Pocket update only with owner approval. The owner performs the required server restart through Pocket; an agent must not restart while its tool call runs.
3. With approval, install the complete extension package as regular files in the data `extensions/` folder. Keep the existing Office extension separate.
4. The owner enables Office v2 through **Menu → Extensions**.
5. Open a root chat and choose its model. Open Office v2 from the rail, then **Fullscreen**.
6. Verify one small task and its native approval path before inviting collaborators.

A failed bridge never falls back to a CLI worker. Releasing a desk does not stop or delete its conversation. A pending hire may already have admitted model work: recover its original actor-bound receipt rather than starting a new task. Public receipt retention is finite. Cancellation after admission does not undo work.

Disable the extension through Pocket's Extensions UI. If browser code fails, use `?noext=1` and disable it. Disabling the extension does not delete its linked conversations.
