import { err, ok } from '../domain/result.ts';
import { formatError } from '../domain/utilities/format-error.ts';
import type { FileReader } from '../use-cases/ports/file-reader.ts';

export const createBunFileReader = (): FileReader => ({
  read: async (path) => {
    try {
      return ok(await Bun.file(path).text());
    } catch (thrown) {
      return err({ kind: 'read-failed', path, message: formatError(thrown) });
    }
  },
});
