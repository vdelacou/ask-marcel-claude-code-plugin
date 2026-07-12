import { describe, expect, test } from 'bun:test';

import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { createLoggerFake } from '../test-helpers/logger-fake.ts';
import type { OfficeError } from './ports/office.ts';
import { createViewCalendar } from './view-calendar.ts';

type OfficeCall = { readonly command: string; readonly params: Record<string, string> };

const setup = (
  response: Result<unknown, OfficeError>
): { readonly view: ReturnType<typeof createViewCalendar>; readonly calls: OfficeCall[]; readonly logger: ReturnType<typeof createLoggerFake> } => {
  const calls: OfficeCall[] = [];
  const logger = createLoggerFake();
  const view = createViewCalendar({
    office: {
      execute: async (command, params) => {
        calls.push({ command, params });
        return response;
      },
    },
    logger,
  });
  return { view, calls, logger };
};

describe('view-calendar', () => {
  test('the window flows to list-calendar-view with a minimal select, and the busy list comes back sorted', async () => {
    const { view, calls, logger } = setup(
      ok({
        value: [
          { subject: 'B', start: { dateTime: '2026-07-13T10:00:00Z', timeZone: 'UTC' }, end: { dateTime: '2026-07-13T11:00:00Z', timeZone: 'UTC' } },
          { subject: 'A', start: { dateTime: '2026-07-13T08:00:00Z', timeZone: 'UTC' }, end: { dateTime: '2026-07-13T09:00:00Z', timeZone: 'UTC' } },
        ],
      })
    );

    const result = await view({ fromIso: '2026-07-13T00:00:00Z', toIso: '2026-07-14T00:00:00Z' });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.map((event) => event.subject)).toEqual(['A', 'B']);
    expect(logger.calls).toEqual([{ level: 'info', event: 'calendar-viewed', meta: { from: '2026-07-13T00:00:00Z', to: '2026-07-14T00:00:00Z', events: 2 } }]);
    expect(calls).toEqual([
      {
        command: 'list-calendar-view',
        params: {
          startDateTime: '2026-07-13T00:00:00Z',
          endDateTime: '2026-07-14T00:00:00Z',
          top: '100',
          orderby: 'start/dateTime',
          select: 'subject,start,end,showAs,isAllDay,isCancelled',
        },
      },
    ]);
  });

  test('a malformed, reversed, or empty window is refused before any Graph call - each guard alone suffices', async () => {
    const { view, calls } = setup(ok({ value: [] }));

    // bad --from that sorts BEFORE the --to string: only the NaN guard can catch it
    const badFrom = await view({ fromIso: '!not-a-date', toIso: '2026-07-14T00:00:00Z' });
    expect(badFrom).toEqual({ ok: false, error: { kind: 'invalid-window', message: '--from must be an instant before --to (got !not-a-date .. 2026-07-14T00:00:00Z)' } });

    // bad --to that sorts AFTER the --from string: only ITS NaN guard can catch it
    expect((await view({ fromIso: '2026-07-13T00:00:00Z', toIso: 'zzz-not-a-date' })).ok).toBe(false);

    // an empty window (from == to) is refused, not passed through
    expect((await view({ fromIso: '2026-07-14T00:00:00Z', toIso: '2026-07-14T00:00:00Z' })).ok).toBe(false);

    const reversed = await view({ fromIso: '2026-07-15T00:00:00Z', toIso: '2026-07-14T00:00:00Z' });
    expect(reversed.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  test('a Graph failure surfaces as source-failed', async () => {
    const { view } = setup(err({ kind: 'command-failed', message: 'graph 503' }));

    expect(await view({ fromIso: '2026-07-13T00:00:00Z', toIso: '2026-07-14T00:00:00Z' })).toEqual({ ok: false, error: { kind: 'source-failed', message: 'graph 503' } });
  });
});
