/*
 * Thin CLI entry:
 *   bun scripts/read-mail.ts --message-id <id>                    (prints the message as markdown)
 *   bun scripts/read-mail.ts --conversation-id <id> [--top N] [--json]  (lists the thread, newest N)
 * The R4-compliant read path for triage-scout: one message body, or a thread's chronological
 * metadata, through the Office library (never a raw ask-marcel-office command). Exit 1 on error.
 */
import { buildDeps } from '../src/composition/build-deps.ts';
import { loadConfig } from '../src/composition/config.ts';
import { extractMarkdown, extractThreadMessages } from '../src/domain/email-thread.ts';
import { formatError } from '../src/domain/utilities/format-error.ts';
import { resolveDataHome } from '../src/composition/data-home.ts';

process.chdir(resolveDataHome(process.env, `${import.meta.dir}/..`));

const flagValue = (name: string, fallback = ''): string => {
  const index = Bun.argv.indexOf(name);
  return index === -1 ? fallback : (Bun.argv[index + 1] ?? fallback);
};

try {
  const messageId = flagValue('--message-id');
  const conversationId = flagValue('--conversation-id');
  const deps = buildDeps(loadConfig({ LOG_LEVEL: 'error', ...process.env }));

  if (messageId !== '') {
    const run = await deps.office.execute('convert-mail-to-markdown', { messageId, inlineImages: 'false' });
    const markdown = run.ok ? extractMarkdown(run.value) : run;
    if (!markdown.ok) {
      console.error(`read-mail: ${JSON.stringify(markdown.error)}`);
      process.exit(1);
    }
    console.log(markdown.value);
  } else if (conversationId !== '') {
    const run = await deps.office.execute('list-conversation-messages', {
      conversationId,
      top: flagValue('--top', '5'),
      select: 'id,subject,from,receivedDateTime,hasAttachments',
    });
    if (!run.ok) {
      console.error(`read-mail: ${JSON.stringify(run.error)}`);
      process.exit(1);
    }
    console.log(JSON.stringify({ ok: true, messages: extractThreadMessages(run.value) }));
  } else {
    console.error('read-mail: --message-id or --conversation-id is required');
    process.exit(1);
  }
} catch (thrown) {
  console.error(`crashed (unexpected): ${formatError(thrown)}`);
  process.exit(1);
}
