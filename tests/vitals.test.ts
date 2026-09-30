import test from 'node:test';
import assert from 'node:assert/strict';
import { CUP, ENERGY_DRAIN, ENERGY_SECONDS, HIGH_STRESS, LOW_ENERGY, STRESS_DRAIN, STRESS_SECONDS, Vitals } from '../src/client/vitals.js';
import { DRINKS, DRINK_BY_ID } from '../src/shared/rooftop.js';

const beer = DRINK_BY_ID.get('beer')!;
const water = DRINK_BY_ID.get('water')!;
const mojito = DRINK_BY_ID.get('mojito')!;

/** Both meters start full and calm, and only start draining from the first call on. */
test('you start full of energy and calm, and the first call does not drain', () => {
  const v = new Vitals();
  assert.equal(v.energyLeft(1_000_000), 1);
  assert.equal(v.strain(1_000_000), 0);
});

test('energy runs down slowly and stress winds up slowly, at their own rates', () => {
  const v = new Vitals();
  v.energyLeft(0);
  v.strain(0);
  assert.equal(v.energyLeft(ENERGY_SECONDS / 2), 0.5);
  assert.equal(v.strain(STRESS_SECONDS / 2), 0.5);
});

test('a meter that has run out stays out, and the drain keeps its rate either way', () => {
  const v = new Vitals();
  v.energyLeft(0);
  v.strain(0);
  assert.equal(v.energyLeft(ENERGY_SECONDS * 3), 0);
  assert.equal(v.strain(STRESS_SECONDS * 3), 1);
  // Ten minutes on top of the last hour and a half: no running past the end of the bar.
  assert.equal(v.energyLeft(STRESS_SECONDS * 3 + 600), 0);
  assert.equal(v.strain(STRESS_SECONDS * 3 + 600), 1);
});

test('a cup puts energy back and never overfills you', () => {
  const v = new Vitals();
  v.drink(CUP, 0);
  assert.equal(v.energyLeft(0), 1, 'a cup on a full bar is still full');
  const nearlyOut = ENERGY_SECONDS * 0.9;
  v.energyLeft(nearlyOut);
  v.drink(CUP, nearlyOut);
  assert.ok(Math.abs(v.energyLeft(0) - (0.1 + CUP.energy)) < 1e-9, 'a cup fills the bar back up by what it puts in it');
});

test('drinking something takes stress off and never below calm', () => {
  const v = new Vitals();
  v.drink(beer, 0);
  assert.equal(v.strain(0), 0, 'a drink when you are calm is still calm');
  const wound = STRESS_SECONDS * 0.9;
  v.strain(wound);
  v.drink(beer, wound);
  assert.ok(Math.abs(v.strain(0) - (0.9 - beer.calm)) < 1e-9, `a lager should take its own share off: ${v.strain(0)}`);
});

test('your legs get heavy as the energy goes and your hands shake once you are wound up', () => {
  const v = new Vitals();
  v.energyLeft(0);
  v.strain(0);
  assert.equal(v.legs(0), 1);
  assert.equal(v.nerves(0), 0);
  v.energyLeft(ENERGY_SECONDS);
  v.strain(STRESS_SECONDS);
  assert.ok(v.legs(0) < 0.8, `flat out you should be slower: ${v.legs(0)}`);
  assert.ok(v.nerves(0) > 0.3, `wound right up your hands should shake: ${v.nerves(0)}`);
});

test('half wound up is where the shaking starts, and the lines the office says something at are around there', () => {
  const v = new Vitals();
  v.energyLeft(0);
  v.strain(0);
  assert.equal(v.nerves(STRESS_SECONDS * 0.5), 0);
  assert.ok(v.nerves(STRESS_SECONDS * 0.75) > 0);
  assert.ok(LOW_ENERGY < 0.5 && HIGH_STRESS > 0.5);
});

test('nothing in the office stops the clocks going backwards', () => {
  const v = new Vitals();
  v.drink(CUP, 100);
  assert.equal(v.energyLeft(0), 1, 'a clock that jumps back before anything has happened has nothing to drain');
  const gone = v.energyLeft(200);
  assert.ok(gone < 1, 'the time between two calls does drain');
  assert.equal(v.energyLeft(100), gone, 'and a clock that jumps back afterwards fills nothing back in');
});

test('the drinks say what they are for: coffee has the energy, the alcohol has the calm', () => {
  assert.ok(CUP.energy > 0, 'a cup of coffee puts energy back');
  assert.ok(CUP.calm >= 0, 'and settles you a little, never winds you up');
  for (const d of DRINKS) {
    assert.ok(d.energy >= 0 && d.energy <= 1, `${d.id} energy`);
    assert.ok(d.calm >= 0 && d.calm <= 1, `${d.id} calm`);
  }
  // Nothing at the bar has real energy in it: that's what a cup of coffee is for.
  for (const d of DRINKS) assert.ok(d.energy <= 0.02, `${d.id} has no energy in it`);
  // The alcohol is what takes the stress off, and the stronger it is the more of it.
  const alcohol = DRINKS.filter((d) => d.strength > 0);
  for (const d of alcohol) assert.ok(d.calm > mojito.calm, `${d.id} takes more off than the mocktail`);
  const byStrength = [...alcohol].sort((a, b) => a.strength - b.strength);
  for (let i = 1; i < byStrength.length; i++) assert.ok(byStrength[i].calm >= byStrength[i - 1].calm, 'a stronger drink takes at least as much off');
  assert.ok(water.calm > mojito.calm && water.calm < beer.calm, 'water settles you a bit, but a lager more');
  assert.equal(beer.energy, 0);
  assert.ok(beer.calm > 0);
});

test('the drain rates are the times the office promises: ten minutes of energy, fifteen of calm', () => {
  assert.equal(ENERGY_SECONDS, 600);
  assert.equal(STRESS_SECONDS, 900);
  assert.equal(ENERGY_DRAIN, 1 / 600);
  assert.equal(STRESS_DRAIN, 1 / 900);
});

test('the meters are only spent once they are right out: empty of energy, or wound right up', () => {
  const v = new Vitals();
  v.energyLeft(0);
  v.strain(0);
  assert.equal(v.spent(0), false, 'full and calm is not spent');
  assert.equal(v.spent(ENERGY_SECONDS - 1), false);
  assert.equal(v.spent(ENERGY_SECONDS), true, 'the energy running out is what does it');
  const w = new Vitals();
  w.energyLeft(0);
  w.strain(0);
  assert.equal(w.spent(STRESS_SECONDS), true, 'and so is winding right up');
});

test('resetting tops both meters up and starts their clocks again from there', () => {
  const v = new Vitals();
  v.energyLeft(0);
  v.strain(0);
  v.energyLeft(ENERGY_SECONDS);
  v.strain(STRESS_SECONDS);
  v.reset(1_000);
  assert.equal(v.spent(1_000), false);
  assert.equal(v.energyLeft(1_000 + ENERGY_SECONDS / 2), 0.5, 'the drain starts over from the reset');
  assert.equal(v.strain(1_000 + STRESS_SECONDS / 2), 0.5);
});