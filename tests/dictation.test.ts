import test from 'node:test';
import assert from 'node:assert/strict';
import { HOLD_MS, PushToTalk, QUIET_MS, Transcript, cleanSpoken, listen, speechProblem, spliceSpoken, type RecResults, type Recognizer, type RecognizerCtor } from '../src/client/ui/speech.js';

/** A recognizer's results so far: [words, whether it has settled on them]. */
const results = (...rs: [string, boolean][]): RecResults => Object.assign(rs.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal })), { length: rs.length });

test('what was said goes into a field in place of the selection, spaced from the words around it', () => {
  assert.deepEqual(spliceSpoken('', 0, 0, ' fix the login bug '), { value: 'fix the login bug', caret: 17 });
  assert.deepEqual(spliceSpoken('Fix it', 6, 6, 'and add a test'), { value: 'Fix it and add a test', caret: 21 });
  assert.deepEqual(spliceSpoken('Fix it ', 7, 7, 'and add a test'), { value: 'Fix it and add a test', caret: 21 });
  assert.deepEqual(spliceSpoken('one three', 4, 4, 'two'), { value: 'one two three', caret: 8 }, 'a space after it, before the next word');
  assert.deepEqual(spliceSpoken('say hello please', 4, 9, 'goodbye'), { value: 'say goodbye please', caret: 11 }, 'the selection is replaced');
  assert.deepEqual(spliceSpoken('done', 4, 4, ', mostly'), { value: 'done, mostly', caret: 12 }, 'no space before punctuation');
  assert.deepEqual(spliceSpoken('see (', 5, 5, 'this'), { value: 'see (this', caret: 9 }, 'nor after an opening bracket');
  assert.deepEqual(spliceSpoken('line one\n', 9, 9, 'line two'), { value: 'line one\nline two', caret: 17 });
  assert.deepEqual(spliceSpoken('as it was', 3, 3, '  '), { value: 'as it was', caret: 3 }, 'nothing said, nothing typed');
});

test('what was said is one line of plain text: nothing a terminal would take for a key', () => {
  assert.equal(cleanSpoken('  run the\ntests \x1b[A now\r\n'), 'run the tests [A now');
  assert.equal(cleanSpoken('\x03\x04'), '');
});

test('each phrase is handed over once, when the recognizer settles on it', () => {
  const t = new Transcript();
  assert.deepEqual(t.take(results(['fix the', false])), { said: [], interim: 'fix the' });
  assert.deepEqual(t.take(results(['fix the login', false], [' bug', false])), { said: [], interim: 'fix the login bug' });
  assert.deepEqual(t.take(results(['Fix the login bug', true])), { said: ['Fix the login bug'], interim: '' });
  assert.deepEqual(t.take(results(['Fix the login bug', true], [' and add', false])), { said: [], interim: 'and add' }, 'not handed over twice');
  assert.deepEqual(t.take(results(['Fix the login bug', true], [' and add a test', true], [' then', false])), { said: ['and add a test'], interim: 'then' });
  assert.deepEqual(t.take(results(['Fix the login bug', true], [' and add a test', true], ['', true])), { said: [], interim: '' }, 'a phrase of nothing is skipped');
});

test('a hold is push to talk; a tap leaves it listening until the next press', () => {
  let now = 0;
  let live = false;
  const log: string[] = [];
  const talk = new PushToTalk({
    live: () => live,
    start: () => {
      live = true;
      log.push('start');
    },
    stop: () => {
      live = false;
      log.push('stop');
    },
    now: () => now,
  });
  // Held.
  talk.press();
  talk.press(); // the key repeating
  now += HOLD_MS + 500;
  talk.release();
  talk.release();
  assert.deepEqual(log, ['start', 'stop']);
  // Tapped: still listening once let go.
  talk.press();
  now += HOLD_MS - 200;
  talk.release();
  assert.deepEqual(log, ['start', 'stop', 'start']);
  assert.equal(live, true);
  // The next press ends it, however long it's held, and doesn't start another.
  now += 5000;
  talk.press();
  now += 50;
  talk.release();
  assert.deepEqual(log, ['start', 'stop', 'start', 'stop']);
  // It ended by itself while left on (an error, a long silence): a press starts it again.
  talk.press();
  now += 50;
  talk.release();
  live = false;
  talk.press();
  assert.deepEqual(log, ['start', 'stop', 'start', 'stop', 'start', 'start']);
});

/** A recognizer that does what the test tells it to. */
class FakeRec implements Recognizer {
  static made: FakeRec[] = [];
  static failStart = false;
  lang = '';
  continuous = false;
  interimResults = false;
  processLocally?: boolean;
  onresult: Recognizer['onresult'] = null;
  onerror: Recognizer['onerror'] = null;
  onend: Recognizer['onend'] = null;
  calls: string[] = [];
  constructor() {
    FakeRec.made.push(this);
  }
  start() {
    if (FakeRec.failStart) throw new Error('already started');
    this.calls.push('start');
  }
  stop() {
    this.calls.push('stop');
  }
  abort() {
    this.calls.push('abort');
  }
  hear(...rs: [string, boolean][]) {
    this.onresult?.({ results: results(...rs) });
  }
}
const Fake = FakeRec as unknown as RecognizerCtor;

/** Listens with a fake recognizer, and writes down what comes of it. */
function listening(opts: { phone?: boolean } = {}) {
  FakeRec.made = [];
  const clock = { now: 0 };
  const log: string[] = [];
  const l = listen(
    { interim: (t) => t && log.push(`interim: ${t}`), said: (t) => log.push(`said: ${t}`), end: (problem) => log.push(problem ? `end: ${problem}` : 'end') },
    { Ctor: Fake, lang: 'en-US', now: () => clock.now, phone: opts.phone ?? false },
  );
  return { l, rec: FakeRec.made[0], log, clock };
}

test('listening hands over the phrases as they settle, and ends once when stopped', () => {
  const { l, rec, log } = listening();
  assert.deepEqual([rec.lang, rec.continuous, rec.interimResults, rec.calls], ['en-US', true, true, ['start']]);
  rec.hear(['fix the', false]);
  rec.hear(['fix the login bug', true]);
  l.stop();
  l.stop();
  assert.deepEqual(rec.calls, ['start', 'stop']);
  // What it was in the middle of arrives after the stop, then it ends.
  rec.hear(['fix the login bug', true], [' and add a test', true]);
  rec.onend?.();
  assert.deepEqual(log, ['interim: fix the', 'said: fix the login bug', 'said: and add a test', 'end']);
});

test('words it never settled on before it ended still count', () => {
  const { l, rec, log } = listening();
  rec.hear(['fix the login bug', true], [' and add a te', false]);
  l.stop();
  rec.onend?.();
  assert.deepEqual(log, ['said: fix the login bug', 'interim: and add a te', 'said: and add a te', 'end']);
});

test('aborting throws away what was not handed over yet', () => {
  const { l, rec, log } = listening();
  rec.hear(['never mi', false]);
  const { onresult, onend } = rec;
  l.abort();
  onresult?.({ results: results(['never mind', true]) });
  onend?.();
  assert.deepEqual(rec.calls, ['start', 'abort']);
  assert.equal(rec.onresult, null);
  assert.deepEqual(log, ['interim: never mi', 'end']);
});

test('a recognizer that gives up on its own is started again, until it has been quiet too long', () => {
  const { rec, log, clock } = listening();
  rec.hear(['first', true]);
  clock.now += 8000;
  rec.onerror?.({ error: 'no-speech' });
  rec.onend?.();
  assert.deepEqual(rec.calls, ['start', 'start'], 'started again after a pause');
  // Its results count from nothing again.
  rec.hear(['second', true]);
  assert.deepEqual(log, ['said: first', 'said: second']);
  clock.now += QUIET_MS + 1;
  rec.onend?.();
  assert.deepEqual(rec.calls, ['start', 'start'], 'not after a minute of nothing');
  assert.deepEqual(log, ['said: first', 'said: second', 'end']);
});

test('a recognizer that fails says why, once, and is not started again', () => {
  const denied = listening();
  denied.clock.now += 5000;
  denied.rec.onerror?.({ error: 'not-allowed' });
  denied.rec.onend?.();
  assert.deepEqual(denied.rec.calls, ['start']);
  assert.equal(denied.log.length, 1);
  assert.match(denied.log[0], /^end: Dictation needs the microphone/);

  // A browser with the API but no speech service behind it (Brave) fails as soon as it starts.
  const dead = listening();
  dead.rec.onerror?.({ error: 'network' });
  dead.rec.onend?.();
  assert.match(dead.log[0], /speech service didn't answer/);

  // Cut off by something else listening: it just ends.
  const cut = listening();
  cut.clock.now += 5000;
  cut.rec.onerror?.({ error: 'aborted' });
  cut.rec.onend?.();
  assert.deepEqual([cut.rec.calls, cut.log], [['start'], ['end']]);

  FakeRec.failStart = true;
  try {
    const stuck = listening();
    assert.match(stuck.log[0], /^end: Dictation couldn't start: already started/);
    assert.equal(stuck.log.length, 1);
  } finally {
    FakeRec.failStart = false;
  }
  assert.equal(speechProblem('aborted', 'en-US'), undefined);
  assert.match(speechProblem('language-not-supported', 'tlh') ?? '', /tlh/);
});

test('on a phone it listens a phrase at a time, for what it settled on only', () => {
  const { rec, log, clock } = listening({ phone: true });
  assert.deepEqual([rec.continuous, rec.interimResults], [false, false]);
  rec.hear(['fix the login bug', true]);
  clock.now += 3000;
  rec.onend?.();
  rec.hear(['and add a test', true]);
  assert.deepEqual(rec.calls, ['start', 'start']);
  assert.deepEqual(log, ['said: fix the login bug', 'said: and add a test']);
});

test('without a recognizer, listening ends at once and says so', () => {
  const log: string[] = [];
  listen({ interim: () => undefined, said: () => undefined, end: (p) => log.push(p ?? '') }, { Ctor: undefined });
  assert.equal(log.length, 1);
  assert.match(log[0], /no speech recognition/);
});
