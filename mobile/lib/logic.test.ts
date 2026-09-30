import assert from 'node:assert/strict';
import { test } from 'node:test';
import { daysUntil, deadlineLabel, isValidIsoDate } from './dates.ts';
import { scansLeft } from './quota.ts';
import { sortItems } from './sort.ts';
import { reminderDate } from './reminder-date.ts';
import { normalizeAnalysis } from './normalize.ts';

const now = new Date(2026, 8, 30, 12, 0);
const mk = (id: string, deadline: string | null, urgency: any = 'low', done = false) =>
  ({ id, deadline, urgency, done, createdAt: '2026-09-01T00:00:00Z' }) as any;

test('daysUntil / label', () => {
  assert.equal(daysUntil('2026-10-02', now), 2);
  assert.equal(daysUntil('2026-09-29', now), -1);
  assert.equal(deadlineLabel('2026-09-30', now), 'Vandaag');
  assert.equal(deadlineLabel('2026-10-01', now), 'Morgen');
  assert.equal(deadlineLabel(null, now), 'Geen deadline');
});

test('isValidIsoDate rejects impossible dates', () => {
  assert.ok(isValidIsoDate('2026-02-28'));
  assert.ok(!isValidIsoDate('2026-02-30'));
  assert.ok(!isValidIsoDate('morgen'));
});

test('sort: overdue first, done last, undated after dated', () => {
  const s = sortItems([mk('none', null, 'high'), mk('done', '2026-09-01', 'low', true), mk('late', '2026-09-20'), mk('soon', '2026-10-05')], now);
  assert.deepEqual(s.map((i) => i.id), ['late', 'soon', 'none', 'done']);
});

test('free quota is 3 per rolling week', () => {
  const n = Date.now();
  assert.equal(scansLeft([], n), 3);
  assert.equal(scansLeft([n - 1000, n - 2000, n - 3000], n), 0);
  assert.equal(scansLeft([n - 8 * 86_400_000, n - 1000], n), 2);
});

test('reminder: 2 days before at 09:00, fallback tomorrow, none when past', () => {
  assert.deepEqual(reminderDate('2026-10-10', now), new Date(2026, 9, 8, 9));
  assert.deepEqual(reminderDate('2026-10-01', now), new Date(2026, 9, 1, 9));
  assert.equal(reminderDate('2026-09-29', now), null);
});

test('normalizeAnalysis sanitises model output', () => {
  const a = normalizeAnalysis({ title: ' X ', urgency: 'bogus', deadline: '2026-13-40', actions: ['a', '', 5], summary: 'ok' });
  assert.equal(a.urgency, 'medium');
  assert.equal(a.deadline, null);
  assert.deepEqual(a.actions, ['a']);
});
