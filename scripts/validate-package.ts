/*
 * Thin CLI entry: bun scripts/validate-package.ts --file <path> [--json]
 * Phase 3 (SPEC.md §2, §10): deterministic shape-check of one email-researcher package -
 * required fields, confidence bounds, citation presence at >=70, exactly three genuinely
 * different strategies, at least one recipient. Exit 0 with ok:true when the package holds;
 * exit 0 with ok:false + precise problems when it does not (the skill retries the researcher
 * with the problems named); exit 1 on a missing file or crash.
 */
import { resolveDataHome } from '../src/composition/data-home.ts';
import { checkResearchPackage } from '../src/domain/research-package.ts';
import { formatError } from '../src/domain/utilities/format-error.ts';

process.chdir(resolveDataHome(process.env, process.cwd()));

const flagValue = (name: string, fallback = ''): string => {
  const index = Bun.argv.indexOf(name);
  return index === -1 ? fallback : (Bun.argv[index + 1] ?? fallback);
};

try {
  const path = flagValue('--file');
  const file = Bun.file(path);
  if (path === '' || !(await file.exists())) {
    console.error(`validate-package: --file is required and must exist (got '${path}')`);
    process.exit(1);
  }
  const { record, problems } = checkResearchPackage(await file.text());
  if (Bun.argv.includes('--json')) {
    console.log(JSON.stringify(problems.length === 0 ? { ok: true, package: record } : { ok: false, problems }));
  } else if (problems.length === 0) {
    console.log('validate-package: the package holds');
  } else {
    console.log(`validate-package: ${problems.length} problem(s)`);
    for (const problem of problems) console.log(`  ! ${problem}`);
  }
} catch (thrown) {
  console.error(`crashed (unexpected): ${formatError(thrown)}`);
  process.exit(1);
}
