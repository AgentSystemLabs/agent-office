import type { Person } from '../../world/character';
import type { GestureCue } from './choreography';

/** Seek the existing rig through its public API; late observers join the current shared phase. */
export class GesturePlayer {
  private key = '';
  private age = 0;

  update(person: Person, cue: GestureCue | undefined, dt: number, t: number, moving: boolean) {
    if (!cue) {
      if (this.key) person.update(5, t, moving, false); // Finish a canceled emote before the base pose.
      this.key = '';
      person.update(dt, t, moving, false);
      return;
    }
    const restart = this.key !== cue.key || cue.age < this.age;
    if (restart) person.emote(cue.emote);
    person.update(restart ? cue.age : cue.age - this.age, t, moving, false);
    this.key = cue.key;
    this.age = cue.age;
  }
}
