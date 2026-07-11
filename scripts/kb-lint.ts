/*
 * Thin CLI entry: bun scripts/kb-lint.ts [--json]
 * kb-gardener Phase 1 (SPEC.md §8): read every page under data/kb and report OKF-conformance
 * issues (missing frontmatter / required fields, duplicate slugs, broken internal links,
 * stale pages >180 days, orphans). Read-only. Exit 1 on a read failure or crash; exit 0 with
 * the report even when issues are found.
 */
import { buildDeps } from '../src/composition/build-deps.ts';
import { loadConfig } from '../src/composition/config.ts';
import { formatError } from '../src/domain/utilities/format-error.ts';
import { createLintKb } from '../src/use-cases/lint-kb.ts';
import { resolveDataHome } from '../src/composition/data-home.ts';

process.chdir(resolveDataHome(process.env, process.cwd()));

try {
  const deps = buildDeps(loadConfig({ LOG_LEVEL: 'error', ...process.env }));
  const result = await createLintKb(deps)();
  if (Bun.argv.includes('--json')) {
    console.log(JSON.stringify(result.ok ? { ok: true, ...result.value } : { ok: false, error: result.error }));
  } else if (result.ok) {
    console.log(`kb-lint: ${result.value.pagesLinted} pages, ${result.value.issues.length} issue(s)`);
    for (const issue of result.value.issues) console.log(`  [${issue.kind}] ${issue.path} - ${issue.detail}`);
  } else {
    console.error(`kb-lint: ${JSON.stringify(result.error)}`);
  }
  if (!result.ok) process.exit(1);
} catch (thrown) {
  console.error(`crashed (unexpected): ${formatError(thrown)}`);
  process.exit(1);
}
