/**
 * /party in the chat (the office tells everyone on that floor: see server/ws/handlers/presence.ts): for
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
  /** Whether you're up on the roof, where the DJ plays anyway. */
  upTop(): boolean;
  /** The lights the sky sets each frame (see core/scene.ts), for the club to turn down. */
  lights: { sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; ambient: THREE.AmbientLight };
}

/** Until when a /party is on, on the office's clock (0: none). */
let partyUntil = 0;

/** Whether a /party is on right now. */
export function partyOn(): boolean {
  return store.officeNow() < partyUntil;
}

export function installParty(ctx: Ctx, deps: PartyDeps) {
  const lights = buildPartyLights(FLOOR, WALL_HEIGHT);
  ctx.scene.add(lights.group);
  /** How far the club lights are faded in, and when everyone next gets up to dance again. */
  let level = 0;
  let danceAt = 0;
  const flash = new THREE.Color();

  const music = () => ctx.sound.setDj(deps.upTop() || partyOn() ? deps.djAt : null);

  ctx.messages.on('party', (msg) => {
    partyUntil = msg.until;
    danceAt = 0;
    music();
    toast(msg.until ? `🎉 ${msg.by} started a party on this floor! (/party stop ends it)` : `${msg.by} called the party off`);
  });

  // A party is its floor's: off to another floor (or up on the roof), and it's over for you.
  store.on('floor', () => {
    if (!partyUntil) return;
    partyUntil = 0;
    music();
  });

  // After the sky has lit the room (see updateSky in core/loop.ts): the club turns the lights down.
  ctx.ticks.add('env', ({ t, dt }) => {
    const on = partyOn();
    if (!on && partyUntil && level < 0.01) {
      partyUntil = 0;
      music();
    }
    const here = on && !deps.upTop() && ctx.inOffice();
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
