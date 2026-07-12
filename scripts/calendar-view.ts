/*
 * Thin CLI entry: bun scripts/calendar-view.ts --from <iso> --to <iso> [--json]
 * The user's busy list between two instants (list-calendar-view expands recurring series into
 * occurrences). Grounds scheduling-type replies: the caller reads this next to user.md's
 * working hours to propose real slots instead of guessing. Read-only. Exit 1 on error or crash.
 */
import { buildDeps } from '../src/composition/build-deps.ts';
import { loadConfig } from '../src/composition/config.ts';
import { resolveDataHome } from '../src/composition/data-home.ts';
import { formatError } from '../src/domain/utilities/format-error.ts';
import { createViewCalendar } from '../src/use-cases/view-calendar.ts';

process.chdir(resolveDataHome(process.env, process.cwd()));

const flagValue = (name: string, fallback = ''): string => {
  const index = Bun.argv.indexOf(name);
  return index === -1 ? fallback : (Bun.argv[index + 1] ?? fallback);
};

try {
  const deps = buildDeps(loadConfig({ LOG_LEVEL: 'error', ...process.env }));
  const result = await createViewCalendar(deps)({ fromIso: flagValue('--from'), toIso: flagValue('--to') });
  if (Bun.argv.includes('--json')) {
    console.log(JSON.stringify(result.ok ? { ok: true, events: result.value } : { ok: false, error: result.error }));
  } else if (result.ok) {
    console.log(`calendar-view: ${result.value.length} event(s)`);
    for (const event of result.value) console.log(`  ${event.start} .. ${event.end} [${event.showAs}${event.isAllDay ? ', all-day' : ''}] ${event.subject}`);
  } else {
    console.error(`calendar-view: ${JSON.stringify(result.error)}`);
  }
  if (!result.ok) process.exit(1);
} catch (thrown) {
  console.error(`crashed (unexpected): ${formatError(thrown)}`);
  process.exit(1);
}
