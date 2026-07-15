import { describe, expect, test } from 'bun:test';

import type { RunFile } from '../domain/email-state.ts';
import type { Result } from '../domain/result.ts';
import { createLoggerFake } from '../test-helpers/logger-fake.ts';
import type { LoggerFake } from '../test-helpers/logger-fake.ts';
import { createStateStoreFake } from '../test-helpers/state-store-fake.ts';
import type { StateStoreFake } from '../test-helpers/state-store-fake.ts';
import { createAdvanceRunPhase, createResumeRun } from './advance-run-phase.ts';
import type { AdvanceRunPhase, ResumeRun } from './advance-run-phase.ts';

const RUN = 'run-20260711-063000';
const QUEUE_PATH = `data/scratch/${RUN}/kb-queue.jsonl`;

type Setup = {
  readonly advanceRun: AdvanceRunPhase;
  readonly resume: ResumeRun;
  readonly stateStore: StateStoreFake;
  readonly logger: LoggerFake;
  readonly probes: ReadonlyArray<string>;
};

const setup = (run: RunFile, queue?: string): Setup => {
  const stateStore = createStateStoreFake({ [RUN]: run });
  const logger = createLoggerFake();
  const probes: string[] = [];
  const deps = {
    stateStore,
    files: {
      exists: async (path: string) => {
        probes.push(path);
        return path === QUEUE_PATH && queue !== undefined;
      },
    },
    reader: {
      read: async (path: string) =>
        queue === undefined ? { ok: false as const, error: { kind: 'read-failed' as const, path, message: 'missing' } } : { ok: true as const, value: queue },
    },
    logger,
  };
  return { advanceRun: createAdvanceRunPhase(deps), resume: createResumeRun(deps), stateStore, logger, probes };
};

const expectErr: <T, E>(result: Result<T, E>) => asserts result is { readonly ok: false; readonly error: E } = (result) => {
  expect(result.ok).toBe(false);
};

describe('advance-run-phase', () => {
  test('a run whose context was read advances init -> context_loaded, and the emails window opens', async () => {
    const { advanceRun, stateStore, logger, probes } = setup({ mode: 'interactive', phase: 'init', emails: { m1: 'scanned' } });

    expect(await advanceRun(RUN, 'context_loaded')).toEqual({ ok: true, value: 'context_loaded' });
    expect(stateStore.snapshot(RUN)?.phase).toBe('context_loaded');
    expect(logger.calls).toEqual([{ level: 'info', event: 'run-phase-advanced', meta: { runId: RUN, to: 'context_loaded' } }]);
    // only the wrapped gate reads the queue - a context_loaded advance never touches the filesystem
    expect(probes).toEqual([]);
  });

  test('wrap-up cannot start while an email is still mid-pipeline', async () => {
    const { advanceRun, stateStore } = setup({ mode: 'interactive', phase: 'context_loaded', emails: { m1: 'done', m2: 'researched' } });

    const result = await advanceRun(RUN, 'jargon_drained');

    expectErr(result);
    expect(result.error).toMatchObject({ kind: 'guard', error: { kind: 'emails-not-terminal' } });
    expect(stateStore.snapshot(RUN)?.phase).toBe('context_loaded');
  });

  test('the wrap ladder walks to wrapped only once the KB queue is drained', async () => {
    const run: RunFile = { mode: 'interactive', phase: 'context_loaded', emails: { m1: 'done', m2: 'skipped' } };
    const withQueue = setup(run, '{"kind":"jargon","term":"OKF"}\n');

    expect(await withQueue.advanceRun(RUN, 'jargon_drained')).toEqual({ ok: true, value: 'jargon_drained' });
    expect(await withQueue.advanceRun(RUN, 'user_md_reviewed')).toEqual({ ok: true, value: 'user_md_reviewed' });
    expect(await withQueue.advanceRun(RUN, 'reindexed')).toEqual({ ok: true, value: 'reindexed' });

    // an undrained candidate blocks the final gate...
    const blocked = await withQueue.advanceRun(RUN, 'wrapped');
    expectErr(blocked);
    expect(blocked.error).toMatchObject({ kind: 'guard', error: { kind: 'queue-not-empty' } });

    // ...a drained (or never-created) queue lets the run wrap: a missing file counts as drained,
    // and a file holding only malformed lines counts as drained too
    const drained = setup({ ...run, phase: 'reindexed' });
    expect(await drained.advanceRun(RUN, 'wrapped')).toEqual({ ok: true, value: 'wrapped' });
    const garbageOnly = setup({ ...run, phase: 'reindexed' }, 'not json\n');
    expect(await garbageOnly.advanceRun(RUN, 'wrapped')).toEqual({ ok: true, value: 'wrapped' });
  });

  test('phases never skip ahead or run backwards', async () => {
    const { advanceRun } = setup({ mode: 'interactive', phase: 'init', emails: {} });

    const skipped = await advanceRun(RUN, 'wrapped');
    expectErr(skipped);
    expect(skipped.error).toMatchObject({ kind: 'guard', error: { kind: 'invalid-run-transition', from: 'init', to: 'wrapped' } });
  });

  test('a pre-research run loads its context but can never begin the wrap', async () => {
    const { advanceRun, stateStore } = setup({ mode: 'pre-research', phase: 'init', emails: { m1: 'researched' } });

    expect(await advanceRun(RUN, 'context_loaded')).toEqual({ ok: true, value: 'context_loaded' });

    const blocked = await advanceRun(RUN, 'jargon_drained');
    expectErr(blocked);
    expect(blocked.error).toMatchObject({ kind: 'guard', error: { kind: 'pre-research-cap' } });
    expect(stateStore.snapshot(RUN)?.phase).toBe('context_loaded');
  });

  test('resume lifts a pre-research run to interactive so the drafting gates open', async () => {
    const { resume, stateStore, logger } = setup({ mode: 'pre-research', phase: 'context_loaded', emails: { m1: 'researched' } });

    expect(await resume(RUN)).toEqual({ ok: true, value: 'interactive' });
    expect(stateStore.snapshot(RUN)?.mode).toBe('interactive');
    expect(logger.calls).toEqual([{ level: 'info', event: 'run-resumed', meta: { runId: RUN } }]);
  });

  test('an invalid run id is rejected before the store is touched, for both commands', async () => {
    const { advanceRun, resume, stateStore } = setup({ mode: 'interactive', phase: 'init', emails: {} });

    expectErr(await advanceRun('../escape', 'context_loaded'));
    expectErr(await resume('../escape'));
    expect(stateStore.reads).toBe(0);
  });

  test('store failures surface as typed errors on load and on save, for both commands', async () => {
    const failing = setup({ mode: 'interactive', phase: 'init', emails: {} });
    failing.stateStore.failWith('load', { kind: 'io', message: 'disk full' });
    expect(await failing.advanceRun(RUN, 'context_loaded')).toEqual({ ok: false, error: { kind: 'store', message: 'disk full' } });
    expect(await failing.resume(RUN)).toEqual({ ok: false, error: { kind: 'store', message: 'disk full' } });

    const failingSave = setup({ mode: 'pre-research', phase: 'init', emails: {} });
    failingSave.stateStore.failWith('save', { kind: 'io', message: 'read-only' });
    expect(await failingSave.advanceRun(RUN, 'context_loaded')).toEqual({ ok: false, error: { kind: 'store', message: 'read-only' } });
    expect(await failingSave.resume(RUN)).toEqual({ ok: false, error: { kind: 'store', message: 'read-only' } });
  });

  test('an unreadable existing queue file blocks the wrap rather than assuming it was drained', async () => {
    const stateStore = createStateStoreFake({ [RUN]: { mode: 'interactive', phase: 'reindexed', emails: { m1: 'done' } } });
    const logger = createLoggerFake();
    const advanceRun = createAdvanceRunPhase({
      stateStore,
      files: { exists: async () => true },
      reader: { read: async (path: string) => ({ ok: false as const, error: { kind: 'read-failed' as const, path, message: 'permission denied' } }) },
      logger,
    });

    const result = await advanceRun(RUN, 'wrapped');

    expectErr(result);
    expect(result.error).toMatchObject({ kind: 'guard', error: { kind: 'queue-not-empty' } });
  });

  test('the wrap-block error names how many candidates are still undrained', async () => {
    const two = '{"kind":"jargon","term":"OKF"}\n{"kind":"fact","emailId":"m1","folder":"orgs","slug":"acme","title":"Acme","content":"x","rationale":"y"}\n';
    const { advanceRun } = setup({ mode: 'interactive', phase: 'reindexed', emails: { m1: 'done' } }, two);

    const blocked = await advanceRun(RUN, 'wrapped');

    expectErr(blocked);
    expect(blocked.error).toEqual({
      kind: 'guard',
      error: { kind: 'queue-not-empty', message: '2 undrained candidate(s) remain in the KB queue - drain or discard before wrapping (SPEC §2)' },
    });
  });
});
