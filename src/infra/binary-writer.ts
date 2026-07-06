import { err, ok } from '../domain/result.ts';
import { formatError } from '../domain/utilities/format-error.ts';
import type { BinaryWriter } from '../use-cases/ports/binary-writer.ts';

export const createBunBinaryWriter = (): BinaryWriter => ({
  write: async (path, bytes) => {
    try {
      await Bun.write(path, bytes);
      return ok(undefined);
    } catch (thrown) {
      return err({ kind: 'write-failed', path, message: formatError(thrown) });
    }
  },
});
