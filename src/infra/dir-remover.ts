import { rm } from 'node:fs/promises';

import { err, ok } from '../domain/result.ts';
import { formatError } from '../domain/utilities/format-error.ts';
import type { DirRemover } from '../use-cases/ports/dir-remover.ts';

// Minimal slice of fs.rm's surface (rule 13 test seam): recursive+force directory removal.
export type RmApi = (path: string) => Promise<void>;

export const createDirRemoverFromRm = (rmDir: RmApi): DirRemover => ({
  remove: async (path) => {
    try {
      await rmDir(path);
      return ok(undefined);
    } catch (thrown) {
      return err({ kind: 'remove-failed', path, message: formatError(thrown) });
    }
  },
});

// force:true makes a missing path a no-op (idempotent sweep), matching the port contract.
export const createBunDirRemover = (): DirRemover => createDirRemoverFromRm((path) => rm(path, { recursive: true, force: true }));
