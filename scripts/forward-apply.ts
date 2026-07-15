/*
 * Thin CLI entry: bun scripts/forward-apply.ts --run-id <id> --email-id <id> --conversation-id <cid> \
 *   --forward-to <messageId> --to "a@x,b@y" [--cc "c@z"] [--subject "<s>"] --comment-file <path> [--json]
 * SPEC.md §2 Phase 4 (redirect stance): create the UNSENT forward draft for an approved email.
 * Same code approval gate as draft-apply - refuses unless the email is user_approved (and never
 * in a pre-research run), then advances to draft_created. Never sends. The comment is plain text
 * read from a file (Graph forward comments carry no HTML signature). Exit 1 on error or crash.
 */
import { buildDeps } from '../src/composition/build-deps.ts';
import { loadConfig } from '../src/composition/config.ts';
import { resolveDataHome } from '../src/composition/data-home.ts';
import { parseRunId } from '../src/domain/run-id.ts';
import { formatError } from '../src/domain/utilities/format-error.ts';
import { createForwardApply } from '../src/use-cases/forward-apply.ts';

process.chdir(resolveDataHome(process.env, process.cwd()));

const flagValue = (name: string, fallback = ''): string => {
  const index = Bun.argv.indexOf(name);
  return index === -1 ? fallback : (Bun.argv[index + 1] ?? fallback);
};

const splitAddresses = (raw: string): ReadonlyArray<string> =>
  raw
    .split(',')
    .map((address) => address.trim())
    .filter((address) => address !== '');

try {
  const runId = parseRunId(flagValue('--run-id'));
  const emailId = flagValue('--email-id');
  const conversationId = flagValue('--conversation-id');
  const forwardMessageId = flagValue('--forward-to');
  const commentFile = flagValue('--comment-file');
  const to = splitAddresses(flagValue('--to'));
  if (!runId.ok) {
    console.error(`forward-apply: invalid --run-id (${runId.error})`);
    process.exit(1);
  }
  if (emailId === '' || conversationId === '' || forwardMessageId === '' || commentFile === '' || to.length === 0) {
    console.error('forward-apply: --email-id, --conversation-id, --forward-to, --comment-file and at least one --to are required');
    process.exit(1);
  }
  const deps = buildDeps(loadConfig({ LOG_LEVEL: 'error', ...process.env }));
  const commentRead = await deps.reader.read(commentFile);
  if (!commentRead.ok) {
    console.error(`forward-apply: cannot read --comment-file (${commentRead.error.message})`);
    process.exit(1);
  }
  const ccRaw = flagValue('--cc');
  const subject = flagValue('--subject');
  const result = await createForwardApply(deps)({
    runId: runId.value,
    emailId,
    conversationId,
    forwardMessageId,
    comment: commentRead.value,
    to,
    ...(ccRaw === '' ? {} : { cc: splitAddresses(ccRaw) }),
    ...(subject === '' ? {} : { subject }),
  });
  if (Bun.argv.includes('--json')) {
    console.log(JSON.stringify(result.ok ? { ok: true, ...result.value } : { ok: false, error: result.error }));
  } else if (result.ok) {
    console.log(`forward-apply: forward draft created (${result.value.draftId})`);
  } else {
    console.error(`forward-apply: ${JSON.stringify(result.error)}`);
  }
  if (!result.ok) process.exit(1);
} catch (thrown) {
  console.error(`crashed (unexpected): ${formatError(thrown)}`);
  process.exit(1);
}
