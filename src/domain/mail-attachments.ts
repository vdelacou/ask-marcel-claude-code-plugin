import { asString, isRecord } from './graph-envelopes.ts';
import { err, ok } from './result.ts';
import type { Result } from './result.ts';

export type AttachmentMeta = {
  readonly attachmentId: string;
  readonly name: string;
  readonly contentType: string;
  readonly size: number;
  readonly isInline: boolean;
};

const asNumber = (value: unknown): number => (typeof value === 'number' ? value : 0);

const toAttachmentMeta = (attachment: Record<string, unknown>): AttachmentMeta | undefined => {
  const attachmentId = asString(attachment['id']);
  if (attachmentId === undefined) return undefined;
  return {
    attachmentId,
    name: asString(attachment['name']) ?? '(unnamed)',
    contentType: asString(attachment['contentType']) ?? '',
    size: asNumber(attachment['size']),
    isInline: attachment['isInline'] === true,
  };
};

const isAttachmentMeta = (attachment: AttachmentMeta | undefined): attachment is AttachmentMeta => attachment !== undefined;

/** list-mail-attachments envelope: `{ value: [attachment, …] }` — entries without an id are skipped. */
export const extractAttachments = (data: unknown): ReadonlyArray<AttachmentMeta> => {
  if (!isRecord(data) || !Array.isArray(data['value'])) return [];
  return data['value'].filter(isRecord).map(toAttachmentMeta).filter(isAttachmentMeta);
};

/** get-mail-attachment envelope: a single attachment resource whose bytes live in the `base64` mirror of contentBytes. */
export const extractBase64 = (data: unknown): Result<string, string> => {
  if (!isRecord(data)) return err('attachment-bytes: unexpected shape');
  const base64 = asString(data['base64']);
  if (base64 === undefined) return err('attachment-bytes: missing base64');
  return ok(base64);
};
