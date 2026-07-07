/*
 * Thin CLI entry: bun scripts/kb-index-gen.ts [--json]
 * kb-gardener Phase 1 (SPEC.md §8): regenerate every folder's index.md under data/kb from its
 * concept pages - derived data, never hand-curated. Exit 1 on error or crash.
 */
import { buildDeps } from '../src/composition/build-deps.ts';
import { loadConfig } from '../src/composition/config.ts';
import { formatError } from '../src/domain/utilities/format-error.ts';
import { createGenKbIndex } from '../src/use-cases/gen-kb-index.ts';
import { resolveDataHome } from '../src/composition/data-home.ts';

process.chdir(resolveDataHome(process.env, process.cwd()));

try {
  const deps = buildDeps(loadConfig({ LOG_LEVEL: 'error', ...process.env }));
  const result = await createGenKbIndex(deps)();
  if (Bun.argv.includes('--json')) {
    console.log(JSON.stringify(result.ok ? { ok: true, ...result.value } : { ok: false, error: result.error }));
  } else if (result.ok) {
    console.log(`kb-index-gen: regenerated ${result.value.folders} folder index files`);
  } else {
    console.error(`kb-index-gen: ${JSON.stringify(result.error)}`);
  }
  if (!result.ok) process.exit(1);
} catch (thrown) {
  console.error(`crashed (unexpected): ${formatError(thrown)}`);
  process.exit(1);
}
