import { emailIdSegment } from '../domain/bundle-path.ts';
import { extractMarkdown, extractThreadMessages } from '../domain/email-thread.ts';
import type { ThreadMessage } from '../domain/email-thread.ts';
import { parseEnvelope } from '../domain/graph-envelopes.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { RunId } from '../domain/run-id.ts';
import type { CommandOutput, CommandRunner, RunError } from './ports/command-runner.ts';
import type { FileWriter, WriteError } from './ports/file-writer.ts';
import type { Logger } from './ports/logger.ts';

export type BundleRequest = { readonly runId: RunId; readonly emailId: string; readonly conversationId: string };

export type BundleError = { readonly kind: 'thread-fetch-failed'; readonly message: string } | WriteError;

export type BundleSummary = { readonly emailId: string; readonly conversationId: string; readonly messageCount: number; readonly threadHasAttachments: boolean };

export type FetchEmailBundle = (request: BundleRequest) => Promise<Result<BundleSummary, BundleError>>;

type Deps = { readonly runner: CommandRunner; readonly writer: FileWriter; readonly logger: Logger };

type ManifestEntry = {
  readonly order: number;
  readonly messageId: string;
  readonly subject: string;
  readonly from: string;
  readonly receivedDateTime: string;
  readonly hasAttachments: boolean;
  readonly path: string;
  readonly status: 'converted' | 'failed';
};

type Converted = { readonly entry: ManifestEntry; readonly markdown: string | undefined };

const threadArgs = (conversationId: string): ReadonlyArray<string> => [
  'list-conversation-messages',
  '--conversation-id',
  conversationId,
  '--select',
  'id,subject,from,receivedDateTime,hasAttachments',
  '--output',
  'json',
];

const markdownArgs = (messageId: string): ReadonlyArray<string> => ['convert-mail-to-markdown', '--message-id', messageId, '--inline-images', 'false', '--output', 'json'];

const fetchThread = async (deps: Deps, conversationId: string): Promise<Result<ReadonlyArray<ThreadMessage>, BundleError>> => {
  const run = await deps.runner.run('ask-marcel-office', threadArgs(conversationId));
  if (!run.ok) return err({ kind: 'thread-fetch-failed', message: run.error.message });
  if (run.value.exitCode !== 0) return err({ kind: 'thread-fetch-failed', message: `exited ${run.value.exitCode}` });
  const parsed = parseEnvelope(run.value.stdout);
  if (!parsed.ok) return err({ kind: 'thread-fetch-failed', message: parsed.error });
  return ok(extractThreadMessages(parsed.value));
};

const readMarkdown = (run: Result<CommandOutput, RunError>): Result<string, string> => {
  if (!run.ok) return err(run.error.message);
  if (run.value.exitCode !== 0) return err(`exited ${run.value.exitCode}`);
  const parsed = parseEnvelope(run.value.stdout);
  if (!parsed.ok) return err(parsed.error);
  return extractMarkdown(parsed.value);
};

const convertMessage = async (deps: Deps, message: ThreadMessage, order: number): Promise<Converted> => {
  const path = `messages/${String(order).padStart(2, '0')}-${message.id}.md`;
  const markdown = readMarkdown(await deps.runner.run('ask-marcel-office', markdownArgs(message.id)));
  const entry: ManifestEntry = {
    order,
    messageId: message.id,
    subject: message.subject,
    from: message.fromAddress,
    receivedDateTime: message.receivedDateTime,
    hasAttachments: message.hasAttachments,
    path,
    status: markdown.ok ? 'converted' : 'failed',
  };
  return { entry, markdown: markdown.ok ? markdown.value : undefined };
};

const writeMarkdownFiles = async (writer: FileWriter, bundleDir: string, converted: ReadonlyArray<Converted>): Promise<Result<void, WriteError>> => {
  for (const { entry, markdown } of converted) {
    if (markdown === undefined) continue;
    const written = await writer.write(`${bundleDir}/${entry.path}`, markdown);
    if (!written.ok) return err(written.error);
  }
  return ok(undefined);
};

export const createFetchEmailBundle =
  (deps: Deps): FetchEmailBundle =>
  async (request) => {
    const thread = await fetchThread(deps, request.conversationId);
    if (!thread.ok) return err(thread.error);
    const converted = await Promise.all(thread.value.map((message, index) => convertMessage(deps, message, index + 1)));
    const bundleDir = `data/scratch/${request.runId}/${emailIdSegment(request.emailId)}/bundle`;
    const filesWritten = await writeMarkdownFiles(deps.writer, bundleDir, converted);
    if (!filesWritten.ok) return err(filesWritten.error);
    const manifest = { emailId: request.emailId, conversationId: request.conversationId, messages: converted.map((entry) => entry.entry) };
    const manifestWritten = await deps.writer.write(`${bundleDir}/manifest.json`, JSON.stringify(manifest, null, 2));
    if (!manifestWritten.ok) return err(manifestWritten.error);
    deps.logger.info('bundle-fetched', { emailId: request.emailId, messageCount: converted.length });
    return ok({
      emailId: request.emailId,
      conversationId: request.conversationId,
      messageCount: thread.value.length,
      threadHasAttachments: thread.value.some((message) => message.hasAttachments),
    });
  };
