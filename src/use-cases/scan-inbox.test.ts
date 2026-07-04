import { describe, expect, test } from 'bun:test';

import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { createLoggerFake } from '../test-helpers/logger-fake.ts';
import { createStateStoreFake } from '../test-helpers/state-store-fake.ts';
import type { StateStoreFake } from '../test-helpers/state-store-fake.ts';
import type { CommandOutput, RunError } from './ports/command-runner.ts';
import { createScanInbox } from './scan-inbox.ts';
import type { ScanInbox, ScanOptions } from './scan-inbox.ts';

const NOW = '2026-07-04T13:59:59.000Z';
const RUN_ID = 'run-20260704-135959';

const MESSAGES = [
  {
    id: 'm1',
    conversationId: 'c1',
    subject: 'Budget question',
    from: { emailAddress: { name: 'Jane Boss', address: 'jane@internal-corp.com' } },
    receivedDateTime: '2026-07-04T08:00:00Z',
    hasAttachments: true,
    importance: 'high',
    bodyPreview: 'Can you confirm the Q3 envelope?',
  },
  {
    id: 'm2',
    conversationId: 'c2',
    subject: 'Your weekly digest',
    from: { emailAddress: { name: 'Service', address: 'no-reply@service.com' } },
    receivedDateTime: '2026-07-04T07:00:00Z',
    hasAttachments: false,
    importance: 'normal',
    bodyPreview: 'News for you',
  },
  {
    id: 'm3',
    conversationId: 'c3',
    subject: 'Contract draft',
    from: { emailAddress: { name: 'Ext Vendor', address: 'vendor@ext-corp.com' } },
    receivedDateTime: '2026-07-04T06:00:00Z',
    hasAttachments: false,
    importance: 'normal',
    bodyPreview: 'Please find attached',
  },
];

type Written = { readonly path: string; readonly content: string };

type Setup = { readonly scan: ScanInbox; readonly written: ReadonlyArray<Written>; readonly runnerLog: ReadonlyArray<string>; readonly stateStore: StateStoreFake };

const setup = (response: Result<CommandOutput, RunError>): Setup => {
  const written: Written[] = [];
  const runnerLog: string[] = [];
  const stateStore = createStateStoreFake();
  const scan = createScanInbox({
    runner: {
      run: async (cmd, args) => {
        runnerLog.push([cmd, ...args].join(' '));
        return response;
      },
    },
    writer: {
      write: async (path, content) => {
        written.push({ path, content });
        return ok(undefined);
      },
    },
    stateStore,
    clock: { todayIso: () => NOW.slice(0, 10), nowIso: () => NOW },
    logger: createLoggerFake(),
  });
  return { scan, written, runnerLog, stateStore };
};

const envelope = (value: unknown): Result<CommandOutput, RunError> => ok({ stdout: JSON.stringify({ ok: true, data: { value } }), exitCode: 0 });

const OPTIONS: ScanOptions = { scope: 'unread', cap: 25, blocked: [] };

describe('scan-inbox', () => {
  test('a fresh unread inbox becomes a run with every real mail scanned and state initialized', async () => {
    const { scan, written, stateStore } = setup(envelope(MESSAGES));

    const result = await scan(OPTIONS);

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.runId).toBe(RUN_ID);
    expect(result.value.runId).toMatch(/^run-\d{8}-\d{6}$/);
    expect(result.value.kept.map((m) => m.id)).toEqual(['m1', 'm3']);
    expect(result.value.dropped).toEqual([{ id: 'm2', subject: 'Your weekly digest', from: 'no-reply@service.com', reason: 'no-reply-sender' }]);
    expect(stateStore.snapshot(RUN_ID)).toEqual({ m1: 'scanned', m3: 'scanned' });

    const candidates = written.find((w) => w.path === `data/scratch/${RUN_ID}/candidates.json`);
    if (candidates === undefined) throw new Error('candidates.json not written');
    expect(JSON.parse(candidates.content)).toEqual({
      runId: RUN_ID,
      scannedAt: NOW,
      scope: 'unread',
      kept: [
        {
          id: 'm1',
          conversationId: 'c1',
          subject: 'Budget question',
          fromName: 'Jane Boss',
          fromAddress: 'jane@internal-corp.com',
          receivedDateTime: '2026-07-04T08:00:00Z',
          hasAttachments: true,
          importance: 'high',
          bodyPreview: 'Can you confirm the Q3 envelope?',
        },
        {
          id: 'm3',
          conversationId: 'c3',
          subject: 'Contract draft',
          fromName: 'Ext Vendor',
          fromAddress: 'vendor@ext-corp.com',
          receivedDateTime: '2026-07-04T06:00:00Z',
          hasAttachments: false,
          importance: 'normal',
          bodyPreview: 'Please find attached',
        },
      ],
      dropped: [{ id: 'm2', subject: 'Your weekly digest', from: 'no-reply@service.com', reason: 'no-reply-sender' }],
    });
  });

  test('the unread scope filters server-side, the all scope does not', async () => {
    const unread = setup(envelope([]));
    await unread.scan(OPTIONS);
    expect(unread.runnerLog[0]).toBe(
      'ask-marcel-office list-mail-folder-messages --mail-folder-id inbox --top 25 --filter isRead eq false --select id,conversationId,subject,from,receivedDateTime,hasAttachments,importance,bodyPreview --output json'
    );

    const all = setup(envelope([]));
    await all.scan({ scope: 'all', cap: 50, blocked: [] });
    expect(all.runnerLog[0]).toBe(
      'ask-marcel-office list-mail-folder-messages --mail-folder-id inbox --top 50 --select id,conversationId,subject,from,receivedDateTime,hasAttachments,importance,bodyPreview --output json'
    );
  });

  test('an empty inbox still yields a well-formed empty run', async () => {
    const { scan, written, stateStore } = setup(envelope([]));

    const result = await scan(OPTIONS);

    expect(result).toEqual({ ok: true, value: { runId: RUN_ID, kept: [], dropped: [] } });
    expect(stateStore.snapshot(RUN_ID)).toEqual({});
    expect(written).toHaveLength(1);
  });

  test('a mail source failure surfaces as source-failed, not a crash', async () => {
    const { scan } = setup(err({ kind: 'spawn-failed', message: 'EPERM boom' }));
    expect(await scan(OPTIONS)).toEqual({ ok: false, error: { kind: 'source-failed', source: 'list-inbox', message: 'EPERM boom' } });

    const nonZero = setup(ok({ stdout: 'boom', exitCode: 3 }));
    expect(await nonZero.scan(OPTIONS)).toEqual({ ok: false, error: { kind: 'source-failed', source: 'list-inbox', message: 'exited 3' } });

    const garbage = setup(ok({ stdout: 'not json', exitCode: 0 }));
    expect(await garbage.scan(OPTIONS)).toEqual({ ok: false, error: { kind: 'source-failed', source: 'list-inbox', message: 'invalid json' } });
  });
});
