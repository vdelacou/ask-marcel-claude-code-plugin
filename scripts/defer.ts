/*
 * Thin CLI entry: bun scripts/defer.ts add --conversation-id <id> --subject "<s>" --until <YYYY-MM-DD> [--reason "<r>"]
 *                 bun scripts/defer.ts due [--consume] [--json]
 *                 bun scripts/defer.ts list [--json]
 * Gate 1's "not now": a deferred thread is skipped in its run and recorded in
 * data/state/deferrals.json; each later scan surfaces the entries whose date has arrived
 * (`due --consume` removes what it returns, so a resurfaced thread is offered exactly once).
 * Exit 1 on error or crash.
 */
import { buildDeps } from '../src/composition/build-deps.ts';
import { loadConfig } from '../src/composition/config.ts';
import { resolveDataHome } from '../src/composition/data-home.ts';
import { formatError } from '../src/domain/utilities/format-error.ts';
import { createAddDeferral, createDueDeferrals, createListDeferrals } from '../src/use-cases/deferrals-store.ts';

process.chdir(resolveDataHome(process.env, process.cwd()));

const flagValue = (name: string, fallback = ''): string => {
  const index = Bun.argv.indexOf(name);
  return index === -1 ? fallback : (Bun.argv[index + 1] ?? fallback);
};

try {
  const command = Bun.argv[2];
  const deps = buildDeps(loadConfig({ LOG_LEVEL: 'error', ...process.env }));

  if (command === 'add') {
    const conversationId = flagValue('--conversation-id');
    const until = flagValue('--until');
    if (conversationId === '' || Number.isNaN(Date.parse(until))) {
      console.error('defer: --conversation-id and a parseable --until (YYYY-MM-DD) are required');
      process.exit(1);
    }
    const added = await createAddDeferral(deps)({ conversationId, subject: flagValue('--subject', '(no subject)'), until, reason: flagValue('--reason') });
    if (!added.ok) {
      console.error(`defer: ${JSON.stringify(added.error)}`);
      process.exit(1);
    }
    console.log(`defer: deferred until ${until}`);
  } else if (command === 'due' || command === 'list') {
    const result = command === 'due' ? await createDueDeferrals(deps)({ consume: Bun.argv.includes('--consume') }) : await createListDeferrals(deps)();
    if (!result.ok) {
      console.error(`defer: ${JSON.stringify(result.error)}`);
      process.exit(1);
    }
    if (Bun.argv.includes('--json')) {
      console.log(JSON.stringify({ ok: true, deferrals: result.value }));
    } else {
      console.log(`defer: ${result.value.length} ${command === 'due' ? 'due' : 'deferred'} thread(s)`);
      for (const deferral of result.value) {
        const reason = deferral.reason === '' ? '' : ` - ${deferral.reason}`;
        console.log(`  ${deferral.until} ${deferral.subject} (${deferral.conversationId})${reason}`);
      }
    }
  } else {
    console.error(`defer: unknown command '${command ?? ''}' (use add|due|list)`);
    process.exit(1);
  }
} catch (thrown) {
  console.error(`crashed (unexpected): ${formatError(thrown)}`);
  process.exit(1);
}
