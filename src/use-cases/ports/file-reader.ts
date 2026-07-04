import type { Result } from '../../domain/result.ts';

export type ReadError = { readonly kind: 'read-failed'; readonly path: string; readonly message: string };

export type FileReader = {
  readonly read: (path: string) => Promise<Result<string, ReadError>>;
};
