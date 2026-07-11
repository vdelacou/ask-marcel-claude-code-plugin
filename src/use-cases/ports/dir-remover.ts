import type { Result } from '../../domain/result.ts';

export type RemoveError = { readonly kind: 'remove-failed'; readonly path: string; readonly message: string };

// Recursively remove one directory (the scratch sweep's only writer). Removing a path that no
// longer exists is a success — the sweep is idempotent.
export type DirRemover = {
  readonly remove: (path: string) => Promise<Result<void, RemoveError>>;
};
