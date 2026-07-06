/*
 * Thin CLI entry: bun scripts/read-doc.ts --run-id <id> --email-id <id> --name <name> --drive-id <id> --item-id <id> [--json]
 * SPEC.md §7 read-document: convert a SharePoint / OneDrive item to markdown, and when the
 * conversion is scrambled (scanned image, table soup) fall back to rendering its PDF pages.
 * Writes into the email's bundle/docs/. Exit 1 on error or crash.
 */
import { buildDeps } from '../src/composition/build-deps.ts';
import { loadConfig } from '../src/composition/config.ts';
import { parseRunId } from '../src/domain/run-id.ts';
import { formatError } from '../src/domain/utilities/format-error.ts';
import { createReadDoc } from '../src/use-cases/read-doc.ts';

const flagValue = (name: string, fallback = ''): string => {
  const index = Bun.argv.indexOf(name);
  return index === -1 ? fallback : (Bun.argv[index + 1] ?? fallback);
};

try {
  const runId = parseRunId(flagValue('--run-id'));
  const emailId = flagValue('--email-id');
  const name = flagValue('--name');
  const driveId = flagValue('--drive-id');
  const itemId = flagValue('--item-id');
  if (!runId.ok) {
    console.error(`read-doc: invalid --run-id (${runId.error})`);
    process.exit(1);
  }
  if (emailId === '' || name === '' || driveId === '' || itemId === '') {
    console.error('read-doc: --email-id, --name, --drive-id and --item-id are required');
    process.exit(1);
  }
  const deps = buildDeps(loadConfig({ LOG_LEVEL: 'error', ...process.env }));
  const result = await createReadDoc(deps)({ runId: runId.value, emailId, name, driveId, itemId });
  if (Bun.argv.includes('--json')) {
    console.log(JSON.stringify(result.ok ? { ok: true, ...result.value } : { ok: false, error: result.error }));
  } else if (result.ok) {
    console.log(`read-doc: ${name} -> ${result.value.mode} (${result.value.path}, ${result.value.images} image(s))`);
  } else {
    console.error(`read-doc: ${JSON.stringify(result.error)}`);
  }
  if (!result.ok) process.exit(1);
} catch (thrown) {
  console.error(`crashed (unexpected): ${formatError(thrown)}`);
  process.exit(1);
}
