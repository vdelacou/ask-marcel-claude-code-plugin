import { describe, expect, test } from 'bun:test';

import { dueDeferrals, parseDeferrals, renderDeferrals, upsertDeferral, withoutDeferrals } from './deferral.ts';
import type { Deferral } from './deferral.ts';

const FRIDAY: Deferral = { conversationId: 'conv-1', subject: 'Budget question', until: '2026-07-17', reason: 'after the review' };
const MONDAY: Deferral = { conversationId: 'conv-2', subject: 'Vendor intro', until: '2026-07-13', reason: '' };

describe('deferral', () => {
  test('the book round-trips through render and parse', () => {
    expect(parseDeferrals(renderDeferrals([FRIDAY, MONDAY]))).toEqual([FRIDAY, MONDAY]);
  });

  test('garbage, malformed entries, and undateable untils are dropped on read - never a crash', () => {
    expect(parseDeferrals('not json')).toEqual([]);
    expect(parseDeferrals('{"an":"object"}')).toEqual([]);
    expect(parseDeferrals(JSON.stringify(['nope', { conversationId: 'c' }, { until: '2026-07-13' }, { conversationId: 'c', until: 'someday' }, MONDAY]))).toEqual([MONDAY]);
    // a minimal valid entry gains the defaults
    expect(parseDeferrals(JSON.stringify([{ conversationId: 'c3', until: '2026-07-14' }]))).toEqual([
      { conversationId: 'c3', subject: '(no subject)', until: '2026-07-14', reason: '' },
    ]);
  });

  test('re-deferring a conversation replaces its date instead of stacking a second entry', () => {
    const rebooked = upsertDeferral([FRIDAY, MONDAY], { ...FRIDAY, until: '2026-07-20' });

    expect(rebooked).toHaveLength(2);
    expect(rebooked.find((entry) => entry.conversationId === 'conv-1')?.until).toBe('2026-07-20');
    // the untouched entry survives, and the rebooked one moves to the end (insertion order)
    expect(rebooked[0]).toEqual(MONDAY);
  });

  test('due is inclusive: defer to Friday surfaces ON Friday, not the day after', () => {
    expect(dueDeferrals([FRIDAY, MONDAY], '2026-07-17')).toEqual([FRIDAY, MONDAY]);
    expect(dueDeferrals([FRIDAY, MONDAY], '2026-07-16')).toEqual([MONDAY]);
    expect(dueDeferrals([FRIDAY, MONDAY], '2026-07-12')).toEqual([]);
  });

  test('withoutDeferrals removes exactly the consumed conversations', () => {
    expect(withoutDeferrals([FRIDAY, MONDAY], ['conv-2'])).toEqual([FRIDAY]);
    expect(withoutDeferrals([FRIDAY], [])).toEqual([FRIDAY]);
  });
});
