import { extractCalendarEvents } from '../domain/calendar-events.ts';
import type { CalendarEvent } from '../domain/calendar-events.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { Logger } from './ports/logger.ts';
import type { Office } from './ports/office.ts';

export type ViewCalendarRequest = { readonly fromIso: string; readonly toIso: string };

export type ViewCalendarError = { readonly kind: 'invalid-window'; readonly message: string } | { readonly kind: 'source-failed'; readonly message: string };

export type ViewCalendar = (request: ViewCalendarRequest) => Promise<Result<ReadonlyArray<CalendarEvent>, ViewCalendarError>>;

type Deps = { readonly office: Office; readonly logger: Logger };

const SELECT_FIELDS = 'subject,start,end,showAs,isAllDay,isCancelled';

// Grounding for scheduling-type replies (SPEC §6 note): the calendar view expands recurring
// series into occurrences between the two instants - the researcher and the drafting loop read
// the busy list next to user.md's working hours instead of guessing availability.
export const createViewCalendar =
  (deps: Deps): ViewCalendar =>
  async (request) => {
    if (Number.isNaN(Date.parse(request.fromIso)) || Number.isNaN(Date.parse(request.toIso)) || request.fromIso >= request.toIso) {
      return err({ kind: 'invalid-window', message: `--from must be an instant before --to (got ${request.fromIso} .. ${request.toIso})` });
    }
    const run = await deps.office.execute('list-calendar-view', {
      startDateTime: request.fromIso,
      endDateTime: request.toIso,
      top: '100',
      orderby: 'start/dateTime',
      select: SELECT_FIELDS,
    });
    if (!run.ok) return err({ kind: 'source-failed', message: run.error.message });
    const events = extractCalendarEvents(run.value);
    deps.logger.info('calendar-viewed', { from: request.fromIso, to: request.toIso, events: events.length });
    return ok(events);
  };
