/*
 * Thin CLI entry: bun scripts/kb-init.ts [--json]
 * Create the OKF knowledge-base skeleton under data/kb (SPEC.md §8).
 * Idempotent: an existing KB is never touched. Exit 1 only on write failure or crash.
 */
import { buildDeps } from '../src/composition/build-deps.ts';
import { loadConfig } from '../src/composition/config.ts';
import { formatError } from '../src/domain/utilities/format-error.ts';
import { createInitKb } from '../src/use-cases/init-kb.ts';
import { resolveDataHome } from '../src/composition/data-home.ts';

process.chdir(resolveDataHome(process.env, process.cwd()));

try {
  const deps = buildDeps(loadConfig({ LOG_LEVEL: 'error', ...process.env }));
  const result = await createInitKb(deps)();
  if (Bun.argv.includes('--json')) {
    console.log(JSON.stringify(result.ok ? { ok: true, created: result.value.created } : { ok: false, error: result.error }));
  } else if (result.ok) {
    console.log(result.value.created.length === 0 ? 'kb-init: already initialized, nothing touched' : `kb-init: created\n${result.value.created.join('\n')}`);
  } else {
    console.error(`kb-init: ${result.error.kind} at ${result.error.path}: ${result.error.message}`);
  }
  if (!result.ok) process.exit(1);
} catch (thrown) {
  console.error(`crashed (unexpected): ${formatError(thrown)}`);
  process.exit(1);
}
