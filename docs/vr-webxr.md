# VR in the headset browser (WebXR)

The office runs in VR straight from the headset's browser (Chrome on Android XR). No native
app, no companion build: the same page, the same office, entered immersively. Desktop behavior
is unchanged — where WebXR is unavailable the client is pixel-identical, down to the top bar.

## Requirements

- A headset browser with WebXR (Chrome on Android XR; Quest browser works too).
- A secure origin: **HTTPS or localhost**. `http://` over LAN fails at `requestSession`
  with a toast saying so; the dev server (`npm run dev`, localhost) is fine.
- For hand tracking without controllers, the headset must grant the `hand-tracking` feature
  (requested as optional; the session starts either way).

## How to enter

1. Open the office URL in the headset browser and join as usual.
2. Press **🕶️ Enter VR** on the top bar, next to 🥽. The button only exists where
   `navigator.xr` exists and `isSessionSupported('immersive-vr')` resolves true.
3. You spawn at your avatar's feet, facing your current view direction. Press **⏻ Exit VR**
   (same button) to leave; the desktop camera and controls come back exactly as they were.

Failures toast the real reason: session declined, headset asleep, HTTPS required, another
session running, or immersive VR unsupported. See `describeSessionError` in
`src/client/vr/support.ts`.

## Controls

A controls card opens in front of you on every session enter (GOT IT dismisses it; the ☰
menu's ❓ row brings it back).

| Input | Action |
|---|---|
| Trigger / pinch tap | **E** on whatever the ray points at (desks, boards, elevator, gong, dog, seats…) |
| Pinch hold (hands) | Aim a teleport arc; release to go (green lands, red doesn't) |
| Both hands pinch-hold, rays off the panels | Toggle the ☰ menu (the hands' squeeze) |
| Squeeze | Cancel: the carried issue card goes back, else the topmost window closes, else ☰ |
| B / Y, or stick click | **N**: go to the next worker waiting on someone |
| Hold A / X | Aim a teleport arc; release to go (green lands, red doesn't) |
| Left stick forward (glide off) | Same teleport aim; release past center to go |
| Left stick (glide on) | Smooth glide in the stick direction, relative to where you look |
| Right stick sideways | Snap-turn 45° per push (or smooth-turn, see Settings) |
| Left stick sideways (glide off) | Snap-/smooth-turn, for single-stick headsets |
| On a ladder: stick up/down, or pinch-hold right/left | Climb up / back down (E, or a quick pinch tap, lets go) |
| Walk around the room | Room-scale: the avatar follows the headset through the usual collision |

Trigger is the controller `select` event, fired at once; a hand-tracked pinch resolves per
frame from the union of the runtime's `select` and three's joint-distance
`pinchstart`/`pinchend`, so runtimes that fire both for one pinch still read as one hold —
see "Input" below. Every VR move goes through the avatar and the normal `move` messages, so
desktop users see the VR user walk, glide, turn and teleport like anyone else.

## Settings (⚙️ → VR)

| Setting | Default | What it does |
|---|---|---|
| Locomotion | Teleport only | Adds smooth stick glide alongside teleport |
| Turning | Snap turn | 45° steps per push, or a smooth spin |
| Turn speed | 90°/s | Smooth-turn rate (30–180) |
| Teleport fade | On | A blink through black on landing, or a straight cut |

Persisted in the existing settings store (`Settings.vr`, localStorage) like everything else.

## World-space UI

E in VR opens panels floating in the office, not DOM modals: the ☰ menu (hire, queue,
board, services, floors, jukebox, bar, chat, people, meeting, settings), worker terminals (ask,
wake, send-home), the prompt + QWERTY keyboard,
the controls card, and a toast mirror. Both rays press independently (two-handed typing),
held keys repeat like a desktop board, and the prompt + keyboard ride teleports along.
A strip low in the view names what E would do to the ray's target (the desktop hint
bar's twin); whiteboard, TV and arcade stay desktop-only and say so.
Head-placed panels draw through walls (below the cursor dots); the terminal stays
depth-tested furniture. The menu, controls card and toast glide after the head; the
terminal, prompt and keyboard stay where they opened so you can lean in.

## What VR reuses, and what it skips

- **Interact dispatch**: `interact()` / `use()` are called untouched — trigger is literally E
  through the same function, N through `goToNextWaiting`, Q through `putBack`. Reach is the
  same `REACH` table, through the shared `pickFromRay` picker.
- **Collision**: gliding, room-scale and teleport landings use the player collision
  (`stepTo`, `blockedAt`, `groundBelow` on `PlayerController`). Ladders, poles, seats and the
  elevator work via the same E dispatch; N and floor changes rebase the rig.
- **Skipped in the headset**: the cartoon first-person hands (your hands are real) and the
  DOM fade (an in-headset quad fades teleports and elevator/ladder trips instead). Drunk
  vision's post shader can't run on the XR framebuffer, so the rig rolls and pitches with
  the same wobble (and the glide staggers) instead. Outlines keep rendering via
  `renderOutline`, three's documented VR path for `OutlineEffect`.

Known gaps:

- The arcade/cabinet zoom cameras and Minesweeper assume a flat screen.
- Pure hand tracking (no controllers) can point, pinch, teleport and open the menu, but not
  glide or turn: there are no sticks to drive them.
- Sitting: E sits the avatar down, but eye height stays physical — stand or sit to match.

## Architecture

- `src/client/vr/support.ts` — availability probe, `requestSession` with the
  `local-floor` → `bounded-floor` → `local` fallback chain, error strings.
- `src/client/vr/session.ts` — `VRSession`: the dolly rig, rays + cursor dots, input mapping,
  teleport arc, snap/smooth turn, glide, room-scale follow, in-headset fade.
- `src/client/vr/attach.ts` — builds the world-space UI and routes rays to it; `panel.ts`
  (canvas panels, per-ray presses), `menu.ts`, `terminal-panel.ts`, `prompt.ts`,
  `keyboard.ts`, `controls.ts`, `toast.ts`, `math.ts` (ray/panel math), `preview.ts`
  (desktop debug render).
- `src/client/main.ts` — owns the hooks the session calls into. The render loop runs through
  `renderer.setAnimationLoop` (desktop-identical rAF timestamps; XR start/stop swaps the driver
  by itself), and `renderer.xr.enabled = true` from boot (every XR branch in three is gated on
  `isPresenting`, so desktop renders byte-for-byte as before).

### The rig

While presenting, the desktop camera is reparented under a dolly `Group` at the avatar's feet;
three composes the headset pose with the dolly (`WebXRManager.updateCamera`). The avatar stays
the source of truth: locomotion writes `player.pos`/`facing`, and desktop code that moves the
player (N's `standAt`, elevator arrivals, climbing) rebases the rig so the head stays
continuous. On session end the camera is re-hung on its previous parent, keys cleared, canvas
size and pixel ratio restored, and `player.updateCamera(true)` snaps the view back.

### Input

Each input source gets its target-ray space parented under the dolly, with a ray line and a
cursor dot (green within reach, cyan beyond it). Controller `selectstart` is E at once;
`squeezestart` is cancel, B/Y/stick-click edges are N. Hands drive the same target-ray spaces
three updates from the hand aim pose, so one raycast path covers controllers and hands. A
hand-tracked pinch resolves per frame from the union of the runtime's `select` and three's
joint-distance `pinchstart`/`pinchend` (`PinchHold` in session.ts): a tap is E, a hold past
450 ms aims a teleport the release fires, and both hands held past 600 ms toggle the menu —
unless either ray works a panel, so two-handed typing never pops the menu up mid-word.
Buttons and sticks follow the XR Standard gamepad mapping (stick at axes [2,3] when present).
Select/teleport/cancel fire a short haptic pulse where the controller has an actuator.

Hands render as the skinned generic-hand mesh (`three`'s `XRHandMeshModel`, vendored under
`src/client/public/xr-hands/` so no CDN can break them), with three's joint spheres behind
as a fallback that hides once the mesh loads.

### xrblocks: what fits, and what doesn't

`xrblocks@0.21.1` is a dependency (client-bundled, loaded as a lazy chunk only when VR
starts — never on desktop). Used:

- **`Hands`** (`new Hands([left, right])`, `getIndexTip`/`getThumbTip`) for the pinch-fallback
  joint reads. Doc source: `build/xrblocks.d.ts` (the `Hands` class) and
  `src/input/Hands.ts` in the published package; interaction contract per the `xb-add-interactions`
  skill (`skills/xb-add-interactions/SKILL.md`: one shared domain method per intent — here,
  the existing `use()`). Note `Hands` indexes `[left, right]` by handedness while three's
  hand slots don't promise that order, so the session re-orders the array on every
  (dis)connect. If the xrblocks chunk fails to load, the poller reads `hand.joints`
  straight off three's hand spaces instead.

Not used, deliberately:

- `Input` / `Interaction` / controllers / gestures: engine-coupled (`init` is "Only called by
  Core", `Script` subclasses run on the xb lifecycle). Adopting them means the xb engine owns
  the renderer, camera and loop — a renderer rewrite, which is out of scope. Plain three
  `select`/`squeeze` events + one raycast path cover the same verbs.
- `Reticle`: declared in xrblocks' typings but **not exported** from the 0.21.1 package root,
  so the cursor dot is a small custom mesh (~15 lines).
- Teleport/locomotion: no API in the 0.21.1 typings, so the arc + marker + fade are custom
  (~100 lines, `session.ts`).

### Dependency note (three peer range)

`xrblocks@0.21.1` declares `three: ^0.184.0` as a peer, which semver reads as
`>=0.184.0 <0.185.0` — an install-time conflict with the repo's `three@0.186.1`. It was
installed with `--legacy-peer-deps` and **three was not downgraded**: xrblocks' own runtime
check (`src/utils/VersionCheck.ts`) only requires r182+, its README/import map targets
`three@0.186.0`, and its `Hands` use here touches stable `XRHandSpace.joints` API only.
Likewise its optional peers (`lit`, `@pmndrs/uikit`, MediaPipe, genai, …) are **not
installed**: per xrblocks' bundler docs they are marked `external` in `vite.config.ts`, so
the simulator/UI/AI chunks that reference them stay unloadable-but-unloaded lazy chunks.
`npm run build` and `npm run typecheck` (`skipLibCheck`, already on) are clean.

Dev-mode note: `vite dev` (unlike the production build) tries to resolve xrblocks' dynamic
optional imports at serve time and answers 500 for the xrblocks chunk, so `import('xrblocks')`
rejects under `npm run dev`. The session catches that and the pinch fallback reads
`hand.joints` straight off three's hand spaces instead — behaviorally identical (`Hands` is a
thin accessor over those same records). The shipped `dist/` build loads the real `Hands`.

## World-space UI attach points

- `window.__office.vr` — the live `VRSession`: `vr.active`, `vr.dolly` (rig to parent panels
  under for head-locked UI), `vr.lookDir(out)` (head forward for placement).
- `VRUiSink` in `session.ts` — the UI contract: `routeRay`, `panelHit`, `stickScroll`,
  `cancelRay`, `carryAlong`, `update`, `toggleMenu`, `openTerminal`, `setCarrying`.
- `VRSession.update` calls `hooks.onTarget` every frame with the ray hover — panel focus state
  can key off the same hover.
- `?vrtest=1` exposes `window.__vrtest` (ray state, teleports, key presses, panel probes);
  `src/client/iwsdk-scripts/` drives it through the IWSDK Quest 3 emulation.

## What needs a headset to verify

Without XR hardware, the following were **not** verified and must be checked on-device before
calling VR done:

1. Immersive stereo rendering (both eyes, correct scale/depth, no clipping through the loft).
2. The outline pass in-headset (`renderOutline` per XR frame): look and frame cost.
3. Controller ray feel, cursor-dot legibility, and reach gating at real room scale.
4. Trigger/squeeze/button/stick mapping on a real controller (mapping varies by headset).
5. Hand tracking: aim-pose rays and pinch (all three fallback layers).
6. Teleport arc readability, landing validation, and fade comfort.
7. Snap- vs smooth-turn comfort, turn-speed range, glide comfort and collision at glide speed.
8. In-headset frame rate with the full office (two eye renders × outline pass).
9. Session edge cases: headset sleep/resume mid-session, controller disconnect/reconnect,
   entering VR while seated/climbing/riding the elevator.
