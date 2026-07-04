import type { Result } from '../../domain/result.ts';

export type WriteError = { readonly kind: 'write-failed'; readonly path: string; readonly message: string };

export type FileWriter = {
  readonly write: (path: string, content: string) => Promise<Result<void, WriteError>>;
};
