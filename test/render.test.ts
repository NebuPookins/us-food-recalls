import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketLabel } from '../src/render.ts';

// The contract: given a recall date and a reference "now", `bucketLabel` returns
// the narrowest recency bucket that still contains the date. Boundaries are
// inclusive — a date exactly N days back still belongs to the N-day bucket.
const now = '2026-08-20';

test('a same-day recall is in the last week', () => {
  assert.equal(bucketLabel('2026-08-20', now), 'In the last week');
});

test('a date exactly seven days back is in the last week', () => {
  assert.equal(bucketLabel('2026-08-13', now), 'In the last week');
});

test('a date just past the week boundary is in the last month', () => {
  assert.equal(bucketLabel('2026-08-12', now), 'In the last month');
});

test('a date exactly thirty days back is in the last month', () => {
  assert.equal(bucketLabel('2026-07-21', now), 'In the last month');
});

test('a date just past the month boundary is in the last 3 months', () => {
  assert.equal(bucketLabel('2026-07-20', now), 'In the last 3 months');
});

test('a date exactly ninety days back is in the last 3 months', () => {
  assert.equal(bucketLabel('2026-05-22', now), 'In the last 3 months');
});

test('a date just past the 3-month boundary is in the last year', () => {
  assert.equal(bucketLabel('2026-05-21', now), 'In the last year');
});

test('a date exactly a year back is in the last year', () => {
  assert.equal(bucketLabel('2025-08-20', now), 'In the last year');
});

test('a date older than a year falls into the older bucket', () => {
  assert.equal(bucketLabel('2025-08-19', now), 'Older');
});
