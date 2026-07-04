import { err, ok } from '../domain/result.ts';
import { formatError } from '../domain/utilities/format-error.ts';
import type { FileWriter } from '../use-cases/ports/file-writer.ts';

export const createBunFileWriter = (): FileWriter => ({
  write: async (path, content) => {
    try {
      await Bun.write(path, content);
      return ok(undefined);
    } catch (thrown) {
      return err({ kind: 'write-failed', path, message: formatError(thrown) });
    }
  },
});
