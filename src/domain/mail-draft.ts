import { asString, isRecord } from './graph-envelopes.ts';

// create-reply-draft / update-mail-draft return the draft message resource; its id names the unsent draft.
export const extractDraftId = (data: unknown): string | undefined => (isRecord(data) ? asString(data['id']) : undefined);

// Drafts-folder listing `{ value: [message] }`: the first message on this conversation is the draft to update (if any).
export const extractFirstMessageId = (data: unknown): string | undefined => {
  if (!isRecord(data) || !Array.isArray(data['value'])) return undefined;
  const first = data['value'].find(isRecord);
  return first === undefined ? undefined : asString(first['id']);
};
