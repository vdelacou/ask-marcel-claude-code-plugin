import { parseJson } from '../domain/graph-envelopes.ts';
import { dedupeHits, extractKbHits, extractMailHits, extractSharepointHits } from '../domain/search-hits.ts';
import type { HitSource, SearchHit } from '../domain/search-hits.ts';
import type { CommandRunner } from './ports/command-runner.ts';
import type { Logger } from './ports/logger.ts';
import type { Office } from './ports/office.ts';

export type SearchRequest = { readonly query: string; readonly backends: ReadonlyArray<HitSource> };

export type BackendError = { readonly backend: HitSource; readonly message: string };

export type SearchRoundResult = { readonly hits: ReadonlyArray<SearchHit>; readonly errors: ReadonlyArray<BackendError> };

export type SearchRound = (request: SearchRequest) => Promise<SearchRoundResult>;

type Deps = { readonly office: Office; readonly runner: CommandRunner; readonly logger: Logger };

// One backend's outcome: hits contributed, plus an error when it failed (recorded, never thrown).
type BackendOutcome = { readonly hits: ReadonlyArray<SearchHit>; readonly error?: BackendError };

const KB_COLLECTION = 'ask-marcel-kb';
const TOP = '20';

// kb rides the local qmd BM25 index (a non-M365 tool, so it stays on CommandRunner) and emits a bare JSON array.
const searchKb = async (deps: Deps, query: string): Promise<BackendOutcome> => {
  const run = await deps.runner.run('qmd', ['search', query, '-c', KB_COLLECTION, '--json', '-n', TOP]);
  if (!run.ok) return { hits: [], error: { backend: 'kb', message: run.error.message } };
  if (run.value.exitCode !== 0) return { hits: [], error: { backend: 'kb', message: `exited ${run.value.exitCode}` } };
  const parsed = parseJson(run.value.stdout);
  return parsed.ok ? { hits: extractKbHits(parsed.value) } : { hits: [], error: { backend: 'kb', message: parsed.error } };
};

const searchMail = async (deps: Deps, query: string): Promise<BackendOutcome> => {
  const run = await deps.office.execute('search-mail-messages', { query, top: TOP, select: 'id,subject,bodyPreview,webLink' });
  return run.ok ? { hits: extractMailHits(run.value) } : { hits: [], error: { backend: 'mail', message: run.error.message } };
};

const searchSharepoint = async (deps: Deps, query: string): Promise<BackendOutcome> => {
  const run = await deps.office.execute('microsoft-search-query', { query });
  return run.ok ? { hits: extractSharepointHits(run.value) } : { hits: [], error: { backend: 'sharepoint', message: run.error.message } };
};

const BACKEND_RUNNERS: Readonly<Record<HitSource, (deps: Deps, query: string) => Promise<BackendOutcome>>> = {
  kb: searchKb,
  mail: searchMail,
  sharepoint: searchSharepoint,
};

const isError = (error: BackendError | undefined): error is BackendError => error !== undefined;

export const createSearchRound =
  (deps: Deps): SearchRound =>
  async (request) => {
    // Backends fan out in parallel (SPEC §6): one merged, deduped, source-tagged list.
    const outcomes = await Promise.all(request.backends.map((backend) => BACKEND_RUNNERS[backend](deps, request.query)));
    const hits = dedupeHits(outcomes.flatMap((outcome) => outcome.hits));
    const errors = outcomes.map((outcome) => outcome.error).filter(isError);
    deps.logger.info('search-round', { query: request.query, backends: request.backends.length, hits: hits.length, errors: errors.length });
    return { hits, errors };
  };
