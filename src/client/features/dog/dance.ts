// How the dog dances at a /party (see features/party): it's the dog's own, so it lives here.

/**
 * The dog at a /party (see features/party): wherever it's stopped (not asleep) it dances, wagging,
 * hopping on the beat, wiggling and turning round; on the move it bobs to the beat.
 */
export class DogDance {
  /** 1 on each beat of the music, falling to 0 before the next; null with no party on. */
  beat: number | null = null;
  /** How far round it's turned, dancing. */
  private spin = 0;

  /**
   * Poses `body` for this frame, over a woof's own little hop (`woofHop`). Returns whether it's
   * dancing, so it wags its tail whatever it was doing.
   */
  pose(body: { rotation: { y: number; z: number }; position: { y: number } }, moving: boolean, asleep: boolean, woofHop: number, dt: number, t: number): boolean {
    const beat = this.beat;
    const dancing = beat !== null && !moving && !asleep;
    if (dancing) this.spin += dt * 2.4;
    else this.spin -= Math.sin(this.spin) * Math.min(1, dt * 6);
    body.rotation.y = this.spin;
    body.rotation.z = dancing ? Math.sin(t * 7) * 0.12 : body.rotation.z * (1 - Math.min(1, dt * 8));
    const hop = beat === null || asleep ? 0 : beat * (moving ? 0.03 : 0.08);
    body.position.y = Math.max(woofHop, hop);
    return dancing;
  }
}
