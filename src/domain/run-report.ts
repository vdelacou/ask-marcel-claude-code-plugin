import type { EmailState, RunFile } from './email-state.ts';
import { asString, isRecord } from './graph-envelopes.ts';

// The permanent per-run report (SPEC §2 Phase 5, decision 16): one markdown file per run in
// data/reports/, carrying the outcome table, the coverage block, and a machine-readable stats
// marker that later runs read to compute the voice-drift rate.

export type RunReportStats = {
  readonly drafted: number;
  readonly updated: number;
  readonly skippedByUser: number;
  readonly skippedByRule: number;
  readonly blocked: ReadonlyArray<string>;
  readonly editedOrRejected: number;
  readonly coverage: ReadonlyArray<string>;
  readonly notes: string;
};

const asCount = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0);

const asLines = (value: unknown): ReadonlyArray<string> => (Array.isArray(value) ? value.filter((line): line is string => typeof line === 'string') : []);

/** Lenient stats intake: the skill sends JSON; missing or malformed keys default to zero/empty. */
export const parseRunReportStats = (value: unknown): RunReportStats => {
  const record = isRecord(value) ? value : {};
  return {
    drafted: asCount(record['drafted']),
    updated: asCount(record['updated']),
    skippedByUser: asCount(record['skippedByUser']),
    skippedByRule: asCount(record['skippedByRule']),
    blocked: asLines(record['blocked']),
    editedOrRejected: asCount(record['editedOrRejected']),
    coverage: asLines(record['coverage']),
    notes: asString(record['notes']) ?? '',
  };
};

export type DriftPoint = { readonly drafts: number; readonly edited: number };

const STATS_MARKER = '<!-- ask-marcel-stats ';

/** The rolling window: the drift rate is judged over at least this many recent drafts (SPEC §9). */
export const DRIFT_WINDOW_DRAFTS = 10;

export const DRIFT_ALERT_RATE = 0.4;

/** Recover the machine-readable stats point from a previously written report. */
export const parseReportStats = (content: string): DriftPoint | undefined => {
  const start = content.indexOf(STATS_MARKER);
  if (start === -1) return undefined;
  const end = content.indexOf('-->', start);
  if (end === -1) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.slice(start + STATS_MARKER.length, end).trim());
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  return { drafts: asCount(parsed['drafts']), edited: asCount(parsed['edited']) };
};

export type Drift = { readonly rate: number | null; readonly alert: boolean; readonly window: number };

// history is newest-first (this run first). Points are accumulated until the window holds
// DRIFT_WINDOW_DRAFTS drafts; the alert only fires on a full window (a 1-edit / 2-draft young
// history must not scream 50%).
export const computeDrift = (history: ReadonlyArray<DriftPoint>): Drift => {
  let drafts = 0;
  let edited = 0;
  for (const point of history) {
    if (drafts >= DRIFT_WINDOW_DRAFTS) break;
    drafts += point.drafts;
    edited += point.edited;
  }
  if (drafts === 0) return { rate: null, alert: false, window: 0 };
  const rate = edited / drafts;
  return { rate, alert: drafts >= DRIFT_WINDOW_DRAFTS && rate > DRIFT_ALERT_RATE, window: drafts };
};

const countByState = (run: RunFile): ReadonlyArray<readonly [EmailState, number]> => {
  const counts = new Map<EmailState, number>();
  for (const state of Object.values(run.emails)) {
    if (state !== undefined) counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
};

export type RunReportInput = {
  readonly runId: string;
  readonly todayIso: string;
  readonly scope: string;
  readonly run: RunFile;
  readonly stats: RunReportStats;
  readonly drift: Drift;
};

const list = (title: string, lines: ReadonlyArray<string>): ReadonlyArray<string> => (lines.length === 0 ? [] : [`## ${title}`, '', ...lines.map((line) => `- ${line}`), '']);

export const renderRunReport = (input: RunReportInput): string => {
  const { stats, drift } = input;
  const alertSuffix = drift.alert ? ' - ABOVE 40%: a voice-profiler refresh is recommended' : '';
  const driftLine = drift.rate === null ? 'no drafts in the window yet' : `${Math.round(drift.rate * 100)}% over the last ${drift.window} draft(s)${alertSuffix}`;
  return [
    `# Run ${input.runId}`,
    '',
    `- date: ${input.todayIso}`,
    `- mode: ${input.run.mode}`,
    `- scope: ${input.scope}`,
    `- run phase: ${input.run.phase}`,
    '',
    '## Outcome',
    '',
    `- drafted: ${stats.drafted}`,
    `- updated: ${stats.updated}`,
    `- skipped by user: ${stats.skippedByUser}`,
    `- skipped by rule: ${stats.skippedByRule}`,
    `- blocked: ${stats.blocked.length}`,
    `- draft edited-or-rejected after preflight: ${stats.editedOrRejected}`,
    '',
    '## Email board',
    '',
    ...countByState(input.run).map(([state, count]) => `- ${state}: ${count}`),
    '',
    ...list('Blocked', stats.blocked),
    ...list('Coverage - sources that errored or were skipped', stats.coverage),
    '## Voice drift',
    '',
    `- edit/reject rate: ${driftLine}`,
    '',
    ...(stats.notes === '' ? [] : ['## Notes', '', stats.notes, '']),
    `${STATS_MARKER}${JSON.stringify({ drafts: stats.drafted + stats.updated, edited: stats.editedOrRejected })} -->`,
    '',
  ].join('\n');
};
