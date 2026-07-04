/*
 * Thin CLI entry: bun scripts/kb-seed.ts [--json]
 * Seed the KB with people and orgs from the Microsoft directory (SPEC.md §2
 * Phase 0 step 7). Never overwrites existing pages. Exit 1 on error or crash.
 */
import { buildDeps } from '../src/composition/build-deps.ts';
import { loadConfig } from '../src/composition/config.ts';
import { formatError } from '../src/domain/utilities/format-error.ts';
import { createSeedKb } from '../src/use-cases/seed-kb.ts';

try {
  const config = loadConfig({ LOG_LEVEL: 'error', ...process.env });
  const result = await createSeedKb(buildDeps(config))(config.seed);
  if (Bun.argv.includes('--json')) {
    console.log(JSON.stringify(result.ok ? { ok: true, ...result.value } : { ok: false, error: result.error }));
  } else if (result.ok) {
    const { created, skipped, dropped } = result.value;
    console.log(`kb-seed: ${created.length} created, ${skipped.length} skipped (already present), ${dropped} dropped by cap`);
    for (const path of created) console.log(`  + ${path}`);
  } else {
    console.error(`kb-seed: ${JSON.stringify(result.error)}`);
  }
  if (!result.ok) process.exit(1);
} catch (thrown) {
  console.error(`crashed (unexpected): ${formatError(thrown)}`);
  process.exit(1);
}
