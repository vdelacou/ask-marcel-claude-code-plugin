import type { EmailState, RunFile } from '../domain/email-state.ts';
import { parseRunId } from '../domain/run-id.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { FileLister, ListError } from './ports/file-lister.ts';
import type { Logger } from './ports/logger.ts';
import type { StateStore } from './ports/state-store.ts';

// A session that died mid-run leaves a resume-safe state file behind; this surfaces every
// run that has not wrapped, newest first, so inbox-zero offers "resume" instead of a blind
// re-scan. Corrupt state files are counted, never fatal - the scan must stay possible.
export type OpenRun = {
  readonly runId: string;
  readonly mode: RunFile['mode'];
  readonly phase: RunFile['phase'];
  readonly emails: Readonly<Partial<Record<EmailState, number>>>;
};

export type ListRunsSummary = { readonly open: ReadonlyArray<OpenRun>; readonly unreadable: number };

export type ListRuns = () => Promise<Result<ListRunsSummary, ListError>>;

type Deps = { readonly lister: FileLister; readonly stateStore: StateStore; readonly logger: Logger };

// data/scratch/run-20260713-060000/state.json -> run-20260713-060000, both separators.
const runIdSegment = (stateFilePath: string): string => {
  const normalized = stateFilePath.replaceAll('\\', '/');
  const segments = normalized.split('/');
  return segments[segments.length - 2] ?? '';
};

const emailCounts = (run: RunFile): Readonly<Partial<Record<EmailState, number>>> => {
  const counts: Partial<Record<EmailState, number>> = {};
  for (const state of Object.values(run.emails)) {
    if (state !== undefined) counts[state] = (counts[state] ?? 0) + 1;
  }
  return counts;
};

export const createListRuns =
  (deps: Deps): ListRuns =>
  async () => {
    const listed = await deps.lister.list('data/scratch/run-*/state.json');
    if (!listed.ok) return err(listed.error);
    const open: OpenRun[] = [];
    let unreadable = 0;
    for (const path of listed.value) {
      const runId = parseRunId(runIdSegment(path));
      if (!runId.ok) {
        unreadable += 1;
        continue;
      }
      const loaded = await deps.stateStore.load(runId.value);
      if (!loaded.ok) {
        unreadable += 1;
        continue;
      }
      if (loaded.value.phase === 'wrapped') continue;
      open.push({ runId: runId.value, mode: loaded.value.mode, phase: loaded.value.phase, emails: emailCounts(loaded.value) });
    }
    // run ids embed their timestamp, so a code-point sort IS newest-first when reversed
    open.sort((a, b) => (a.runId < b.runId ? 1 : -1));
    deps.logger.info('runs-listed', { open: open.length, unreadable });
    return ok({ open, unreadable });
  };
