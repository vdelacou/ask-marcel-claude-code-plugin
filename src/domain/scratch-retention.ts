// Scratch retention (SPEC §1/§2: bundles and run state keep 7 days). Age comes from the run-id
// embedded in the directory name (run-YYYYMMDD-HHMMSS) — deterministic, no filesystem mtime.
export const SCRATCH_RETENTION_DAYS = 7;

const DAY_MS = 86_400_000;

// data/scratch/run-20260704-135959/state.json -> its run dir, splitting on both separators
// so Windows backslash listings resolve too.
const runDirOf = (stateFilePath: string): string => {
  const slash = Math.max(stateFilePath.lastIndexOf('/'), stateFilePath.lastIndexOf('\\'));
  return slash === -1 ? '' : stateFilePath.slice(0, slash);
};

const runDateOf = (runDir: string): number => {
  const slash = Math.max(runDir.lastIndexOf('/'), runDir.lastIndexOf('\\'));
  const name = runDir.slice(slash + 1);
  // The rendered date parses or it does not - Date.parse is the only guard a short or
  // misshapen name needs; the prefix check keeps date-LOOKING non-run dirs alive.
  if (!name.startsWith('run-')) return Number.NaN;
  const digits = name.slice(4, 12);
  return Date.parse(`${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`);
};

/** Run dirs older than the retention window, from their state.json paths. Unparseable names are kept (never sweep what we cannot date). */
export const expiredRunDirs = (stateFilePaths: ReadonlyArray<string>, todayIso: string, retentionDays: number): ReadonlyArray<string> => {
  const today = Date.parse(todayIso);
  if (Number.isNaN(today)) return [];
  return stateFilePaths.map(runDirOf).filter((dir) => {
    const born = runDateOf(dir);
    return !Number.isNaN(born) && (today - born) / DAY_MS > retentionDays;
  });
};
