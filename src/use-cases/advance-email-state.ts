import { advanceEmailInRun } from '../domain/email-state.ts';
import type { EmailState, RunGuardError, TransitionError } from '../domain/email-state.ts';
import { parseRunId } from '../domain/run-id.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { Logger } from './ports/logger.ts';
import type { StateStore } from './ports/state-store.ts';

export type AdvanceError =
  | { readonly kind: 'invalid-run-id'; readonly message: string }
  | { readonly kind: 'transition'; readonly error: TransitionError | RunGuardError }
  | { readonly kind: 'store'; readonly message: string };

export type AdvanceEmailState = (rawRunId: string, emailId: string, to: EmailState) => Promise<Result<EmailState, AdvanceError>>;

type Deps = {
  readonly stateStore: StateStore;
  readonly logger: Logger;
};

export const createAdvanceEmailState =
  (deps: Deps): AdvanceEmailState =>
  async (rawRunId, emailId, to) => {
    const runId = parseRunId(rawRunId);
    if (!runId.ok) return err({ kind: 'invalid-run-id', message: runId.error });
    const loaded = await deps.stateStore.load(runId.value);
    if (!loaded.ok) return err({ kind: 'store', message: loaded.error.message });
    // The run-level guards ride along: emails move only in the context_loaded window, and a
    // pre-research run cannot take an email past researched (SPEC §2).
    const advanced = advanceEmailInRun(loaded.value, emailId, to);
    if (!advanced.ok) return err({ kind: 'transition', error: advanced.error });
    const saved = await deps.stateStore.save(runId.value, advanced.value);
    if (!saved.ok) return err({ kind: 'store', message: saved.error.message });
    deps.logger.info('email-state-advanced', { emailId, to });
    return ok(to);
  };
