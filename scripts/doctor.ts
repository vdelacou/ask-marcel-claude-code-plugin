/*
 * Thin CLI entry: bun scripts/doctor.ts [--json]
 * Prints the plugin setup report (SPEC.md §2 Phase 0). Exit 0 with a report
 * even when checks fail; exit 1 only on an unexpected crash.
 */
import { buildDeps } from '../src/composition/build-deps.ts';
import { loadConfig } from '../src/composition/config.ts';
import { unwrap } from '../src/domain/result.ts';
import { formatError } from '../src/domain/utilities/format-error.ts';
import { renderDoctorJson, renderDoctorText } from '../src/presenter/doctor-report.ts';
import { createRunDoctor } from '../src/use-cases/run-doctor.ts';
import { resolveDataHome } from '../src/composition/data-home.ts';

process.chdir(resolveDataHome(process.env, `${import.meta.dir}/..`));

try {
  // Default the logger to error-level so the report (and especially --json,
  // which skills parse) is the only stdout; an explicit LOG_LEVEL still wins.
  const deps = buildDeps(loadConfig({ LOG_LEVEL: 'error', ...process.env }));
  const report = unwrap(await createRunDoctor(deps)());
  console.log(Bun.argv.includes('--json') ? renderDoctorJson(report) : renderDoctorText(report));
} catch (thrown) {
  console.error(`crashed (unexpected): ${formatError(thrown)}`);
  process.exit(1);
}
