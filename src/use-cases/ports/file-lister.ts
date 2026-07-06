import type { Result } from '../../domain/result.ts';

export type ListError = { readonly kind: 'list-failed'; readonly message: string };

// Enumerate files by glob (relative to the working directory). Used by the KB gardener to
// walk the pages under data/kb. Returned paths are sorted for deterministic output.
export type FileLister = {
  readonly list: (glob: string) => Promise<Result<ReadonlyArray<string>, ListError>>;
};
