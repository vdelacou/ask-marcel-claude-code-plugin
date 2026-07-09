import { decodeBase64 } from '../domain/base64.ts';
import { emailIdSegment } from '../domain/bundle-path.ts';
import { extractMarkdown, extractThreadMessages } from '../domain/email-thread.ts';
import type { ThreadMessage } from '../domain/email-thread.ts';
import { extractAttachments, extractBase64 } from '../domain/mail-attachments.ts';
import type { AttachmentMeta } from '../domain/mail-attachments.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { RunId } from '../domain/run-id.ts';
import { extractSharepointLinks, isResolvedLink } from '../domain/sharepoint-links.ts';
import type { ErroredLink, ResolvedLink, SharepointLink } from '../domain/sharepoint-links.ts';
import { toSlug } from '../domain/slug.ts';
import type { BinaryWriter } from './ports/binary-writer.ts';
import type { FileWriter, WriteError } from './ports/file-writer.ts';
import type { Logger } from './ports/logger.ts';
import type { Office, OfficeError } from './ports/office.ts';

export type BundleRequest = { readonly runId: RunId; readonly emailId: string; readonly conversationId: string };

export type BundleError = { readonly kind: 'thread-fetch-failed'; readonly message: string } | WriteError;

export type BundleSummary = { readonly emailId: string; readonly conversationId: string; readonly messageCount: number; readonly threadHasAttachments: boolean };

export type FetchEmailBundle = (request: BundleRequest) => Promise<Result<BundleSummary, BundleError>>;

type Deps = { readonly office: Office; readonly writer: FileWriter; readonly binaryWriter: BinaryWriter; readonly logger: Logger };

type AttachmentArtifact = AttachmentMeta & { readonly path?: string; readonly status: 'converted' | 'failed' | 'image' };

// A resolved SharePoint link, once downloaded, carries its bundle path + conversion status; an errored link is recorded as-is.
type SharepointArtifact = (ResolvedLink & { readonly path?: string; readonly status: 'converted' | 'failed' }) | ErroredLink;

type ManifestEntry = {
  readonly order: number;
  readonly messageId: string;
  readonly subject: string;
  readonly from: string;
  readonly webLink?: string;
  readonly receivedDateTime: string;
  readonly hasAttachments: boolean;
  readonly path: string;
  readonly status: 'converted' | 'failed';
  readonly attachments: ReadonlyArray<AttachmentArtifact>;
  readonly attachmentsError?: string;
  readonly sharepointDocs: ReadonlyArray<SharepointArtifact>;
  readonly sharepointError?: string;
};

type FileToWrite = { readonly path: string; readonly content: string };

type BinaryToWrite = { readonly path: string; readonly bytes: Uint8Array };

type Converted = { readonly entry: ManifestEntry; readonly files: ReadonlyArray<FileToWrite>; readonly binaries: ReadonlyArray<BinaryToWrite> };

const pad = (value: number): string => String(value).padStart(2, '0');

// top:'50' overrides the library's small default page so a long thread is captured whole - otherwise
// the newest messages (incl. the one being replied to) can fall off and force a lossy search-snippet.
const threadParams = (conversationId: string): Record<string, string> => ({ conversationId, top: '50', select: 'id,subject,from,receivedDateTime,hasAttachments,webLink' });

const attachmentParams = (messageId: string): Record<string, string> => ({ messageId, select: 'id,name,contentType,size,isInline' });

// The library returns the command's data object directly (no CLI envelope, no exit code):
// a failed command is an OfficeError, a rendered body is `data.text`.
const readMarkdown = (run: Result<unknown, OfficeError>): Result<string, string> => {
  if (!run.ok) return err(run.error.message);
  return extractMarkdown(run.value);
};

const fetchThread = async (deps: Deps, conversationId: string): Promise<Result<ReadonlyArray<ThreadMessage>, BundleError>> => {
  const run = await deps.office.execute('list-conversation-messages', threadParams(conversationId));
  if (!run.ok) return err({ kind: 'thread-fetch-failed', message: run.error.message });
  return ok(extractThreadMessages(run.value));
};

type ListedAttachments = { readonly attachments: ReadonlyArray<AttachmentMeta>; readonly error?: string };

// A listing hiccup on one message must not sink the whole bundle: the failure is recorded, not thrown.
const listAttachments = async (deps: Deps, message: ThreadMessage): Promise<ListedAttachments> => {
  if (!message.hasAttachments) return { attachments: [] };
  const run = await deps.office.execute('list-mail-attachments', attachmentParams(message.id));
  if (!run.ok) return { attachments: [], error: run.error.message };
  return { attachments: extractAttachments(run.value) };
};

type ListedLinks = { readonly links: ReadonlyArray<SharepointLink>; readonly error?: string };

// Runs for every message (links can sit in any body), and stays resilient like the attachment listing.
const listSharepointLinks = async (deps: Deps, message: ThreadMessage): Promise<ListedLinks> => {
  const run = await deps.office.execute('extract-sharepoint-links-in-mail', { messageId: message.id });
  if (!run.ok) return { links: [], error: run.error.message };
  return { links: extractSharepointLinks(run.value) };
};

type RenderedLink = { readonly artifact: SharepointArtifact; readonly file?: FileToWrite };

// Each resolved link is downloaded to markdown; an errored link is recorded untouched (nothing to fetch).
const downloadSharepointDoc = async (deps: Deps, order: number, index: number, link: ResolvedLink): Promise<RenderedLink> => {
  const markdown = readMarkdown(await deps.office.execute('download-drive-item-as-markdown', { driveId: link.driveId, itemId: link.itemId }));
  if (!markdown.ok) return { artifact: { ...link, status: 'failed' } };
  const path = `sharepoint/${pad(order)}-${pad(index + 1)}-${toSlug(link.name)}.md`;
  return { artifact: { ...link, path, status: 'converted' }, file: { path, content: markdown.value } };
};

const renderSharepointLink = (deps: Deps, order: number, index: number, link: SharepointLink): Promise<RenderedLink> =>
  isResolvedLink(link) ? downloadSharepointDoc(deps, order, index, link) : Promise.resolve({ artifact: link });

type RenderedAttachment = { readonly artifact: AttachmentArtifact; readonly file?: FileToWrite; readonly binary?: BinaryToWrite };

// Filesystem-safe image name: slug the base, take the extension from the (authoritative) content type.
const imageBundlePath = (order: number, index: number, meta: AttachmentMeta): string => {
  const dot = meta.name.lastIndexOf('.');
  const stem = toSlug(dot > 0 ? meta.name.slice(0, dot) : meta.name);
  const extension = meta.contentType.slice(meta.contentType.lastIndexOf('/') + 1);
  return `images/${pad(order)}-${pad(index + 1)}-${stem}.${extension}`;
};

// Images 415 on the text converter — get-mail-attachment returns the bytes as a base64 mirror,
// which we decode and hand to the BinaryWriter (replacing the CLI's --output-path side effect).
const fetchImage = async (deps: Deps, messageId: string, order: number, meta: AttachmentMeta, index: number): Promise<RenderedAttachment> => {
  const run = await deps.office.execute('get-mail-attachment', { messageId, attachmentId: meta.attachmentId });
  if (!run.ok) return { artifact: { ...meta, status: 'failed' } };
  const base64 = extractBase64(run.value);
  if (!base64.ok) return { artifact: { ...meta, status: 'failed' } };
  const decoded = decodeBase64(base64.value);
  if (!decoded.ok) return { artifact: { ...meta, status: 'failed' } };
  const path = imageBundlePath(order, index, meta);
  return { artifact: { ...meta, path, status: 'image' }, binary: { path, bytes: decoded.value } };
};

const convertDocument = async (deps: Deps, messageId: string, order: number, meta: AttachmentMeta, index: number): Promise<RenderedAttachment> => {
  const markdown = readMarkdown(await deps.office.execute('read-mail-attachment', { messageId, attachmentId: meta.attachmentId }));
  if (!markdown.ok) return { artifact: { ...meta, status: 'failed' } };
  const path = `attachments/${pad(order)}-${pad(index + 1)}-${toSlug(meta.name)}.md`;
  return { artifact: { ...meta, path, status: 'converted' }, file: { path, content: markdown.value } };
};

// Images ride out as decoded bytes (get-mail-attachment); everything else converts to markdown text (read-mail-attachment).
const convertAttachment = (deps: Deps, messageId: string, order: number, meta: AttachmentMeta, index: number): Promise<RenderedAttachment> =>
  meta.contentType.startsWith('image/') ? fetchImage(deps, messageId, order, meta, index) : convertDocument(deps, messageId, order, meta, index);

const definedFile = (file: FileToWrite | undefined): file is FileToWrite => file !== undefined;

const definedBinary = (binary: BinaryToWrite | undefined): binary is BinaryToWrite => binary !== undefined;

const convertMessage = async (deps: Deps, message: ThreadMessage, order: number): Promise<Converted> => {
  // The body file lives under the same deep bundle path as the capped directory segment; a raw
  // ~200-char Graph message id as the filename pushes the whole path past Windows' 260-char
  // MAX_PATH (ENAMETOOLONG, #1). emailIdSegment caps + hashes it exactly as it does the dir
  // segment, so the manifest still carries the real id (messageId) while the on-disk path stays short.
  const bodyPath = `messages/${pad(order)}-${emailIdSegment(message.id)}.md`;
  const markdown = readMarkdown(await deps.office.execute('convert-mail-to-markdown', { messageId: message.id, inlineImages: 'false' }));
  const listed = await listAttachments(deps, message);
  const rendered = await Promise.all(listed.attachments.map((meta, index) => convertAttachment(deps, message.id, order, meta, index)));
  const sharepoint = await listSharepointLinks(deps, message);
  const renderedLinks = await Promise.all(sharepoint.links.map((link, index) => renderSharepointLink(deps, order, index, link)));
  const entry: ManifestEntry = {
    order,
    messageId: message.id,
    subject: message.subject,
    from: message.fromAddress,
    ...(message.webLink !== undefined ? { webLink: message.webLink } : {}),
    receivedDateTime: message.receivedDateTime,
    hasAttachments: message.hasAttachments,
    path: bodyPath,
    status: markdown.ok ? 'converted' : 'failed',
    attachments: rendered.map((item) => item.artifact),
    ...(listed.error !== undefined ? { attachmentsError: listed.error } : {}),
    sharepointDocs: renderedLinks.map((item) => item.artifact),
    ...(sharepoint.error !== undefined ? { sharepointError: sharepoint.error } : {}),
  };
  const bodyFile = markdown.ok ? [{ path: bodyPath, content: markdown.value }] : [];
  const files = [...bodyFile, ...rendered.map((item) => item.file).filter(definedFile), ...renderedLinks.map((item) => item.file).filter(definedFile)];
  const binaries = rendered.map((item) => item.binary).filter(definedBinary);
  return { entry, files, binaries };
};

const writeFiles = async (deps: Deps, bundleDir: string, converted: ReadonlyArray<Converted>): Promise<Result<void, WriteError>> => {
  for (const { files, binaries } of converted) {
    for (const file of files) {
      const written = await deps.writer.write(`${bundleDir}/${file.path}`, file.content);
      if (!written.ok) return err(written.error);
    }
    for (const binary of binaries) {
      const written = await deps.binaryWriter.write(`${bundleDir}/${binary.path}`, binary.bytes);
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
    // Bundle messages render serially so the command ladder is deterministic; cross-email parallelism lives in the research fan-out.
    const bundleDir = `data/scratch/${request.runId}/${emailIdSegment(request.emailId)}/bundle`;
    const converted: Converted[] = [];
    for (const [index, message] of thread.value.entries()) converted.push(await convertMessage(deps, message, index + 1));
    const filesWritten = await writeFiles(deps, bundleDir, converted);
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
