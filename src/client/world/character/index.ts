// People: the chibi Person everyone in the office is (you, everyone else, the castle's guards) and the
// little Worker at a desk, what they hold, and the timing of how they move.
export { Person, type Pose } from './person';
export { Worker } from './worker';
export type { Stage } from './worker-dance';
export { BACKSWING_TIME, IMPACT } from './person-golf';
export { EXHALE_AT, REACH_TIME, SMOKE_CYCLE, dragCurve, emoteEnvelope, popCurve, reachCurve } from './curves';
export { boxOfStuff, cigarette, coffeeMug, drinkGlass, putDownGlass } from './props';
