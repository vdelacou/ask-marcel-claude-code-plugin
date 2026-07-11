/*
 * Thin CLI entry: bun scripts/parse-verdicts.ts --file <path> [--json]
 * Phase 2 (SPEC.md §2, §10): the skill bundles every triage-scout reply into one scratch
 * file separated by scissors lines (-----8<-----); this parses each chunk leniently
 * (fences and stray keys tolerated, five keys kept) and names the 0-based position of every
 * garbage chunk so the skill retries exactly that scout. Exit 1 on a missing file or crash.
 */
import { resolveDataHome } from '../src/composition/data-home.ts';
import { parseScoutVerdicts } from '../src/domain/triage-verdict.ts';
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
    console.error(`parse-verdicts: --file is required and must exist (got '${path}')`);
    process.exit(1);
  }
  const { verdicts, garbage } = parseScoutVerdicts(await file.text());
  if (Bun.argv.includes('--json')) {
    console.log(JSON.stringify({ ok: true, verdicts, garbage }));
  } else {
    const positions = garbage.length > 0 ? ` at position(s) ${garbage.join(', ')}` : '';
    console.log(`parse-verdicts: ${verdicts.length} verdict(s), ${garbage.length} garbage chunk(s)${positions}`);
    for (const verdict of verdicts) console.log(`  ${verdict.needs_reply ? '+' : '-'} [${verdict.urgency}] ${verdict.id} - ${verdict.reason}`);
  }
} catch (thrown) {
  console.error(`crashed (unexpected): ${formatError(thrown)}`);
  process.exit(1);
}
