/*
 * Thin CLI entry: bun scripts/search-exec.ts --query "<q>" [--backends kb,mail,sharepoint] [--json]
 * SPEC.md §6 search module (one round): fan out the query across the requested backends in
 * parallel and print ONE merged, deduped, source-tagged hit list. The confidence rubric and
 * multi-round refine loop live in the calling agent, not here. Exit 1 on crash.
 */
import { buildDeps } from '../src/composition/build-deps.ts';
import { loadConfig } from '../src/composition/config.ts';
import { formatError } from '../src/domain/utilities/format-error.ts';
import type { HitSource } from '../src/domain/search-hits.ts';
import { createSearchRound } from '../src/use-cases/search-round.ts';
import { resolveDataHome } from '../src/composition/data-home.ts';

process.chdir(resolveDataHome(process.env, `${import.meta.dir}/..`));

const flagValue = (name: string, fallback = ''): string => {
  const index = Bun.argv.indexOf(name);
  return index === -1 ? fallback : (Bun.argv[index + 1] ?? fallback);
};

const isBackend = (value: string): value is HitSource => value === 'kb' || value === 'mail' || value === 'sharepoint';

try {
  const query = flagValue('--query');
  if (query === '') {
    console.error('search-exec: --query is required');
    process.exit(1);
  }
  const backends = flagValue('--backends', 'kb,mail,sharepoint')
    .split(',')
    .map((backend) => backend.trim())
    .filter(isBackend);
  const deps = buildDeps(loadConfig({ LOG_LEVEL: 'error', ...process.env }));
  const result = await createSearchRound(deps)({ query, backends });
  if (Bun.argv.includes('--json')) {
    console.log(JSON.stringify({ ok: true, ...result }));
  } else {
    console.log(`search-exec: ${result.hits.length} hits, ${result.errors.length} backend errors`);
    for (const hit of result.hits) console.log(`  [${hit.source}] ${hit.title} - ${hit.uri}`);
    for (const backendError of result.errors) console.log(`  ! ${backendError.backend}: ${backendError.message}`);
  }
} catch (thrown) {
  console.error(`crashed (unexpected): ${formatError(thrown)}`);
  process.exit(1);
}
