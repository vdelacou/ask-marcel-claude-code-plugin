import { emailIdSegment } from '../domain/bundle-path.ts';
import { extractThreadMessages } from '../domain/email-thread.ts';
import type { ThreadMessage } from '../domain/email-thread.ts';
import { parseEnvelope } from '../domain/graph-envelopes.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { RunId } from '../domain/run-id.ts';
import type { CommandRunner } from './ports/command-runner.ts';
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
};

const threadArgs = (conversationId: string): ReadonlyArray<string> => [
  'list-conversation-messages',
  '--conversation-id',
  conversationId,
  '--select',
  'id,subject,from,receivedDateTime,hasAttachments',
  '--output',
  'json',
];

const fetchThread = async (deps: Deps, conversationId: string): Promise<Result<ReadonlyArray<ThreadMessage>, BundleError>> => {
  const run = await deps.runner.run('ask-marcel-office', threadArgs(conversationId));
  if (!run.ok) return err({ kind: 'thread-fetch-failed', message: run.error.message });
  if (run.value.exitCode !== 0) return err({ kind: 'thread-fetch-failed', message: `exited ${run.value.exitCode}` });
  const parsed = parseEnvelope(run.value.stdout);
  if (!parsed.ok) return err({ kind: 'thread-fetch-failed', message: parsed.error });
  return ok(extractThreadMessages(parsed.value));
};

const manifestEntry = (message: ThreadMessage, index: number): ManifestEntry => ({
  order: index + 1,
  messageId: message.id,
  subject: message.subject,
  from: message.fromAddress,
  receivedDateTime: message.receivedDateTime,
  hasAttachments: message.hasAttachments,
});

export const createFetchEmailBundle =
  (deps: Deps): FetchEmailBundle =>
  async (request) => {
    const thread = await fetchThread(deps, request.conversationId);
    if (!thread.ok) return err(thread.error);
    const bundleDir = `data/scratch/${request.runId}/${emailIdSegment(request.emailId)}/bundle`;
    const manifest = { emailId: request.emailId, conversationId: request.conversationId, messages: thread.value.map(manifestEntry) };
    const written = await deps.writer.write(`${bundleDir}/manifest.json`, JSON.stringify(manifest, null, 2));
    if (!written.ok) return err(written.error);
    deps.logger.info('bundle-fetched', { emailId: request.emailId, messageCount: thread.value.length });
    return ok({
      emailId: request.emailId,
      conversationId: request.conversationId,
      messageCount: thread.value.length,
      threadHasAttachments: thread.value.some((message) => message.hasAttachments),
    });
  };
