/*
 * Thin CLI entry: bun scripts/watermark.ts show
 *                 bun scripts/watermark.ts advance --run-id <id>
 * The inbox delta watermark (SPEC.md §2 Phases 1+5): `advance` sets it to the run's scannedAt
 * (from its candidates.json) at wrap-up; the next `inbox-scan --scope since-watermark` starts
 * exactly there. Exit 1 on error or crash.
 */
import { buildDeps } from '../src/composition/build-deps.ts';
import { loadConfig } from '../src/composition/config.ts';
import { resolveDataHome } from '../src/composition/data-home.ts';
import { formatError } from '../src/domain/utilities/format-error.ts';
import { parseWatermark, WATERMARK_PATH } from '../src/domain/watermark.ts';
import { createAdvanceWatermark } from '../src/use-cases/advance-watermark.ts';

process.chdir(resolveDataHome(process.env, process.cwd()));

const flagValue = (name: string, fallback = ''): string => {
  const index = Bun.argv.indexOf(name);
  return index === -1 ? fallback : (Bun.argv[index + 1] ?? fallback);
};

try {
  const command = Bun.argv[2];
  const deps = buildDeps(loadConfig({ LOG_LEVEL: 'error', ...process.env }));

  if (command === 'show') {
    const read = await deps.reader.read(WATERMARK_PATH);
    const watermark = read.ok ? parseWatermark(read.value) : undefined;
    console.log(JSON.stringify({ ok: true, watermark: watermark ?? null }));
  } else if (command === 'advance') {
    const result = await createAdvanceWatermark(deps)(flagValue('--run-id'));
    console.log(JSON.stringify(result.ok ? { ok: true, watermark: result.value } : { ok: false, error: result.error }));
    if (!result.ok) process.exit(1);
  } else {
    console.error(`watermark: unknown command '${command ?? ''}' (use show|advance --run-id <id>)`);
    process.exit(1);
  }
} catch (thrown) {
  console.error(`crashed (unexpected): ${formatError(thrown)}`);
  process.exit(1);
}
