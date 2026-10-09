# GTA-style smartphone — implementation plan

> **Plan only — no game code.** This document is the design the implementation PR will follow.
> Target: a GTA-style smartphone for the player character, in the game's look and feel.

## 1. Goal

The main character gets a GTA-style smartphone with the game's look and feel:

- **Contacts** = the currently active agents/workers in the office.
- The player can **"call"** an active agent and **"send SMS"** to agents.
- Everything stays in the game's style/optics (toon look, HUD, modals, sounds).

## 2. What exists today (explored read-only)

The phone composes existing systems; it invents almost no wire protocol:

| System | Where it lives | What the phone reuses |
| --- | --- | --- |
| Active workers | `store.workers` (`Map<string, WorkerInfo>`), painted by `src/client/features/workers/views.ts`, acted on by `src/client/features/workers/actions.ts` | Contacts list source; `STATUS_LABEL`, `clip`, `workerPr` badges |
| Waiting order | `waitingInOrder` in `src/client/nextup.ts` | Contacts sort (needs-you first, longest-waiting first) |
| Go to a worker | `parts.waiting.goToWorker(id)` (`src/client/features/waiting/index.ts`) — closes modals, `actions.standAt(desk)` | The "pick up and walk over" half of a call |
| Open a worker's terminal | `parts.waiting.openWorkerTerminal(id)` — resumes if asleep, `openTerminal(net, id, …)` (`src/client/ui/terminal.ts`) with `doing: "💻 in <name>'s terminal"` | The "talk" half of a call |
| Prompt a worker | `net.send({ t: 'worker.prompt', workerId, prompt })` (used by `promptAtDesk`, `openPrompt` in `src/client/ui/prompt.ts`, `openAsk` in `src/client/ui/ask.ts`) | The SMS transport — no new message type |
| Chat rendering | `renderChat` in `src/client/ui/chat.ts`, `installChat` in `src/client/features/chat/index.ts` (`T`/`Enter`, `chat` topic) | Visual language for message bubbles only (no chat-protocol reuse) |
| Voice | `installVoice` in `src/client/features/voice/index.ts` (`V` join / push-to-talk, `M` mute, WebRTC between browsers) | Explicitly **not** reused: workers are text agents with no voice peer |
| Modal system | `openModal` in `src/client/ui/dom.ts` (auto top-right ✕, `Esc` closes, `doing` line under the name tag) + `installFocus` in `src/client/input/focus.ts` (`backToGame`: closing the last modal returns straight to mouse-look, no extra click) | Phone, call screen and SMS thread are `openModal` dialogs |
| Feature-window example | `src/client/features/jukebox/` (`index.ts` + `ui.ts` + `ui.css`, `openJukebox(net, …)`, `doing: '🎵 at the jukebox'`) | Template for `smartphone/` module shape |
| HUD menu | `mountHud` list in `src/client/features/hud/index.ts`, `HudParts` in the same file | One `📱 Smartphone` entry (`section: 'Open'`, `key: 'J'`) |
| Help rows | `HELP_ROWS` in `src/client/ui/help.ts` | One `J` row |
| Sounds | Recipe fn taking `AudioCore` in the feature folder + method on `OfficeSound` (`src/client/sound/index.ts`, e.g. `features/gong/sound.ts`, `features/needsyou/sound.ts`) | Ringtone, SMS swoosh, key blips |
| Player / character | `ctx.player` (`PlayerController`), `ctx.me`/`ctx.hands`, `src/client/world/character/`, `src/client/player/` | Phone-in-hand prop while the phone is open (follow-up; MVP: HUD/modal only) |
| Registries | `ctx.keys`, `ctx.messages`, `ctx.ticks`, `store.on('<topic>')` (`src/client/core/registry.ts`, `src/client/core/context.ts`) | `ctx.keys.bind({ code: 'KeyJ', … })`; `store.on('workers')` / `store.on('smartphone')` |
| Size guard | `tests/size.test.ts` (600-line budget per `.ts`/`.css` under `src/`) | Every new file stays well under 600 lines; split `ui.ts` if it grows |
| Structure guard | `tests/client-structure.test.ts` (`main.ts` calls each feature's install once; `lite.ts` loads no three.js / `features/`) | Phone UI imports nothing from three.js, `world/`, `player/` or `features/` so `/lite` stays clean |

Free key check: office bindings use `E P C B R X L O N F Q H T G V M K`, `WASD`/arrows, `1–6`, `/`, `Tab`, `Esc`, `Ctrl+K`, `Ctrl+Space`, `Ctrl+[`. **`J` is free** (no `KeyJ` binding anywhere; `Z` is taken by the arcade cabinet while playing).

## 3. Decided semantics: what "call" and "SMS" mean

### 3.1 "Call" = walk over + open a direct line (no voice)

Workers are text agents: they have **no voice peer**, so a WebRTC call with a worker is not
possible without building a whole TTS/STT bridge (explicit follow-up, §5). And "walk to them" alone
already exists (`N` / Next worker that needs you).

MVP call semantics — a GTA-style placed call with three beats:

1. **Dial** — phone UI shows `Calling <name>…`, plays the ringback tone (2 rings).
2. **Connect** — the phone modal closes, `waiting.goToWorker(id)` puts you at their desk looking
   at the laptop, and `waiting.openWorkerTerminal(id)` opens their terminal with
   `doing: "📱 on a call with <name>"` (teammates see it under your name tag, like `"💻 in …"`).
   Sleeping workers are resumed first (already handled inside `openWorkerTerminal`).
3. **Hang up** — closing the terminal (`✕` / `Esc`, the existing terminal behavior) ends the call;
   the phone logs it in Recents.

Edge cases: `lost` worktree → route to `actions.fixLostWorktree(w)` instead of dialing; worker gone
mid-dial → toast and back to contacts; shells (`kind: 'shell'`) are callable too (🐚 icon, same flow).

Rejected alternatives: real-time voice with the agent (no peer; TTS/STT bridge = separate project);
walk-only (duplicates `N`); terminal-only without moving (loses the GTA "call your guy and you're
with him" fantasy).

### 3.2 "SMS" = `worker.prompt` with a phone-thread skin

SMS transport is the existing prompt wire message:

```ts
net.send({ t: 'worker.prompt', workerId, prompt: text });
```

It lands in the worker's input box (queued while busy), exactly like prompting at the desk. The
phone adds the SMS fantasy around it:

- Per-worker thread view (blue/green bubbles) kept in the phone's state slice, seeded in-memory and
  persisted to `localStorage` (namespaced key, same pattern as `worktreePref()` in `ui/prompt.ts`).
- `📩 SMS sent to <name>` toast on send; status hints derived from existing worker status
  (`working` ≈ "delivered", `needs_input` ≈ "💬 replied — open the call to read it").
- The worker's actual reply happens in its terminal/session, not in the phone (same as desk prompts).

Rejected alternatives: sending via `chat` (that's human-to-human broadcast, wrong channel); toasts as
the message body (not conversational); server-persisted threads (needs protocol + storage — follow-up).

## 4. MVP scope

**In:**

- `J` key + `📱 Smartphone` HUD/☰ entry open the phone modal (GTA iFruit parody styling, §7).
- Contacts tab: all workers on the current floor from `store.workers`, sorted with
  `waitingInOrder` first then the rest alphabetically; color dot, name, `STATUS_LABEL` pill,
  clipped activity, PR badge where present; tap → contact actions (Call / SMS / Go to desk).
- Call flow per §3.1 (dial → ringback → `goToWorker` + `openWorkerTerminal`, Recents log).
- SMS flow per §3.2 (thread view, send via `worker.prompt`, toast, local thread persistence).
- Recents tab (calls + sent SMS, from the slice; cleared on floor change).
- Sound recipe: ringtone loop (2 rings then stop), SMS swoosh, dial blips — synthesized, positional
  only where it makes sense (phone sounds are UI-local, like `ding`).
- Help row for `J`; docs touch-up in the implementation PR (`README.md`, `docs/features.md`,
  `docs/controls.md`).

**Explicitly out (follow-ups, §5):** real voice/TTS calls, server-persisted threads,
delivery/read receipts, cross-floor contacts, photos/MMS, phone-in-hand 3D prop, `/lite` phone UI.

**No new wire protocol, no server handler, no `FloorView` field in MVP.** Both flows ride existing
messages (`worker.prompt`, `worker.attach`/`term.*` via the terminal). If a follow-up needs pushing
SMS state to other tabs, it gets a protocol domain file + handler file then — not now.

## 5. Follow-ups (not MVP)

1. **Real voice calls** — TTS reads the worker's latest output, STT feeds mic back as prompts.
   Needs a worker-voice peer/bridge; whole project on its own.
2. **Server-persisted SMS threads** — protocol domain (`sms.*` client msgs, `sms` server msgs),
   handler in `src/server/ws/handlers/sms.ts`, `FloorView` field + view piece, slice `enter()`.
3. **Delivery/read receipts** — derive from `needs_input`/`working` transitions; toast "💬 X replied".
4. **Cross-floor contacts** — contacts across `store.floors`, SMS to another floor, call rides the
   elevator first (reuse `travel`).
5. **Phone-in-hand 3D prop** — `world/character/props.ts` + `hands` pose while phone open; ring
   audible to nearby players.
6. **`/lite` support** — a lite-safe contacts+SKS list; must keep `lite.ts` three.js-free.

## 6. Architecture (registry rules)

New self-contained feature module `src/client/features/smartphone/`:

- `index.ts` — `installSmartphone(ctx, deps)` with
  `deps: Pick<Parts, 'waiting' | 'actions'>` (reaches across only when something happens, per
  `core/parts.ts` conventions). Binds `KeyJ`, subscribes `store.on('workers')` for the HUD badge.
- `ui.ts` — `openSmartphone(deps)` modal: contacts / call screen / thread view. Imports `./ui.css`.
- `ui.css` — phone skin next to its module.
- `sound.ts` — `ringtone(a: AudioCore, …)`, `smsSwoosh(a)`, `dialBlip(a)`; methods on `OfficeSound`.
- `logic.ts` — pure helpers (contact sort, thread append, recents) so `tests/smartphone.test.ts`
  can cover them without a DOM.
- State slice `src/client/state/slices/smartphone.ts` (client-only: `init` + `on.workers` → topic
  `smartphone`; `enter` resets recents/threads to the new floor).

One-line joins only (the sanctioned "one line in each list it joins"):

| List | One line |
| --- | --- |
| `src/client/main.ts` | `parts.smartphone = installSmartphone(ctx, parts);` after the waiting/actions installs |
| `src/client/core/parts.ts` | `smartphone: Made<typeof installSmartphone>;` (+ type import) |
| `src/client/state/slices/index.ts` | import + `SLICES` entry **at the end** |
| `src/client/features/hud/index.ts` | one `mountHud` entry + `'smartphone'` added to `HudParts` Pick |
| `src/client/ui/help.ts` | one `HELP_ROWS` row for `J` |
| `src/client/sound/index.ts` | recipe import + `ringtone()/smsSwoosh()/dialBlip()` methods on `OfficeSound` |

Nothing else is touched: no `server.ts`, no store core, no `protocol.ts`, no other feature's logic.

## 7. UX flow

1. Press `J` (or `📱 Smartphone` in HUD/☰). Phone slides up, GTA-iFruit style: rounded slab, notch,
   `Tinkle 📶` carrier gag in the status bar, toon panel colors from `base.css` vars, click blip.
2. **Contacts**: workers on this floor, needs-you first (red 🙋 / green ✅ markers, same as the
   banner), each row: color dot, name, status pill, clipped activity, PR badge. Empty floor:
   "No contacts — hire someone first (E at an empty desk)".
3. Tap a contact → actions: `📞 Call` (primary), `💬 SMS`, `🚶 Go to desk` (no terminal).
4. **Call**: full-screen call UI (`Calling…` → `Ringing…` with ringback, `📱 with <name>` + timer on
   connect, big red End button). Connect = close phone, stand at desk, open terminal with the
   `📱 on a call with <name>` doing-line. End/hang-up before connect cancels with a blip.
5. **SMS**: thread view (own messages right/blue, worker status-notes left/grey — clearly labeled as
   status, not their words), input box with Dictate (🎤) support via existing `dictateField`, `Enter`
   sends, toast confirms. Thread persists per floor+worker in `localStorage`.
6. **Recents**: calls (outgoing, duration) + sent SMS, newest first.
7. Close via top-right `✕` or `Esc` → `backToGame` puts the player straight back into mouse-look
   (inherited from `installFocus`; nothing custom).

## 8. File-by-file changes (implementation PR)

| File | Change |
| --- | --- |
| `src/client/features/smartphone/index.ts` | **New.** `installSmartphone(ctx, deps)`: `KeyJ` bind, `store.on('workers')`, `showSmartphone()` |
| `src/client/features/smartphone/ui.ts` | **New.** `openSmartphone(deps)`: contacts/call/SMS/recents modal via `openModal`, `doing: '📱 checking contacts'` |
| `src/client/features/smartphone/ui.css` | **New.** iFruit skin: slab, notch, green/red call buttons, SMS bubbles; selectors more specific than `base.css` |
| `src/client/features/smartphone/sound.ts` | **New.** `ringtone`/`smsSwoosh`/`dialBlip` recipes on `AudioCore` |
| `src/client/features/smartphone/logic.ts` | **New.** Pure contact-sort/thread/recents helpers |
| `src/client/state/slices/smartphone.ts` | **New.** Client-only slice: threads, recents; `init`/`on.workers`/`enter`, topic `smartphone` |
| `src/client/main.ts` | +1 install line |
| `src/client/core/parts.ts` | +1 `Parts` field (+ type import) |
| `src/client/state/slices/index.ts` | +import, +`SLICES` entry at end |
| `src/client/features/hud/index.ts` | +1 `mountHud` entry, `HudParts` Pick + `'smartphone'` |
| `src/client/ui/help.ts` | +1 `HELP_ROWS` row (`J`) |
| `src/client/sound/index.ts` | +import, +3 `OfficeSound` methods |
| `tests/smartphone.test.ts` | **New.** `logic.ts` unit tests (sort order, thread caps, recents) |
| `README.md`, `docs/features.md`, `docs/controls.md` | Feature bullet + `J` control row (implementation PR) |

Size-guard note: each new file ≤ ~350 lines (`ui.ts` split into `contacts.ts`/`call.ts`/`sms.ts`
if it approaches the budget — never raise ceilings).

## 9. Verification (implementation PR)

1. `npm run typecheck` — passes (new module wired through registries; `HandlerMap` untouched).
2. `npm test` — passes, incl. new `tests/smartphone.test.ts`, `size.test.ts` (all new files < 600
   lines) and `client-structure.test.ts` (one install line, no `main.ts`/`lite.ts` imports).
3. `npm run build` — client + server build clean.
4. Headless-browser screenshot (no manual playthrough): boot dev server, open floor, evaluate
   `showSmartphone()` (exposed via `parts`/debug handle like `__office`), press Call on a hired
   worker, screenshot contacts + call screen + SMS thread; confirm toon styling, ✕ placement, and
   `backToGame` focus return on `Esc`.

## 10. Risks and open questions

- **Key choice**: `J` is free today but sits near no mnemonic cluster; alternative `U` ("ring u up").
  Either is one line to change. Decision leans `J` (single-hand reach next to `H`/`K`/`N`).
- **Call vs `N` overlap**: `N` goes to whoever waits; Call goes to *whomever you choose*, then opens
  the channel. Docs must say so in one line.
- **Thread-vs-terminal truth**: the phone thread is a *sent-box + status hints*, not the
  conversation; the terminal stays canonical. The UI must label status-notes as such to avoid
  implying the worker "texted back".
- **Modal chaining**: Call connects by closing the phone and opening the terminal — relies on
  `closeAllModals` + focus `backToGame` timing (same pattern as `goToDesk`); verify no mouse-capture
  gap in the screenshot pass.
- **`lite.ts` contamination**: `ui.ts` must import only `ui/*`, `state`, `shared/*` — enforced by
  `client-structure.test.ts`; keep it that way.
- **Scope creep magnet**: anything with a server component (receipts, persistence, voice) is a
  follow-up with its own protocol domain — not smuggled into MVP.

## 11. Hard repo rules this plan respects

> - "Ship every code change as a PR branched from freshly fetched `origin/main`, and end with the PR URL instead of stopping at a local commit or asking first."
> - "The main checkout is shared with other live sessions and board agents, so do branch work in a worktree and never stash, reset or commit anyone else's changes there."
> - "Verify with `npm run typecheck`, `npm test` and `npm run build`, plus a headless-browser screenshot for visual changes, rather than slow manual playthroughs."
> - "When a change affects how people run, deploy or use the office, update `README.md` and the matching `docs/*.md` page in the same PR."
> - "New features plug in through the registries as modules of their own (see `docs/code-layout.md`), never by adding their code to `main.ts`, `server.ts`, the state store, `protocol.ts` or another feature's files, and `tests/size.test.ts` must stay green."
> - "Every modal needs a top-right ✕, and closing it by ✕ or Esc must put the player straight back into mouse-look with no extra click."

Conformance: the phone is a module of its own (`features/smartphone/` + one slice); registry files
get one join-line each, never feature logic; all new files stay far under the 600-line budget; the
phone is an `openModal` dialog (automatic top-right ✕, `Esc`, `backToGame` via `installFocus`); the
implementation PR updates `README.md` + `docs/features.md` + `docs/controls.md` and ends with a PR URL.

## 12. Rollout

- This plan lands as a **draft PR** containing only `docs/plans/smartphone.md` (no game code).
- The implementation follows as a separate PR from a fresh branch off `origin/main`, implementing
  §8 file-by-file, verifying per §9, and reporting the PR URL with a screenshot.
