/*
 * Thin CLI entry: bun scripts/inbox-scan.ts [--scope unread|all] [--cap N] [--json]
 * Phase 1 of inbox-zero (SPEC.md §2): list the inbox, apply the rule-based
 * drops, mint a run, initialize its state machine, write candidates.json.
 * Optional blocklist: data/profile/blocked-senders.txt (one domain or address
 * per line, # comments). Exit 1 on error or crash.
 */
import { buildDeps } from '../src/composition/build-deps.ts';
import { loadConfig } from '../src/composition/config.ts';
import { formatError } from '../src/domain/utilities/format-error.ts';
import { createScanInbox } from '../src/use-cases/scan-inbox.ts';
import type { ScanScope } from '../src/use-cases/scan-inbox.ts';
import { resolveDataHome } from '../src/composition/data-home.ts';

process.chdir(resolveDataHome(process.env, process.cwd()));

const flagValue = (name: string, fallback: string): string => {
  const index = Bun.argv.indexOf(name);
  return index === -1 ? fallback : (Bun.argv[index + 1] ?? fallback);
};

try {
  const scopeRaw = flagValue('--scope', 'unread');
  if (scopeRaw !== 'unread' && scopeRaw !== 'all') {
    console.error(`inbox-scan: unknown scope '${scopeRaw}' (use unread|all)`);
    process.exit(1);
  }
  const scope: ScanScope = scopeRaw;
  const cap = Number(flagValue('--cap', '25'));
  const deps = buildDeps(loadConfig({ LOG_LEVEL: 'error', ...process.env }));
  const blocklist = await deps.reader.read('data/profile/blocked-senders.txt');
  const blocked = blocklist.ok
    ? blocklist.value
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'))
    : [];
  const result = await createScanInbox(deps)({ scope, cap, blocked });
  if (Bun.argv.includes('--json')) {
    console.log(JSON.stringify(result.ok ? { ok: true, ...result.value } : { ok: false, error: result.error }));
  } else if (result.ok) {
    const { runId, kept, dropped } = result.value;
    console.log(`inbox-scan: ${runId} - ${kept.length} kept, ${dropped.length} dropped (scope: ${scope})`);
    for (const message of kept) console.log(`  + [${message.id.slice(0, 8)}…] ${message.fromName} - ${message.subject}`);
    for (const drop of dropped) console.log(`  - ${drop.from} - ${drop.subject} (${drop.reason})`);
  } else {
    console.error(`inbox-scan: ${JSON.stringify(result.error)}`);
  }
  if (!result.ok) process.exit(1);
} catch (thrown) {
  console.error(`crashed (unexpected): ${formatError(thrown)}`);
  process.exit(1);
}
