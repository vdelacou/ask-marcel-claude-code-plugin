import { describe, expect, test } from 'bun:test';

import { err, ok } from '../domain/result.ts';
import { createLoggerFake } from '../test-helpers/logger-fake.ts';
import type { LoggerFake } from '../test-helpers/logger-fake.ts';
import { createAdvanceWatermark } from './advance-watermark.ts';
import type { AdvanceWatermark } from './advance-watermark.ts';

const RUN = 'run-20260711-063000';
const CANDIDATES_PATH = `data/scratch/${RUN}/candidates.json`;
const WATERMARK_PATH = 'data/state/inbox-watermark.json';

type Opts = { readonly failWrite?: boolean };

type Setup = { readonly advance: AdvanceWatermark; readonly written: ReadonlyArray<{ path: string; content: string }>; readonly logger: LoggerFake };

const setup = (candidates: string | undefined, opts: Opts = {}): Setup => {
  const written: { path: string; content: string }[] = [];
  const logger = createLoggerFake();
  const advance = createAdvanceWatermark({
    reader: { read: async (path: string) => (candidates === undefined || path !== CANDIDATES_PATH ? err({ kind: 'read-failed', path, message: 'missing' }) : ok(candidates)) },
    writer: {
      write: async (path: string, content: string) => {
        if (opts.failWrite === true) return err({ kind: 'write-failed', path, message: 'disk full' });
        written.push({ path, content });
        return ok(undefined);
      },
    },
    logger,
  });
  return { advance, written, logger };
};

describe('advance-watermark', () => {
  test("the wrap advances the watermark to the run's scannedAt so the next scan starts exactly there", async () => {
    const { advance, written, logger } = setup(JSON.stringify({ runId: RUN, scannedAt: '2026-07-11T06:30:00.000Z' }));

    const result = await advance(RUN);

    expect(result).toEqual({ ok: true, value: '2026-07-11T06:30:00.000Z' });
    expect(written).toEqual([{ path: WATERMARK_PATH, content: '{\n  "watermark": "2026-07-11T06:30:00.000Z"\n}\n' }]);
    expect(logger.calls).toEqual([{ level: 'info', event: 'watermark-advanced', meta: { runId: RUN, watermark: '2026-07-11T06:30:00.000Z' } }]);
  });

  test('an invalid run id is rejected before anything is read', async () => {
    const { advance, written } = setup(undefined);

    const result = await advance('../../etc');

    expect(result).toEqual({ ok: false, error: { kind: 'invalid-run-id', message: 'invalid RunId: "../../etc"' } });
    expect(written).toHaveLength(0);
  });

  test('a run with no readable candidates.json cannot advance the watermark', async () => {
    expect(await setup(undefined).advance(RUN)).toEqual({ ok: false, error: { kind: 'candidates-unreadable', message: 'missing' } });
  });

  test('candidates.json without a scannedAt (or unparseable) never moves the watermark', async () => {
    expect(await setup(JSON.stringify({ runId: RUN })).advance(RUN)).toEqual({ ok: false, error: { kind: 'candidates-unreadable', message: 'candidates.json has no scannedAt' } });
    expect(await setup('not json').advance(RUN)).toEqual({ ok: false, error: { kind: 'candidates-unreadable', message: 'candidates.json has no scannedAt' } });
  });

  test('a watermark write failure surfaces as a typed error', async () => {
    const { advance } = setup(JSON.stringify({ scannedAt: '2026-07-11T06:30:00.000Z' }), { failWrite: true });

    expect(await advance(RUN)).toEqual({ ok: false, error: { kind: 'write-failed', message: 'disk full' } });
  });
});
