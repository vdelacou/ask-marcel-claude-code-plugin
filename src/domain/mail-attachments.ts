import { asString, isRecord } from './graph-envelopes.ts';

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
