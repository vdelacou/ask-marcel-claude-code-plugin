import { expiredRunDirs } from '../domain/scratch-retention.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { Clock } from './ports/clock.ts';
import type { DirRemover, RemoveError } from './ports/dir-remover.ts';
import type { FileLister, ListError } from './ports/file-lister.ts';
import type { Logger } from './ports/logger.ts';

export type SweepError = ListError | RemoveError;

export type SweepSummary = { readonly swept: ReadonlyArray<string> };

export type SweepScratch = (retentionDays: number) => Promise<Result<SweepSummary, SweepError>>;

type Deps = { readonly lister: FileLister; readonly remover: DirRemover; readonly clock: Clock; readonly logger: Logger };

// The 7-day scratch retention (SPEC §1), run at every scan so no separate wrap-up chore exists.
// Run dirs are keyed by their state.json (every minted run writes one); a dir without it is not
// a run and is never touched.
export const createSweepScratch =
  (deps: Deps): SweepScratch =>
  async (retentionDays) => {
    const listed = await deps.lister.list('data/scratch/run-*/state.json');
    if (!listed.ok) return err(listed.error);
    const expired = expiredRunDirs(listed.value, deps.clock.todayIso(), retentionDays);
    for (const dir of expired) {
      const removed = await deps.remover.remove(dir);
      if (!removed.ok) return err(removed.error);
    }
    deps.logger.info('scratch-swept', { swept: expired.length });
    return ok({ swept: expired });
  };
