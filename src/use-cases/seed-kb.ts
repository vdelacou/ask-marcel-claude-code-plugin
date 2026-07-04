import { extractCurrentUser, extractManager, extractRelevantPeople, extractUsers, parseEnvelope } from '../domain/graph-envelopes.ts';
import type { CurrentUser } from '../domain/graph-envelopes.ts';
import { appendLogEntries } from '../domain/kb-log.ts';
import type { KbFile } from '../domain/okf-kb.ts';
import { orgPage } from '../domain/org-page.ts';
import { personPage } from '../domain/person-page.ts';
import type { PersonSeed } from '../domain/person-page.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { Clock } from './ports/clock.ts';
import type { CommandRunner } from './ports/command-runner.ts';
import type { FileProbe } from './ports/file-probe.ts';
import type { FileReader, ReadError } from './ports/file-reader.ts';
import type { FileWriter, WriteError } from './ports/file-writer.ts';
import type { Logger } from './ports/logger.ts';

export type SeedOptions = { readonly relevantTop: number; readonly pageCap: number };

export type SeedError =
  | { readonly kind: 'kb-not-initialized'; readonly message: string }
  | { readonly kind: 'source-failed'; readonly source: string; readonly message: string }
  | WriteError
  | ReadError;

export type SeedSummary = { readonly created: ReadonlyArray<string>; readonly skipped: ReadonlyArray<string>; readonly dropped: number };

export type SeedKb = (options: SeedOptions) => Promise<Result<SeedSummary, SeedError>>;

type Deps = {
  readonly runner: CommandRunner;
  readonly files: FileProbe;
  readonly reader: FileReader;
  readonly writer: FileWriter;
  readonly clock: Clock;
  readonly logger: Logger;
};

const fetchEnvelope = async (deps: Deps, source: string, args: ReadonlyArray<string>): Promise<Result<unknown, SeedError>> => {
  const run = await deps.runner.run('ask-marcel', [...args, '--output', 'json']);
  if (!run.ok) return err({ kind: 'source-failed', source, message: run.error.message });
  if (run.value.exitCode !== 0) return err({ kind: 'source-failed', source, message: `exited ${run.value.exitCode}` });
  const parsed = parseEnvelope(run.value.stdout);
  return parsed.ok ? ok(parsed.value) : err({ kind: 'source-failed', source, message: parsed.error });
};

const emailDomain = (email: string): string => email.slice(email.indexOf('@') + 1);

/** One human = one page: a seed sharing any email with an earlier seed merges into it (SPEC.md §8b). */
const dedupeByEmail = (seeds: ReadonlyArray<PersonSeed>, excludeEmail: string): ReadonlyArray<PersonSeed> => {
  const claimed = new Map<string, PersonSeed>();
  const unique: PersonSeed[] = [];
  for (const seed of seeds) {
    if (seed.emails.includes(excludeEmail)) continue;
    const known = seed.emails.map((email) => claimed.get(email)).find((found) => found !== undefined);
    if (known === undefined) {
      unique.push(seed);
      for (const email of seed.emails) claimed.set(email, seed);
    }
  }
  return unique;
};

const buildPages = (me: CurrentUser, people: ReadonlyArray<PersonSeed>, todayIso: string): { readonly orgs: ReadonlyArray<KbFile>; readonly persons: ReadonlyArray<KbFile> } => {
  const domains = new Set<string>([me.domain, ...people.flatMap((person) => person.emails.map(emailDomain))]);
  const orgs = [...domains].sort((a, b) => a.localeCompare(b)).map((domain) => orgPage({ name: domain, domains: [domain], internal: domain === me.domain }, todayIso));
  return { orgs, persons: people.map((person) => personPage(person, todayIso)) };
};

const writeMissing = async (
  deps: Deps,
  pages: ReadonlyArray<KbFile>
): Promise<Result<{ readonly created: ReadonlyArray<string>; readonly skipped: ReadonlyArray<string> }, SeedError>> => {
  const created: string[] = [];
  const skipped: string[] = [];
  for (const page of pages) {
    if (await deps.files.exists(page.path)) {
      skipped.push(page.path);
      continue;
    }
    const written = await deps.writer.write(page.path, page.content);
    if (!written.ok) return err(written.error);
    created.push(page.path);
  }
  return ok({ created, skipped });
};

const appendLog = async (deps: Deps, created: ReadonlyArray<string>): Promise<Result<void, SeedError>> => {
  if (created.length === 0) return ok(undefined);
  const existing = await deps.reader.read('data/kb/log.md');
  if (!existing.ok) return err(existing.error);
  const entries = created.map((path) => `kb-seed: ${path.replace('data/kb/', '')}`);
  return deps.writer.write('data/kb/log.md', appendLogEntries(existing.value, deps.clock.todayIso(), entries));
};

export const createSeedKb =
  (deps: Deps): SeedKb =>
  async (options) => {
    if (!(await deps.files.exists('data/kb/index.md'))) return err({ kind: 'kb-not-initialized', message: 'run kb-init first' });
    const sources = await Promise.all([
      fetchEnvelope(deps, 'get-current-user', ['get-current-user']),
      fetchEnvelope(deps, 'get-my-manager', ['get-my-manager']),
      fetchEnvelope(deps, 'list-my-direct-reports', ['list-my-direct-reports']),
      fetchEnvelope(deps, 'list-relevant-people', ['list-relevant-people', '--top', String(options.relevantTop)]),
    ]);
    const failed = sources.find((source) => !source.ok);
    if (failed !== undefined && !failed.ok) return err(failed.error);
    const [user, manager, reports, relevant] = sources.map((source) => (source.ok ? source.value : undefined));
    const me = extractCurrentUser(user);
    if (!me.ok) return err({ kind: 'source-failed', source: 'get-current-user', message: me.error });
    const managerSeed = extractManager(manager);
    const people = dedupeByEmail([...(managerSeed === undefined ? [] : [managerSeed]), ...extractUsers(reports), ...extractRelevantPeople(relevant)], me.value.email);
    const { orgs, persons } = buildPages(me.value, people, deps.clock.todayIso());
    const capped = [...orgs, ...persons].slice(0, options.pageCap);
    const dropped = orgs.length + persons.length - capped.length;
    const outcome = await writeMissing(deps, capped);
    if (!outcome.ok) return err(outcome.error);
    const logged = await appendLog(deps, outcome.value.created);
    if (!logged.ok) return err(logged.error);
    deps.logger.info('kb-seeded', { created: outcome.value.created.length, skipped: outcome.value.skipped.length, dropped });
    return ok({ ...outcome.value, dropped });
  };
