import { err, ok } from './result.ts';
import type { Result } from './result.ts';

/**
 * Branded per rule 12: a RunId becomes a path segment under data/scratch/,
 * so it crosses a filesystem sink. The factory is the validation checkpoint.
 */
export type RunId = string & { readonly __brand: 'RunId' };

const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;

export const parseRunId = (value: string): Result<RunId, string> => (RUN_ID_PATTERN.test(value) ? ok(value as RunId) : err(`invalid RunId: ${JSON.stringify(value)}`));
