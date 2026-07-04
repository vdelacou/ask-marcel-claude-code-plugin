import { extractSentMetas, parseEnvelope } from '../domain/graph-envelopes.ts';
import type { SentMeta } from '../domain/graph-envelopes.ts';
import { extractOwnBody } from '../domain/own-body.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { bucketFor, isSubstantive } from '../domain/voice-rules.ts';
import type { Bucket, OrgContext } from '../domain/voice-rules.ts';
import type { Clock } from './ports/clock.ts';
import type { CommandRunner } from './ports/command-runner.ts';
import type { FileWriter, WriteError } from './ports/file-writer.ts';
import type { Logger } from './ports/logger.ts';

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
  readonly runner: CommandRunner;
  readonly writer: FileWriter;
  readonly clock: Clock;
  readonly logger: Logger;
};

const listSent = async (deps: Deps, options: CorpusOptions): Promise<Result<ReadonlyArray<SentMeta>, CorpusError>> => {
  const args = [
    'list-mail-messages',
    '--filter',
    `from/emailAddress/address eq '${options.me.email}'`,
    '--top',
    String(options.fetchTop),
    '--select',
    'id,subject,toRecipients,ccRecipients,receivedDateTime,isDraft',
    '--output',
    'json',
  ];
  const run = await deps.runner.run('ask-marcel-office', args);
  if (!run.ok) return err({ kind: 'source-failed', source: 'list-mail-messages', message: run.error.message });
  if (run.value.exitCode !== 0) return err({ kind: 'source-failed', source: 'list-mail-messages', message: `exited ${run.value.exitCode}` });
  const parsed = parseEnvelope(run.value.stdout);
  return parsed.ok ? ok(extractSentMetas(parsed.value)) : err({ kind: 'source-failed', source: 'list-mail-messages', message: parsed.error });
};

const ownBodyOf = async (deps: Deps, meta: SentMeta, options: CorpusOptions): Promise<string | undefined> => {
  const converted = await deps.runner.run('ask-marcel-office', ['convert-mail-to-markdown', '--message-id', meta.id]);
  if (!converted.ok || converted.value.exitCode !== 0) return undefined;
  const body = extractOwnBody(converted.value.stdout, options.me.displayName, options.me.jobTitle);
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
