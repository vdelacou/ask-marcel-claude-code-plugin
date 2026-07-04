import type { PersonSeed } from './person-page.ts';
import { err, ok } from './result.ts';
import type { Result } from './result.ts';

export type CurrentUser = { readonly displayName: string; readonly email: string; readonly domain: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const asString = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

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
