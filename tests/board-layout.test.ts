import test from 'node:test';
import assert from 'node:assert/strict';
import { TAB_H, inRect, jiraLayout, tabRects } from '../src/client/world/board-layout.js';

test('the wall board tabs sit side by side inside the tab strip', () => {
  const { issues, jira } = tabRects();
  assert.ok(issues.x + issues.w < jira.x);
  for (const r of [issues, jira]) {
    assert.ok(r.y >= 0 && r.y + r.h <= TAB_H);
    assert.ok(inRect(r, r.x + r.w / 2, r.y + r.h / 2));
  }
  assert.ok(!inRect(issues, jira.x + 1, jira.y + 1));
});

test('the Jira view shows every ticket when they fit', () => {
  const layout = jiraLayout([2, 1, 0], 1200, 600, TAB_H + 6);
  assert.deepEqual(
    layout.columns.map((c) => [c.cards.length, c.hidden]),
    [
      [2, 0],
      [1, 0],
      [0, 0],
    ],
  );
  for (const col of layout.columns) {
    assert.ok(col.rect.x >= 0 && col.rect.x + col.rect.w <= 1200);
    assert.ok(col.rect.y + col.rect.h <= 600);
    for (const card of col.cards) {
      assert.ok(card.y >= col.rect.y && card.y + card.h <= col.rect.y + col.rect.h);
      assert.ok(card.x >= col.rect.x && card.x + card.w <= col.rect.x + col.rect.w);
    }
  }
});

test('a full Jira column shows what fits and counts the rest', () => {
  const layout = jiraLayout([30, 0, 5], 1200, 600, TAB_H + 6);
  const [todo, , done] = layout.columns;
  assert.ok(todo.cards.length > 0);
  assert.equal(todo.cards.length + todo.hidden, 30);
  const last = todo.cards[todo.cards.length - 1];
  // Room is left under the last card for "+N more".
  assert.ok(last.y + last.h + 20 <= todo.rect.y + todo.rect.h);
  assert.equal(done.cards.length + done.hidden, 5);
});

test('cards in one column never overlap', () => {
  const [col] = jiraLayout([4], 1200, 600, TAB_H).columns;
  for (let i = 1; i < col.cards.length; i++) assert.ok(col.cards[i].y >= col.cards[i - 1].y + col.cards[i - 1].h);
});
