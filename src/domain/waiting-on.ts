import { asString, isRecord } from './graph-envelopes.ts';

// "What am I waiting on?" - threads where the LAST word is the user's and silence has lasted
// N days. Computed from one list-mail-messages page (all folders, newest first): group by
// conversation, keep the newest message per conversation, keep the conversations whose newest
// message the user sent. Read-only; nudging is the user's call.
export type WaitingThread = {
  readonly conversationId: string;
  readonly subject: string;
  readonly to: ReadonlyArray<string>;
  readonly lastSentAt: string;
  readonly ageDays: number;
};

type Message = {
  readonly conversationId: string;
  readonly subject: string;
  readonly fromAddress: string;
  readonly toNames: ReadonlyArray<string>;
  readonly receivedDateTime: string;
};

const recipientNames = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value)
    ? value.flatMap((recipient) => {
        if (!isRecord(recipient) || !isRecord(recipient['emailAddress'])) return [];
        const name = asString(recipient['emailAddress']['name']) ?? asString(recipient['emailAddress']['address']);
        return name === undefined ? [] : [name];
      })
    : [];

const toMessage = (value: unknown): Message | undefined => {
  if (!isRecord(value)) return undefined;
  const conversationId = asString(value['conversationId']);
  const receivedDateTime = asString(value['receivedDateTime']);
  const from = isRecord(value['from']) && isRecord(value['from']['emailAddress']) ? asString(value['from']['emailAddress']['address']) : undefined;
  if (conversationId === undefined || receivedDateTime === undefined || from === undefined) return undefined;
  return { conversationId, subject: asString(value['subject']) ?? '(no subject)', fromAddress: from, toNames: recipientNames(value['toRecipients']), receivedDateTime };
};

const isMessage = (message: Message | undefined): message is Message => message !== undefined;

const DAY_MS = 86_400_000;

/**
 * The waiting list from a mailbox page. The page must be newest-first (the caller orders by
 * receivedDateTime desc), so the first message seen per conversation IS its latest; a
 * conversation whose latest arrival is someone else's message is answered, not waiting.
 */
export const waitingThreads = (payload: unknown, meAddress: string, todayIso: string, minAgeDays: number): ReadonlyArray<WaitingThread> => {
  if (!isRecord(payload) || !Array.isArray(payload['value'])) return [];
  const me = meAddress.toLowerCase();
  const today = Date.parse(todayIso);
  const newestPerConversation = new Map<string, Message>();
  for (const message of payload['value'].map(toMessage).filter(isMessage)) {
    if (!newestPerConversation.has(message.conversationId)) newestPerConversation.set(message.conversationId, message);
  }
  const waiting: WaitingThread[] = [];
  for (const message of newestPerConversation.values()) {
    if (message.fromAddress.toLowerCase() !== me) continue;
    const ageDays = Math.floor((today - Date.parse(message.receivedDateTime)) / DAY_MS);
    if (Number.isNaN(ageDays) || ageDays < minAgeDays) continue;
    waiting.push({ conversationId: message.conversationId, subject: message.subject, to: message.toNames, lastSentAt: message.receivedDateTime, ageDays });
  }
  return waiting.sort((a, b) => b.ageDays - a.ageDays);
};
