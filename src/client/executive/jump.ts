export interface JumpState { offset: number; velocity: number; airborne: boolean }

export function startJump(state: JumpState): boolean {
  if (state.airborne) return false;
  state.velocity = 5.4;
  state.airborne = true;
  return true;
}

export function stepJump(state: JumpState, dt: number): void {
  if (!state.airborne) return;
  state.velocity -= 14 * Math.min(dt, .05);
  state.offset = Math.max(0, Math.min(1.1, state.offset + state.velocity * Math.min(dt, .05)));
  if (state.offset <= 0 && state.velocity < 0) {
    state.offset = 0;
    state.velocity = 0;
    state.airborne = false;
  }
}
