/**
 * Quest / WebXR controller input: left thumbstick walks (WASD virtual keys), stick click runs,
 * right stick snap-turns (and, up and down, zooms the tabletop), face buttons / trigger map to the
 * office's keys (E, Esc, Space, Tab, N). The XR feature sees every press first (see XrHooks.press).
 */
import type { PlayerController } from '../../player';
import type { Hand } from './rays';

const SNAP = Math.PI / 6; // 30°
const DEAD = 0.3;
const MOVE_CODES = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft'] as const;

/**
 * XR standard gamepad (oculus-touch / Quest Touch Plus):
 * 0 trigger, 1 grip, 3 thumbstick click, 4 A/X, 5 B/Y.
 * Codes starting `Xr` are the headset's own, never sent to the office as keys.
 */
const LEFT_BUTTONS: Record<number, string> = {
  0: 'KeyE', // trigger → interact (more natural than face button alone)
  1: 'KeyN', // grip → next waiting worker
  4: 'Space', // X → jump
  5: 'Tab', // Y → menu
};
const RIGHT_BUTTONS: Record<number, string> = {
  0: 'KeyE', // trigger → interact
  1: 'XrGrip', // grip → tabletop / life-size, in passthrough
  4: 'KeyE', // A → interact
  5: 'Escape', // B → close / free
};

export interface XrHooks {
  /** The right stick flicked left or right. */
  snapYaw(delta: number): void;
  /** The right stick held up (+) or down (−), -1..1, each frame it is. */
  zoom(amount: number, dt: number): void;
  /** A mapped button went down or up: true keeps it from the office's keys. */
  press(hand: Hand, code: string, down: boolean): boolean;
}

export interface XrControls {
  /** Call each frame while a session is presenting. */
  tick(session: XRSession, dt: number, hooks: XrHooks): void;
  /** Release every virtual key and forget button edge state. */
  reset(): void;
}

/** Sends the office a key press, as if from the keyboard, so its own key bindings handle it. */
export function fireKey(code: string, down: boolean) {
  const key = code === 'Escape' ? 'Escape' : code === 'Space' ? ' ' : code === 'Tab' ? 'Tab' : code.replace(/^Key/, '');
  window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key, bubbles: true, cancelable: true }));
}

/** Builds the per-frame controller reader for one player. */
export function makeXrControls(player: PlayerController): XrControls {
  /** Which button indices were down last frame, per handedness. */
  const wasDown = { left: new Set<number>(), right: new Set<number>() };
  /** Buttons whose press the XR feature kept, so their release is kept too. */
  const kept = { left: new Set<number>(), right: new Set<number>() };
  /** Right stick was past the snap threshold last frame (edge-trigger snap turns). */
  let snapLatched = false;

  /** Quest profiles put the stick on 0/1 or 2/3 — pick whichever has more deflection. */
  function axesOf(pad: Gamepad): { x: number; y: number } {
    const a0 = pad.axes[0] ?? 0;
    const a1 = pad.axes[1] ?? 0;
    const a2 = pad.axes[2] ?? 0;
    const a3 = pad.axes[3] ?? 0;
    if (Math.hypot(a2, a3) > Math.hypot(a0, a1)) return { x: a2, y: a3 };
    return { x: a0, y: a1 };
  }

  function setMove(x: number, y: number, run: boolean) {
    for (const c of MOVE_CODES) player.releaseVirtual(c);
    if (Math.hypot(x, y) < DEAD) {
      if (run) player.holdVirtual('ShiftLeft');
      return;
    }
    // y < 0 is forward on Quest sticks.
    if (y < -DEAD) player.holdVirtual('KeyW');
    if (y > DEAD) player.holdVirtual('KeyS');
    if (x < -DEAD) player.holdVirtual('KeyA');
    if (x > DEAD) player.holdVirtual('KeyD');
    if (run) player.holdVirtual('ShiftLeft');
  }

  function buttons(hand: Hand, pad: Gamepad, map: Record<number, string>, hooks: XrHooks) {
    const prev = wasDown[hand];
    const next = new Set<number>();
    for (const [idxStr, code] of Object.entries(map)) {
      const idx = Number(idxStr);
      const btn = pad.buttons[idx];
      const down = !!btn && (btn.pressed || btn.value > 0.55);
      if (down) next.add(idx);
      if (down === prev.has(idx)) continue;
      if (down) {
        if (hooks.press(hand, code, true)) {
          kept[hand].add(idx);
          continue;
        }
      } else if (kept[hand].delete(idx)) {
        hooks.press(hand, code, false);
        continue;
      }
      if (!code.startsWith('Xr')) fireKey(code, down);
    }
    wasDown[hand] = next;
  }

  return {
    tick(session, dt, hooks) {
      let leftStick = false;
      const sources = session.inputSources;
      for (let i = 0; i < sources.length; i++) {
        const src = sources[i]!;
        const pad = src.gamepad;
        if (!pad) continue;
        const hand = src.handedness === 'left' || src.handedness === 'right' ? src.handedness : i === 0 ? 'left' : 'right';
        if (hand === 'left') {
          leftStick = true;
          const { x, y } = axesOf(pad);
          const run = !!pad.buttons[3]?.pressed;
          setMove(x, y, run);
          buttons('left', pad, LEFT_BUTTONS, hooks);
        } else {
          const { x, y } = axesOf(pad);
          if (Math.abs(x) > 0.55) {
            if (!snapLatched) {
              hooks.snapYaw(x > 0 ? -SNAP : SNAP);
              snapLatched = true;
            }
          } else {
            snapLatched = false;
            if (Math.abs(y) > DEAD) hooks.zoom(-y, dt);
          }
          buttons('right', pad, RIGHT_BUTTONS, hooks);
        }
      }
      if (!leftStick) for (const c of MOVE_CODES) player.releaseVirtual(c);
    },
    reset() {
      player.clearVirtual();
      wasDown.left.clear();
      wasDown.right.clear();
      kept.left.clear();
      kept.right.clear();
      snapLatched = false;
    },
  };
}
