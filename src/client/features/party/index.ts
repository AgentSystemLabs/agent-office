/**
 * /party in the chat (the floor's, see server/ws/handlers/party.ts, and store.party): for
 * a minute every worker and board agent up on its desk dancing, the dog too, the DJ's set playing on
 * the floor, and the room a club (the lights down, lasers, a mirror ball, spots on the floor and
 * flashes on the beat, in the track's colour). When it's over the music stops and the lights fade back.
 */
import * as THREE from 'three';
import { FLOOR, WALL_HEIGHT } from '../../../shared/layout';
import type { Ctx } from '../../core/context';
import { djFrame } from '../../dnb';
import { store } from '../../state';
import { toast } from '../../ui/dom';
import { buildPartyLights } from '../../world/party';
import { uniforms as skyUniforms } from '../../world/sky';
import type { Dog } from '../dog/world';

export interface PartyDeps {
  /** Every worker and board agent on the floor up on its desk for a dance (see features/gong). */
  danceParty(): void;
  dog: Dog;
  /** How far into the DJ's set it is (see features/rooftop). */
  djAt(): number;
  /** The lights the sky sets each frame (see core/scene.ts), for the club to turn down. */
  lights: { sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; ambient: THREE.AmbientLight };
}

/** Whether the floor's /party is on right now. */
const partyOn = () => !!store.party && store.officeNow() < store.party.until;

export function installParty(ctx: Ctx, deps: PartyDeps) {
  const lights = buildPartyLights(FLOOR, WALL_HEIGHT);
  ctx.scene.add(lights.group);
  /** How far the club lights are faded in, and when everyone next gets up to dance again. */
  let level = 0;
  let danceAt = 0;
  const flash = new THREE.Color();

  ctx.messages.on('party', (msg) => {
    danceAt = 0;
    toast(msg.until ? `🎉 ${msg.by} started a party on this floor! (/party stop ends it)` : `${msg.by} called the party off`);
  });

  // After the sky has lit the room (see updateSky in core/loop.ts): the club turns the lights down.
  ctx.ticks.add('env', ({ t, dt }) => {
    // The floor's: on another floor, or up on the roof, it's not yours. (Arriving mid-party, you're
    // in it: see store.party.)
    const here = partyOn() && !ctx.upTop() && ctx.inOffice();
    // The DJ plays up on the roof and at a party (the sound only changes when that does).
    ctx.sound.setDj(ctx.upTop() || here ? deps.djAt : null);
    // The club lights are the office's; on a map of its own it's the dancing and the music.
    level += ((here && ctx.plan().style === 'office' ? 1 : 0) - level) * (1 - Math.exp(-dt * 2));
    if (here && t >= danceAt) {
      danceAt = t + 3;
      deps.danceParty();
    }
    const f = djFrame(deps.djAt());
    // The dog dances too, while it's on.
    deps.dog.dance.beat = here ? f.beat : null;
    lights.update(t, f, level);
    if (level < 0.01) return;
    const { sun, hemi, ambient } = deps.lights;
    // The house lights down, and the room flashing the track's colour on the kicks and snares.
    sun.intensity *= 1 - 0.9 * level;
    hemi.intensity *= 1 - 0.8 * level;
    // The office's lamplight in every lit material (see world/sky.ts), turned down.
    skyUniforms.skyOffice.value.multiplyScalar(1 - 0.85 * level);
    ambient.intensity = ambient.intensity * (1 - 0.7 * level) + Math.max(f.kick, f.snare * 0.7) * 0.8 * level * (0.5 + 0.5 * f.energy);
    ambient.color.lerp(flash.setHSL(f.hue, 0.9, 0.6), level);
  });
}
