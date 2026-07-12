import { registerEmail } from '../domain/email-state.ts';
import type { RegisterError } from '../domain/email-state.ts';
import { parseRunId } from '../domain/run-id.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { Logger } from './ports/logger.ts';
import type { StateStore } from './ports/state-store.ts';

export type RegisterEmailError =
  | { readonly kind: 'invalid-run-id'; readonly message: string }
  | { readonly kind: 'register'; readonly error: RegisterError }
  | { readonly kind: 'store'; readonly message: string };

export type RegisterEmailState = (rawRunId: string, emailId: string) => Promise<Result<'scanned', RegisterEmailError>>;

type Deps = { readonly stateStore: StateStore; readonly logger: Logger };

// A deferred thread resurfaces into a run whose scan never saw it: registration adds its
// representative email at `scanned` so the normal ladder (triage -> Gate 1 -> ...) applies.
// An id the run already tracks is refused - registration never resets a position.
export const createRegisterEmailState =
  (deps: Deps): RegisterEmailState =>
  async (rawRunId, emailId) => {
    const runId = parseRunId(rawRunId);
    if (!runId.ok) return err({ kind: 'invalid-run-id', message: runId.error });
    const loaded = await deps.stateStore.load(runId.value);
    if (!loaded.ok) return err({ kind: 'store', message: loaded.error.message });
    const registered = registerEmail(loaded.value.emails, emailId);
    if (!registered.ok) return err({ kind: 'register', error: registered.error });
    const saved = await deps.stateStore.save(runId.value, { ...loaded.value, emails: registered.value });
    if (!saved.ok) return err({ kind: 'store', message: saved.error.message });
    deps.logger.info('email-registered', { runId: runId.value, emailId });
    return ok('scanned');
  };
