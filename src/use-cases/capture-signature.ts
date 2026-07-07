import { extractAttachments } from '../domain/mail-attachments.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { buildDraftTemplate, extractInlineImage, extractSignatureBlock, findSignatureMessage, inlineCidImages } from '../domain/signature.ts';
import type { InlineImage } from '../domain/signature.ts';
import type { FileWriter, WriteError } from './ports/file-writer.ts';
import type { Logger } from './ports/logger.ts';
import type { Office } from './ports/office.ts';

export type CaptureSignatureError = { readonly kind: 'fetch-failed'; readonly message: string } | { readonly kind: 'no-signature'; readonly message: string } | WriteError;

export type CaptureSignatureSummary = { readonly imageCount: number; readonly path: string };

export type CaptureSignature = () => Promise<Result<CaptureSignatureSummary, CaptureSignatureError>>;

type Deps = { readonly office: Office; readonly writer: FileWriter; readonly logger: Logger };

const TEMPLATE_PATH = 'data/profile/draft-template.html';

// The signature's cid: logos are inline attachments; fetch each so it can be inlined as base64. A
// listing or per-image fetch that fails just drops that image - a missing logo never fails the capture.
const fetchInlineImages = async (deps: Deps, messageId: string): Promise<ReadonlyArray<InlineImage>> => {
  const listed = await deps.office.execute('list-mail-attachments', { messageId, select: 'id,name,contentType,size,isInline' });
  if (!listed.ok) return [];
  const images: InlineImage[] = [];
  for (const meta of extractAttachments(listed.value).filter((att) => att.isInline)) {
    const got = await deps.office.execute('get-mail-attachment', { messageId, attachmentId: meta.attachmentId });
    if (!got.ok) continue;
    const image = extractInlineImage(got.value);
    if (image !== undefined) images.push(image);
  }
  return images;
};

// SPEC §13 signature capture: lift the id="Signature" block from a recent sent email, inline its logos
// as base64, and write the self-contained draft template. Read-only on the mailbox; the only write is
// data/profile/draft-template.html.
export const createCaptureSignature =
  (deps: Deps): CaptureSignature =>
  async () => {
    const sent = await deps.office.execute('list-mail-folder-messages', { mailFolderId: 'sentitems', top: '40', select: 'id,subject,body' });
    if (!sent.ok) return err({ kind: 'fetch-failed', message: sent.error.message });
    const message = findSignatureMessage(sent.value);
    if (message === undefined) return err({ kind: 'no-signature', message: 'no sent email with an id="Signature" block found' });
    const block = extractSignatureBlock(message.htmlBody);
    if (block === undefined) return err({ kind: 'no-signature', message: 'the signature block could not be extracted' });
    const images = await fetchInlineImages(deps, message.id);
    const written = await deps.writer.write(TEMPLATE_PATH, buildDraftTemplate(inlineCidImages(block, images)));
    if (!written.ok) return err(written.error);
    deps.logger.info('signature-captured', { images: images.length, path: TEMPLATE_PATH });
    return ok({ imageCount: images.length, path: TEMPLATE_PATH });
  };
