import { describe, expect, test } from 'bun:test';

import type { RunFile } from '../domain/email-state.ts';
import { err, ok } from '../domain/result.ts';
import { createLoggerFake } from '../test-helpers/logger-fake.ts';
import { createStateStoreFake } from '../test-helpers/state-store-fake.ts';
import { createListRuns } from './list-runs.ts';

const path = (runId: string): string => `data/scratch/${runId}/state.json`;

const run = (phase: RunFile['phase'], mode: RunFile['mode'] = 'interactive'): RunFile => ({
  mode,
  phase,
  emails: { m1: 'researched', m2: 'skipped', m3: 'researched', m4: undefined },
});

type Opts = { readonly failList?: boolean };

type Setup = { readonly listRuns: ReturnType<typeof createListRuns>; readonly logger: ReturnType<typeof createLoggerFake>; readonly globs: ReadonlyArray<string> };

const setup = (paths: ReadonlyArray<string>, runs: Record<string, RunFile>, opts: Opts = {}): Setup => {
  const stateStore = createStateStoreFake(runs);
  const logger = createLoggerFake();
  const globs: string[] = [];
  const listRuns = createListRuns({
    lister: {
      list: async (glob: string) => {
        globs.push(glob);
        return opts.failList === true ? err({ kind: 'list-failed', message: 'glob crashed' }) : ok(paths);
      },
    },
    stateStore,
    logger,
  });
  return { listRuns, logger, globs };
};

describe('list-runs', () => {
  test('open runs come back newest first with their phase, mode, and a per-state email count', async () => {
    // three OPEN runs deliberately scrambled (11, 13, 12) so insertion order, ascending order,
    // and constant comparators all differ from the expected newest-first result
    const { listRuns, logger, globs } = setup([path('run-20260710-060000'), path('run-20260711-060000'), path('run-20260713-060000'), path('run-20260712-060000')], {
      'run-20260710-060000': run('wrapped'),
      'run-20260711-060000': run('context_loaded', 'pre-research'),
      'run-20260712-060000': run('reindexed'),
      'run-20260713-060000': run('init'),
    });

    const result = await listRuns();

    if (!result.ok) throw new Error('expected ok');
    // the wrapped run is done - only the open runs surface, newest first; undefined holes not counted
    expect(result.value.open).toEqual([
      { runId: 'run-20260713-060000', mode: 'interactive', phase: 'init', emails: { researched: 2, skipped: 1 } },
      { runId: 'run-20260712-060000', mode: 'interactive', phase: 'reindexed', emails: { researched: 2, skipped: 1 } },
      { runId: 'run-20260711-060000', mode: 'pre-research', phase: 'context_loaded', emails: { researched: 2, skipped: 1 } },
    ]);
    expect(result.value.unreadable).toBe(0);
    expect(globs).toEqual(['data/scratch/run-*/state.json']);
    expect(logger.calls).toEqual([{ level: 'info', event: 'runs-listed', meta: { open: 3, unreadable: 0 } }]);
  });

  test('corrupt state files and undateable dir names are counted, never fatal - windows paths resolve', async () => {
    const { listRuns } = setup(
      ['data\\scratch\\run-20260712-060000\\state.json', path('run-20260711-060000'), 'data/scratch/not-a-run/state.json', 'state.json'],
      { 'run-20260712-060000': run('init') } // run-20260711 missing from the store = unreadable
    );

    const result = await listRuns();

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.open.map((entry) => entry.runId)).toEqual(['run-20260712-060000']);
    expect(result.value.unreadable).toBe(3);
  });

  test('an empty scratch is an empty summary, and a listing failure surfaces typed', async () => {
    expect(await setup([], {}).listRuns()).toEqual({ ok: true, value: { open: [], unreadable: 0 } });
    expect(await setup([], {}, { failList: true }).listRuns()).toEqual({ ok: false, error: { kind: 'list-failed', message: 'glob crashed' } });
  });
});
