/*
 * Thin CLI entry: bun scripts/waiting-on.ts [--days N] [--top N] [--json]
 * "What am I waiting on?" - threads across the whole mailbox where the LAST message is the
 * user's and silence has lasted at least --days (default from config: 3). Read-only: it lists;
 * whether to nudge stays the user's decision. Exit 1 on error or crash.
 */
import { buildDeps } from '../src/composition/build-deps.ts';
import { loadConfig } from '../src/composition/config.ts';
import { resolveDataHome } from '../src/composition/data-home.ts';
import { formatError } from '../src/domain/utilities/format-error.ts';
import { createListWaitingOn } from '../src/use-cases/list-waiting-on.ts';

process.chdir(resolveDataHome(process.env, process.cwd()));

const flagValue = (name: string, fallback: string): string => {
  const index = Bun.argv.indexOf(name);
  return index === -1 ? fallback : (Bun.argv[index + 1] ?? fallback);
};

try {
  const config = loadConfig({ LOG_LEVEL: 'error', ...process.env });
  const deps = buildDeps(config);
  const result = await createListWaitingOn(deps)({
    minAgeDays: Number(flagValue('--days', String(config.followUps.minAgeDays))),
    fetchTop: Number(flagValue('--top', String(config.followUps.fetchTop))),
  });
  if (Bun.argv.includes('--json')) {
    console.log(JSON.stringify(result.ok ? { ok: true, waiting: result.value } : { ok: false, error: result.error }));
  } else if (result.ok) {
    console.log(`waiting-on: ${result.value.length} thread(s) with your last word standing`);
    for (const thread of result.value) console.log(`  ${thread.ageDays}d ${thread.subject} -> ${thread.to.join(', ')} (${thread.conversationId})`);
  } else {
    console.error(`waiting-on: ${JSON.stringify(result.error)}`);
  }
  if (!result.ok) process.exit(1);
} catch (thrown) {
  console.error(`crashed (unexpected): ${formatError(thrown)}`);
  process.exit(1);
}
