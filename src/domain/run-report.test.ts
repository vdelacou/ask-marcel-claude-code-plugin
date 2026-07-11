import { describe, expect, test } from 'bun:test';

import { computeDrift, DRIFT_WINDOW_DRAFTS, parseReportStats, parseRunReportStats, renderRunReport } from './run-report.ts';
import type { RunReportStats } from './run-report.ts';

const STATS: RunReportStats = {
  drafted: 2,
  updated: 1,
  skippedByUser: 1,
  skippedByRule: 2,
  blocked: ['m9: researcher failed twice'],
  editedOrRejected: 1,
  coverage: ['sharepoint search errored on question 2'],
  notes: 'first live run of the week',
};

describe('run-report', () => {
  test('lenient stats intake defaults every missing or malformed key', () => {
    expect(parseRunReportStats('not even a record')).toEqual({
      drafted: 0,
      updated: 0,
      skippedByUser: 0,
      skippedByRule: 0,
      blocked: [],
      editedOrRejected: 0,
      coverage: [],
      notes: '',
    });
    expect(parseRunReportStats({ drafted: -3, updated: 'x', blocked: ['a', 42], notes: 7 })).toEqual({
      drafted: 0,
      updated: 0,
      skippedByUser: 0,
      skippedByRule: 0,
      blocked: ['a'],
      editedOrRejected: 0,
      coverage: [],
      notes: '',
    });
    // a complete stats object round-trips field-for-field, and Infinity is not a count
    expect(parseRunReportStats({ ...STATS })).toEqual(STATS);
    expect(parseRunReportStats({ drafted: Infinity })).toMatchObject({ drafted: 0 });
  });

  test('a rendered report is byte-stable: outcome, board, blocked, coverage, drift, notes, stats marker', () => {
    const report = renderRunReport({
      runId: 'run-20260711-063000',
      todayIso: '2026-07-11',
      scope: 'since 2026-07-10T06:30:00Z',
      run: { mode: 'interactive', phase: 'wrapped', emails: { m1: 'done', m2: 'done', m3: 'skipped' } },
      stats: STATS,
      drift: { rate: 0.2, alert: false, window: 10 },
    });

    // golden output: the report is a contract read by humans AND by the next run's drift pass
    expect(report).toBe(
      [
        '# Run run-20260711-063000',
        '',
        '- date: 2026-07-11',
        '- mode: interactive',
        '- scope: since 2026-07-10T06:30:00Z',
        '- run phase: wrapped',
        '',
        '## Outcome',
        '',
        '- drafted: 2',
        '- updated: 1',
        '- skipped by user: 1',
        '- skipped by rule: 2',
        '- blocked: 1',
        '- draft edited-or-rejected after preflight: 1',
        '',
        '## Email board',
        '',
        '- done: 2',
        '- skipped: 1',
        '',
        '## Blocked',
        '',
        '- m9: researcher failed twice',
        '',
        '## Coverage - sources that errored or were skipped',
        '',
        '- sharepoint search errored on question 2',
        '',
        '## Voice drift',
        '',
        '- edit/reject rate: 20% over the last 10 draft(s)',
        '',
        '## Notes',
        '',
        'first live run of the week',
        '',
        '<!-- ask-marcel-stats {"drafts":3,"edited":1} -->',
        '',
      ].join('\n')
    );
    // the marker is machine-recoverable: drafts = drafted + updated
    expect(parseReportStats(report)).toEqual({ drafts: 3, edited: 1 });
  });

  test('the drift alert line names the voice-profiler when the rate crosses 40%', () => {
    const report = renderRunReport({
      runId: 'run-20260711-063000',
      todayIso: '2026-07-11',
      scope: 'unread',
      run: { mode: 'interactive', phase: 'wrapped', emails: {} },
      stats: { ...STATS, blocked: [], coverage: [], notes: '' },
      drift: { rate: 0.5, alert: true, window: 12 },
    });

    expect(report).toContain('ABOVE 40%: a voice-profiler refresh is recommended');
    expect(report).not.toContain('## Blocked');
    expect(report).not.toContain('## Coverage');
    expect(report).not.toContain('## Notes');
    // empty sections contribute NOTHING: the minimal report is exactly this many lines
    expect(report.split('\n')).toHaveLength(25);
  });

  test('the board sorts states alphabetically, skips undefined holes, and a draftless window says so', () => {
    const report = renderRunReport({
      runId: 'run-20260711-063000',
      todayIso: '2026-07-11',
      scope: 'all',
      run: { mode: 'interactive', phase: 'wrapped', emails: { m1: 'skipped', m2: 'done', m3: undefined } },
      stats: { ...STATS, blocked: [], coverage: [], notes: '' },
      drift: { rate: null, alert: false, window: 0 },
    });

    expect(report).toContain('## Email board\n\n- done: 1\n- skipped: 1\n');
    expect(report).toContain('- edit/reject rate: no drafts in the window yet');
  });

  test('reports without a marker, with a truncated marker, or with garbage JSON yield no stats point', () => {
    expect(parseReportStats('# Run x\n\nno marker here')).toBeUndefined();
    expect(parseReportStats('<!-- ask-marcel-stats {"drafts": 2')).toBeUndefined();
    expect(parseReportStats('<!-- ask-marcel-stats not-json -->')).toBeUndefined();
    expect(parseReportStats('<!-- ask-marcel-stats "a string" -->')).toBeUndefined();
  });

  test('drift accumulates newest-first until the 10-draft window is filled, then stops', () => {
    // this run: 2 drafts 2 edited; prior runs fill the window to exactly 10 before the stale tail
    const drift = computeDrift([
      { drafts: 2, edited: 2 },
      { drafts: 8, edited: 2 },
      { drafts: 100, edited: 0 }, // beyond the window - must not dilute the rate
    ]);

    expect(drift).toEqual({ rate: 0.4, alert: false, window: 10 });
  });

  test('the alert fires only above 40% AND only on a full window', () => {
    // above the rate but window too small: a young history must not scream
    expect(computeDrift([{ drafts: 2, edited: 1 }])).toEqual({ rate: 0.5, alert: false, window: 2 });
    // full window, above the rate
    expect(computeDrift([{ drafts: DRIFT_WINDOW_DRAFTS, edited: 5 }])).toEqual({ rate: 0.5, alert: true, window: 10 });
    // no drafts at all
    expect(computeDrift([{ drafts: 0, edited: 0 }])).toEqual({ rate: null, alert: false, window: 0 });
    expect(computeDrift([])).toEqual({ rate: null, alert: false, window: 0 });
  });
});
