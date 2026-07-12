import { describe, expect, test } from 'bun:test';

import { extractCalendarEvents } from './calendar-events.ts';

const event = (subject: string, start: string, end: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  subject,
  start: { dateTime: start, timeZone: 'UTC' },
  end: { dateTime: end, timeZone: 'UTC' },
  showAs: 'busy',
  isAllDay: false,
  ...extra,
});

describe('extractCalendarEvents', () => {
  test('a calendar view becomes a compact busy list, sorted by start whatever order Graph returned', () => {
    const payload = {
      value: [
        event('Standup', '2026-07-13T09:30:00.0000000', '2026-07-13T09:45:00.0000000'),
        event('Budget review', '2026-07-13T08:00:00.0000000', '2026-07-13T09:00:00.0000000', { showAs: 'tentative' }),
      ],
    };

    expect(extractCalendarEvents(payload)).toEqual([
      { subject: 'Budget review', start: '2026-07-13T08:00:00.0000000', end: '2026-07-13T09:00:00.0000000', timeZone: 'UTC', showAs: 'tentative', isAllDay: false },
      { subject: 'Standup', start: '2026-07-13T09:30:00.0000000', end: '2026-07-13T09:45:00.0000000', timeZone: 'UTC', showAs: 'busy', isAllDay: false },
    ]);
  });

  test('cancelled occurrences and shapeless entries are dropped; defaults degrade gracefully', () => {
    const payload = {
      value: [
        event('Cancelled sync', '2026-07-13T10:00:00Z', '2026-07-13T11:00:00Z', { isCancelled: true }),
        { subject: 'no times at all' },
        { subject: 'start but no end', start: { dateTime: '2026-07-13T10:00:00Z', timeZone: 'UTC' } },
        { subject: 'end but no start', end: { dateTime: '2026-07-13T11:00:00Z', timeZone: 'UTC' } },
        'not even an object',
        { start: { dateTime: '2026-07-14T00:00:00Z' }, end: { dateTime: '2026-07-15T00:00:00Z' }, isAllDay: true },
      ],
    };

    const events = extractCalendarEvents(payload);

    // toHaveLength pins the filter: bun's toEqual ignores undefined array holes (LESSONS 2026-07-04)
    expect(events).toHaveLength(1);
    expect(events).toEqual([{ subject: '(no subject)', start: '2026-07-14T00:00:00Z', end: '2026-07-15T00:00:00Z', timeZone: 'UTC', showAs: 'busy', isAllDay: true }]);
  });

  test("an event's own time zone rides along - it is not assumed UTC", () => {
    const paris = {
      subject: 'Comex',
      start: { dateTime: '2026-07-13T09:00:00.0000000', timeZone: 'Europe/Paris' },
      end: { dateTime: '2026-07-13T10:00:00.0000000', timeZone: 'Europe/Paris' },
      showAs: 'busy',
    };
    expect(extractCalendarEvents({ value: [paris] })[0]?.timeZone).toBe('Europe/Paris');
  });

  test('a payload without a value array is an empty busy list, never a crash', () => {
    expect(extractCalendarEvents('garbage')).toEqual([]);
    expect(extractCalendarEvents({ value: 'nope' })).toEqual([]);
  });
});
