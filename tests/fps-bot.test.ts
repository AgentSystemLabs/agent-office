import test from 'node:test';
import assert from 'node:assert/strict';
import { FpsBot, BOT_SKILL } from '../src/server/fps-bot.js';
import { FpsDuel } from '../src/server/fps.js';
import { idleInput, validInput, type FpsPlayer } from '../src/shared/fps.js';
import { BOT_PROFILES, validBotOptions, type BotProfile } from '../src/shared/fps-bots.js';

const player = (id: string, x: number, z: number): FpsPlayer => ({ id, name: id, x, z, y: 0, vy: 0, yaw: 0, pitch: 0, hp: 100, ammo: 30, reserve: 90, score: 0, reloadUntil: 0, ready: false });

test('bot options reject malformed and inherited keys; configuration is restricted to the trainee', () => {
  for (const v of [null, {}, { profile: 'toString', difficulty: 'hard' }, { profile: 'marksman', difficulty: '__proto__' }]) assert.equal(validBotOptions(v), false);
  const d = new FpsDuel(), options = { profile: 'marksman', difficulty: 'expert' } as const;
  assert.equal(d.practice('a', 'Alice', options, 1000), true);
  assert.equal(d.state(1000).phase, 'countdown'); assert.equal(d.state(1000).players[1].bot, 'marksman');
  assert.equal(d.configureBot('outsider', { profile: 'flanker', difficulty: 'easy' }), false);
  assert.equal(d.configureBot('a', { profile: 'flanker', difficulty: 'easy' }), true);
  assert.equal(d.state(1000).players[1].difficulty, 'easy');
  assert.equal(d.join('b', 'Bob', 1000), false);
  const humans = new FpsDuel(); humans.join('a', 'Alice', 1000); humans.join('b', 'Bob', 1000);
  assert.equal(humans.practice('a', 'Alice', options, 1000), false); assert.equal(humans.configureBot('a', options), false);
  assert.equal(humans.state(1000).players.length, 2);
});

test('difficulty changes reaction time, precision and cadence; cover prevents bot fire', () => {
  assert.ok(BOT_SKILL.expert.error < BOT_SKILL.easy.error); assert.ok(BOT_SKILL.expert.interval < BOT_SKILL.easy.interval);
  const a = player('ai', -14, 9), b = player('b', -14, -9);
  const easy = new FpsBot({ profile: 'marksman', difficulty: 'easy' }, () => .5);
  const expert = new FpsBot({ profile: 'marksman', difficulty: 'expert' }, () => .5);
  for (const bot of [easy, expert]) assert.equal(bot.step(a, b, 1000, .05).input.fire, false);
  assert.equal(easy.step(a, b, 1200, .05).input.fire, false);
  assert.equal(expert.step(a, b, 1200, .05).input.fire, true);
  assert.equal(expert.step(a, b, 1250, .05).input.fire, false);
  a.x = b.x = -11;
  for (let t = 2000; t < 4000; t += 50) assert.equal(expert.step(a, b, t, .05).input.fire, false, 'crate blocks line of sight');
  a.x = b.x = -14;
  assert.equal(expert.step(a, b, 4000, .05).input.fire, false, 'reacquiring needs another reaction delay');
  const empty = expert.step({ ...a, ammo: 0 }, b, 4050, .05);
  assert.equal(empty.reload, true); assert.equal(validInput(empty.input), true);
});

test('all hard bots navigate cover and win an idle-player round using regular authority', () => {
  for (const profile of Object.keys(BOT_PROFILES) as BotProfile[]) {
    const d = new FpsDuel(); d.practice('a', 'Alice', { profile, difficulty: 'hard' }, 1000);
    let botShots = 0, now = 4000;
    for (; now < 65000; now += 50) {
      for (const s of d.tick(now)) { if (s.shooter !== 'a') botShots++; }
      const state = d.state(now), bot = state.players.find(p => p.bot)!;
      assert.ok(Math.abs(bot.x) <= 15.2 && Math.abs(bot.z) <= 11.2, `${profile} stays within walls`);
      if (state.phase === 'intermission') break;
    }
    const state = d.state(now), bot = state.players.find(p => p.bot)!;
    assert.ok(botShots > 0, `${profile} reaches line of sight and fires`);
    assert.equal(state.players[0].hp, 0, `${profile} defeats a stationary opponent`);
    assert.equal(bot.score, 1); assert.ok(bot.ammo < 30); assert.ok(bot.reserve <= 90);
    d.tick(now + 3500); assert.equal(d.state(now + 3500).phase, 'countdown');
    assert.ok(d.state(now + 3500).players.every(p => p.hp === 100 && p.ammo === 30));
    assert.equal(d.leave('a', now + 3600), true); assert.equal(d.state(now + 3600).players.length, 0);
  }
});

test('a training match ends at five and one human rematch vote restarts it', () => {
  const d = new FpsDuel(); d.practice('a', 'Alice', { profile: 'marksman', difficulty: 'expert' }, 1000);
  let now = 4000;
  for (; now < 300000 && d.state(now).phase !== 'finished'; now += 50) { d.input('a', idleInput(), now); d.tick(now); }
  assert.equal(d.state(now).phase, 'finished'); assert.equal(d.state(now).players[1].score, 5);
  d.rematch('a', now); assert.equal(d.state(now).phase, 'countdown');
  assert.ok(d.state(now).players.every(p => p.score === 0));
});
