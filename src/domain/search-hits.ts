import { asString, isRecord } from './graph-envelopes.ts';

export type HitSource = 'kb' | 'mail' | 'sharepoint';

// One normalized result across every backend (SPEC §6): the search module returns a single
// source-tagged, deduped list regardless of which engine produced each hit.
export type SearchHit = { readonly source: HitSource; readonly id: string; readonly title: string; readonly snippet: string; readonly uri: string };

const isHit = (hit: SearchHit | undefined): hit is SearchHit => hit !== undefined;

// qmd search --json: an array of `{ docid, score, file, line, title, context, snippet }`.
const toKbHit = (hit: Record<string, unknown>): SearchHit | undefined => {
  const uri = asString(hit['file']);
  if (uri === undefined) return undefined;
  return { source: 'kb', id: asString(hit['docid']) ?? uri, title: asString(hit['title']) ?? uri, snippet: asString(hit['snippet']) ?? asString(hit['context']) ?? '', uri };
};

export const extractKbHits = (data: unknown): ReadonlyArray<SearchHit> => (Array.isArray(data) ? data.filter(isRecord).map(toKbHit).filter(isHit) : []);

// search-mail-messages: `{ value: [message] }`, each with id / subject / bodyPreview / webLink.
const toMailHit = (message: Record<string, unknown>): SearchHit | undefined => {
  const id = asString(message['id']);
  if (id === undefined) return undefined;
  return { source: 'mail', id, title: asString(message['subject']) ?? '(no subject)', snippet: asString(message['bodyPreview']) ?? '', uri: asString(message['webLink']) ?? '' };
};

export const extractMailHits = (data: unknown): ReadonlyArray<SearchHit> =>
  isRecord(data) && Array.isArray(data['value']) ? data['value'].filter(isRecord).map(toMailHit).filter(isHit) : [];

// microsoft-search-query: `{ value: [{ hitsContainers: [{ hits: [{ hitId, summary, resource }] }] }] }`.
const toSharepointHit = (hit: Record<string, unknown>): SearchHit | undefined => {
  const id = asString(hit['hitId']);
  if (id === undefined) return undefined;
  const resource = isRecord(hit['resource']) ? hit['resource'] : {};
  return {
    source: 'sharepoint',
    id,
    title: asString(resource['name']) ?? asString(resource['title']) ?? id,
    snippet: asString(hit['summary']) ?? '',
    uri: asString(resource['webUrl']) ?? '',
  };
};

const hitsOfContainer = (container: unknown): ReadonlyArray<SearchHit> =>
  isRecord(container) && Array.isArray(container['hits']) ? container['hits'].filter(isRecord).map(toSharepointHit).filter(isHit) : [];

export const extractSharepointHits = (data: unknown): ReadonlyArray<SearchHit> => {
  if (!isRecord(data) || !Array.isArray(data['value'])) return [];
  return data['value']
    .filter(isRecord)
    .flatMap((entry) => (Array.isArray(entry['hitsContainers']) ? entry['hitsContainers'] : []))
    .flatMap(hitsOfContainer);
};

// One document = one hit: a later hit sharing a non-empty uri with an earlier one is dropped (SPEC §6).
export const dedupeHits = (hits: ReadonlyArray<SearchHit>): ReadonlyArray<SearchHit> => {
  const seen = new Set<string>();
  const unique: SearchHit[] = [];
  for (const hit of hits) {
    const key = hit.uri === '' ? `${hit.source}:${hit.id}` : hit.uri;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(hit);
  }
  return unique;
};
