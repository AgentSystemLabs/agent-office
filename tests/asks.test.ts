import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Asks, cleanAsk } from '../src/server/asks.js';
import { composeAnswer } from '../src/client/ui/answer.js';
import { main, parseArgs, NO_ANSWER } from '../bin/office-ask.js';

const Q = { question: 'Who is it for?', options: [{ label: 'Customers' }, { label: 'Staff' }], multi: false };

test('an answer reaches the agent that is waiting for it', async () => {
  const asks = new Asks();
  const r = asks.ask('w1', Q, 1000);
  assert.equal(asks.current('w1')?.question, 'Who is it for?');
  assert.equal(asks.answer('w1', r.ask.id, 'Customers'), true);
  assert.equal(await r.answer, 'Customers');
  assert.equal(asks.current('w1'), undefined);
  assert.equal(asks.answer('w1', r.ask.id, 'again'), false, 'a question is answered once');
});

test('with no answer in time it says so, and asking again picks the same question back up', async () => {
  const asks = new Asks();
  const first = asks.ask('w1', Q, 5);
  assert.equal(await first.answer, null);
  const again = asks.ask('w1', Q, 1000);
  assert.equal(again.fresh, false);
  assert.equal(again.ask.id, first.ask.id);
  asks.answer('w1', again.ask.id, 'Staff');
  assert.equal(await again.answer, 'Staff');
});

test('an answer that comes in while the agent is away is waiting when it comes back', async () => {
  const asks = new Asks();
  const first = asks.ask('w1', Q, 5);
  await first.answer;
  assert.equal(asks.answer('w1', first.ask.id, 'Staff'), true);
  const back = asks.ask('w1', Q, 1000);
  assert.equal(await back.answer, 'Staff');
  assert.equal(asks.current('w1'), undefined);
});

test('a different question replaces the old one, and dropping a worker lets its waiter go', async () => {
  const asks = new Asks();
  const old = asks.ask('w1', Q, 1000);
  const next = asks.ask('w1', { ...Q, question: 'By when?' }, 1000);
  assert.equal(await old.answer, null);
  assert.equal(next.fresh, true);
  assert.equal(asks.answer('w1', old.ask.id, 'late'), false);
  asks.drop('w1');
  assert.equal(await next.answer, null);
  assert.equal(asks.current('w1'), undefined);
});

test('empty answers are turned away, and questions are cleaned up', () => {
  const asks = new Asks();
  const r = asks.ask('w1', Q, 1000);
  assert.equal(asks.answer('w1', r.ask.id, '   '), false);
  assert.equal(cleanAsk({}), 'Send a question');
  assert.deepEqual(cleanAsk({ question: ' Why? ', options: ['Only one'] }), { question: 'Why?', options: [], multi: false });
  assert.deepEqual(cleanAsk({ question: 'Which?', options: ['A', { label: 'B', description: 'bee' }], multi: true, header: 'Pick' }), {
    question: 'Which?',
    header: 'Pick',
    options: [{ label: 'A' }, { label: 'B', description: 'bee' }],
    multi: true,
  });
});

test('the answer is the picked options, then whatever was typed', () => {
  assert.equal(composeAnswer(['A', 'B'], '  and C '), 'A\nB\nand C');
  assert.equal(composeAnswer([], '  '), '');
});

test('office-ask takes a question and options, and refuses a single option', () => {
  assert.deepEqual(parseArgs(['Who?', '--option', 'A', '--option', 'B', '--header', 'Users']), { question: 'Who?', options: ['A', 'B'], multi: false, header: 'Users' });
  assert.throws(() => parseArgs(['Who?', '--option', 'A']), /at least two/);
  assert.throws(() => parseArgs([]), /Give it the question/);
  assert.throws(() => parseArgs(['Who?', '--multi']), /--multi needs/);
});

const env = { AGENT_OFFICE_HOOK_URL: 'http://127.0.0.1:1234/', AGENT_OFFICE_WORKER_ID: 'abc', AGENT_OFFICE_HOOK_TOKEN: 'tok' };
const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

test('office-ask prints the answer, and asks again while there is none', async () => {
  const seen: { url: string; auth: string; body: any }[] = [];
  const out: string[] = [];
  let n = 0;
  const fetchImpl = (async (url: string, init: any) => {
    seen.push({ url, auth: init.headers.authorization, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(++n < 3 ? { answer: null } : { answer: 'Customers' }), { status: 200 });
  }) as unknown as typeof fetch;
  const code = await main(['Who?', '--option', 'Customers', '--option', 'Staff'], { env, fetch: fetchImpl, out: (s) => out.push(s), err: () => {} });
  assert.equal(code, 0);
  assert.deepEqual(out, ['Customers']);
  assert.equal(n, 3);
  assert.equal(seen[0].url, 'http://127.0.0.1:1234/office/ask?worker=abc');
  assert.equal(seen[0].auth, 'Bearer tok');
  assert.deepEqual(seen[0].body.options, ['Customers', 'Staff']);
});

test('office-ask gives up politely when nobody answers, and reports a refusal', async () => {
  const out: string[] = [];
  const err: string[] = [];
  assert.equal(await main(['Who?'], { env, fetch: reply(200, { answer: null }) as any, out: (s) => out.push(s), err: (s) => err.push(s), giveUpMs: 0 }), 0);
  assert.deepEqual(out, [NO_ANSWER]);
  assert.equal(await main(['Who?'], { env, fetch: reply(403, { error: 'nope' }) as any, out: () => {}, err: (s) => err.push(s) }), 1);
  assert.match(err.join('\n'), /403.*nope/);
  assert.equal(await main(['Who?'], { env: {}, out: () => {}, err: (s) => err.push(s) }), 1);
});
