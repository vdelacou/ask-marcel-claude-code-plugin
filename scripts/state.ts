/*
 * Thin CLI entry: bun scripts/state.ts <runId> show
 *                 bun scripts/state.ts <runId> advance <emailId> <toState>
 *                 bun scripts/state.ts <runId> advance-run <toPhase>
 *                 bun scripts/state.ts <runId> resume
 *                 bun scripts/state.ts <runId> register <emailId>
 * Inspect or advance a run's state machine (SPEC.md §2). Emails move only inside the
 * context_loaded window; `advance-run` walks init → context_loaded → jargon_drained →
 * user_md_reviewed → reindexed → wrapped under the domain's guards (wrap needs every email
 * done|skipped and an empty KB queue); `resume` lifts a pre-research run to interactive.
 * Every transition is validated by the domain - illegal moves are refused. Exit 1 on error.
 */
import { buildDeps } from '../src/composition/build-deps.ts';
import { loadConfig } from '../src/composition/config.ts';
import { isEmailState, isRunPhase } from '../src/domain/email-state.ts';
import { parseRunId } from '../src/domain/run-id.ts';
import { formatError } from '../src/domain/utilities/format-error.ts';
import { createAdvanceEmailState } from '../src/use-cases/advance-email-state.ts';
import { createAdvanceRunPhase, createResumeRun } from '../src/use-cases/advance-run-phase.ts';
import { createRegisterEmailState } from '../src/use-cases/register-email.ts';
import { resolveDataHome } from '../src/composition/data-home.ts';

process.chdir(resolveDataHome(process.env, process.cwd()));

const usage = (): never => {
  console.error('usage: bun scripts/state.ts <runId> show | advance <emailId> <toState> | advance-run <toPhase> | resume | register <emailId>');
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
  } else if (action === 'advance-run' && isRunPhase(emailId)) {
    const result = await createAdvanceRunPhase(deps)(runId, emailId);
    console.log(JSON.stringify(result.ok ? { ok: true, phase: result.value } : { ok: false, error: result.error }));
    if (!result.ok) process.exit(1);
  } else if (action === 'resume') {
    const result = await createResumeRun(deps)(runId);
    console.log(JSON.stringify(result.ok ? { ok: true, mode: result.value } : { ok: false, error: result.error }));
    if (!result.ok) process.exit(1);
  } else if (action === 'register' && emailId !== undefined) {
    const result = await createRegisterEmailState(deps)(runId, emailId);
    console.log(JSON.stringify(result.ok ? { ok: true, state: result.value } : { ok: false, error: result.error }));
    if (!result.ok) process.exit(1);
  } else {
    usage();
  }
} catch (thrown) {
  console.error(`crashed (unexpected): ${formatError(thrown)}`);
  process.exit(1);
}
