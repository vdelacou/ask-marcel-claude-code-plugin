/*
 * Thin CLI entry: bun scripts/draft-apply.ts --run-id <id> --email-id <id> --conversation-id <id> \
 *   --reply-to <messageId> --subject "<subj>" --body-file <path> [--json]
 * SPEC.md §2 Phase 4 step 8: create or update the UNSENT reply draft for an approved email. This IS
 * the code approval gate (decision 19) - it refuses unless the email's state is user_approved, then
 * advances to draft_created. Never sends. Body is read from a file (HTML, signature included).
 * Exit 1 on error or crash.
 */
import { buildDeps } from '../src/composition/build-deps.ts';
import { loadConfig } from '../src/composition/config.ts';
import { parseRunId } from '../src/domain/run-id.ts';
import { formatError } from '../src/domain/utilities/format-error.ts';
import { createDraftApply } from '../src/use-cases/draft-apply.ts';
import { resolveDataHome } from '../src/composition/data-home.ts';

process.chdir(resolveDataHome(process.env, `${import.meta.dir}/..`));

const flagValue = (name: string, fallback = ''): string => {
  const index = Bun.argv.indexOf(name);
  return index === -1 ? fallback : (Bun.argv[index + 1] ?? fallback);
};

try {
  const runId = parseRunId(flagValue('--run-id'));
  const emailId = flagValue('--email-id');
  const conversationId = flagValue('--conversation-id');
  const replyToMessageId = flagValue('--reply-to');
  const subject = flagValue('--subject');
  const bodyFile = flagValue('--body-file');
  if (!runId.ok) {
    console.error(`draft-apply: invalid --run-id (${runId.error})`);
    process.exit(1);
  }
  if (emailId === '' || conversationId === '' || replyToMessageId === '' || bodyFile === '') {
    console.error('draft-apply: --email-id, --conversation-id, --reply-to and --body-file are required');
    process.exit(1);
  }
  const deps = buildDeps(loadConfig({ LOG_LEVEL: 'error', ...process.env }));
  const bodyRead = await deps.reader.read(bodyFile);
  if (!bodyRead.ok) {
    console.error(`draft-apply: cannot read --body-file (${bodyRead.error.message})`);
    process.exit(1);
  }
  const result = await createDraftApply(deps)({ runId: runId.value, emailId, conversationId, replyToMessageId, subject, body: bodyRead.value });
  if (Bun.argv.includes('--json')) {
    console.log(JSON.stringify(result.ok ? { ok: true, ...result.value } : { ok: false, error: result.error }));
  } else if (result.ok) {
    console.log(`draft-apply: draft ${result.value.mode} (${result.value.draftId})`);
  } else {
    console.error(`draft-apply: ${JSON.stringify(result.error)}`);
  }
  if (!result.ok) process.exit(1);
} catch (thrown) {
  console.error(`crashed (unexpected): ${formatError(thrown)}`);
  process.exit(1);
}
