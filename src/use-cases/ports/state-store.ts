import type { RunFile } from '../../domain/email-state.ts';
import type { Result } from '../../domain/result.ts';
import type { RunId } from '../../domain/run-id.ts';

export type StateStoreError = { readonly kind: 'not-found'; readonly message: string } | { readonly kind: 'io'; readonly message: string };

export type StateStore = {
  readonly load: (runId: RunId) => Promise<Result<RunFile, StateStoreError>>;
  readonly save: (runId: RunId, state: RunFile) => Promise<Result<void, StateStoreError>>;
};
