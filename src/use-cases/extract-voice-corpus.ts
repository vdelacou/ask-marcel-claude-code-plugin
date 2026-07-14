import { extractMarkdown } from '../domain/email-thread.ts';
import { extractSentMetas } from '../domain/graph-envelopes.ts';
import type { SentMeta } from '../domain/graph-envelopes.ts';
import { extractOwnBody } from '../domain/own-body.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { bucketFor, isSubstantive } from '../domain/voice-rules.ts';
import type { Bucket, OrgContext } from '../domain/voice-rules.ts';
import type { Clock } from './ports/clock.ts';
import type { FileWriter, WriteError } from './ports/file-writer.ts';
import type { Logger } from './ports/logger.ts';
import type { Office } from './ports/office.ts';

export type CorpusOptions = {
  readonly me: { readonly displayName: string; readonly email: string; readonly jobTitle: string };
  readonly org: OrgContext;
  readonly fetchTop: number;
  readonly keep: number;
};

export type CorpusMessage = {
  readonly id: string;
  readonly subject: string;
  readonly sentAt: string;
  readonly bucket: Bucket;
  readonly to: ReadonlyArray<string>;
  readonly body: string;
};

export type CorpusSummary = { readonly path: string; readonly kept: number; readonly scanned: number; readonly byBucket: Readonly<Partial<Record<Bucket, number>>> };

export type CorpusError = { readonly kind: 'source-failed'; readonly source: string; readonly message: string } | WriteError;

export type ExtractVoiceCorpus = (options: CorpusOptions) => Promise<Result<CorpusSummary, CorpusError>>;

type Deps = {
  readonly office: Office;
  readonly writer: FileWriter;
  readonly clock: Clock;
  readonly logger: Logger;
};

// SPEC §9: voice sourcing is `search-mail-messages` KQL `from:<me>` across ALL folders (catches
// sent mail filed into project folders). The earlier `list-mail-messages` with a
// `$filter from/emailAddress/address eq …` + `$orderby receivedDateTime` combination is rejected
// by Graph as `InefficientFilter` (live blocker 2026-07-14), and `$search` forbids `$orderby`
// anyway — so we ask by relevance and sort by date ourselves. KQL is raw, unquoted (the library
// wraps the value on the wire; extra quotes make Graph reject it).
const searchParams = (options: CorpusOptions): Record<string, string> => ({
  query: `from:${options.me.email}`,
  top: String(options.fetchTop),
  select: 'id,subject,toRecipients,ccRecipients,receivedDateTime,isDraft',
});

// Newest first: ISO-8601 instants sort chronologically, so a reversed localeCompare is desc.
const byNewestSent = (a: SentMeta, b: SentMeta): number => b.sentAt.localeCompare(a.sentAt);

const listSent = async (deps: Deps, options: CorpusOptions): Promise<Result<ReadonlyArray<SentMeta>, CorpusError>> => {
  const run = await deps.office.execute('search-mail-messages', searchParams(options));
  if (!run.ok) return err({ kind: 'source-failed', source: 'search-mail-messages', message: run.error.message });
  // search ranks by relevance, but the keep-loop takes the FIRST N substantive - so it must see
  // the newest sent mail first, hence the client-side sort (the fix that replaced the rejected $orderby).
  return ok([...extractSentMetas(run.value)].sort(byNewestSent));
};

const ownBodyOf = async (deps: Deps, meta: SentMeta, options: CorpusOptions): Promise<string | undefined> => {
  // inlineImages defaults to TRUE in the library - without 'false' every signature logo and
  // pasted screenshot lands as base64 in the corpus the voice analysis reads. Prose only.
  const converted = await deps.office.execute('convert-mail-to-markdown', { messageId: meta.id, inlineImages: 'false' });
  if (!converted.ok) return undefined;
  const markdown = extractMarkdown(converted.value);
  if (!markdown.ok) return undefined;
  const body = extractOwnBody(markdown.value, options.me.displayName, options.me.jobTitle);
  return isSubstantive(body) ? body : undefined;
};

const runStamp = (nowIso: string): string => `voice-${nowIso.slice(0, 10).replaceAll('-', '')}-${nowIso.slice(11, 19).replaceAll(':', '')}`;

export const createExtractVoiceCorpus =
  (deps: Deps): ExtractVoiceCorpus =>
  async (options) => {
    const listed = await listSent(deps, options);
    if (!listed.ok) return err(listed.error);
    const messages: CorpusMessage[] = [];
    let scanned = 0;
    for (const meta of listed.value) {
      if (messages.length >= options.keep) break;
      if (meta.isDraft) continue;
      scanned += 1;
      const body = await ownBodyOf(deps, meta, options);
      if (body === undefined) continue;
      messages.push({ id: meta.id, subject: meta.subject, sentAt: meta.sentAt, bucket: bucketFor(meta.to, meta.cc, options.org), to: meta.to, body });
    }
    const byBucket: Partial<Record<Bucket, number>> = {};
    for (const message of messages) byBucket[message.bucket] = (byBucket[message.bucket] ?? 0) + 1;
    const path = `data/scratch/${runStamp(deps.clock.nowIso())}/corpus.json`;
    const written = await deps.writer.write(path, JSON.stringify({ generatedAt: deps.clock.nowIso(), me: options.me.email, byBucket, messages }, null, 2));
    if (!written.ok) return err(written.error);
    deps.logger.info('voice-corpus-extracted', { kept: messages.length, scanned });
    return ok({ path, kept: messages.length, scanned, byBucket });
  };
