/*
 * Thin CLI entry: bun scripts/run-report.ts --run-id <id> --stats '<json>' [--json]
 * Phase 5 (SPEC.md §2, decision 16): write the permanent run report to
 * data/reports/<run-id>.md and compute the rolling voice-drift rate (edit/reject over the
 * last 10 drafts, alert above 40% per SPEC §9). --stats carries what only the session knows:
 * {drafted, updated, skippedByUser, skippedByRule, blocked[], editedOrRejected, coverage[], notes}
 * (missing keys default to zero/empty). Exit 1 on error or crash.
 */
import { buildDeps } from '../src/composition/build-deps.ts';
import { loadConfig } from '../src/composition/config.ts';
import { resolveDataHome } from '../src/composition/data-home.ts';
import { parseRunReportStats } from '../src/domain/run-report.ts';
import { formatError } from '../src/domain/utilities/format-error.ts';
import { createWriteRunReport } from '../src/use-cases/write-run-report.ts';

process.chdir(resolveDataHome(process.env, process.cwd()));

const flagValue = (name: string, fallback = ''): string => {
  const index = Bun.argv.indexOf(name);
  return index === -1 ? fallback : (Bun.argv[index + 1] ?? fallback);
};

try {
  let raw: unknown;
  try {
    raw = JSON.parse(flagValue('--stats', '{}'));
  } catch {
    console.error('run-report: --stats is not valid JSON');
    process.exit(1);
  }
  const deps = buildDeps(loadConfig({ LOG_LEVEL: 'error', ...process.env }));
  const result = await createWriteRunReport(deps)(flagValue('--run-id'), parseRunReportStats(raw));
  if (Bun.argv.includes('--json')) {
    console.log(JSON.stringify(result.ok ? { ok: true, ...result.value } : { ok: false, error: result.error }));
  } else if (result.ok) {
    const { path, drift } = result.value;
    console.log(`run-report: wrote ${path}`);
    const alertSuffix = drift.alert ? ' - RECOMMEND voice-profiler refresh' : '';
    const driftText = drift.rate === null ? 'no drafts in window' : `${Math.round(drift.rate * 100)}% over last ${drift.window} draft(s)${alertSuffix}`;
    console.log(`  drift: ${driftText}`);
  } else {
    console.error(`run-report: ${JSON.stringify(result.error)}`);
  }
  if (!result.ok) process.exit(1);
} catch (thrown) {
  console.error(`crashed (unexpected): ${formatError(thrown)}`);
  process.exit(1);
}
