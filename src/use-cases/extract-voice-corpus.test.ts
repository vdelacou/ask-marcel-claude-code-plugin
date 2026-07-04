import { describe, expect, test } from 'bun:test';

import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { createLoggerFake } from '../test-helpers/logger-fake.ts';
import type { CommandOutput, RunError } from './ports/command-runner.ts';
import { createExtractVoiceCorpus } from './extract-voice-corpus.ts';
import type { CorpusOptions, ExtractVoiceCorpus } from './extract-voice-corpus.ts';

const NOW = '2026-07-04T18:15:00.000Z';

const OPTIONS: CorpusOptions = {
  me: { displayName: 'Vincent DELACOURT', email: 'me@internal-corp.com', jobTitle: 'Chief Information Officer' },
  org: { ownDomains: ['internal-corp.com'], managerEmails: ['jane.boss@internal-corp.com'] },
  fetchTop: 100,
  keep: 2,
};

const LIST_KEY =
  "ask-marcel-office list-mail-messages --filter from/emailAddress/address eq 'me@internal-corp.com' --top 100 --select id,subject,toRecipients,ccRecipients,receivedDateTime,isDraft --output json";

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

type Setup = { readonly extract: ExtractVoiceCorpus; readonly written: ReadonlyArray<{ readonly path: string; readonly content: string }> };

const setup = (responses: Readonly<Record<string, Result<CommandOutput, RunError>>>): Setup => {
  const written: { path: string; content: string }[] = [];
  const extract = createExtractVoiceCorpus({
    runner: { run: async (cmd, args) => responses[[cmd, ...args].join(' ')] ?? err({ kind: 'not-found', message: `${cmd}: command not found` }) },
    writer: {
      write: async (path, content) => {
        written.push({ path, content });
        return ok(undefined);
      },
    },
    clock: { todayIso: () => NOW.slice(0, 10), nowIso: () => NOW },
    logger: createLoggerFake(),
  });
  return { extract, written };
};

const envelope = (value: unknown): Result<CommandOutput, RunError> => ok({ stdout: JSON.stringify({ ok: true, data: { value } }), exitCode: 0 });
const markdown = (text: string): Result<CommandOutput, RunError> => ok({ stdout: text, exitCode: 0 });

describe('extract-voice-corpus', () => {
  test('the corpus keeps the last N substantive own-bodies from all folders, bucketed', async () => {
    const { extract, written } = setup({
      [LIST_KEY]: envelope([sentMeta('s1', 'jane.boss@internal-corp.com'), sentMeta('s2', 'peer@internal-corp.com'), sentMeta('s3', 'vendor@ext-corp.com')]),
      'ask-marcel-office convert-mail-to-markdown --message-id s1': markdown(substantiveMd('Jane')),
      'ask-marcel-office convert-mail-to-markdown --message-id s2': markdown('**Subject:** x\n\nOk noted.'),
      'ask-marcel-office convert-mail-to-markdown --message-id s3': markdown(substantiveMd('Vendor')),
    });

    const result = await extract(OPTIONS);

    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual({ path: 'data/scratch/voice-20260704-181500/corpus.json', kept: 2, scanned: 3, byBucket: { upward: 1, external: 1 } });
    const corpus = JSON.parse(written[0].content);
    expect(corpus.me).toBe('me@internal-corp.com');
    expect(corpus.messages.map((m: { id: string; bucket: string }) => [m.id, m.bucket])).toEqual([
      ['s1', 'upward'],
      ['s3', 'external'],
    ]);
    expect(corpus.messages[0].body.startsWith('Hello Jane, confirmed for Ledger')).toBe(true);
    expect(corpus.messages[0].body.includes('Vincent DELACOURT')).toBe(false);
  });

  test('drafts and unconvertible messages never enter the corpus', async () => {
    const { extract } = setup({
      [LIST_KEY]: envelope([sentMeta('d1', 'a@internal-corp.com', { isDraft: true }), sentMeta('s2', 'peer@internal-corp.com'), sentMeta('bad', 'x@internal-corp.com')]),
      'ask-marcel-office convert-mail-to-markdown --message-id s2': markdown(substantiveMd('Peer')),
      'ask-marcel-office convert-mail-to-markdown --message-id bad': err({ kind: 'spawn-failed', message: 'boom' }),
    });

    const result = await extract(OPTIONS);

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.kept).toBe(1);
    expect(result.value.scanned).toBe(2);
  });

  test('a mail source failure surfaces as source-failed, not a crash', async () => {
    const { extract } = setup({ [LIST_KEY]: ok({ stdout: 'segfault', exitCode: 3 }) });

    expect(await extract(OPTIONS)).toEqual({ ok: false, error: { kind: 'source-failed', source: 'list-mail-messages', message: 'exited 3' } });

    const notJson = setup({ [LIST_KEY]: ok({ stdout: 'not json', exitCode: 0 }) });
    expect(await notJson.extract(OPTIONS)).toEqual({ ok: false, error: { kind: 'source-failed', source: 'list-mail-messages', message: 'invalid json' } });

    const noCli = setup({});
    expect(await noCli.extract(OPTIONS)).toEqual({ ok: false, error: { kind: 'source-failed', source: 'list-mail-messages', message: 'ask-marcel-office: command not found' } });
  });
});
