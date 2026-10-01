import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BODY_MAX, buildReview, diffLines, mergeFindings, normalize, parseFindings, sameProblem, similarity, type ReviewFinding } from '../src/shared/review.js';

const f = (x: Partial<ReviewFinding> & { comment: string }): ReviewFinding => ({ file: 'src/a.ts', line: 10, severity: 'medium', lenses: ['Correctness'], ...x });

test('parseFindings reads an array, a {findings} object or a fenced block, and tags the lens', () => {
  const one = [{ file: './src/a.ts', line: 3, severity: 'HIGH', comment: ' Leaks the token ' }];
  assert.deepEqual(parseFindings(JSON.stringify(one), 'Security'), [{ file: 'src/a.ts', line: 3, severity: 'high', lenses: ['Security'], comment: 'Leaks the token' }]);
  assert.equal(parseFindings(JSON.stringify({ findings: one }), 'Security').length, 1);
  assert.equal(parseFindings('Here you go:\n```json\n' + JSON.stringify(one) + '\n```\n', 'Security').length, 1);
  assert.deepEqual(parseFindings('[]', 'Security'), []);
  assert.throws(() => parseFindings('- a.ts:1 bad', 'Security'));
  assert.throws(() => parseFindings('{"nope": 1}', 'Security'));
});

test('parseFindings drops what it cannot use and keeps paths inside the repo', () => {
  const got = parseFindings(JSON.stringify([
    { file: 'a.ts', comment: '' },
    { comment: 'no file' },
    { file: '/etc/passwd', comment: 'absolute' },
    { file: '../up.ts', comment: 'outside' },
    { file: 'b/src/x.ts', line: -2, severity: 'nit', comment: 'fine' },
    'junk',
  ]), 'Perf');
  assert.deepEqual(got, [{ file: 'src/x.ts', line: undefined, severity: 'low', lenses: ['Perf'], comment: 'fine' }]);
});

test('normalize takes back merged findings with their lenses', () => {
  assert.deepEqual(normalize({ file: 'a.ts', line: 1, severity: 'low', lenses: ['A', 'B', 'A'], comment: 'x' })?.lenses, ['A', 'B']);
  assert.equal(normalize({ file: 'a.ts', comment: 'x' }), null);
});

test('similarity and sameProblem tell the same problem apart from a different one', () => {
  assert.equal(similarity('Leaks the token', 'leaks the TOKEN'), 1);
  assert.ok(similarity('The token is compared with == and leaks', 'Use timingSafeEqual: comparing the token with == leaks it') > 0.3);
  assert.ok(sameProblem(f({ comment: 'token compared with == leaks timing' }), f({ line: 12, comment: 'comparing the token with == leaks timing information' })));
  assert.ok(!sameProblem(f({ comment: 'token compared with == leaks timing' }), f({ file: 'src/b.ts', comment: 'token compared with == leaks timing' })));
  assert.ok(!sameProblem(f({ comment: 'token compared with == leaks timing' }), f({ line: 40, comment: 'token compared with == leaks timing' })));
  assert.ok(!sameProblem(f({ comment: 'the loop allocates on every frame' }), f({ comment: 'missing null check on the user' })));
  assert.ok(!sameProblem(f({ comment: 'same words here' }), f({ line: undefined, comment: 'same words here' })));
});

test('mergeFindings keeps one per problem, with every lens, the worst severity and the fullest wording', () => {
  const merged = mergeFindings([
    [f({ comment: 'Token compared with == leaks timing' }), f({ file: 'src/z.ts', line: 1, severity: 'low', comment: 'Rename this variable' })],
    [f({ line: 11, severity: 'high', lenses: ['Security'], comment: 'Token compared with == leaks timing: use crypto.timingSafeEqual instead' })],
    [f({ lenses: ['Performance'], comment: 'This loop is quadratic over the users' }), f({ line: 10, lenses: ['Security'], comment: 'Token compared with == leaks timing' })],
  ]);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged[0], { file: 'src/a.ts', line: 11, severity: 'high', lenses: ['Correctness', 'Security'], comment: 'Token compared with == leaks timing: use crypto.timingSafeEqual instead' });
  assert.deepEqual(merged.map((x) => x.severity), ['high', 'medium', 'low']);
  assert.deepEqual(merged[1].lenses, ['Performance']);
});

test('mergeFindings does not change its input', () => {
  const a = f({ comment: 'Token compared with == leaks timing' });
  mergeFindings([[a], [f({ lenses: ['Security'], comment: 'Token compared with == leaks timing' })]]);
  assert.deepEqual(a.lenses, ['Correctness']);
});

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 1..2 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -8,4 +8,5 @@ export function check() {
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 return a;
\\ No newline at end of file
diff --git a/src/gone.ts b/src/gone.ts
--- a/src/gone.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-bye
diff --git a/src/new.ts b/src/new.ts
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+++x;
+y;
`;

test('diffLines lists the new-side lines a review can comment on', () => {
  const lines = diffLines(DIFF);
  assert.deepEqual([...lines.get('src/a.ts')!], [8, 9, 10, 11]);
  assert.deepEqual([...lines.get('src/new.ts')!], [1, 2]);
  assert.ok(!lines.has('src/gone.ts'));
});

test('buildReview puts findings on their lines, tagged by lens, and the rest in the body', () => {
  const review = buildReview(
    [
      f({ line: 9, severity: 'high', lenses: ['Correctness', 'Security'], comment: 'b changed meaning' }),
      f({ line: 40, comment: 'Outside the diff' }),
      f({ file: 'src/new.ts', line: undefined, severity: 'low', lenses: ['Performance'], comment: 'Whole file' }),
    ],
    'Request changes.',
    diffLines(DIFF),
    ['Correctness', 'Security', 'Performance'],
  );
  assert.equal(review.event, 'COMMENT');
  assert.deepEqual(review.comments, [{ path: 'src/a.ts', line: 9, side: 'RIGHT', body: '🔴 **[Correctness · Security]** b changed meaning' }]);
  assert.match(review.body, /^Request changes\./);
  assert.match(review.body, /\*\*3 findings\*\*, 1 on the lines/);
  assert.match(review.body, /\*\*\[Correctness\]\*\* `src\/a\.ts:40`: Outside the diff/);
  assert.match(review.body, /\*\*\[Performance\]\*\* `src\/new\.ts`: Whole file/);
  assert.match(review.body, /Correctness, Security, Performance/);
  assert.match(buildReview([], 'LGTM', new Map()).body, /found nothing/);
});

test('buildReview keeps the body under GitHub\'s limit, saying how many findings did not fit', () => {
  const findings: ReviewFinding[] = Array.from({ length: 60 }, (_, i) => ({ file: `src/f${i}.ts`, line: 1, severity: 'medium', lenses: ['Correctness'], comment: `Finding ${i} ` + 'x'.repeat(1990) }));
  const { body, comments } = buildReview(findings, 'S'.repeat(20_000), new Map());
  assert.equal(comments.length, 0);
  assert.ok(body.length <= BODY_MAX, `${body.length} > ${BODY_MAX}`);
  assert.match(body, /…and \d+ more that don't fit in one review\./);
  assert.ok(body.includes('Finding 0 '));
  assert.match(body, /Review panel in Agent Office/);
});
