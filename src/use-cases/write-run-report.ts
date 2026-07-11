import { asString, isRecord, parseJson } from '../domain/graph-envelopes.ts';
import { computeDrift, parseReportStats, renderRunReport } from '../domain/run-report.ts';
import type { Drift, DriftPoint, RunReportStats } from '../domain/run-report.ts';
import { parseRunId } from '../domain/run-id.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { Clock } from './ports/clock.ts';
import type { FileLister } from './ports/file-lister.ts';
import type { FileReader } from './ports/file-reader.ts';
import type { FileWriter } from './ports/file-writer.ts';
import type { Logger } from './ports/logger.ts';
import type { StateStore } from './ports/state-store.ts';

export type RunReportError =
  | { readonly kind: 'invalid-run-id'; readonly message: string }
  | { readonly kind: 'state-unreadable'; readonly message: string }
  | { readonly kind: 'write-failed'; readonly message: string };

export type RunReportSummary = { readonly path: string; readonly drift: Drift };

export type WriteRunReport = (rawRunId: string, stats: RunReportStats) => Promise<Result<RunReportSummary, RunReportError>>;

type Deps = {
  readonly stateStore: StateStore;
  readonly lister: FileLister;
  readonly reader: FileReader;
  readonly writer: FileWriter;
  readonly clock: Clock;
  readonly logger: Logger;
};

const REPORTS_GLOB = 'data/reports/*.md';

// Prior runs' stats points, newest first. Report filenames embed the run-id, which sorts
// chronologically; unreadable or marker-less files simply contribute nothing.
const historyPoints = async (deps: Deps): Promise<ReadonlyArray<DriftPoint>> => {
  const listed = await deps.lister.list(REPORTS_GLOB);
  if (!listed.ok) return [];
  const points: DriftPoint[] = [];
  for (const path of [...listed.value].sort((a, b) => b.localeCompare(a))) {
    const content = await deps.reader.read(path);
    if (!content.ok) continue;
    const point = parseReportStats(content.value);
    if (point !== undefined) points.push(point);
  }
  return points;
};

const scopeOf = async (deps: Deps, runId: string): Promise<string> => {
  const read = await deps.reader.read(`data/scratch/${runId}/candidates.json`);
  if (!read.ok) return 'unknown';
  const parsed = parseJson(read.value);
  return parsed.ok && isRecord(parsed.value) ? (asString(parsed.value['scope']) ?? 'unknown') : 'unknown';
};

// Phase 5 (SPEC §2, decision 16): the permanent run report. The drift window includes THIS
// run's drafts first, then walks backward through prior reports (SPEC §9 refresh policy).
export const createWriteRunReport =
  (deps: Deps): WriteRunReport =>
  async (rawRunId, stats) => {
    const runId = parseRunId(rawRunId);
    if (!runId.ok) return err({ kind: 'invalid-run-id', message: runId.error });
    const loaded = await deps.stateStore.load(runId.value);
    if (!loaded.ok) return err({ kind: 'state-unreadable', message: loaded.error.message });
    const current: DriftPoint = { drafts: stats.drafted + stats.updated, edited: stats.editedOrRejected };
    const drift = computeDrift([current, ...(await historyPoints(deps))]);
    const scope = await scopeOf(deps, runId.value);
    const path = `data/reports/${runId.value}.md`;
    const report = renderRunReport({ runId: runId.value, todayIso: deps.clock.todayIso(), scope, run: loaded.value, stats, drift });
    const written = await deps.writer.write(path, report);
    if (!written.ok) return err({ kind: 'write-failed', message: written.error.message });
    deps.logger.info('run-report-written', { runId: runId.value, path, driftAlert: drift.alert });
    return ok({ path, drift });
  };
