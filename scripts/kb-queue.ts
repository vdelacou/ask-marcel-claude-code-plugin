/*
 * Thin CLI entry:
 *   bun scripts/kb-queue.ts append --run-id <id> --candidate '<json>'
 *   bun scripts/kb-queue.ts drain  --run-id <id> [--json]
 * SPEC.md §8 KB queue: candidates (facts / jargon) discovered during research are queued per run,
 * drained in one batch to kb-curator at wrap-up. A `--candidate` is one KbCandidate JSON object.
 * Exit 1 on error or crash.
 */
import { parseQueue } from '../src/domain/kb-queue.ts';
import { parseRunId } from '../src/domain/run-id.ts';
import { formatError } from '../src/domain/utilities/format-error.ts';
import { buildDeps } from '../src/composition/build-deps.ts';
import { loadConfig } from '../src/composition/config.ts';
import { createAppendKbCandidate, createDrainKbQueue } from '../src/use-cases/kb-queue-store.ts';
import { resolveDataHome } from '../src/composition/data-home.ts';

process.chdir(resolveDataHome(process.env, `${import.meta.dir}/..`));

const flagValue = (name: string, fallback = ''): string => {
  const index = Bun.argv.indexOf(name);
  return index === -1 ? fallback : (Bun.argv[index + 1] ?? fallback);
};

try {
  const command = Bun.argv[2];
  const runId = parseRunId(flagValue('--run-id'));
  if (!runId.ok) {
    console.error(`kb-queue: invalid --run-id (${runId.error})`);
    process.exit(1);
  }
  const deps = buildDeps(loadConfig({ LOG_LEVEL: 'error', ...process.env }));

  if (command === 'append') {
    // Reuse the domain validator: a valid single-line queue yields exactly one candidate.
    const candidates = parseQueue(flagValue('--candidate'));
    if (candidates.length !== 1) {
      console.error('kb-queue: --candidate must be one valid KbCandidate JSON object (fact or jargon)');
      process.exit(1);
    }
    const appended = await createAppendKbCandidate(deps)(runId.value, candidates[0]);
    if (!appended.ok) {
      console.error(`kb-queue: ${JSON.stringify(appended.error)}`);
      process.exit(1);
    }
    console.log('kb-queue: candidate appended');
  } else if (command === 'drain') {
    const drained = await createDrainKbQueue(deps)(runId.value);
    if (!drained.ok) {
      console.error(`kb-queue: ${JSON.stringify(drained.error)}`);
      process.exit(1);
    }
    console.log(Bun.argv.includes('--json') ? JSON.stringify({ ok: true, candidates: drained.value }) : `kb-queue: ${drained.value.length} candidate(s) queued`);
  } else {
    console.error(`kb-queue: unknown command '${command ?? ''}' (use append|drain)`);
    process.exit(1);
  }
} catch (thrown) {
  console.error(`crashed (unexpected): ${formatError(thrown)}`);
  process.exit(1);
}
