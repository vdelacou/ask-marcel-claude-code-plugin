import { describe, expect, test } from 'bun:test';

import { createSystemClock } from './clock.ts';

describe('system clock', () => {
  test('the system clock yields an ISO date', () => {
    expect(createSystemClock().todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
