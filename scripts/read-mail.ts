/*
 * Thin CLI entry:
 *   bun scripts/read-mail.ts --message-id <id>                          (prints the message as markdown)
 *   bun scripts/read-mail.ts --conversation-id <id> [--top N] [--json]  (lists the thread oldest-first, capped at N)
 *   bun scripts/read-mail.ts --conversation-id <id> --latest [--json]   (only the current latest message)
 * The R4-compliant read path for triage-scout: one message body, or a thread's chronological
 * metadata, through the Office library (never a raw ask-marcel-office command). --latest fetches a
 * 50-message window and returns the max-receivedDateTime message: list-conversation-messages takes no
 * $orderby (Graph rejects it with the conversationId filter), so the latest is resolved client-side.
 * Exit 1 on error.
 */
import { buildDeps } from '../src/composition/build-deps.ts';
import { loadConfig } from '../src/composition/config.ts';
import { extractMarkdown, extractThreadMessages, latestThreadMessage } from '../src/domain/email-thread.ts';
import { formatError } from '../src/domain/utilities/format-error.ts';
import { resolveDataHome } from '../src/composition/data-home.ts';

process.chdir(resolveDataHome(process.env, process.cwd()));

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
    // --latest wants only the newest message, but list-conversation-messages cannot $orderby, so fetch a
    // wide window and let extractThreadMessages sort it - the last element is the max receivedDateTime.
    const latestOnly = Bun.argv.includes('--latest');
    const run = await deps.office.execute('list-conversation-messages', {
      conversationId,
      top: latestOnly ? '50' : flagValue('--top', '5'),
      select: 'id,subject,from,receivedDateTime,hasAttachments',
    });
    if (!run.ok) {
      console.error(`read-mail: ${JSON.stringify(run.error)}`);
      process.exit(1);
    }
    const messages = extractThreadMessages(run.value);
    const latest = latestThreadMessage(messages);
    const latestPayload = latest ? [latest] : [];
    console.log(JSON.stringify({ ok: true, messages: latestOnly ? latestPayload : messages }));
  } else {
    console.error('read-mail: --message-id or --conversation-id is required');
    process.exit(1);
  }
} catch (thrown) {
  console.error(`crashed (unexpected): ${formatError(thrown)}`);
  process.exit(1);
}
