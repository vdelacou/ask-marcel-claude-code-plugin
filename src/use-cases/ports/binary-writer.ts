import type { Result } from '../../domain/result.ts';
import type { WriteError } from './file-writer.ts';

// Writes raw bytes (decoded image / attachment content) into the bundle. Separate from the
// string FileWriter (ISP): only the bundle's binary artifacts need it. Shares WriteError.
export type BinaryWriter = {
  readonly write: (path: string, bytes: Uint8Array) => Promise<Result<void, WriteError>>;
};
