import { asString, isRecord } from './graph-envelopes.ts';
import { err, ok } from './result.ts';
import type { Result } from './result.ts';

export type ThreadMessage = {
  readonly id: string;
  readonly subject: string;
  readonly fromAddress: string;
  readonly receivedDateTime: string;
  readonly hasAttachments: boolean;
  readonly webLink?: string;
};

const toThreadMessage = (message: Record<string, unknown>): ThreadMessage | undefined => {
  const id = asString(message['id']);
  const fromField = message['from'];
  const emailAddress = isRecord(fromField) ? fromField['emailAddress'] : undefined;
  const address = isRecord(emailAddress) ? asString(emailAddress['address']) : undefined;
  if (id === undefined || address === undefined) return undefined;
  const webLink = asString(message['webLink']);
  return {
    id,
    subject: asString(message['subject']) ?? '(no subject)',
    fromAddress: address.toLowerCase(),
    receivedDateTime: asString(message['receivedDateTime']) ?? '',
    hasAttachments: message['hasAttachments'] === true,
    ...(webLink !== undefined ? { webLink } : {}),
  };
};

const isThreadMessage = (message: ThreadMessage | undefined): message is ThreadMessage => message !== undefined;

// ISO-8601 instants sort chronologically under a locale-independent code-point compare (no host-locale dependence).
const byReceivedAscending = (a: ThreadMessage, b: ThreadMessage): number => Number(a.receivedDateTime > b.receivedDateTime) - Number(a.receivedDateTime < b.receivedDateTime);

/** Conversation-thread envelope: `{ value: [message, …] }`, returned unordered by Graph → sorted chronologically here. */
export const extractThreadMessages = (data: unknown): ReadonlyArray<ThreadMessage> => {
  if (!isRecord(data) || !Array.isArray(data['value'])) return [];
  return data['value'].filter(isRecord).map(toThreadMessage).filter(isThreadMessage).sort(byReceivedAscending);
};

/** convert-mail-to-markdown envelope: `{ contentType, size, text, note? }` — the rendered body lives in `text`. */
export const extractMarkdown = (data: unknown): Result<string, string> => {
  if (!isRecord(data)) return err('markdown: unexpected shape');
  const text = asString(data['text']);
  if (text === undefined) return err('markdown: missing text');
  return ok(text);
};
