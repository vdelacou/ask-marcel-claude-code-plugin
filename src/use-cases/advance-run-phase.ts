import { advanceRunPhase, resumeRun } from '../domain/email-state.ts';
import type { RunGuardError, RunPhase } from '../domain/email-state.ts';
import { parseQueue } from '../domain/kb-queue.ts';
import { parseRunId } from '../domain/run-id.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { FileProbe } from './ports/file-probe.ts';
import type { FileReader } from './ports/file-reader.ts';
import type { Logger } from './ports/logger.ts';
import type { StateStore } from './ports/state-store.ts';

export type RunAdvanceError =
  { readonly kind: 'invalid-run-id'; readonly message: string } | { readonly kind: 'guard'; readonly error: RunGuardError } | { readonly kind: 'store'; readonly message: string };

export type AdvanceRunPhase = (rawRunId: string, to: RunPhase) => Promise<Result<RunPhase, RunAdvanceError>>;

export type ResumeRun = (rawRunId: string) => Promise<Result<'interactive', RunAdvanceError>>;

type Deps = { readonly stateStore: StateStore; readonly files: FileProbe; readonly reader: FileReader; readonly logger: Logger };

// The wrapped gate reads the run's KB queue: a missing file counts as drained (0); an unreadable one
// blocks (`unreadable`); otherwise the parseable-candidate count blocks when non-zero (SPEC §2: wrapped
// is unreachable while the queue is non-empty). The count is surfaced so the block names how many remain.
const queueRemaining = async (deps: Deps, runId: string): Promise<number | 'unreadable'> => {
  const path = `data/scratch/${runId}/kb-queue.jsonl`;
  if (!(await deps.files.exists(path))) return 0;
  const content = await deps.reader.read(path);
  return content.ok ? parseQueue(content.value).length : 'unreadable';
};

export const createAdvanceRunPhase =
  (deps: Deps): AdvanceRunPhase =>
  async (rawRunId, to) => {
    const runId = parseRunId(rawRunId);
    if (!runId.ok) return err({ kind: 'invalid-run-id', message: runId.error });
    const loaded = await deps.stateStore.load(runId.value);
    if (!loaded.ok) return err({ kind: 'store', message: loaded.error.message });
    const gate = { queueRemaining: to === 'wrapped' ? await queueRemaining(deps, runId.value) : 0 };
    const advanced = advanceRunPhase(loaded.value, to, gate);
    if (!advanced.ok) return err({ kind: 'guard', error: advanced.error });
    const saved = await deps.stateStore.save(runId.value, advanced.value);
    if (!saved.ok) return err({ kind: 'store', message: saved.error.message });
    deps.logger.info('run-phase-advanced', { runId: runId.value, to });
    return ok(to);
  };

// The interactive session picking up a pre-research run lifts its restrictions (SPEC §2).
export const createResumeRun =
  (deps: Deps): ResumeRun =>
  async (rawRunId) => {
    const runId = parseRunId(rawRunId);
    if (!runId.ok) return err({ kind: 'invalid-run-id', message: runId.error });
    const loaded = await deps.stateStore.load(runId.value);
    if (!loaded.ok) return err({ kind: 'store', message: loaded.error.message });
    const saved = await deps.stateStore.save(runId.value, resumeRun(loaded.value));
    if (!saved.ok) return err({ kind: 'store', message: saved.error.message });
    deps.logger.info('run-resumed', { runId: runId.value });
    return ok('interactive');
  };
