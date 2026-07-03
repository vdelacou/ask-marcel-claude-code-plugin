import type { RunState } from '../../domain/email-state.ts';
import type { Result } from '../../domain/result.ts';
import type { RunId } from '../../domain/run-id.ts';

export type StateStoreError = { readonly kind: 'not-found'; readonly message: string } | { readonly kind: 'io'; readonly message: string };

export type StateStore = {
  readonly load: (runId: RunId) => Promise<Result<RunState, StateStoreError>>;
  readonly save: (runId: RunId, state: RunState) => Promise<Result<void, StateStoreError>>;
};
