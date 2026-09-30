/**
 * You: your character as everyone else sees it, the cigarette smoke off it, what you hear, and
 * reaching out with your hands to use something.
 */
import * as THREE from 'three';
import { OfficeSound } from '../sound';
import { store, type Profile, type Settings } from '../state';
import { toast } from '../ui/dom';
import { Person } from '../world/character';
import { Smoke } from '../world/smoke';
import type { Ctx } from './context';
import { noOutline } from './outline';

/** A puff of cigarette smoke off someone's cigarette: a wisp off it, or a breath of it out. */
export type Puff = (kind: 'wisp' | 'exhale', at: THREE.Vector3, dir: THREE.Vector3) => void;

/** Your own character, as everyone else sees it (no name tag over your own head). */
export function makeMe(ctx: Ctx): Person {
  const me = new Person(store.profile.name, store.profile.color, store.profile.look);
  me.showLabel(false);
  ctx.scene.add(me.root);
  noOutline(me.root);
  return me;
}

/** Cigarette smoke, from anyone on a smoke break: the particles, and a puff of them off someone's cigarette. Needs ctx.me made. */
export function makeSmoke(ctx: Ctx): { smoke: Smoke; puff: Puff } {
  const smoke = new Smoke();
  ctx.scene.add(smoke.group);
  const puff: Puff = (kind, at, dir) => (kind === 'wisp' ? smoke.wisp(at) : smoke.exhale(at, dir));
  const camLocal = new THREE.Vector3();
  // In first person yours comes off the cigarette in your hand and out in front of the camera.
  ctx.me.onSmoke = (kind, at, dir) => {
    const { camera } = ctx;
    if (ctx.player.view !== 'first') return puff(kind, at, dir);
    if (kind === 'wisp') return smoke.wisp(camera.localToWorld(ctx.hands.cigTip(camLocal)));
    smoke.exhale(camera.localToWorld(camLocal.set(0, -0.14, -0.3)), camera.getWorldDirection(camLocal).setY(0.1).normalize());
  };
  return { smoke, puff };
}

/** What you hear, as loud as your settings have it. */
export function makeSound(settings: Settings): OfficeSound {
  const sound = new OfficeSound();
  sound.setVolume(settings.volume, settings.muted);
  sound.setMusicVolume(settings.music, settings.musicMuted);
  sound.onMusicError = (text) => toast(text, 'warn');
  return sound;
}

/** Reaching out to use something, and your look changing. */
export function installYou(ctx: Ctx) {
  let lastActSent = 0;
  /** Plays the reach on your hands and your character, and shows it to everyone else. */
  function reach() {
    if (ctx.player.view === 'first') ctx.hands.reach();
    ctx.me.reach();
    const now = performance.now();
    if (now - lastActSent > 120) {
      lastActSent = now;
      ctx.net.send({ t: 'act' });
    }
  }

  /** Your character and your hands, as `p` has them. */
  function showMyProfile(p: Profile) {
    const { me, hands } = ctx;
    me.setColor(p.color);
    me.setLook(p.look);
    hands.setColor(p.color);
    hands.setSkin(me.skinColor);
  }

  return { reach, showMyProfile };
}
