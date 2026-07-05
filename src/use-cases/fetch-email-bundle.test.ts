import { describe, expect, test } from 'bun:test';

import { parseRunId } from '../domain/run-id.ts';
import { err, ok, unwrap } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { createLoggerFake } from '../test-helpers/logger-fake.ts';
import type { LoggerFake } from '../test-helpers/logger-fake.ts';
import { createFetchEmailBundle } from './fetch-email-bundle.ts';
import type { BundleRequest, FetchEmailBundle } from './fetch-email-bundle.ts';
import type { CommandOutput, RunError } from './ports/command-runner.ts';

const RUN_ID = unwrap(parseRunId('run-20260704-135959'));
const REQUEST: BundleRequest = { runId: RUN_ID, emailId: 'msg-2', conversationId: 'conv-abc' };

type Written = { readonly path: string; readonly content: string };

type Setup = { readonly fetchBundle: FetchEmailBundle; readonly written: ReadonlyArray<Written>; readonly runnerLog: ReadonlyArray<string>; readonly logger: LoggerFake };

type Overrides = {
  readonly convert?: Record<string, Result<CommandOutput, RunError>>;
  readonly attachments?: Record<string, Result<CommandOutput, RunError>>;
  readonly readAttachment?: Record<string, Result<CommandOutput, RunError>>;
  readonly failWrite?: (path: string) => boolean;
};

const threadEnvelope = (messages: ReadonlyArray<unknown>): Result<CommandOutput, RunError> => ok({ stdout: JSON.stringify({ ok: true, data: { value: messages } }), exitCode: 0 });

const markdownEnvelope = (text: string): Result<CommandOutput, RunError> =>
  ok({ stdout: JSON.stringify({ ok: true, data: { contentType: 'text/markdown', size: text.length, text } }), exitCode: 0 });

const attachmentsEnvelope = (list: ReadonlyArray<unknown>): Result<CommandOutput, RunError> => ok({ stdout: JSON.stringify({ ok: true, data: { value: list } }), exitCode: 0 });

const setup = (thread: Result<CommandOutput, RunError>, markdownById: Record<string, string>, overrides: Overrides = {}): Setup => {
  const written: Written[] = [];
  const runnerLog: string[] = [];
  const logger = createLoggerFake();
  const fetchBundle = createFetchEmailBundle({
    runner: {
      run: async (cmd, args) => {
        runnerLog.push([cmd, ...args].join(' '));
        if (args[0] === 'list-conversation-messages') return thread;
        const id = args[args.indexOf('--message-id') + 1];
        if (args[0] === 'list-mail-attachments') return overrides.attachments?.[id] ?? attachmentsEnvelope([]);
        if (args[0] === 'read-mail-attachment') return overrides.readAttachment?.[args[args.indexOf('--attachment-id') + 1]] ?? markdownEnvelope('');
        return overrides.convert?.[id] ?? markdownEnvelope(markdownById[id] ?? '');
      },
    },
    writer: {
      write: async (path, content) => {
        if (overrides.failWrite?.(path) === true) return err({ kind: 'write-failed', path, message: 'disk full' });
        written.push({ path, content });
        return ok(undefined);
      },
    },
    logger,
  });
  return { fetchBundle, written, runnerLog, logger };
};

const messageOf = (id: string, receivedDateTime: string, hasAttachments: boolean): Record<string, unknown> => ({
  id,
  subject: `Subject ${id}`,
  from: { emailAddress: { address: `${id}@x.com` } },
  receivedDateTime,
  hasAttachments,
});

describe('fetch-email-bundle', () => {
  test('researching an approved email pulls its whole thread, writes each message as markdown, and manifests them in chronological order', async () => {
    // thread comes back UNORDERED (reply before original) to prove client-side chronological sort
    const thread = [
      { id: 'msg-2', subject: 'RE: Q3 envelope', from: { emailAddress: { name: 'Jane', address: 'Jane@X.com' } }, receivedDateTime: '2026-07-02T10:00:00Z', hasAttachments: false },
      {
        id: 'msg-1',
        subject: 'Q3 envelope',
        from: { emailAddress: { name: 'Vincent', address: 'v@example.com' } },
        receivedDateTime: '2026-07-01T09:00:00Z',
        hasAttachments: true,
      },
    ];
    const markdown = { 'msg-1': '**Subject:** Q3 envelope\n\nOriginal body', 'msg-2': '**Subject:** RE: Q3 envelope\n\nReply body' };
    const { fetchBundle, written, runnerLog, logger } = setup(threadEnvelope(thread), markdown);

    const result = await fetchBundle({ runId: RUN_ID, emailId: 'msg-2', conversationId: 'conv-abc' });

    // 1. correct CLI ladder: list the thread, convert each message, and list attachments only for the one that has them
    expect(runnerLog).toEqual([
      'ask-marcel-office list-conversation-messages --conversation-id conv-abc --select id,subject,from,receivedDateTime,hasAttachments --output json',
      'ask-marcel-office convert-mail-to-markdown --message-id msg-1 --inline-images false --output json',
      'ask-marcel-office convert-mail-to-markdown --message-id msg-2 --inline-images false --output json',
      'ask-marcel-office list-mail-attachments --message-id msg-1 --select id,name,contentType,size,isInline --output json',
    ]);

    // 2. each message written as markdown, numbered chronologically
    expect(written.find((w) => w.path === `data/scratch/${RUN_ID}/msg-2/bundle/messages/01-msg-1.md`)?.content).toBe('**Subject:** Q3 envelope\n\nOriginal body');
    expect(written.find((w) => w.path === `data/scratch/${RUN_ID}/msg-2/bundle/messages/02-msg-2.md`)?.content).toBe('**Subject:** RE: Q3 envelope\n\nReply body');

    // 3. manifest lists every artifact + conversion status, bundle-relative paths, no silent failures
    const manifestFile = written.find((w) => w.path === `data/scratch/${RUN_ID}/msg-2/bundle/manifest.json`);
    if (manifestFile === undefined) throw new Error('manifest.json not written');
    expect(JSON.parse(manifestFile.content)).toEqual({
      emailId: 'msg-2',
      conversationId: 'conv-abc',
      messages: [
        {
          order: 1,
          messageId: 'msg-1',
          subject: 'Q3 envelope',
          from: 'v@example.com',
          receivedDateTime: '2026-07-01T09:00:00Z',
          hasAttachments: true,
          path: 'messages/01-msg-1.md',
          status: 'converted',
          attachments: [],
        },
        {
          order: 2,
          messageId: 'msg-2',
          subject: 'RE: Q3 envelope',
          from: 'jane@x.com',
          receivedDateTime: '2026-07-02T10:00:00Z',
          hasAttachments: false,
          path: 'messages/02-msg-2.md',
          status: 'converted',
          attachments: [],
        },
      ],
    });

    // 4. compact summary handed back to the researcher orchestration, and the run is logged
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual({ emailId: 'msg-2', conversationId: 'conv-abc', messageCount: 2, threadHasAttachments: true });
    expect(logger.calls).toEqual([{ level: 'info', event: 'bundle-fetched', meta: { emailId: 'msg-2', messageCount: 2 } }]);
  });

  test('an IO failure at any step surfaces as a typed error, never a crash', async () => {
    const spawnFailed = setup(err({ kind: 'spawn-failed', message: 'EPERM' }), {});
    expect(await spawnFailed.fetchBundle(REQUEST)).toEqual({ ok: false, error: { kind: 'thread-fetch-failed', message: 'EPERM' } });

    const nonZeroExit = setup(ok({ stdout: 'x', exitCode: 2 }), {});
    expect(await nonZeroExit.fetchBundle(REQUEST)).toEqual({ ok: false, error: { kind: 'thread-fetch-failed', message: 'exited 2' } });

    const badJson = setup(ok({ stdout: 'not json', exitCode: 0 }), {});
    expect(await badJson.fetchBundle(REQUEST)).toEqual({ ok: false, error: { kind: 'thread-fetch-failed', message: 'invalid json' } });

    // a message-file write and the manifest write each surface as write-failed
    const oneMessage = [messageOf('m', '2026-07-01T00:00:00Z', false)];
    const messageWriteFails = setup(threadEnvelope(oneMessage), { m: 'body' }, { failWrite: (path) => path.endsWith('.md') });
    expect(await messageWriteFails.fetchBundle(REQUEST)).toEqual({
      ok: false,
      error: { kind: 'write-failed', path: `data/scratch/${RUN_ID}/msg-2/bundle/messages/01-m.md`, message: 'disk full' },
    });

    const manifestWriteFails = setup(threadEnvelope(oneMessage), { m: 'body' }, { failWrite: (path) => path.endsWith('manifest.json') });
    expect(await manifestWriteFails.fetchBundle(REQUEST)).toEqual({
      ok: false,
      error: { kind: 'write-failed', path: `data/scratch/${RUN_ID}/msg-2/bundle/manifest.json`, message: 'disk full' },
    });
  });

  test('a message that fails to convert is manifested as failed and writes no file, while the rest still bundle', async () => {
    const thread = [messageOf('m1', '2026-07-01T00:00:00Z', false), messageOf('m2', '2026-07-02T00:00:00Z', false)];
    const failModes: Record<string, Result<CommandOutput, RunError>> = {
      'spawn error': err({ kind: 'spawn-failed', message: 'boom' }),
      'non-zero exit': ok({ stdout: 'x', exitCode: 3 }),
      'invalid json': ok({ stdout: 'nope', exitCode: 0 }),
      'data not a record': ok({ stdout: JSON.stringify({ ok: true, data: 'oops' }), exitCode: 0 }),
      'missing text': ok({ stdout: JSON.stringify({ ok: true, data: { contentType: 'text/markdown', size: 0 } }), exitCode: 0 }),
    };

    for (const [label, response] of Object.entries(failModes)) {
      const { fetchBundle, written } = setup(threadEnvelope(thread), { m1: 'good body' }, { convert: { m2: response } });
      const result = await fetchBundle(REQUEST);
      if (!result.ok) throw new Error(`expected ok for ${label}`);
      expect(result.value.threadHasAttachments).toBe(false);
      const manifestFile = written.find((w) => w.path.endsWith('manifest.json'));
      if (manifestFile === undefined) throw new Error(`manifest not written for ${label}`);
      const statuses = JSON.parse(manifestFile.content).messages.map((message: { status: string }) => message.status);
      expect(statuses).toEqual(['converted', 'failed']);
      expect(written.some((w) => w.path.endsWith('01-m1.md'))).toBe(true);
      expect(written.some((w) => w.path.endsWith('02-m2.md'))).toBe(false);
    }
  });

  test('malformed thread entries are skipped and missing fields fall back to defaults', async () => {
    const thread = [
      messageOf('ok1', '2026-07-01T00:00:00Z', false),
      'not-a-record',
      null,
      { subject: 'neither id nor sender', receivedDateTime: '2026-07-02T00:00:00Z' },
      { id: 'has-id-no-sender', subject: 'orphan' },
      { from: { emailAddress: { address: 'z@z.com' } }, subject: 'sender-but-no-id' },
      { id: 'ok2', from: { emailAddress: { address: 'C@D.com' } }, hasAttachments: false },
    ];
    const { fetchBundle, written } = setup(threadEnvelope(thread), { ok1: 'b1', ok2: 'b2' });

    const result = await fetchBundle(REQUEST);

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.messageCount).toBe(2);
    const manifestFile = written.find((w) => w.path.endsWith('manifest.json'));
    if (manifestFile === undefined) throw new Error('manifest not written');
    const messages = JSON.parse(manifestFile.content).messages;
    expect(messages).toHaveLength(2);
    const defaulted = messages.find((message: { messageId: string }) => message.messageId === 'ok2');
    expect(defaulted).toEqual({
      order: 1,
      messageId: 'ok2',
      subject: '(no subject)',
      from: 'c@d.com',
      receivedDateTime: '',
      hasAttachments: false,
      path: 'messages/01-ok2.md',
      status: 'converted',
      attachments: [],
    });
  });

  test('a conversation with no recognizable messages yields an empty bundle, not a crash', async () => {
    const noValueArray = setup(ok({ stdout: JSON.stringify({ ok: true, data: {} }), exitCode: 0 }), {});
    const emptyResult = await noValueArray.fetchBundle(REQUEST);
    if (!emptyResult.ok) throw new Error('expected ok');
    expect(emptyResult.value).toEqual({ emailId: 'msg-2', conversationId: 'conv-abc', messageCount: 0, threadHasAttachments: false });
    const manifestFile = noValueArray.written.find((w) => w.path.endsWith('manifest.json'));
    if (manifestFile === undefined) throw new Error('manifest not written');
    expect(JSON.parse(manifestFile.content).messages).toEqual([]);

    const nonRecordData = setup(ok({ stdout: JSON.stringify({ ok: true, data: null }), exitCode: 0 }), {});
    const nullResult = await nonRecordData.fetchBundle(REQUEST);
    if (!nullResult.ok) throw new Error('expected ok');
    expect(nullResult.value.messageCount).toBe(0);
  });

  test('every message with attachments has its attachment metadata listed in the manifest; a message without is not queried', async () => {
    const thread = [messageOf('msg-1', '2026-07-01T00:00:00Z', true), messageOf('msg-2', '2026-07-02T00:00:00Z', false)];
    const attachments = {
      'msg-1': attachmentsEnvelope([
        { id: 'att-1', name: 'contract.pdf', contentType: 'application/pdf', size: 12345, isInline: false },
        { id: 'att-2', name: 'logo.png', contentType: 'image/png', size: 678, isInline: true },
      ]),
    };
    const readAttachment = { 'att-1': markdownEnvelope('contract body'), 'att-2': markdownEnvelope('logo alt text') };
    const { fetchBundle, written, runnerLog } = setup(threadEnvelope(thread), { 'msg-1': 'b1', 'msg-2': 'b2' }, { attachments, readAttachment });

    const result = await fetchBundle(REQUEST);

    // only the message that has attachments is queried
    expect(runnerLog).toContain('ask-marcel-office list-mail-attachments --message-id msg-1 --select id,name,contentType,size,isInline --output json');
    expect(runnerLog.some((call) => call.includes('list-mail-attachments --message-id msg-2'))).toBe(false);

    // the manifest records each attachment's metadata, inline flag preserved
    if (!result.ok) throw new Error('expected ok');
    const messages = JSON.parse(written.find((w) => w.path.endsWith('manifest.json'))!.content).messages;
    expect(messages.find((message: { messageId: string }) => message.messageId === 'msg-1').attachments).toEqual([
      { attachmentId: 'att-1', name: 'contract.pdf', contentType: 'application/pdf', size: 12345, isInline: false, path: 'attachments/01-01-contract-pdf.md', status: 'converted' },
      { attachmentId: 'att-2', name: 'logo.png', contentType: 'image/png', size: 678, isInline: true, path: 'attachments/01-02-logo-png.md', status: 'converted' },
    ]);
    expect(messages.find((message: { messageId: string }) => message.messageId === 'msg-2').attachments).toEqual([]);
  });

  test('a failed attachment listing is recorded on the message without sinking the bundle', async () => {
    const failModes: Record<string, Result<CommandOutput, RunError>> = {
      'spawn error': err({ kind: 'spawn-failed', message: 'boom' }),
      'non-zero exit': ok({ stdout: 'x', exitCode: 5 }),
      'invalid json': ok({ stdout: 'nope', exitCode: 0 }),
    };
    const expectedError: Record<string, string> = { 'spawn error': 'boom', 'non-zero exit': 'exited 5', 'invalid json': 'invalid json' };

    for (const [label, response] of Object.entries(failModes)) {
      const { fetchBundle, written } = setup(threadEnvelope([messageOf('m1', '2026-07-01T00:00:00Z', true)]), { m1: 'body' }, { attachments: { m1: response } });
      const result = await fetchBundle(REQUEST);
      if (!result.ok) throw new Error(`expected ok for ${label}`);
      const entry = JSON.parse(written.find((w) => w.path.endsWith('manifest.json'))!.content).messages[0];
      expect(entry.attachments).toEqual([]);
      expect(entry.attachmentsError).toBe(expectedError[label]);
    }
  });

  test('malformed attachment entries are skipped and missing fields fall back to defaults', async () => {
    const list = [{ id: 'a1', name: 'doc.pdf', contentType: 'application/pdf', size: 10, isInline: false }, 'not-a-record', null, { name: 'no-id.png' }, { id: 'a2' }];
    const { fetchBundle, written } = setup(
      threadEnvelope([messageOf('m1', '2026-07-01T00:00:00Z', true)]),
      { m1: 'body' },
      { attachments: { m1: attachmentsEnvelope(list) }, readAttachment: { a2: markdownEnvelope('a2 body') } }
    );

    const result = await fetchBundle(REQUEST);

    if (!result.ok) throw new Error('expected ok');
    const attachments = JSON.parse(written.find((w) => w.path.endsWith('manifest.json'))!.content).messages[0].attachments;
    expect(attachments).toHaveLength(2);
    expect(attachments.find((attachment: { attachmentId: string }) => attachment.attachmentId === 'a2')).toEqual({
      attachmentId: 'a2',
      name: '(unnamed)',
      contentType: '',
      size: 0,
      isInline: false,
      path: 'attachments/01-02-unnamed.md',
      status: 'converted',
    });
  });

  test('each listed attachment is converted to markdown, written to the bundle, and marked converted or failed', async () => {
    const thread = [messageOf('m1', '2026-07-01T00:00:00Z', true)];
    const attachments = {
      m1: attachmentsEnvelope([
        { id: 'att-1', name: 'contract.pdf', contentType: 'application/pdf', size: 10, isInline: false },
        { id: 'att-2', name: 'photo.png', contentType: 'image/png', size: 20, isInline: true },
      ]),
    };
    const readAttachment = {
      'att-1': markdownEnvelope('# Contract\n\nterms'),
      'att-2': ok({ stdout: JSON.stringify({ ok: false, error: 'unsupported image (415)' }), exitCode: 0 }),
    };
    const { fetchBundle, written, runnerLog } = setup(threadEnvelope(thread), { m1: 'body' }, { attachments, readAttachment });

    const result = await fetchBundle(REQUEST);

    // every listed attachment is read by id
    expect(runnerLog).toContain('ask-marcel-office read-mail-attachment --message-id m1 --attachment-id att-1 --output json');
    expect(runnerLog).toContain('ask-marcel-office read-mail-attachment --message-id m1 --attachment-id att-2 --output json');

    if (!result.ok) throw new Error('expected ok');
    // the converted attachment's markdown lands in the bundle; the image writes no file
    expect(written.find((w) => w.path === `data/scratch/${RUN_ID}/msg-2/bundle/attachments/01-01-contract-pdf.md`)?.content).toBe('# Contract\n\nterms');
    expect(written.some((w) => w.path.endsWith('01-02-photo-png.md'))).toBe(false);
    // the manifest records path + status per attachment
    expect(JSON.parse(written.find((w) => w.path.endsWith('manifest.json'))!.content).messages[0].attachments).toEqual([
      { attachmentId: 'att-1', name: 'contract.pdf', contentType: 'application/pdf', size: 10, isInline: false, path: 'attachments/01-01-contract-pdf.md', status: 'converted' },
      { attachmentId: 'att-2', name: 'photo.png', contentType: 'image/png', size: 20, isInline: true, status: 'failed' },
    ]);
  });

  test('a failed write of a converted attachment surfaces as a typed error', async () => {
    const thread = [messageOf('m1', '2026-07-01T00:00:00Z', true)];
    const attachments = { m1: attachmentsEnvelope([{ id: 'att-1', name: 'contract.pdf', contentType: 'application/pdf', size: 10, isInline: false }]) };
    const readAttachment = { 'att-1': markdownEnvelope('contract body') };
    const { fetchBundle } = setup(threadEnvelope(thread), { m1: 'body' }, { attachments, readAttachment, failWrite: (path) => path.includes('/attachments/') });

    expect(await fetchBundle(REQUEST)).toEqual({
      ok: false,
      error: { kind: 'write-failed', path: `data/scratch/${RUN_ID}/msg-2/bundle/attachments/01-01-contract-pdf.md`, message: 'disk full' },
    });
  });
});
