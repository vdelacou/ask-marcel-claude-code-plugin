import { describe, expect, test } from 'bun:test';

import { parseRunReportStats } from '../domain/run-report.ts';
import { err, ok } from '../domain/result.ts';
import { createLoggerFake } from '../test-helpers/logger-fake.ts';
import { createStateStoreFake } from '../test-helpers/state-store-fake.ts';
import { createWriteRunReport } from './write-run-report.ts';
import type { WriteRunReport } from './write-run-report.ts';

const RUN = 'run-20260711-063000';
const REPORT_PATH = `data/reports/${RUN}.md`;

type Files = Record<string, string>;
type Opts = { readonly failWrite?: boolean; readonly failList?: boolean };

type Setup = {
  readonly report: WriteRunReport;
  readonly written: ReadonlyArray<{ path: string; content: string }>;
  readonly stateStore: ReturnType<typeof createStateStoreFake>;
  readonly globs: ReadonlyArray<string>;
  readonly logger: ReturnType<typeof createLoggerFake>;
};

const setup = (files: Files, opts: Opts = {}): Setup => {
  const written: { path: string; content: string }[] = [];
  const globs: string[] = [];
  const logger = createLoggerFake();
  const stateStore = createStateStoreFake({ [RUN]: { mode: 'interactive', phase: 'reindexed', emails: { m1: 'done', m2: 'skipped' } } });
  const report = createWriteRunReport({
    stateStore,
    lister: {
      list: async (glob: string) => {
        globs.push(glob);
        return opts.failList === true ? err({ kind: 'list-failed', message: 'boom' }) : ok(Object.keys(files).filter((path) => path.startsWith('data/reports/')));
      },
    },
    reader: { read: async (path: string) => (path in files ? ok(files[path] ?? '') : err({ kind: 'read-failed', path, message: 'missing' })) },
    writer: {
      write: async (path: string, content: string) => {
        if (opts.failWrite === true) return err({ kind: 'write-failed', path, message: 'disk full' });
        written.push({ path, content });
        return ok(undefined);
      },
    },
    clock: { todayIso: () => '2026-07-11', nowIso: () => '2026-07-11T18:00:00.000Z' },
    logger,
  });
  return { report, written, stateStore, globs, logger };
};

const stats = (drafted: number, edited: number, updated = 0): ReturnType<typeof parseRunReportStats> => parseRunReportStats({ drafted, updated, editedOrRejected: edited });

const priorReport = (drafts: number, edited: number): string => `# Run old\n\n<!-- ask-marcel-stats {"drafts": ${drafts}, "edited": ${edited}} -->\n`;

describe('write-run-report', () => {
  test('the report lands in data/reports and the drift window spans this run plus prior reports, newest first', async () => {
    const { report, written, globs, logger } = setup({
      [`data/scratch/${RUN}/candidates.json`]: JSON.stringify({ scope: 'unread' }),
      // filenames sort chronologically; the newest prior report is read first
      'data/reports/run-20260701-070000.md': priorReport(100, 0), // old and beyond the window
      'data/reports/run-20260710-070000.md': priorReport(8, 4),
    });

    // drafts = drafted + updated: 1 created + 1 patched both count toward the window
    const result = await report(RUN, stats(1, 2, 1));

    // window: this run (2 drafts, 2 edited) + newest prior (8 drafts, 4 edited) = 10 drafts, 60%
    expect(result).toEqual({ ok: true, value: { path: REPORT_PATH, drift: { rate: 0.6, alert: true, window: 10 } } });
    expect(written).toHaveLength(1);
    expect(written[0]?.path).toBe(REPORT_PATH);
    expect(written[0]?.content).toContain('- scope: unread');
    expect(written[0]?.content).toContain('ABOVE 40%');
    expect(globs).toEqual(['data/reports/*.md']);
    expect(logger.calls).toEqual([{ level: 'info', event: 'run-report-written', meta: { runId: RUN, path: REPORT_PATH, driftAlert: true } }]);
  });

  test('a first run with no history and no candidates file still reports, scope unknown, drift young', async () => {
    const { report, written } = setup({});

    const result = await report(RUN, stats(1, 0));

    expect(result).toEqual({ ok: true, value: { path: REPORT_PATH, drift: { rate: 0, alert: false, window: 1 } } });
    expect(written[0]?.content).toContain('- scope: unknown');
  });

  test('garbage or shapeless candidates.json also reads as scope unknown, never a crash', async () => {
    const garbage = setup({ [`data/scratch/${RUN}/candidates.json`]: 'not json' });
    const first = await garbage.report(RUN, stats(1, 0));
    if (!first.ok) throw new Error('expected ok');
    expect(garbage.written[0]?.content).toContain('- scope: unknown');

    const shapeless = setup({ [`data/scratch/${RUN}/candidates.json`]: JSON.stringify({ scope: 42 }) });
    const second = await shapeless.report(RUN, stats(1, 0));
    if (!second.ok) throw new Error('expected ok');
    expect(shapeless.written[0]?.content).toContain('- scope: unknown');
  });

  test('marker-less prior reports and a failing lister contribute nothing instead of failing the wrap', async () => {
    const { report } = setup({ 'data/reports/run-20260710-070000.md': '# Run old - no marker' });
    const result = await report(RUN, stats(2, 1));
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.drift).toEqual({ rate: 0.5, alert: false, window: 2 });

    const listFails = setup({}, { failList: true });
    const fallback = await listFails.report(RUN, stats(2, 1));
    if (!fallback.ok) throw new Error('expected ok');
    expect(fallback.value.drift.window).toBe(2);
  });

  test('an invalid run id and an unknown run fail with typed errors', async () => {
    const { report, stateStore } = setup({});

    expect(await report('../escape', stats(0, 0))).toEqual({ ok: false, error: { kind: 'invalid-run-id', message: 'invalid RunId: "../escape"' } });
    expect(stateStore.reads).toBe(0);

    expect(await report('run-20260101-000000', stats(0, 0))).toEqual({ ok: false, error: { kind: 'state-unreadable', message: 'no run run-20260101-000000' } });
  });

  test('a report write failure surfaces as a typed error', async () => {
    const { report } = setup({}, { failWrite: true });

    expect(await report(RUN, stats(0, 0))).toEqual({ ok: false, error: { kind: 'write-failed', message: 'disk full' } });
  });
});
