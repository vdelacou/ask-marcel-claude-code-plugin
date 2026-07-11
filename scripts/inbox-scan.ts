/*
 * Thin CLI entry: bun scripts/inbox-scan.ts [--scope unread|all|since-watermark] [--cap N]
 *                     [--mode interactive|pre-research] [--json]
 * Phase 1 of inbox-zero (SPEC.md §2): list the inbox, apply the rule-based
 * drops, mint a run (stamped with its mode), initialize its state machine at
 * phase init, write candidates.json, and sweep scratch dirs past retention.
 * --scope since-watermark reads data/state/inbox-watermark.json (advanced at
 * wrap-up by scripts/watermark.ts) and falls back to unread when absent.
 * Optional blocklist: data/profile/blocked-senders.txt (one domain or address
 * per line, # comments). Exit 1 on error or crash.
 */
import { buildDeps } from '../src/composition/build-deps.ts';
import { loadConfig } from '../src/composition/config.ts';
import { formatError } from '../src/domain/utilities/format-error.ts';
import { parseWatermark, WATERMARK_PATH } from '../src/domain/watermark.ts';
import { createScanInbox } from '../src/use-cases/scan-inbox.ts';
import type { ScanScope } from '../src/use-cases/scan-inbox.ts';
import { createSweepScratch } from '../src/use-cases/sweep-scratch.ts';
import { resolveDataHome } from '../src/composition/data-home.ts';

process.chdir(resolveDataHome(process.env, process.cwd()));

const flagValue = (name: string, fallback: string): string => {
  const index = Bun.argv.indexOf(name);
  return index === -1 ? fallback : (Bun.argv[index + 1] ?? fallback);
};

try {
  const scopeRaw = flagValue('--scope', 'unread');
  if (scopeRaw !== 'unread' && scopeRaw !== 'all' && scopeRaw !== 'since-watermark') {
    console.error(`inbox-scan: unknown scope '${scopeRaw}' (use unread|all|since-watermark)`);
    process.exit(1);
  }
  const modeRaw = flagValue('--mode', 'interactive');
  if (modeRaw !== 'interactive' && modeRaw !== 'pre-research') {
    console.error(`inbox-scan: unknown mode '${modeRaw}' (use interactive|pre-research)`);
    process.exit(1);
  }
  const config = loadConfig({ LOG_LEVEL: 'error', ...process.env });
  const cap = Number(flagValue('--cap', String(config.scan.cap)));
  const deps = buildDeps(config);

  // since-watermark resolves here: a stored watermark scopes the scan to mail after it; no
  // watermark yet (first run) falls back to unread, and says so — never silently.
  let scope: ScanScope = scopeRaw === 'all' ? { kind: 'all' } : { kind: 'unread' };
  let scopeNote = '';
  if (scopeRaw === 'since-watermark') {
    const stored = await deps.reader.read(WATERMARK_PATH);
    const iso = stored.ok ? parseWatermark(stored.value) : undefined;
    if (iso === undefined) scopeNote = 'no watermark yet - fell back to unread';
    else scope = { kind: 'since', iso };
  }

  // Every scan sweeps run dirs past retention first (SPEC §1: 7-day scratch retention).
  const sweep = await createSweepScratch(deps)(config.scratch.retentionDays);
  const swept = sweep.ok ? sweep.value.swept : [];
  if (!sweep.ok) console.error(`inbox-scan: scratch sweep failed (continuing): ${JSON.stringify(sweep.error)}`);

  const blocklist = await deps.reader.read('data/profile/blocked-senders.txt');
  const blocked = blocklist.ok
    ? blocklist.value
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'))
    : [];
  const result = await createScanInbox(deps)({ scope, cap, blocked, mode: modeRaw });
  if (Bun.argv.includes('--json')) {
    console.log(JSON.stringify(result.ok ? { ok: true, ...result.value, swept: swept.length, ...(scopeNote === '' ? {} : { scopeNote }) } : { ok: false, error: result.error }));
  } else if (result.ok) {
    const { runId, kept, dropped, capTruncated } = result.value;
    console.log(`inbox-scan: ${runId} - ${kept.length} kept, ${dropped.length} dropped (scope: ${scopeRaw}, mode: ${modeRaw})`);
    if (scopeNote !== '') console.log(`  ! ${scopeNote}`);
    for (const message of kept) console.log(`  + [${message.id.slice(0, 8)}…] ${message.fromName} - ${message.subject}`);
    for (const drop of dropped) console.log(`  - ${drop.from} - ${drop.subject} (${drop.reason})`);
    if (capTruncated) console.log(`  ! cap truncated at ${cap}: the page was full, so older mail exists beyond it — raise --cap or rerun --scope all to surface it`);
    if (swept.length > 0) console.log(`  ~ swept ${swept.length} scratch run dir(s) past ${config.scratch.retentionDays}-day retention`);
  } else {
    console.error(`inbox-scan: ${JSON.stringify(result.error)}`);
  }
  if (!result.ok) process.exit(1);
} catch (thrown) {
  console.error(`crashed (unexpected): ${formatError(thrown)}`);
  process.exit(1);
}
