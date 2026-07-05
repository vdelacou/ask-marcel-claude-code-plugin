import { asString, isRecord } from './graph-envelopes.ts';

export type ThreadMessage = {
  readonly id: string;
  readonly subject: string;
  readonly fromAddress: string;
  readonly receivedDateTime: string;
  readonly hasAttachments: boolean;
};

const toThreadMessage = (message: Record<string, unknown>): ThreadMessage | undefined => {
  const id = asString(message['id']);
  const fromField = message['from'];
  const emailAddress = isRecord(fromField) ? fromField['emailAddress'] : undefined;
  const address = isRecord(emailAddress) ? asString(emailAddress['address']) : undefined;
  if (id === undefined || address === undefined) return undefined;
  return {
    id,
    subject: asString(message['subject']) ?? '(no subject)',
    fromAddress: address.toLowerCase(),
    receivedDateTime: asString(message['receivedDateTime']) ?? '',
    hasAttachments: message['hasAttachments'] === true,
  };
};

const isThreadMessage = (message: ThreadMessage | undefined): message is ThreadMessage => message !== undefined;

// ISO-8601 instants sort chronologically under a lexical compare.
const byReceivedAscending = (a: ThreadMessage, b: ThreadMessage): number => a.receivedDateTime.localeCompare(b.receivedDateTime);

/** Conversation-thread envelope: `{ value: [message, …] }`, returned unordered by Graph → sorted chronologically here. */
export const extractThreadMessages = (data: unknown): ReadonlyArray<ThreadMessage> => {
  if (!isRecord(data) || !Array.isArray(data['value'])) return [];
  return data['value'].filter(isRecord).map(toThreadMessage).filter(isThreadMessage).sort(byReceivedAscending);
};
