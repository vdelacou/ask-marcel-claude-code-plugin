import { asString, isRecord } from './graph-envelopes.ts';

// Candidates queued during research (SPEC §8), drained in one batch to kb-curator at wrap-up.
// A fact targets a KB page (carrying its source email); a jargon term is proposed at run wrap-up.
export type KbFact = {
  readonly kind: 'fact';
  readonly emailId: string;
  readonly webLink?: string;
  readonly folder: string;
  readonly slug: string;
  readonly title: string;
  readonly content: string;
  readonly rationale: string;
};

export type KbJargon = { readonly kind: 'jargon'; readonly term: string; readonly guessedMeaning: string; readonly context: string };

export type KbCandidate = KbFact | KbJargon;

// One candidate per line (JSONL) so appends never rewrite prior entries beyond a concat.
export const serializeCandidate = (candidate: KbCandidate): string => JSON.stringify(candidate);

const parseFact = (record: Record<string, unknown>): KbFact | undefined => {
  const emailId = asString(record['emailId']);
  const folder = asString(record['folder']);
  const slug = asString(record['slug']);
  const title = asString(record['title']);
  const content = asString(record['content']);
  if (emailId === undefined || folder === undefined || slug === undefined || title === undefined || content === undefined) return undefined;
  const webLink = asString(record['webLink']);
  return { kind: 'fact', emailId, folder, slug, title, content, rationale: asString(record['rationale']) ?? '', ...(webLink !== undefined ? { webLink } : {}) };
};

const parseJargon = (record: Record<string, unknown>): KbJargon | undefined => {
  const term = asString(record['term']);
  if (term === undefined) return undefined;
  return { kind: 'jargon', term, guessedMeaning: asString(record['guessedMeaning']) ?? '', context: asString(record['context']) ?? '' };
};

// A malformed line (bad JSON, unknown kind, missing required field) is dropped, never a throw.
const parseLine = (line: string): KbCandidate | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  if (parsed['kind'] === 'fact') return parseFact(parsed);
  if (parsed['kind'] === 'jargon') return parseJargon(parsed);
  return undefined;
};

const isCandidate = (candidate: KbCandidate | undefined): candidate is KbCandidate => candidate !== undefined;

export const parseQueue = (content: string): ReadonlyArray<KbCandidate> =>
  content
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map(parseLine)
    .filter(isCandidate);

// Append one serialized candidate to the existing queue text (missing queue starts empty).
export const appendToQueue = (existing: string, candidate: KbCandidate): string => `${existing}${serializeCandidate(candidate)}\n`;
