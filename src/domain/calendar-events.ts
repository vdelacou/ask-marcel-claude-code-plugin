import { asString, isRecord } from './graph-envelopes.ts';

// Scheduling-type email asks ("can we meet Tuesday?") are grounded in the user's real
// calendar (SPEC §6 note): list-calendar-view returns the expanded occurrences between two
// instants; this extracts a compact, sorted busy list. NO free-gap math here - Graph returns
// per-event time zones and the user's working hours live in user.md, so gap judgment belongs
// to the caller reading both. Extraction only, deterministic.
export type CalendarEvent = {
  readonly subject: string;
  readonly start: string;
  readonly end: string;
  readonly timeZone: string;
  readonly showAs: string;
  readonly isAllDay: boolean;
};

const timePart = (value: unknown): { readonly at: string; readonly timeZone: string } | undefined => {
  if (!isRecord(value)) return undefined;
  const at = asString(value['dateTime']);
  return at === undefined ? undefined : { at, timeZone: asString(value['timeZone']) ?? 'UTC' };
};

const toEvent = (value: unknown): CalendarEvent | undefined => {
  if (!isRecord(value)) return undefined;
  if (value['isCancelled'] === true) return undefined;
  const start = timePart(value['start']);
  const end = timePart(value['end']);
  if (start === undefined || end === undefined) return undefined;
  return {
    subject: asString(value['subject']) ?? '(no subject)',
    start: start.at,
    end: end.at,
    timeZone: start.timeZone,
    showAs: asString(value['showAs']) ?? 'busy',
    isAllDay: value['isAllDay'] === true,
  };
};

const isEvent = (event: CalendarEvent | undefined): event is CalendarEvent => event !== undefined;

/** Busy list from a list-calendar-view payload: cancelled and shapeless entries dropped, sorted by start. */
export const extractCalendarEvents = (payload: unknown): ReadonlyArray<CalendarEvent> => {
  if (!isRecord(payload) || !Array.isArray(payload['value'])) return [];
  // The view returns every occurrence in one zone, so parsing the naive dateTime is a
  // consistent sort key even though it is not an absolute instant.
  return payload['value']
    .map(toEvent)
    .filter(isEvent)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
};
