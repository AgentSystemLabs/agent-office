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
2. Press **🕶️ Enter VR** on the top bar. The button only exists where
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
| Trigger / pinch tap | **E** on whatever the ray points at (desks, boards, elevator, gong, seats…). Trigger uses the object in that controller's hand first. |
| Squeeze / pinch-hold within 30 cm of a cup or issue note | Grab it in that hand; let go to put it down |
| Bring a held coffee mug to your mouth | Drink once after a short hold; trigger also drinks it |
| Touch a cab floor button with an index fingertip | Ride to that floor, without pinching |
| Touch the gong disc with a tracked hand | Ring it, without pinching |
| Pinch hold (hands) | Aim a teleport arc; release to go (green lands, red doesn't) |
| Both hands pinch-hold, rays off the panels | Toggle the ☰ menu (the hands' squeeze) |
| Squeeze away from grabbables, with no physical object held | Cancel: the carried issue card goes back, else the topmost window closes, else ☰ |
| B / Y, or stick click | **N**: go to the next worker waiting on someone |
| Hold A / X | Aim a teleport arc; release to go (green lands, red doesn't) |
| Left stick forward (glide off) | Same teleport aim; release past center to go |
| Left stick (glide on) | Smooth glide in the stick direction, relative to where you look |
| Right stick sideways | Snap-turn 45° per push (or smooth-turn, see Settings) |
| Left stick sideways (glide off) | Snap-/smooth-turn, for single-stick headsets |
| On a ladder: stick up/down, or pinch-hold right/left | Climb up / back down (E, or a quick pinch tap, lets go) |
| Walk around the room | Room-scale: the avatar follows the headset through the usual collision |
| ≡ on the left controller | Leaves VR. Chrome treats it as its exit gesture, and the office never sees the press |

Trigger is the controller `select` event, fired at once. A hand-tracked pinch counts only at
a full pinch (see "Input" below) and resolves per frame into tap, hold or menu. Every VR move goes through the avatar and the normal `move` messages, so
desktop users see the VR user walk, glide, turn and teleport like anyone else.

### Held coffee and issue cards

Reach for the cup under the kitchen coffee machine or a note on the issues board.
Controller squeeze grabs immediately; a tracked pinch held for 180 ms grabs before the
teleport threshold. Reach is measured from the controller grip or the midpoint of the
tracked thumb/index tips, not from the long aim ray. Panels and elevator touches keep
priority. One object can be carried at a time, in either hand.

Coffee stays attached to the hand. Bring it just below the headset for 350 ms, or press
that controller's trigger, to drink it through the usual coffee action. Each cup gives one
drink and visibly empties. Release to set it upright on the supporting floor or furniture;
it can be picked up again, still empty. Take a fresh cup at the machine to refill.

For an issue, aim at the board, queue, a desk or the meeting table and press the holding
controller's trigger, or tap with the free hand. Releasing while aimed at one of those
targets also uses it. Pinning returns the original card, queueing and desk handoff use the
existing carry actions, and meeting opens the VR meeting prompt with the issue number,
title and instructions filled in. Releasing elsewhere returns the card to its board.
There is no throwing physics.

Peers see the same object, hand pose and empty/placed coffee state over `peer.carrying`.
Pose updates are capped at 20 Hz and do not repaint the people list or boards. Session end,
loss of the holding input source, loss of tracking, floor changes and network disconnects
clear held objects; session/floor/network transitions also remove placed mugs. Desktop
coffee, issue carrying and controls are unchanged.

### Physical keyboard

A Bluetooth keyboard paired to the headset types while presenting. Keys go to the open
prompt (hire, ask, chat, search, comment…) first, else to the focused world-space terminal.
In a prompt, Enter sends, Escape cancels, ←/→/Home/End move and Backspace/Delete edit. In a
terminal, keys arrive as xterm bytes, including Ctrl chords (Ctrl+C), Alt as meta,
modified arrows, Home/End, PageUp/PageDown and Shift+Tab. In a Droid worker's terminal,
Ctrl+Enter queues and Shift+Enter adds a newline, the same as the desktop terminal
(`src/client/term-keys.ts`). With neither panel open, keys
type nothing and a toast says where they go.

No key reaches a desktop keybind while presenting: E doesn't interact, N doesn't jump, WASD
doesn't walk, T/Enter don't open chat, Tab doesn't open ☰. The boundary is one capture-phase
`keydown`/`keyup` listener on `window` (`src/client/vr/physical-keys.ts`), registered before
every other key listener. While `vr.active` it stops every key event there. Typeable keys
also lose their browser default. ⌘/Meta chords, function keys and bare modifiers keep their
browser behavior. On session enter, the focused DOM element is blurred, so an IME can't
compose into the chat box behind the headset.

The world-space keyboard is the fallback for hand-only users. It opens with every prompt
and terminal until a physical key types, then it tucks away and stays hidden for later
prompts and terminals. The **⌨** button on the terminal header and the prompt's title row
brings it back (and hides it again). Showing it this way re-arms the virtual keyboard until
the next physical key.

### Elevator cab buttons

In VR, the cab's west wall has one labeled key per floor and an **R · Rooftop bar** key.
Aim and tap, or touch a key with a tracked index fingertip. The key depresses and returns;
the normal elevator trip closes the doors, fades, changes floors and opens the doors on arrival.
The current floor is gold and does not start another trip. Floors still cloning are gray and
cannot be selected. Added, renamed, removed and finished-cloning floors update both cabs.
Long names are shortened on the key; the ray's aim hint shows the full name.

Touch fires once until the finger withdraws, with a short release margin for tracking jitter.
A touch consumes that hand's pinch so its release cannot also select or teleport. Without hand
tracking, ray taps still work. The **☰ → Floors** menu and tapping the elevator housing remain
fallbacks, including from outside the cab. Desktop retains its decorative cab panel and E/menu flow.

### Physical hand contact

Reach out and tap the gong disc.
Fingertips and palm joints can activate it. The coffee machine has no contact
zone: a hand reaching for its cup would press the machine first, so coffee in VR comes only
from grabbing the cup (see "Held coffee and issue cards"). A hand that holds an object
touches nothing. Its contact zone follows the visible
geometry with only a few centimeters of tolerance, not the much larger desktop walk-up radius.
The gong's zone stays at the resting disc so its swing cannot
ring it again against a stationary hand. Nearby furniture, the gong frame, and walking past
without touching do nothing. Seats, ladders, poles and other physical kinds remain ray-only
to avoid accidental locomotion or toggles.

Contact fires the same E action as a ray tap. Both hands on one object count as one contact.
Withdraw both hands for at least 120 ms to rearm; tracking loss alone does not rearm it.
A touch consumes that hand's pinch until release, preventing an extra ray click or teleport.
Panels, climbing and teleport aiming/fades take priority over contact. Ray taps keep their
existing reach limits for hands and controllers; desktop controls are unchanged.

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
wake, send-home, ⌨ keyboard toggle), the prompt + QWERTY keyboard,
the controls card, and a toast mirror. Both rays press independently (two-handed typing),
held keys repeat like a desktop board, and the prompt + keyboard ride teleports along.
A strip low in the view names what E would do to the ray's target (the desktop hint
bar's twin); TV and arcade stay desktop-only and say so.
Head-placed panels draw through walls (below the cursor dots); the terminal stays
depth-tested furniture. The menu, controls card and toast glide after the head; the
terminal, prompt and keyboard stay where they opened so you can lean in.
Destructive acts confirm with tap-twice (detail ✕, queue rows, PR review): the first tap
arms red, the second fires. Per view: hire (free desks, worktree toggle, shell shortcut),
queue (add, pause, tap-twice remove + requeue, trailing tap-twice clear), board detail (hand, queue, comment, close,
PR review panel, tap-twice ✓ merge at the dialog's defaults), jukebox (tunes + pasted streams), people (tap a row to walk over),
meeting (call with a pattern picker), settings (locomotion, sound mutes),
chat (🔎 searches the chat and every terminal; a terminal hit opens it at the line),
changes (a focused terminal's checkout: files, commit, tap-twice discard, open-a-PR).

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
- `src/client/vr/grab.ts` — single-owner physical grabs, object use/release, placement and
  throttled poses. `Grabbable` supplies domain callbacks; world meshes opt in with
  `userData.grabbable`. `world/held-object.ts` shares local/peer object geometry and offsets,
  and `shared/carry.ts` validates carry messages before the server stores or relays them.
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
`squeezestart` grabs nearby opted-in objects (otherwise cancel), and `squeezeend` releases.
B/Y/stick-click edges are N. Hands drive the same target-ray spaces
three updates from the hand aim pose, so one raycast path covers controllers and hands.
A hand is pinching when its gamepad's `buttons[0].value` reaches 1.0 (`FULL_PINCH` in
session.ts), or when three's joint-distance `pinchstart` fires (thumb and index tips within
about 1.5 cm). The runtime's native `selectstart` for a hand is ignored whenever the hand
reports a pinch value, because Galaxy XR fires it early, at a pinch value of 0.7, so a
half-closed hand would select. Chromium binds both the hand's select and `buttons[0]` to the
runtime's `/input/pinch_ext/value` and adds no threshold of its own, so the early threshold
comes from the runtime. Native select events stand in only for a hand with no gamepad.
The pinch resolves per frame (`PinchHold` in session.ts): a tap is E, a hold past
450 ms aims a teleport the release fires, and both hands held past 600 ms toggle the menu —
unless either ray works a panel, so two-handed typing never pops the menu up mid-word.
A nearby object claims a pinch at 180 ms, before teleport can aim. Its release cannot click
a panel, press E or teleport, and an occupied hand does not join the two-hand menu gesture.
A hand already aiming a teleport isn't hijacked: the second hand joining late doesn't menu.
All four behaviors were driven with real runtime hand input in the emulator (single hold →
aim → teleport; both together → menu with suppressed aims and consumed releases; late
second hand → no menu; hand tap on a panel row → click).
Controller buttons and sticks follow the XR Standard gamepad mapping. On Galaxy XR, Chromium
builds the controller gamepad as `[trigger, squeeze, placeholder, thumbstick, X/A, Y/B,
thumbrest]` with the stick on axes `[2, 3]` (`device/vr/openxr/openxr_controller.cc`,
matching the `samsung-galaxyxr` input profile). Tracked hands also get a gamepad,
`[pinch, placeholder, placeholder, placeholder, grasp]` with no axes (or just `[pinch]` on
runtimes that use XR_FB_hand_tracking_aim), so a source counts as a hand when
`inputSource.hand` is set, whatever its gamepad looks like. Sticks and face buttons are read
only from controllers (`controllerPad` in `session.ts`), so a hand's grasp at `[4]` is never
read as B. Chromium never fires `squeeze` events for hands.
The left controller's menu button is not on the gamepad: Chromium ends the WebXR session
when it is pressed (`openxr_input_helper.cc`).
Select, teleport and cancel request a short haptic pulse through
`gamepad.vibrationActuator` (then the older `hapticActuators`). Chrome currently returns no
actuator for XR gamepads (`xr_input_source.h`, crbug.com/955097), so Galaxy XR controllers do
not vibrate, and no feedback depends on it.
Chrome also ignores `XRProjectionLayer.fixedFoveation`, so three's foveation setting does
nothing there. The framebuffer scale (0.8 while presenting) is what trims the render cost.

Hands render as the skinned generic-hand mesh (`three`'s `XRHandMeshModel`, vendored under
`src/client/public/xr-hands/` so no CDN can break them), with three's joint spheres behind
as a fallback that hides once the mesh loads.

### three.js version

The client uses upstream `three` (not the `super-three` fork) with `WebGLRenderer`. Keep
`three` and `@types/three` on the same minor, so typecheck sees the API the browser runs.
`@iwsdk/core` and `@iwsdk/vite-plugin-dev` pin their own `super-three`; npm nests those
copies under them, and the emulator's injected bundle carries its own three.js, so neither
reaches the office bundle.

### xrblocks

[XR Blocks](https://github.com/google/xrblocks) (Google XR Labs) targets Chrome on Android
XR and Galaxy XR, but the office does not depend on it. Its input, interaction, reticle, UI
and simulator all run inside its `Core` engine: `xb.init()` creates its own
`WebGLRenderer`, camera, scene and `setAnimationLoop`, and `Input.init` is "Only called by
Core". Importing the package root constructs that `Core` singleton at load time. The office
already owns its renderer, dolly rig, outline pass and render loop, so adopting xrblocks
would mean moving the whole client onto its engine.

Its device knowledge is still a useful reference for Galaxy XR:

- `src/input/PinchFilter.ts`: "Temporary class until pinch is fixed at the system level on
  Galaxy XR". The Galaxy XR runtime fires a hand's native `selectstart` at a pinch value of
  0.7 (google/xrblocks 5dacc9ae), so xrblocks drops native hand select events and makes its
  own when `gamepad.buttons[0].value` reaches 1.0. The office applies the same rule
  (`FULL_PINCH`, see "Input").
- `src/core/Options.ts`: hands are the default input on Android XR, and `local-floor`,
  `bounded-floor` and `unbounded` are requested as optional reference spaces.

## World-space UI attach points

- `window.__office.vr` — the live `VRSession`: `vr.active`, `vr.dolly` (rig to parent panels
  under for head-locked UI), `vr.lookDir(out)` (head forward for placement).
- `VRUiSink` in `session.ts` — the UI contract: `routeRay`, `panelHit`, `stickScroll`,
  `cancelRay`, `carryAlong`, `update`, `toggleMenu`, `openTerminal`, `setCarrying`.
- `VRSession.update` calls `hooks.onTarget` every frame with the ray hover — panel focus state
  can key off the same hover.
- `?vrtest=1` exposes `window.__vrtest` (ray state, teleports, key presses, panel probes);
  `src/client/iwsdk-scripts/` drives it through the IWSDK Quest 3 emulation.

## Factory MCP setup

The project's `.factory/mcp.json` registers `iwsdk-runtime` using the installed
`@iwsdk/cli` and the `src/client` runtime workspace. Install the root dependencies
first (`npm ci --legacy-peer-deps`). Factory reloads the project config automatically;
the runtime, browser and XR tools become available without a global MCP entry.
`--no-install` prevents the MCP launcher from downloading a different CLI version.

`src/client/package.json` is a detection shim, never installed: the CLI treats the nearest
directory with a `package.json` that lists an `@iwsdk/*` package plus a Vite config as the
workspace, and the Vite plugin publishes its session under the Vite root (`src/client`).
Its `@iwsdk/cli` pin and `src/client/package-lock.json` must match the root lockfile
([`src/client/AGENTS.md`](../src/client/AGENTS.md) says how to update them).

Start the test runtime with `npm run dev:runtime` when using the browser/XR tools.
Runtime status and target discovery report whether a session is ready; they do not
start a browser or imply that a physical headset is connected.

## What needs a headset to verify

Without XR hardware, the following were **not** verified and must be checked on-device before
calling VR done:

1. Immersive stereo rendering (both eyes, correct scale/depth, no clipping through the loft).
2. The outline pass in-headset (`renderOutline` per XR frame): look and frame cost.
3. Controller ray feel, cursor-dot legibility, and reach gating at real room scale.
4. Trigger/squeeze/button/stick mapping on a real controller (mapping varies by headset).
   On Galaxy XR, B/Y fires N once per press, A/X aims a teleport, the stick glides and turns,
   and the left ≡ button leaves VR. Log `inputSource.profiles` once: Chromium builds with the
   Galaxy XR mapping report `samsung-galaxyxr` first (older builds report `oculus-touch`),
   and the controller model should load instead of the orange stand-in.
5. Hand tracking: aim-pose rays and pinch. A pinch should take effect only when thumb and
   index fully meet, never on a half-closed or relaxed hand. A closed fist must not fire N or
   aim a teleport. Log a hand's `gamepad.buttons` once to confirm the
   `[pinch, -, -, -, grasp]` layout and that a full pinch reaches `value` 1.0. If it never
   does, three's joint-distance pinch still has to trigger it.
   Also switch between controllers and hands mid-session (put the controllers down, pick them
   back up) and confirm rays, holds and the hand mesh follow.
6. Teleport arc readability, landing validation, and fade comfort.
7. Snap- vs smooth-turn comfort, turn-speed range, glide comfort and collision at glide speed.
8. In-headset frame rate with the full office (two eye renders × outline pass). Foveation
   does nothing in Chrome, so the 0.8 framebuffer scale is the only render-size saving.
   After leaving VR, the desktop camera's field of view and canvas size must be back to
   normal.
9. Session edge cases: headset sleep/resume mid-session, controller disconnect/reconnect,
   entering VR while seated/climbing/riding the elevator.
10. Physical keyboard: a Bluetooth keyboard paired to the headset delivers `keydown` to the
    page during the immersive session (the emulator run drives Chromium's key input, not a
    headset's), plus IME and non-US layouts through it.
11. Galaxy XR cab buttons: ride by ray tap and index-finger touch, hold contact without repeat
    rides, withdraw and press again, and travel to/from the roof. Check label readability and
    reach while standing/seated, live floor additions/removals/clone completion, and the
    floors-menu fallback. This physical-headset check is still pending; automated tests or
    IWSDK emulation do not satisfy it.
12. Galaxy XR physical contact: touch the gong
    with either hand. Hold contact (including both hands), withdraw, and re-touch. Walk past
    without reaching out, briefly lose tracking, and check pinch/ray and controller fallbacks.
    Reach for the coffee cup and confirm the machine does not drink on contact. This
    physical-headset check is pending; automated checks do not satisfy issue #4's hardware
    acceptance criterion.
13. **Galaxy XR grab acceptance is pending.** With hands, pick up coffee, move it, sip once,
    put it on a desk and pick the empty cup back up. With both hands and controllers, take an
    issue note, pin it, queue it, hand it to a desk and open a meeting with its issue preset.
    Observe the held/placed poses from a second client. Check hand tracking loss, controller
    disconnect, session exit, floor changes and network reconnect for orphaned objects.
    Confirm grabbing never also teleports or opens the menu, and ordinary teleport/menu/panel
    gestures still work away from objects. Node tests and browser checks do not satisfy this
    physical-headset requirement.

`tests/vr-grab.test.ts` covers physical reach, ownership, controller and pinch event routing,
mouth use, placement/re-grab, peer rendering, cleanup, and wire validation.

The cab's geometry, picking, press animation, list updates and touch debounce have Node tests
in `tests/elevator.test.ts` and `tests/vr.test.ts`. In an active IWSDK session, after visiting
the roof, run `npx --no-install @iwsdk/cli browser run iwsdk-scripts/vr-elevator-live-list.mjs`
from `src/client` to check both cabs against added, cloning, ready and removed floors.
That script injects client-only fixture data and restores the original list afterward.
