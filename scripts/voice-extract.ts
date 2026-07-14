/*
 * Thin CLI entry: bun scripts/voice-extract.ts [--keep N] [--json]
 * Build the voice corpus (SPEC.md §9): the last N substantive messages the
 * user wrote, from ALL folders (from:me KQL search - not an OData $filter, which
 * Graph rejects as InefficientFilter), quoted chains and signatures
 * stripped, bucketed upward/peers/external/broadcast. Writes
 * data/scratch/voice-<stamp>/corpus.json. Exit 1 on error or crash.
 */
import { buildDeps } from '../src/composition/build-deps.ts';
import { loadConfig } from '../src/composition/config.ts';
import { extractCurrentUser, extractManager } from '../src/domain/graph-envelopes.ts';
import { formatError } from '../src/domain/utilities/format-error.ts';
import { createExtractVoiceCorpus } from '../src/use-cases/extract-voice-corpus.ts';
import type { Office } from '../src/use-cases/ports/office.ts';
import { resolveDataHome } from '../src/composition/data-home.ts';

process.chdir(resolveDataHome(process.env, process.cwd()));

const flagValue = (name: string, fallback: string): string => {
  const index = Bun.argv.indexOf(name);
  return index === -1 ? fallback : (Bun.argv[index + 1] ?? fallback);
};

// --help must NOT reach Microsoft 365: print usage and exit before any Graph call (previously it
// fell through and re-ran the whole extract, erroring instead of helping).
if (Bun.argv.includes('--help') || Bun.argv.includes('-h')) {
  console.log('usage: bun scripts/voice-extract.ts [--job-title "<title-prefix>"] [--keep N] [--json]');
  console.log('  Build the voice corpus (SPEC §9): the last N substantive own-bodies sourced by a');
  console.log('  from:me KQL search across ALL folders, quoted chains + signatures stripped, bucketed.');
  console.log('  --job-title  a sign-off title prefix to strip from bodies (optional)');
  console.log('  --keep       how many substantive messages to keep (default from config)');
  console.log('  --json       print a one-line result envelope');
  process.exit(0);
}

const fetchData = async (office: Office, command: string): Promise<unknown> => {
  const run = await office.execute(command, {});
  return run.ok ? run.value : undefined;
};

try {
  const config = loadConfig({ LOG_LEVEL: 'error', ...process.env });
  const deps = buildDeps(config);
  const me = extractCurrentUser(await fetchData(deps.office, 'get-current-user'));
  if (!me.ok) {
    console.error(`voice-extract: cannot resolve identity: ${me.error}`);
    process.exit(1);
  }
  const manager = extractManager(await fetchData(deps.office, 'get-my-manager'));
  const jobTitle = flagValue('--job-title', '');
  const result = await createExtractVoiceCorpus(deps)({
    me: { displayName: me.value.displayName, email: me.value.email, jobTitle },
    org: { ownDomains: [me.value.domain], managerEmails: manager === undefined ? [] : manager.emails },
    fetchTop: config.voice.fetchTop,
    keep: Number(flagValue('--keep', String(config.voice.keep))),
  });
  if (Bun.argv.includes('--json')) {
    console.log(JSON.stringify(result.ok ? { ok: true, ...result.value } : { ok: false, error: result.error }));
  } else if (result.ok) {
    const { path, kept, scanned, byBucket } = result.value;
    console.log(`voice-extract: ${kept} substantive messages kept (of ${scanned} scanned) -> ${path}`);
    console.log(`  buckets: ${JSON.stringify(byBucket)}`);
  } else {
    console.error(`voice-extract: ${JSON.stringify(result.error)}`);
  }
  if (!result.ok) process.exit(1);
} catch (thrown) {
  console.error(`crashed (unexpected): ${formatError(thrown)}`);
  process.exit(1);
}
