import { asString, isRecord } from './graph-envelopes.ts';

// Gate 1's third answer (besides approve/skip): "not now - resurface on <date>". Deferrals
// out-live the run that parked them, so they persist in data/state/ (like the watermark) and
// each later scan surfaces the ones that have come due.
export const DEFERRALS_PATH = 'data/state/deferrals.json';

export type Deferral = {
  readonly conversationId: string;
  readonly subject: string;
  readonly until: string;
  readonly reason: string;
};

const toDeferral = (value: unknown): Deferral | undefined => {
  if (!isRecord(value)) return undefined;
  const conversationId = asString(value['conversationId']);
  const until = asString(value['until']);
  if (conversationId === undefined || until === undefined || Number.isNaN(Date.parse(until))) return undefined;
  return { conversationId, subject: asString(value['subject']) ?? '(no subject)', until, reason: asString(value['reason']) ?? '' };
};

const isDeferral = (deferral: Deferral | undefined): deferral is Deferral => deferral !== undefined;

/** Malformed entries are dropped on read - a hand-edited file never crashes a scan. */
export const parseDeferrals = (content: string): ReadonlyArray<Deferral> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed.map(toDeferral).filter(isDeferral) : [];
};

export const renderDeferrals = (deferrals: ReadonlyArray<Deferral>): string => `${JSON.stringify(deferrals, null, 2)}\n`;

/** One deferral per conversation: re-deferring replaces the previous date instead of stacking. */
export const upsertDeferral = (deferrals: ReadonlyArray<Deferral>, deferral: Deferral): ReadonlyArray<Deferral> => [
  ...deferrals.filter((entry) => entry.conversationId !== deferral.conversationId),
  deferral,
];

/** Due = the until date has arrived (inclusive): defer to Friday means it surfaces Friday. */
export const dueDeferrals = (deferrals: ReadonlyArray<Deferral>, todayIso: string): ReadonlyArray<Deferral> =>
  deferrals.filter((deferral) => Date.parse(deferral.until) <= Date.parse(todayIso));

export const withoutDeferrals = (deferrals: ReadonlyArray<Deferral>, conversationIds: ReadonlyArray<string>): ReadonlyArray<Deferral> =>
  deferrals.filter((deferral) => !conversationIds.includes(deferral.conversationId));
