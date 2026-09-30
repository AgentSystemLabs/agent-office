import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Activities, Hooks, Interactions, Keys, Messages, TICK_PHASES, Ticks, Usables, View, type KeyPress } from '../src/client/core/registry.js';

type Msg = { t: 'hello'; n: number } | { t: 'bye' };

test('messages run before the store, then the routers, then after, each in registration order', () => {
  const log: string[] = [];
  const messages = new Messages<Msg>((m) => log.push(`apply ${m.t}`));
  messages.on('hello', (m) => log.push(`after1 ${m.n}`));
  messages.on('hello', () => log.push('before1'), 'before');
  messages.onAny((m) => log.push(`any1 ${m.t}`));
  messages.on('hello', () => log.push('after2'), 'after');
  messages.on('hello', () => log.push('before2'), 'before');
  messages.onAny(() => log.push('any2'));
  messages.on('bye', () => log.push('bye after'));
  messages.dispatch({ t: 'hello', n: 7 });
  assert.deepEqual(log, ['before1', 'before2', 'apply hello', 'any1 hello', 'any2', 'after1 7', 'after2']);
  log.length = 0;
  messages.dispatch({ t: 'bye' });
  assert.deepEqual(log, ['apply bye', 'any1 bye', 'any2', 'bye after']);
});

test('a message handler taken out stops running, from the next message on', () => {
  const log: string[] = [];
  const messages = new Messages<Msg>(() => {});
  const off = messages.on('hello', () => {
    log.push('once');
    off();
  });
  messages.on('hello', () => log.push('always'));
  messages.dispatch({ t: 'hello', n: 1 });
  messages.dispatch({ t: 'hello', n: 2 });
  assert.deepEqual(log, ['once', 'always', 'always']);
});

const press = (code: string, extra: Partial<{ key: string; repeat: boolean }> = {}) => {
  const e = { code, key: extra.key ?? code, repeat: extra.repeat ?? false, prevented: false, preventDefault: () => (e.prevented = true) };
  return e;
};
type Press = ReturnType<typeof press>;

test('keys go to the guards, then activities, then emotes, then bindings', () => {
  const log: string[] = [];
  const keys = new Keys<Press>();
  keys.bind({ code: 'KeyE', run: () => void log.push('bound E') });
  keys.add('emote', (e) => (log.push('emote'), e.code === 'KeyG'));
  keys.add('activity', (e) => (log.push('activity'), e.code === 'KeyE' && e.key === 'busy'));
  keys.add('guard', (e) => (log.push('guard'), e.key === 'typing'));
  assert.equal(keys.handle(press('KeyE', { key: 'typing' })), 'guard');
  assert.deepEqual(log, ['guard']);
  log.length = 0;
  assert.equal(keys.handle(press('KeyE', { key: 'busy' })), 'activity');
  assert.deepEqual(log, ['guard', 'activity']);
  log.length = 0;
  assert.equal(keys.handle(press('KeyG')), 'emote');
  assert.deepEqual(log, ['guard', 'activity', 'emote']);
  log.length = 0;
  assert.equal(keys.handle(press('KeyE')), 'bound');
  assert.deepEqual(log, ['guard', 'activity', 'emote', 'bound E']);
  assert.equal(keys.handle(press('KeyZ')), null);
});

test('a binding with the code has the key even when it does nothing; the character counts only for other codes', () => {
  let carrying = false;
  const log: string[] = [];
  const keys = new Keys<Press>();
  keys.bind({ key: '/', preventDefault: true, run: () => void log.push('search') });
  keys.bind({ code: 'KeyQ', when: () => carrying, run: () => void log.push('put back') });
  keys.bind({ code: ['KeyP', 'KeyL'], run: (e) => e.code === 'KeyP' });
  // A layout where Q types '/': Q is Q's, carrying or not.
  assert.equal(keys.handle(press('KeyQ', { key: '/' })), 'claimed');
  carrying = true;
  assert.equal(keys.handle(press('KeyQ', { key: '/' })), 'bound');
  const slash = press('Slash', { key: '/' });
  assert.equal(keys.handle(slash), 'bound');
  assert.equal(slash.prevented, true);
  assert.deepEqual(log, ['put back', 'search']);
  // run() returning false: the key stops there, unhandled.
  assert.equal(keys.handle(press('KeyP')), 'bound');
  assert.equal(keys.handle(press('KeyL')), 'claimed');
});

test('a binding that swallows repeats takes them as handled without running', () => {
  let runs = 0;
  const keys = new Keys<Press>();
  keys.bind({ code: 'KeyV', repeat: false, run: () => void runs++ });
  keys.bind({ code: 'KeyT', preventDefault: true, run: () => void runs++ });
  assert.equal(keys.handle(press('KeyV')), 'bound');
  assert.equal(keys.handle(press('KeyV', { repeat: true })), 'bound');
  assert.equal(runs, 1);
  // Repeats run by default.
  const t = press('KeyT', { repeat: true });
  assert.equal(keys.handle(t), 'bound');
  assert.equal(runs, 2);
  assert.equal(t.prevented, true);
});

test('the key registry works with any key press shape', () => {
  const keys = new Keys<KeyPress>();
  keys.bind({ code: 'KeyH', run: () => {} });
  assert.equal(keys.handle({ code: 'KeyH', key: 'h', repeat: false, preventDefault() {} }), 'bound');
});

test('ticks run phase by phase in the frame order, and in registration order within a phase', () => {
  const log: string[] = [];
  const ticks = new Ticks();
  for (const phase of [...TICK_PHASES].reverse()) ticks.add(phase, () => log.push(phase));
  ticks.add('move', () => log.push('move 2'));
  ticks.add('pre', (f) => log.push(`pre 2 ${f.dt}`));
  ticks.run({ delta: 0.5, dt: 0.1, t: 3, now: 3000 });
  const want: string[] = [];
  for (const phase of TICK_PHASES) {
    want.push(phase);
    if (phase === 'pre') want.push('pre 2 0.1');
    if (phase === 'move') want.push('move 2');
  }
  assert.deepEqual(log, want);
  assert.throws(() => ticks.add('nope' as never, () => {}));
});

test('a tick taken out mid-frame still runs the rest of that frame', () => {
  const log: string[] = [];
  const ticks = new Ticks();
  const off = ticks.add('aim', () => {
    log.push('a');
    off();
  });
  ticks.add('aim', () => log.push('b'));
  const f = { delta: 0, dt: 0, t: 0, now: 0 };
  ticks.run(f);
  ticks.run(f);
  assert.deepEqual(log, ['a', 'b', 'b']);
});

type Why = 'trip' | 'walk';

function activity(id: string, log: string[], opts: { on?: boolean; stopsFor?: Why[]; key?: string; camera?: boolean } = {}) {
  const a = {
    id,
    on: opts.on ?? false,
    active: () => a.on,
    stop: (why: Why) => {
      if (opts.stopsFor && !opts.stopsFor.includes(why)) return;
      log.push(`${id} stops for ${why}`);
      a.on = false;
    },
    key: (e: string) => (log.push(`${id} key ${e}`), e === opts.key),
    takesCamera: opts.camera,
  };
  return a;
}

test('activities keep their declared order whatever order they were added in', () => {
  const log: string[] = [];
  const acts = new Activities<Why, string>(['hanger', 'climber', 'golf']);
  const golf = activity('golf', log, { on: true, key: 'KeyE', camera: true });
  const extra = activity('extra', log, { on: true });
  const hanger = activity('hanger', log, { on: true, key: 'Escape' });
  acts.add(golf);
  acts.add(extra);
  acts.add(hanger);
  acts.add(activity('climber', log));
  assert.deepEqual(
    acts.all().map((a) => a.id),
    ['hanger', 'climber', 'golf', 'extra'],
  );
  assert.equal(acts.current()?.id, 'hanger');
  assert.equal(acts.busy(), true);
  assert.equal(acts.running('golf'), true);
  assert.equal(acts.running('climber'), false);
  assert.equal(acts.any('takesCamera'), true);
  assert.equal(acts.any('hidesHands'), false);
  // Keys go to what's going on, in order, until one takes it.
  assert.equal(acts.key('KeyE'), true);
  assert.deepEqual(log, ['hanger key KeyE', 'golf key KeyE']);
  assert.throws(() => acts.add(activity('golf', log)));
});

test('stopAll stops what is going on in order, but what is excepted or does not stop for that', () => {
  const log: string[] = [];
  const acts = new Activities<Why>(['hanger', 'climber', 'driver', 'golf']);
  const hanger = activity('hanger', log, { on: true, stopsFor: ['trip'] });
  const climber = activity('climber', log);
  const driver = activity('driver', log, { on: true });
  const golf = activity('golf', log, { on: true });
  for (const a of [golf, driver, climber, hanger]) acts.add(a);
  acts.stopAll('walk');
  assert.deepEqual(log, ['driver stops for walk', 'golf stops for walk']);
  assert.equal(hanger.on, true);
  log.length = 0;
  driver.on = golf.on = true;
  acts.stopAll('trip', ['golf']);
  assert.deepEqual(log, ['hanger stops for trip', 'driver stops for trip']);
  assert.equal(golf.on, true);
  log.length = 0;
  acts.stopAll('trip');
  assert.deepEqual(log, ['golf stops for trip']);
  assert.equal(acts.busy(), false);
  assert.equal(acts.current(), undefined);
});

test('stop stops one activity alone, only while it is going on, and it decides whether that stops it', () => {
  const log: string[] = [];
  const acts = new Activities<Why>(['hanger', 'driver']);
  const hanger = activity('hanger', log, { on: true });
  const driver = activity('driver', log, { stopsFor: ['trip'] });
  acts.add(hanger);
  acts.add(driver);
  acts.stop('driver', 'trip');
  assert.deepEqual(log, []);
  driver.on = true;
  acts.stop('driver', 'walk');
  assert.deepEqual(log, []);
  acts.stop('driver', 'trip');
  assert.deepEqual(log, ['driver stops for trip']);
  assert.equal(hanger.on, true);
  // Nothing registered by that id: nothing happens.
  acts.stop('golf', 'trip');
  assert.deepEqual(log, ['driver stops for trip']);
});

test('an activity with both hands busy says so, only while it is going on', () => {
  const acts = new Activities(['golf', 'driver']);
  let golfing = false;
  acts.add({ id: 'golf', active: () => golfing, stop: () => {}, bothHands: true, hidesHands: true });
  acts.add({ id: 'driver', active: () => true, stop: () => {}, hidesHands: true });
  assert.equal(acts.any('hidesHands'), true);
  assert.equal(acts.any('bothHands'), false);
  golfing = true;
  assert.equal(acts.any('bothHands'), true);
});

test('an activity taken out is gone from the order', () => {
  const acts = new Activities(['a', 'b']);
  const off = acts.add({ id: 'a', active: () => true, stop: () => {} });
  acts.add({ id: 'b', active: () => true, stop: () => {} });
  off();
  assert.deepEqual(
    acts.all().map((a) => a.id),
    ['b'],
  );
});

test('view effects: the first grip that holds on, the field of view through each in order, updates, cover', () => {
  const view = new View<'ladder' | 'pole'>();
  const log: string[] = [];
  let grip: 'ladder' | 'pole' | null = null;
  let narrow = false;
  let covered = false;
  view.add({ fov: (f) => (narrow ? 24 : f), covers: () => covered, update: () => log.push('first') });
  view.add({ grip: () => grip, fov: (f) => f + 0.5 * 16, update: () => log.push('second') });
  view.add({ grip: () => 'pole' });
  // The first effect holding on to something says what you hold.
  assert.equal(view.grip(), 'pole');
  grip = 'ladder';
  assert.equal(view.grip(), 'ladder');
  // Through each effect in the order they were added: the second widens what the first narrowed.
  assert.equal(view.fov(55), 55 + 8);
  narrow = true;
  assert.equal(view.fov(55), 24 + 8);
  view.update();
  assert.deepEqual(log, ['first', 'second']);
  assert.equal(view.covered(), false);
  covered = true;
  assert.equal(view.covered(), true);
});

test('view filters wrap the frame, the first outermost, and only those that are on', () => {
  const view = new View();
  const log: string[] = [];
  const f = { delta: 0, dt: 0, t: 7, now: 0 };
  let drunk = true;
  view.add({ filter: { begin: () => (log.push('outer begin'), true), end: (x) => void log.push(`outer end ${x.t}`) } });
  view.add({ filter: { begin: () => (log.push('drunk begin'), drunk), end: () => void log.push('drunk end') } });
  view.draw(f, () => log.push('draw'));
  assert.deepEqual(log, ['outer begin', 'drunk begin', 'draw', 'drunk end', 'outer end 7']);
  log.length = 0;
  drunk = false;
  view.draw(f, () => log.push('draw'));
  assert.deepEqual(log, ['outer begin', 'drunk begin', 'draw', 'outer end 7']);
});

test('an effect taken out stops having a say', () => {
  const view = new View();
  const off = view.add({ fov: (f) => f * 2, covers: () => true });
  assert.equal(view.fov(10), 20);
  off();
  assert.equal(view.fov(10), 10);
  assert.equal(view.covered(), false);
});

test('hooks run in the order they were added, and one taken out stops running', () => {
  const log: string[] = [];
  const hooks = new Hooks();
  hooks.add(() => log.push('ball'));
  const off = hooks.add(() => log.push('wheel'));
  hooks.add(() => log.push('last'));
  hooks.run();
  assert.deepEqual(log, ['ball', 'wheel', 'last']);
  log.length = 0;
  off();
  hooks.run();
  assert.deepEqual(log, ['ball', 'last']);
});

test('a hook added while the hooks run runs from the next time on', () => {
  const log: string[] = [];
  const hooks = new Hooks();
  hooks.add(() => {
    log.push('first');
    hooks.add(() => log.push('late'));
  });
  hooks.run();
  assert.deepEqual(log, ['first']);
  log.length = 0;
  hooks.run();
  assert.deepEqual(log, ['first', 'late']);
});

test('usables: each source a list, in the order they were added, read when asked, and only the pickables there are', () => {
  const pictures = ['frame'];
  let dogAt = 'kitchen';
  const usables = new Usables<string, string>();
  usables.add({ usable: () => pictures });
  const offDog = usables.add({ usable: () => [`dog in the ${dogAt}`], pickable: () => 'dog' });
  usables.add({ usable: () => ['ball'] });
  assert.deepEqual(usables.lists(), [['frame'], ['dog in the kitchen'], ['ball']]);
  assert.deepEqual(usables.pickables(), ['dog']);
  pictures.push('poster');
  dogAt = 'lounge';
  assert.deepEqual(usables.lists(), [['frame', 'poster'], ['dog in the lounge'], ['ball']]);
  offDog();
  assert.deepEqual(usables.lists(), [['frame', 'poster'], ['ball']]);
  assert.deepEqual(usables.pickables(), []);
});

type It = { kind: 'desk' | 'dog' | 'tv'; name?: string };

test('interactions: one definition per kind, with its reach, hint and use', () => {
  const log: string[] = [];
  const things = new Interactions<{ it: It; hint: string; key: 'E' | 'O'; note: string | null }>();
  things.define('dog', { reach: 3.2, hint: () => 'pet the dog', use: (it, key, note) => void log.push(`${it.kind} ${key} ${note}`) });
  things.define('desk', { reach: 4.5, hint: (it) => `desk ${it.name}`, use: () => void log.push('desk') });
  assert.equal(things.reach('dog'), 3.2);
  assert.equal(things.hint({ kind: 'desk', name: 'D1' }), 'desk D1');
  things.use({ kind: 'dog' }, 'E', null);
  assert.deepEqual(log, ['dog E null']);
  assert.deepEqual(things.missing(['desk', 'dog', 'tv']), ['tv']);
  assert.deepEqual(things.kinds().sort(), ['desk', 'dog']);
  assert.throws(() => things.define('dog', { reach: 1, hint: () => '', use: () => {} }));
  assert.throws(() => things.hint({ kind: 'tv' }));
});

/** Every .ts file in the client, by its path under src/client, with its code (its comments taken out). */
function clientSources(): { file: string; src: string }[] {
  const root = path.join(import.meta.dirname, '../src/client');
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  return (readdirSync(root, { recursive: true }) as string[]).filter((rel) => rel.endsWith('.ts')).map((file) => ({ file, src: code(readFileSync(path.join(root, file), 'utf8')) }));
}

/**
 * The kinds of thing you can use, as the client adds them to world/types.ts's InteractKinds (each
 * where it's defined), with the file each is added in. Every `interface InteractKinds` in the client
 * is read, and each line in one must be a kind (`name: true;`), so none can slip past.
 */
function interactKinds(): { kind: string; file: string }[] {
  const out: { kind: string; file: string }[] = [];
  for (const { file, src } of clientSources()) {
    for (const m of src.matchAll(/interface InteractKinds\b([^{]*)\{([^}]*)\}/g)) {
      assert.equal(m[1].trim(), '', `${file}: InteractKinds is only ever augmented, never extended`);
      for (const line of m[2].split('\n').map((l) => l.trim())) {
        if (!line) continue;
        const k = /^([a-z]+): true;$/.exec(line);
        assert.ok(k, `${file}: "${line}" in InteractKinds isn't a kind (name: true;)`);
        out.push({ kind: k[1], file });
      }
    }
    // Declared any other way, the scan above wouldn't see it.
    assert.equal([...src.matchAll(/\bInteractKinds\b/g)].length - [...src.matchAll(/interface InteractKinds\b/g)].length, file === 'world/types.ts' ? 1 : 0, `${file} names InteractKinds other than to add kinds to it`);
  }
  return out;
}

/** Every `interactions.define('kind', …)` in the client, wherever it lives, with the file it's in. */
function definedKinds(): { kind: string; file: string }[] {
  const out: { kind: string; file: string }[] = [];
  for (const { file, src } of clientSources()) for (const m of src.matchAll(/interactions\.define\(\s*'([a-z]+)'/g)) out.push({ kind: m[1], file });
  return out;
}

test('InteractKind is the kinds added to InteractKinds, and world/types.ts adds none itself', () => {
  const src = readFileSync(path.join(import.meta.dirname, '../src/client/world/types.ts'), 'utf8');
  assert.match(src, /^export interface InteractKinds \{\}$/m);
  assert.match(src, /^export type InteractKind = keyof InteractKinds;$/m);
  assert.deepEqual(interactKinds().filter((k) => k.file === 'world/types.ts'), []);
});

test('every kind of thing you can use has exactly one definition, in the file that adds the kind, and nothing else is defined', () => {
  const added = interactKinds();
  const kinds = added.map((k) => k.kind);
  assert.ok(kinds.length >= 31, `found ${kinds.length} kinds`);
  assert.deepEqual(
    kinds.filter((k, i) => kinds.indexOf(k) !== i),
    [],
    'kinds added more than once',
  );
  const defined = definedKinds();
  const count = new Map<string, number>();
  for (const d of defined) count.set(d.kind, (count.get(d.kind) ?? 0) + 1);
  assert.deepEqual(
    kinds.filter((k) => !count.has(k)),
    [],
    'kinds with no definition',
  );
  assert.deepEqual(
    [...count].filter(([, n]) => n > 1).map(([k]) => k),
    [],
    'kinds defined more than once',
  );
  assert.deepEqual(
    [...count.keys()].filter((k) => !kinds.includes(k)),
    [],
    'definitions for kinds InteractKinds does not have',
  );
  assert.deepEqual(
    defined.filter((d) => !added.some((a) => a.kind === d.kind && a.file === d.file)).map((d) => `${d.kind} in ${d.file}`),
    [],
    'kinds defined somewhere other than where they are added',
  );
});
