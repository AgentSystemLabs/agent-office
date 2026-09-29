# Spec: .44 Magnum, worker Darwin Awards

## Summary

Pressing `7` toggles a realistic silver .44 Magnum in your right hand.
Click shoots. One shot visually kills a worker: it falls out of its chair,
bleeds out on the floor, and a cleanup dialog opens with a new **Revive**
option. Picking a cleanup confirms the kill (same as send home). Revive
stands the worker back up with its session untouched.

## Behavior

### Draw and holster (`7`)

- `7` toggles the gun on and off. Both draw and holster get an animation
  and a sound (slide click out, soft click away).
- The gun lives in the right hand. The left hand keeps its mug, drink,
  or smoke.
- Blocked with a "hands full" toast while carrying an issue card, book,
  or basketball, and while golfing, climbing, or hanging a picture.
- While drawn, the crosshair turns red and the hint bar reads
  `Click: fire · 7: holster`.
- First person shows the gun in `Hands`; third person shows it in your
  character's raised right hand (same pattern as the golf club prop).
- `1-6` are emotes, so `7` is free.

### Firing

- Click fires.
- Hit test is a raycast from the camera through the crosshair (first
  person) or mouse (third): the nearest worker whose model the ray hits
  first wins.
- Anything solid in front blocks the shot, so line of sight is required.
  Range covers the whole floor.
- Workers only. Never players, never yourself.
- A miss cracks against the wall or floor with an impact puff and sound.
  Nothing dies.
- One shot kills (visually). Muzzle flash, loud synthesized shot, one
  shell of recoil.

### Bleed-out (local preview, nothing sent to the server yet)

- The shot worker tumbles out of its chair onto the floor, lands with a
  thud, and a realistic blood pool spreads under it. Status light out,
  face gone slack.
- Session keeps running, laptop stays on, desk stays occupied. This
  mirrors having send-home open but unconfirmed.
- The bleed-out dialog opens instantly and can only be resolved with a
  button: pick a cleanup (same keep / worktree / all radios as send-home,
  same worktree inspection) to confirm the kill, or **Revive**.
- Revive stands the worker back up into its seat with session untouched,
  blood gone, toast confirms.
- Shooting always opens the full cleanup dialog with Revive, even for
  workers without worktrees (which today get a small confirm dialog).
- Escape counts as Revive, so the dialog can never strand a corpse.

### Confirmed kill

- Sends the existing `worker.kill` with the chosen cleanup.
- When `worker.remove` arrives, this client routes the worker to the new
  medic sequence instead of the walk-out: two white-uniform paramedics
  walk in from the elevator with a stretcher, load the body (~1.5s, blood
  pool drains as it lifts), carry it to the elevator, and fade.
- Laptop shuts and shrinks as it does today.
- Blood pool is gone with the body. No permanent stain.

### Multiplayer

- Cheapest thing that works (multiplayer is going away): the death scene
  is local to the shooter. Other clients see a normal send-home walk-out
  on the confirmed kill.

### Edge cases

- One body at a time: modals already block input, so you cannot shoot
  again until the dialog resolves.
- Floor switch, disconnect, or the worker vanishing mid-dialog: dialog
  closes, local dying state drops, normal removal proceeds. No stuck
  corpse, no stuck desk.
- Weird positions (meeting table, beanbag, mid-arrival, upstairs floors):
  fall to the floor the same way everywhere.
- Upstairs floors: medics use the elevator, never the balcony parachute.

## Changes (client only, no protocol or server changes)

| File | Change |
| --- | --- |
| `src/client/world/gun.ts` (new) | Silver .44 Magnum mesh (three.js primitives), muzzle-flash helper |
| `src/client/world/hands.ts` | `holdGun(on)`, `fireGun()` recoil on the right arm |
| `src/client/world/character.ts` | `Person.setGun/fire` (third-person arm + prop); `Worker.die/revive` visual states |
| `src/client/world/casualties.ts` (new) | `Casualties` class mirroring `Departures`: fall, blood pool, medics + stretcher, revive-to-seat |
| `src/client/main.ts` | `Digit7` toggle, gun-drawn click override in `player.onClick`, worker raycast, dialog hookup, `shotDead` routing in the remove sync, crosshair/hint, per-frame update |
| `src/client/ui/prompt.ts` | `shootDialog`: cleanup radios + Revive + confirm-kill, button-only resolution |
| `src/client/sound.ts` | `gunshot`, `gunDraw`, `gunHolster`, body thud, medic siren sting (Web Audio synth, same patterns as `thunder`/`gong`) |
| `docs/guide.md` | `7` row in Controls plus a short section |
| `tests/casualties.test.ts` (new) | State-machine and timeline unit tests (Node-loadable, like other world modules) |

Out of scope: VR support, kill confirmations for other players,
persistent blood.

## Validation

`npm run lint`, `npm run typecheck`, `npm test`, plus a manual in-office
shoot/revive/kill pass.
