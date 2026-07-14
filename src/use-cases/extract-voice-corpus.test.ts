import { describe, expect, test } from 'bun:test';

import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { createLoggerFake } from '../test-helpers/logger-fake.ts';
import type { LoggerFake } from '../test-helpers/logger-fake.ts';
import { createExtractVoiceCorpus } from './extract-voice-corpus.ts';
import type { CorpusOptions, ExtractVoiceCorpus } from './extract-voice-corpus.ts';
import type { OfficeError } from './ports/office.ts';

type OfficeResp = Result<unknown, OfficeError>;

const NOW = '2026-07-04T18:15:00.000Z';

const OPTIONS: CorpusOptions = {
  me: { displayName: 'Vincent DELACOURT', email: 'me@internal-corp.com', jobTitle: 'Chief Information Officer' },
  org: { ownDomains: ['internal-corp.com'], managerEmails: ['jane.boss@internal-corp.com'] },
  fetchTop: 100,
  keep: 2,
};

const sentMeta = (id: string, to: string, extras: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  subject: `Subject ${id}`,
  receivedDateTime: '2026-07-01T08:00:00Z',
  toRecipients: [{ emailAddress: { address: to } }],
  ccRecipients: [],
  ...extras,
});

const substantiveMd = (who: string): string =>
  `**Subject:** x\n\nHello ${who}, confirmed for Ledger, we align with the group choice and I will push the QUICK OB step with Sam next week.\n\n**_Vincent DELACOURT_**\n`;

type Setup = {
  readonly extract: ExtractVoiceCorpus;
  readonly written: ReadonlyArray<{ readonly path: string; readonly content: string }>;
  readonly officeLog: ReadonlyArray<{ command: string; params: Record<string, string> }>;
  readonly logger: LoggerFake;
};

const setup = (list: OfficeResp, convertById: Readonly<Record<string, OfficeResp>> = {}): Setup => {
  const written: { path: string; content: string }[] = [];
  const officeLog: { command: string; params: Record<string, string> }[] = [];
  const logger = createLoggerFake();
  const extract = createExtractVoiceCorpus({
    office: {
      execute: async (command, params) => {
        officeLog.push({ command, params });
        if (command === 'search-mail-messages') return list;
        if (command === 'convert-mail-to-markdown') {
          // the corpus is prose-only: a conversion that embeds base64 images is a broken call
          if (params['inlineImages'] !== 'false') return err({ kind: 'command-failed', message: 'corpus conversion must pass inlineImages false' });
          return convertById[params['messageId']] ?? err({ kind: 'command-failed', message: 'no fixture' });
        }
        return err({ kind: 'unknown-command', message: command });
      },
    },
    writer: {
      write: async (path, content) => {
        written.push({ path, content });
        return ok(undefined);
      },
    },
    clock: { todayIso: () => NOW.slice(0, 10), nowIso: () => NOW },
    logger,
  });
  return { extract, written, officeLog, logger };
};

const listData = (value: unknown): OfficeResp => ok({ value });
const markdownData = (text: string): OfficeResp => ok({ contentType: 'text/markdown', size: text.length, text });

describe('extract-voice-corpus', () => {
  test('the corpus keeps the last N substantive own-bodies from all folders, bucketed', async () => {
    const { extract, written, logger } = setup(
      listData([sentMeta('s1', 'jane.boss@internal-corp.com'), sentMeta('s2', 'peer@internal-corp.com'), sentMeta('s3', 'vendor@ext-corp.com')]),
      {
        s1: markdownData(substantiveMd('Jane')),
        s2: markdownData('**Subject:** x\n\nOk noted.'),
        s3: markdownData(substantiveMd('Vendor')),
      }
    );

    const result = await extract(OPTIONS);

    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual({ path: 'data/scratch/voice-20260704-181500/corpus.json', kept: 2, scanned: 3, byBucket: { upward: 1, external: 1 } });
    expect(logger.calls).toEqual([{ level: 'info', event: 'voice-corpus-extracted', meta: { kept: 2, scanned: 3 } }]);
    const corpus = JSON.parse(written[0].content);
    expect(corpus.me).toBe('me@internal-corp.com');
    expect(corpus.messages.map((m: { id: string; bucket: string }) => [m.id, m.bucket])).toEqual([
      ['s1', 'upward'],
      ['s3', 'external'],
    ]);
    expect(corpus.messages[0].body.startsWith('Hello Jane, confirmed for Ledger')).toBe(true);
    expect(corpus.messages[0].body.includes('Vincent DELACOURT')).toBe(false);
  });

  test('the corpus stops at the keep cap even when more substantive messages remain', async () => {
    const { extract } = setup(listData([sentMeta('a', 'p1@internal-corp.com'), sentMeta('b', 'p2@internal-corp.com'), sentMeta('c', 'p3@internal-corp.com')]), {
      a: markdownData(substantiveMd('A')),
      b: markdownData(substantiveMd('B')),
      c: markdownData(substantiveMd('C')),
    });

    const result = await extract(OPTIONS);

    if (!result.ok) throw new Error('expected ok');
    // keep is 2: the cap halts scanning at the third message, so it is never converted
    expect(result.value.kept).toBe(2);
    expect(result.value.scanned).toBe(2);
  });

  test('drafts and unconvertible messages never enter the corpus', async () => {
    const { extract } = setup(
      listData([sentMeta('d1', 'a@internal-corp.com', { isDraft: true }), sentMeta('s2', 'peer@internal-corp.com'), sentMeta('bad', 'x@internal-corp.com')]),
      {
        s2: markdownData(substantiveMd('Peer')),
        bad: err({ kind: 'command-failed', message: 'boom' }),
      }
    );

    const result = await extract(OPTIONS);

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.kept).toBe(1);
    expect(result.value.scanned).toBe(2);
  });

  test('the corpus is sourced by a from:me KQL search across all folders (no InefficientFilter combo), slim select', async () => {
    const { extract, officeLog } = setup(listData([]));

    await extract(OPTIONS);

    // search-mail-messages, NOT list-mail-messages with $filter+$orderby (which Graph rejects);
    // raw unquoted KQL, no $orderby (search forbids it - we sort client-side)
    expect(officeLog[0]).toEqual({
      command: 'search-mail-messages',
      params: { query: 'from:me@internal-corp.com', top: '100', select: 'id,subject,toRecipients,ccRecipients,receivedDateTime,isDraft' },
    });
  });

  test('search ranks by relevance, so the keep-loop sees the corpus newest-first via a client-side sort', async () => {
    // input order is scrambled by date; keep is 2, so ONLY the two newest must survive
    const { extract, written } = setup(
      listData([
        sentMeta('old', 'p1@internal-corp.com', { receivedDateTime: '2026-01-01T00:00:00Z' }),
        sentMeta('newest', 'p2@internal-corp.com', { receivedDateTime: '2026-07-10T00:00:00Z' }),
        sentMeta('middle', 'p3@internal-corp.com', { receivedDateTime: '2026-07-05T00:00:00Z' }),
      ]),
      { old: markdownData(substantiveMd('Old')), newest: markdownData(substantiveMd('New')), middle: markdownData(substantiveMd('Mid')) }
    );

    const result = await extract(OPTIONS);

    if (!result.ok) throw new Error('expected ok');
    // without the sort the loop would keep old+newest (input order); with it, newest+middle
    expect(JSON.parse(written[0].content).messages.map((m: { id: string }) => m.id)).toEqual(['newest', 'middle']);
  });

  test('a mail source failure surfaces as source-failed; malformed list data is a well-formed empty corpus', async () => {
    const { extract } = setup(err({ kind: 'command-failed', message: 'boom' }));
    expect(await extract(OPTIONS)).toEqual({ ok: false, error: { kind: 'source-failed', source: 'search-mail-messages', message: 'boom' } });

    const garbage = setup(ok('not a record'));
    const result = await garbage.extract(OPTIONS);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.kept).toBe(0);
  });
});
