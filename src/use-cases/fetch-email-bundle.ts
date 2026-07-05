import { emailIdSegment } from '../domain/bundle-path.ts';
import { extractMarkdown, extractThreadMessages } from '../domain/email-thread.ts';
import type { ThreadMessage } from '../domain/email-thread.ts';
import { parseEnvelope } from '../domain/graph-envelopes.ts';
import { extractAttachments } from '../domain/mail-attachments.ts';
import type { AttachmentMeta } from '../domain/mail-attachments.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { RunId } from '../domain/run-id.ts';
import { extractSharepointLinks } from '../domain/sharepoint-links.ts';
import type { SharepointLink } from '../domain/sharepoint-links.ts';
import { toSlug } from '../domain/slug.ts';
import type { CommandOutput, CommandRunner, RunError } from './ports/command-runner.ts';
import type { FileWriter, WriteError } from './ports/file-writer.ts';
import type { Logger } from './ports/logger.ts';

export type BundleRequest = { readonly runId: RunId; readonly emailId: string; readonly conversationId: string };

export type BundleError = { readonly kind: 'thread-fetch-failed'; readonly message: string } | WriteError;

export type BundleSummary = { readonly emailId: string; readonly conversationId: string; readonly messageCount: number; readonly threadHasAttachments: boolean };

export type FetchEmailBundle = (request: BundleRequest) => Promise<Result<BundleSummary, BundleError>>;

type Deps = { readonly runner: CommandRunner; readonly writer: FileWriter; readonly logger: Logger };

type AttachmentArtifact = AttachmentMeta & { readonly path?: string; readonly status: 'converted' | 'failed' };

type ManifestEntry = {
  readonly order: number;
  readonly messageId: string;
  readonly subject: string;
  readonly from: string;
  readonly receivedDateTime: string;
  readonly hasAttachments: boolean;
  readonly path: string;
  readonly status: 'converted' | 'failed';
  readonly attachments: ReadonlyArray<AttachmentArtifact>;
  readonly attachmentsError?: string;
  readonly sharepointDocs: ReadonlyArray<SharepointLink>;
  readonly sharepointError?: string;
};

type FileToWrite = { readonly path: string; readonly content: string };

type Converted = { readonly entry: ManifestEntry; readonly files: ReadonlyArray<FileToWrite> };

const pad = (value: number): string => String(value).padStart(2, '0');

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

const attachmentArgs = (messageId: string): ReadonlyArray<string> => [
  'list-mail-attachments',
  '--message-id',
  messageId,
  '--select',
  'id,name,contentType,size,isInline',
  '--output',
  'json',
];

const readAttachmentArgs = (messageId: string, attachmentId: string): ReadonlyArray<string> => [
  'read-mail-attachment',
  '--message-id',
  messageId,
  '--attachment-id',
  attachmentId,
  '--output',
  'json',
];

const readMarkdown = (run: Result<CommandOutput, RunError>): Result<string, string> => {
  if (!run.ok) return err(run.error.message);
  if (run.value.exitCode !== 0) return err(`exited ${run.value.exitCode}`);
  const parsed = parseEnvelope(run.value.stdout);
  if (!parsed.ok) return err(parsed.error);
  return extractMarkdown(parsed.value);
};

const fetchThread = async (deps: Deps, conversationId: string): Promise<Result<ReadonlyArray<ThreadMessage>, BundleError>> => {
  const run = await deps.runner.run('ask-marcel-office', threadArgs(conversationId));
  if (!run.ok) return err({ kind: 'thread-fetch-failed', message: run.error.message });
  if (run.value.exitCode !== 0) return err({ kind: 'thread-fetch-failed', message: `exited ${run.value.exitCode}` });
  const parsed = parseEnvelope(run.value.stdout);
  if (!parsed.ok) return err({ kind: 'thread-fetch-failed', message: parsed.error });
  return ok(extractThreadMessages(parsed.value));
};

type ListedAttachments = { readonly attachments: ReadonlyArray<AttachmentMeta>; readonly error?: string };

// A listing hiccup on one message must not sink the whole bundle: the failure is recorded, not thrown.
const listAttachments = async (deps: Deps, message: ThreadMessage): Promise<ListedAttachments> => {
  if (!message.hasAttachments) return { attachments: [] };
  const run = await deps.runner.run('ask-marcel-office', attachmentArgs(message.id));
  if (!run.ok) return { attachments: [], error: run.error.message };
  if (run.value.exitCode !== 0) return { attachments: [], error: `exited ${run.value.exitCode}` };
  const parsed = parseEnvelope(run.value.stdout);
  if (!parsed.ok) return { attachments: [], error: parsed.error };
  return { attachments: extractAttachments(parsed.value) };
};

const sharepointArgs = (messageId: string): ReadonlyArray<string> => ['extract-sharepoint-links-in-mail', '--message-id', messageId, '--output', 'json'];

type ListedLinks = { readonly links: ReadonlyArray<SharepointLink>; readonly error?: string };

// Runs for every message (links can sit in any body), and stays resilient like the attachment listing.
const listSharepointLinks = async (deps: Deps, message: ThreadMessage): Promise<ListedLinks> => {
  const run = await deps.runner.run('ask-marcel-office', sharepointArgs(message.id));
  if (!run.ok) return { links: [], error: run.error.message };
  if (run.value.exitCode !== 0) return { links: [], error: `exited ${run.value.exitCode}` };
  const parsed = parseEnvelope(run.value.stdout);
  if (!parsed.ok) return { links: [], error: parsed.error };
  return { links: extractSharepointLinks(parsed.value) };
};

type RenderedAttachment = { readonly artifact: AttachmentArtifact; readonly file?: FileToWrite };

// Images and scanned PDFs come back as a CLI api_error; contentType on the artifact already says why, so status alone suffices.
const convertAttachment = async (deps: Deps, messageId: string, messageOrder: number, meta: AttachmentMeta, index: number): Promise<RenderedAttachment> => {
  const markdown = readMarkdown(await deps.runner.run('ask-marcel-office', readAttachmentArgs(messageId, meta.attachmentId)));
  if (!markdown.ok) return { artifact: { ...meta, status: 'failed' } };
  const path = `attachments/${pad(messageOrder)}-${pad(index + 1)}-${toSlug(meta.name)}.md`;
  return { artifact: { ...meta, path, status: 'converted' }, file: { path, content: markdown.value } };
};

const definedFile = (file: FileToWrite | undefined): file is FileToWrite => file !== undefined;

const convertMessage = async (deps: Deps, message: ThreadMessage, order: number): Promise<Converted> => {
  const bodyPath = `messages/${pad(order)}-${message.id}.md`;
  const markdown = readMarkdown(await deps.runner.run('ask-marcel-office', markdownArgs(message.id)));
  const listed = await listAttachments(deps, message);
  const rendered = await Promise.all(listed.attachments.map((meta, index) => convertAttachment(deps, message.id, order, meta, index)));
  const sharepoint = await listSharepointLinks(deps, message);
  const entry: ManifestEntry = {
    order,
    messageId: message.id,
    subject: message.subject,
    from: message.fromAddress,
    receivedDateTime: message.receivedDateTime,
    hasAttachments: message.hasAttachments,
    path: bodyPath,
    status: markdown.ok ? 'converted' : 'failed',
    attachments: rendered.map((item) => item.artifact),
    ...(listed.error !== undefined ? { attachmentsError: listed.error } : {}),
    sharepointDocs: sharepoint.links,
    ...(sharepoint.error !== undefined ? { sharepointError: sharepoint.error } : {}),
  };
  const bodyFile = markdown.ok ? [{ path: bodyPath, content: markdown.value }] : [];
  const files = [...bodyFile, ...rendered.map((item) => item.file).filter(definedFile)];
  return { entry, files };
};

const writeFiles = async (writer: FileWriter, bundleDir: string, converted: ReadonlyArray<Converted>): Promise<Result<void, WriteError>> => {
  for (const { files } of converted) {
    for (const file of files) {
      const written = await writer.write(`${bundleDir}/${file.path}`, file.content);
      if (!written.ok) return err(written.error);
    }
  }
  return ok(undefined);
};

export const createFetchEmailBundle =
  (deps: Deps): FetchEmailBundle =>
  async (request) => {
    const thread = await fetchThread(deps, request.conversationId);
    if (!thread.ok) return err(thread.error);
    // Bundle messages render serially so the CLI ladder is deterministic; cross-email parallelism lives in the research fan-out.
    const converted: Converted[] = [];
    for (const [index, message] of thread.value.entries()) converted.push(await convertMessage(deps, message, index + 1));
    const bundleDir = `data/scratch/${request.runId}/${emailIdSegment(request.emailId)}/bundle`;
    const filesWritten = await writeFiles(deps.writer, bundleDir, converted);
    if (!filesWritten.ok) return err(filesWritten.error);
    const manifest = { emailId: request.emailId, conversationId: request.conversationId, messages: converted.map((item) => item.entry) };
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
