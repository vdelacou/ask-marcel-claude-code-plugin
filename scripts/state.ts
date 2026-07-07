/*
 * Thin CLI entry: bun scripts/state.ts <runId> show
 *                 bun scripts/state.ts <runId> advance <emailId> <toState>
 * Inspect or advance a run's state machine (SPEC.md §2). Every transition is
 * validated by the domain - illegal moves are refused. Exit 1 on error.
 */
import { buildDeps } from '../src/composition/build-deps.ts';
import { loadConfig } from '../src/composition/config.ts';
import { isEmailState } from '../src/domain/email-state.ts';
import { parseRunId } from '../src/domain/run-id.ts';
import { formatError } from '../src/domain/utilities/format-error.ts';
import { createAdvanceEmailState } from '../src/use-cases/advance-email-state.ts';
import { resolveDataHome } from '../src/composition/data-home.ts';

process.chdir(resolveDataHome(process.env, `${import.meta.dir}/..`));

const usage = (): never => {
  console.error('usage: bun scripts/state.ts <runId> show | advance <emailId> <toState>');
  process.exit(1);
};

try {
  const [runId, action, emailId, toState] = Bun.argv.slice(2);
  if (runId === undefined || action === undefined) usage();
  const deps = buildDeps(loadConfig({ LOG_LEVEL: 'error', ...process.env }));

  if (action === 'show') {
    const parsed = parseRunId(runId);
    if (!parsed.ok) {
      console.error(`state: ${parsed.error}`);
      process.exit(1);
    }
    const loaded = await deps.stateStore.load(parsed.value);
    console.log(JSON.stringify(loaded.ok ? { ok: true, state: loaded.value } : { ok: false, error: loaded.error }));
    if (!loaded.ok) process.exit(1);
  } else if (action === 'advance' && emailId !== undefined && isEmailState(toState)) {
    const result = await createAdvanceEmailState(deps)(runId, emailId, toState);
    console.log(JSON.stringify(result.ok ? { ok: true, state: result.value } : { ok: false, error: result.error }));
    if (!result.ok) process.exit(1);
  } else {
    usage();
  }
} catch (thrown) {
  console.error(`crashed (unexpected): ${formatError(thrown)}`);
  process.exit(1);
}
