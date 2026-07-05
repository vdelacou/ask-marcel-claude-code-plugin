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

type Overrides = { readonly failWrite?: (path: string) => boolean };

const threadEnvelope = (messages: ReadonlyArray<unknown>): Result<CommandOutput, RunError> => ok({ stdout: JSON.stringify({ ok: true, data: { value: messages } }), exitCode: 0 });

const setup = (thread: Result<CommandOutput, RunError>, overrides: Overrides = {}): Setup => {
  const written: Written[] = [];
  const runnerLog: string[] = [];
  const logger = createLoggerFake();
  const fetchBundle = createFetchEmailBundle({
    runner: {
      run: async (cmd, args) => {
        runnerLog.push([cmd, ...args].join(' '));
        return thread;
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

describe('fetch-email-bundle: thread membership', () => {
  test('researching an approved email lists the whole conversation and manifests every message in chronological order', async () => {
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
    const { fetchBundle, written, runnerLog, logger } = setup(threadEnvelope(thread));

    const result = await fetchBundle(REQUEST);

    // the whole thread is listed with one Graph call
    expect(runnerLog).toEqual(['ask-marcel-office list-conversation-messages --conversation-id conv-abc --select id,subject,from,receivedDateTime,hasAttachments --output json']);

    // the manifest names every message, chronological, sender lowercased
    const manifestFile = written.find((w) => w.path === `data/scratch/${RUN_ID}/msg-2/bundle/manifest.json`);
    if (manifestFile === undefined) throw new Error('manifest.json not written');
    expect(JSON.parse(manifestFile.content)).toEqual({
      emailId: 'msg-2',
      conversationId: 'conv-abc',
      messages: [
        { order: 1, messageId: 'msg-1', subject: 'Q3 envelope', from: 'v@example.com', receivedDateTime: '2026-07-01T09:00:00Z', hasAttachments: true },
        { order: 2, messageId: 'msg-2', subject: 'RE: Q3 envelope', from: 'jane@x.com', receivedDateTime: '2026-07-02T10:00:00Z', hasAttachments: false },
      ],
    });

    // compact summary for the researcher orchestration, and the run is logged
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual({ emailId: 'msg-2', conversationId: 'conv-abc', messageCount: 2, threadHasAttachments: true });
    expect(logger.calls).toEqual([{ level: 'info', event: 'bundle-fetched', meta: { emailId: 'msg-2', messageCount: 2 } }]);
  });

  test('an IO failure at any step surfaces as a typed error, never a crash', async () => {
    const spawnFailed = setup(err({ kind: 'spawn-failed', message: 'EPERM' }));
    expect(await spawnFailed.fetchBundle(REQUEST)).toEqual({ ok: false, error: { kind: 'thread-fetch-failed', message: 'EPERM' } });

    const nonZeroExit = setup(ok({ stdout: 'x', exitCode: 2 }));
    expect(await nonZeroExit.fetchBundle(REQUEST)).toEqual({ ok: false, error: { kind: 'thread-fetch-failed', message: 'exited 2' } });

    const badJson = setup(ok({ stdout: 'not json', exitCode: 0 }));
    expect(await badJson.fetchBundle(REQUEST)).toEqual({ ok: false, error: { kind: 'thread-fetch-failed', message: 'invalid json' } });

    const manifestWriteFails = setup(threadEnvelope([messageOf('m', '2026-07-01T00:00:00Z', false)]), { failWrite: (path) => path.endsWith('manifest.json') });
    expect(await manifestWriteFails.fetchBundle(REQUEST)).toEqual({
      ok: false,
      error: { kind: 'write-failed', path: `data/scratch/${RUN_ID}/msg-2/bundle/manifest.json`, message: 'disk full' },
    });
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
    const { fetchBundle, written } = setup(threadEnvelope(thread));

    const result = await fetchBundle(REQUEST);

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.messageCount).toBe(2);
    const manifestFile = written.find((w) => w.path.endsWith('manifest.json'));
    if (manifestFile === undefined) throw new Error('manifest not written');
    const messages = JSON.parse(manifestFile.content).messages;
    expect(messages).toHaveLength(2);
    const defaulted = messages.find((message: { messageId: string }) => message.messageId === 'ok2');
    expect(defaulted).toEqual({ order: 1, messageId: 'ok2', subject: '(no subject)', from: 'c@d.com', receivedDateTime: '', hasAttachments: false });
  });

  test('a conversation with no recognizable messages yields an empty bundle, not a crash', async () => {
    const noValueArray = setup(ok({ stdout: JSON.stringify({ ok: true, data: {} }), exitCode: 0 }));
    const emptyResult = await noValueArray.fetchBundle(REQUEST);
    if (!emptyResult.ok) throw new Error('expected ok');
    expect(emptyResult.value).toEqual({ emailId: 'msg-2', conversationId: 'conv-abc', messageCount: 0, threadHasAttachments: false });
    const manifestFile = noValueArray.written.find((w) => w.path.endsWith('manifest.json'));
    if (manifestFile === undefined) throw new Error('manifest not written');
    expect(JSON.parse(manifestFile.content).messages).toEqual([]);

    const nonRecordData = setup(ok({ stdout: JSON.stringify({ ok: true, data: null }), exitCode: 0 }));
    const nullResult = await nonRecordData.fetchBundle(REQUEST);
    if (!nullResult.ok) throw new Error('expected ok');
    expect(nullResult.value.messageCount).toBe(0);
  });
});
