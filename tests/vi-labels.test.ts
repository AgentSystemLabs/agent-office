import test from 'node:test';
import assert from 'node:assert/strict';
import { vietnameseLabel } from '../src/client/shared/vi-labels';

test('Vietnamese UI labels keep icons and variable desk numbers', () => {
  assert.equal(vietnameseLabel('⚙️ Settings'), '⚙️ Cài đặt');
  assert.equal(vietnameseLabel('✨ Hire a worker at Desk 8'), '✨ Tạo AI tại bàn 8');
  assert.equal(vietnameseLabel('  Workers  '), '  Nhóm AI  ');
});
test('Unknown labels, commands and model identifiers stay intact', () => {
  for (const text of ['Pixel', 'Get-Location', 'gpt-6.1-sol', 'C:\\my-project', 'worker.start']) {
    assert.equal(vietnameseLabel(text), text);
  }
});
