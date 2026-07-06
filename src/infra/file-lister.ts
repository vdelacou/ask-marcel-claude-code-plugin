import { err, ok } from '../domain/result.ts';
import { formatError } from '../domain/utilities/format-error.ts';
import type { FileLister } from '../use-cases/ports/file-lister.ts';

// Minimal slice of Bun.Glob's surface (rule 13 test seam): a glob -> an async stream of paths.
export type ScanApi = (glob: string) => AsyncIterable<string>;

export const createFileListerFromScan = (scan: ScanApi): FileLister => ({
  list: async (glob) => {
    try {
      const paths: string[] = [];
      for await (const path of scan(glob)) paths.push(path);
      return ok([...paths].sort((a, b) => a.localeCompare(b)));
    } catch (thrown) {
      return err({ kind: 'list-failed', message: formatError(thrown) });
    }
  },
});

export const createBunFileLister = (): FileLister => createFileListerFromScan((glob) => new Bun.Glob(glob).scan('.'));
