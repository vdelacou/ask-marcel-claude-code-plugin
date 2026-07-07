/*
 * Thin CLI entry: bun scripts/capture-signature.ts [--json]
 * SPEC.md §13 signature capture: lift the id="Signature" block from a recent sent email, inline its
 * logo images as base64, and write data/profile/draft-template.html (the drafting step wraps replies
 * in it). Read-only on the mailbox; the only write is the template. Exit 1 on error or crash.
 */
import { buildDeps } from '../src/composition/build-deps.ts';
import { loadConfig } from '../src/composition/config.ts';
import { resolveDataHome } from '../src/composition/data-home.ts';
import { formatError } from '../src/domain/utilities/format-error.ts';
import { createCaptureSignature } from '../src/use-cases/capture-signature.ts';

process.chdir(resolveDataHome(process.env, process.cwd()));

try {
  const deps = buildDeps(loadConfig({ LOG_LEVEL: 'error', ...process.env }));
  const result = await createCaptureSignature(deps)();
  if (Bun.argv.includes('--json')) {
    console.log(JSON.stringify(result.ok ? { ok: true, ...result.value } : { ok: false, error: result.error }));
  } else if (result.ok) {
    console.log(`capture-signature: wrote ${result.value.path} with ${result.value.imageCount} inlined image(s)`);
  } else {
    console.error(`capture-signature: ${JSON.stringify(result.error)}`);
  }
  if (!result.ok) process.exit(1);
} catch (thrown) {
  console.error(`crashed (unexpected): ${formatError(thrown)}`);
  process.exit(1);
}
