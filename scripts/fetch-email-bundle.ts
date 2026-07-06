/*
 * Thin CLI entry: bun scripts/fetch-email-bundle.ts --run-id <id> --email-id <id> --conversation-id <id> [--json]
 * Phase 3 (SPEC.md §7): assemble the research bundle for one email - the whole thread as markdown,
 * every attachment (docs to markdown, images to bytes), and resolved SharePoint docs - under
 * data/scratch/<run>/<email>/bundle/ with a manifest. Exit 1 on error or crash.
 */
import { buildDeps } from '../src/composition/build-deps.ts';
import { loadConfig } from '../src/composition/config.ts';
import { parseRunId } from '../src/domain/run-id.ts';
import { formatError } from '../src/domain/utilities/format-error.ts';
import { createFetchEmailBundle } from '../src/use-cases/fetch-email-bundle.ts';

const flagValue = (name: string, fallback = ''): string => {
  const index = Bun.argv.indexOf(name);
  return index === -1 ? fallback : (Bun.argv[index + 1] ?? fallback);
};

try {
  const runId = parseRunId(flagValue('--run-id'));
  const emailId = flagValue('--email-id');
  const conversationId = flagValue('--conversation-id');
  if (!runId.ok) {
    console.error(`fetch-email-bundle: invalid --run-id (${runId.error})`);
    process.exit(1);
  }
  if (emailId === '' || conversationId === '') {
    console.error('fetch-email-bundle: --email-id and --conversation-id are required');
    process.exit(1);
  }
  const deps = buildDeps(loadConfig({ LOG_LEVEL: 'error', ...process.env }));
  const result = await createFetchEmailBundle(deps)({ runId: runId.value, emailId, conversationId });
  if (Bun.argv.includes('--json')) {
    console.log(JSON.stringify(result.ok ? { ok: true, ...result.value } : { ok: false, error: result.error }));
  } else if (result.ok) {
    console.log(`fetch-email-bundle: ${result.value.messageCount} messages bundled for ${emailId} (attachments: ${result.value.threadHasAttachments})`);
  } else {
    console.error(`fetch-email-bundle: ${JSON.stringify(result.error)}`);
  }
  if (!result.ok) process.exit(1);
} catch (thrown) {
  console.error(`crashed (unexpected): ${formatError(thrown)}`);
  process.exit(1);
}
