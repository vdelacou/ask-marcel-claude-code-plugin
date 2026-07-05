import type { PersonSeed } from './person-page.ts';
import { err, ok } from './result.ts';
import type { Result } from './result.ts';
import type { InboxMessage } from './triage-rules.ts';

export type CurrentUser = { readonly displayName: string; readonly email: string; readonly domain: string };

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

export const asString = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

// JSON.parse is a native synchronous thrower — pure-domain fallback (rule 17).
export const parseEnvelope = (json: string): Result<unknown, string> => {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!isRecord(parsed) || parsed['ok'] !== true) return err('envelope is not ok');
    return ok(parsed['data']);
  } catch {
    return err('invalid json');
  }
};

const emailDomain = (email: string): string => email.slice(email.indexOf('@') + 1).toLowerCase();

export const extractCurrentUser = (data: unknown): Result<CurrentUser, string> => {
  if (!isRecord(data)) return err('current-user: unexpected shape');
  const displayName = asString(data['displayName']);
  const email = asString(data['mail']) ?? asString(data['userPrincipalName']);
  if (displayName === undefined || email === undefined) return err('current-user: missing displayName or mail');
  return ok({ displayName, email: email.toLowerCase(), domain: emailDomain(email) });
};

const userToSeed = (user: Record<string, unknown>): PersonSeed | undefined => {
  const displayName = asString(user['displayName']);
  const email = asString(user['mail']) ?? asString(user['userPrincipalName']);
  if (displayName === undefined || email === undefined) return undefined;
  return { displayName, emails: [email.toLowerCase()], title: asString(user['jobTitle']), department: asString(user['department']) };
};

const isSeed = (seed: PersonSeed | undefined): seed is PersonSeed => seed !== undefined;

/** Direct-reports style envelope: `{ value: [user resource, …] }` — entries without an email are skipped. */
export const extractUsers = (data: unknown): ReadonlyArray<PersonSeed> => {
  if (!isRecord(data) || !Array.isArray(data['value'])) return [];
  return data['value'].filter(isRecord).map(userToSeed).filter(isSeed);
};

/** Manager envelope: `{ manager: user | null, note? }` — a directory without a manager yields no seed. */
export const extractManager = (data: unknown): PersonSeed | undefined => {
  if (!isRecord(data) || !isRecord(data['manager'])) return undefined;
  return userToSeed(data['manager']);
};

const personToSeed = (person: Record<string, unknown>): PersonSeed | undefined => {
  const displayName = asString(person['displayName']);
  const scored = Array.isArray(person['scoredEmailAddresses']) ? person['scoredEmailAddresses'] : [];
  const emails = scored
    .filter(isRecord)
    .map((entry) => asString(entry['address']))
    .filter((address): address is string => address !== undefined)
    .map((address) => address.toLowerCase());
  if (displayName === undefined || emails.length === 0) return undefined;
  return { displayName, emails, title: asString(person['jobTitle']), company: asString(person['companyName']), department: asString(person['department']) };
};

/** Relevant-people envelope: `{ value: [person resource with scoredEmailAddresses, …] }`. */
export const extractRelevantPeople = (data: unknown): ReadonlyArray<PersonSeed> => {
  if (!isRecord(data) || !Array.isArray(data['value'])) return [];
  return data['value'].filter(isRecord).map(personToSeed).filter(isSeed);
};

const messageToInbox = (message: Record<string, unknown>): InboxMessage | undefined => {
  const id = asString(message['id']);
  const conversationId = asString(message['conversationId']);
  const fromField = message['from'];
  const emailAddress = isRecord(fromField) ? fromField['emailAddress'] : undefined;
  const sender = isRecord(emailAddress) ? emailAddress : undefined;
  const fromAddress = sender === undefined ? undefined : asString(sender['address']);
  if (id === undefined || conversationId === undefined || sender === undefined || fromAddress === undefined) return undefined;
  const address = fromAddress.toLowerCase();
  return {
    id,
    conversationId,
    subject: asString(message['subject']) ?? '(no subject)',
    fromName: asString(sender['name']) ?? address,
    fromAddress: address,
    receivedDateTime: asString(message['receivedDateTime']) ?? '',
    hasAttachments: message['hasAttachments'] === true,
    importance: asString(message['importance']) ?? 'normal',
    bodyPreview: asString(message['bodyPreview']) ?? '',
    odataType: asString(message['@odata.type']) ?? '',
  };
};

const isMessage = (message: InboxMessage | undefined): message is InboxMessage => message !== undefined;

/** Mail-folder listing envelope: `{ value: [message resource, …] }` — entries without id, conversation, or sender are skipped. */
export const extractMessages = (data: unknown): ReadonlyArray<InboxMessage> => {
  if (!isRecord(data) || !Array.isArray(data['value'])) return [];
  return data['value'].filter(isRecord).map(messageToInbox).filter(isMessage);
};

export type SentMeta = {
  readonly id: string;
  readonly subject: string;
  readonly sentAt: string;
  readonly to: ReadonlyArray<string>;
  readonly cc: ReadonlyArray<string>;
  readonly isDraft: boolean;
};

const recipientAddresses = (field: unknown): ReadonlyArray<string> => {
  if (!Array.isArray(field)) return [];
  return field
    .filter(isRecord)
    .map((entry) => (isRecord(entry['emailAddress']) ? asString(entry['emailAddress']['address']) : undefined))
    .filter((address): address is string => address !== undefined)
    .map((address) => address.toLowerCase());
};

const messageToSentMeta = (message: Record<string, unknown>): SentMeta | undefined => {
  const id = asString(message['id']);
  if (id === undefined) return undefined;
  return {
    id,
    subject: asString(message['subject']) ?? '(no subject)',
    sentAt: asString(message['receivedDateTime']) ?? '',
    to: recipientAddresses(message['toRecipients']),
    cc: recipientAddresses(message['ccRecipients']),
    isDraft: message['isDraft'] === true,
  };
};

const isSentMeta = (meta: SentMeta | undefined): meta is SentMeta => meta !== undefined;

/** Sent-mail listing envelope: recipients flattened to lowercase addresses; entries without an id are skipped. */
export const extractSentMetas = (data: unknown): ReadonlyArray<SentMeta> => {
  if (!isRecord(data) || !Array.isArray(data['value'])) return [];
  return data['value'].filter(isRecord).map(messageToSentMeta).filter(isSentMeta);
};
