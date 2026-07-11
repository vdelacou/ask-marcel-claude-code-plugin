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

// What a drain takes out of the queue: everything (no filter), one email's facts, or one kind.
// A drain is CONSUMING (SPEC §2 step 9 / §8): matching candidates leave the queue so the next
// drain never re-lands them; only jargon has no emailId, so an emailId filter matches facts only.
export type DrainFilter = { readonly kind?: KbCandidate['kind']; readonly emailId?: string };

export const matchesFilter = (candidate: KbCandidate, filter: DrainFilter): boolean =>
  (filter.kind === undefined || candidate.kind === filter.kind) && (filter.emailId === undefined || (candidate.kind === 'fact' && candidate.emailId === filter.emailId));

export type QueueSplit = { readonly drained: ReadonlyArray<KbCandidate>; readonly remaining: string };

// Malformed lines are dropped here too: a drain is the queue's one rewrite point, so garbage
// never outlives the first drain that touches the file.
export const splitQueue = (content: string, filter: DrainFilter): QueueSplit => {
  const candidates = parseQueue(content);
  const drained = candidates.filter((candidate) => matchesFilter(candidate, filter));
  const kept = candidates.filter((candidate) => !matchesFilter(candidate, filter));
  return { drained, remaining: kept.map((candidate) => `${serializeCandidate(candidate)}\n`).join('') };
};

/** True when the queue text holds no parseable candidate — the run-wrap gate reads this. */
export const isQueueEmpty = (content: string): boolean => parseQueue(content).length === 0;
