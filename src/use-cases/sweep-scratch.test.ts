import { describe, expect, test } from 'bun:test';

import { err, ok } from '../domain/result.ts';
import { createLoggerFake } from '../test-helpers/logger-fake.ts';
import type { LoggerFake } from '../test-helpers/logger-fake.ts';
import { createSweepScratch } from './sweep-scratch.ts';
import type { SweepScratch } from './sweep-scratch.ts';

const TODAY = '2026-07-11';

type Opts = { readonly failList?: boolean; readonly failRemove?: string };

type Setup = { readonly sweep: SweepScratch; readonly removed: ReadonlyArray<string>; readonly logger: LoggerFake };

const setup = (stateFiles: ReadonlyArray<string>, opts: Opts = {}): Setup => {
  const removed: string[] = [];
  const logger = createLoggerFake();
  const sweep = createSweepScratch({
    lister: { list: async () => (opts.failList === true ? err({ kind: 'list-failed', message: 'glob crashed' }) : ok(stateFiles)) },
    remover: {
      remove: async (path: string) => {
        if (opts.failRemove === path) return err({ kind: 'remove-failed', path, message: 'busy' });
        removed.push(path);
        return ok(undefined);
      },
    },
    clock: { todayIso: () => TODAY, nowIso: () => `${TODAY}T06:30:00.000Z` },
    logger,
  });
  return { sweep, removed, logger };
};

describe('sweep-scratch', () => {
  test('run dirs past retention are removed; younger runs and non-run dirs survive', async () => {
    const { sweep, removed, logger } = setup([
      'data/scratch/run-20260601-070000/state.json', // 40 days old - swept
      'data/scratch/run-20260710-070000/state.json', // yesterday - kept
      'data/scratch/not-a-run/state.json', // undateable - kept
    ]);

    const result = await sweep(7);

    expect(result).toEqual({ ok: true, value: { swept: ['data/scratch/run-20260601-070000'] } });
    expect(removed).toEqual(['data/scratch/run-20260601-070000']);
    expect(logger.calls).toEqual([{ level: 'info', event: 'scratch-swept', meta: { swept: 1 } }]);
  });

  test('an empty scratch sweeps nothing and still reports cleanly', async () => {
    expect(await setup([]).sweep(7)).toEqual({ ok: true, value: { swept: [] } });
  });

  test('a listing failure surfaces as a typed error', async () => {
    expect(await setup([], { failList: true }).sweep(7)).toEqual({ ok: false, error: { kind: 'list-failed', message: 'glob crashed' } });
  });

  test('a removal failure surfaces as a typed error naming the dir', async () => {
    const { sweep } = setup(['data/scratch/run-20260601-070000/state.json'], { failRemove: 'data/scratch/run-20260601-070000' });

    expect(await sweep(7)).toEqual({ ok: false, error: { kind: 'remove-failed', path: 'data/scratch/run-20260601-070000', message: 'busy' } });
  });
});
