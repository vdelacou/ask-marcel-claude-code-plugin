import { describe, expect, test } from 'bun:test';

import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { createLoggerFake } from '../test-helpers/logger-fake.ts';
import { createListWaitingOn } from './list-waiting-on.ts';
import type { OfficeError } from './ports/office.ts';

type OfficeCall = { readonly command: string; readonly params: Record<string, string> };
type Responses = { readonly me?: Result<unknown, OfficeError>; readonly page?: Result<unknown, OfficeError> };

const MY_MESSAGE = {
  conversationId: 'conv-1',
  subject: 'Vendor contract',
  from: { emailAddress: { address: 'me@internal-corp.com' } },
  toRecipients: [{ emailAddress: { name: 'Ext Vendor', address: 'vendor@ext-corp.com' } }],
  receivedDateTime: '2026-07-09T10:00:00Z',
};

const setup = (responses: Responses = {}): { readonly list: ReturnType<typeof createListWaitingOn>; readonly calls: OfficeCall[] } => {
  const calls: OfficeCall[] = [];
  const list = createListWaitingOn({
    office: {
      execute: async (command, params) => {
        calls.push({ command, params });
        if (command === 'get-current-user') return responses.me ?? ok({ mail: 'me@internal-corp.com' });
        return responses.page ?? ok({ value: [MY_MESSAGE] });
      },
    },
    clock: { todayIso: () => '2026-07-13', nowIso: () => '2026-07-13T08:00:00.000Z' },
    logger: createLoggerFake(),
  });
  return { list, calls };
};

describe('list-waiting-on', () => {
  test('my address comes from Graph, the page spans the whole mailbox newest-first, and the waiting list returns', async () => {
    const { list, calls } = setup();

    const result = await list({ minAgeDays: 3, fetchTop: 100 });

    if (!result.ok) throw new Error('expected ok');
    // 2026-07-09T10:00Z to 2026-07-13T00:00Z is 3d14h - whole days, floored
    expect(result.value).toEqual([{ conversationId: 'conv-1', subject: 'Vendor contract', to: ['Ext Vendor'], lastSentAt: '2026-07-09T10:00:00Z', ageDays: 3 }]);
    expect(calls).toEqual([
      { command: 'get-current-user', params: { select: 'mail,userPrincipalName' } },
      { command: 'list-mail-messages', params: { top: '100', orderby: 'receivedDateTime desc', select: 'id,conversationId,subject,from,toRecipients,receivedDateTime' } },
    ]);
  });

  test('a mailbox without mail falls back to the UPN; no address at all is a typed failure', async () => {
    const upnOnly = setup({ me: ok({ userPrincipalName: 'me@internal-corp.com' }) });
    expect((await upnOnly.list({ minAgeDays: 3, fetchTop: 100 })).ok).toBe(true);

    const addressless = setup({ me: ok({ displayName: 'Me' }) });
    expect(await addressless.list({ minAgeDays: 3, fetchTop: 100 })).toEqual({
      ok: false,
      error: { kind: 'source-failed', source: 'me', message: 'get-current-user returned no address' },
    });
  });

  test('identity and mailbox failures surface typed, naming their source', async () => {
    const meFails = setup({ me: err({ kind: 'command-failed', message: '401' }) });
    expect(await meFails.list({ minAgeDays: 3, fetchTop: 100 })).toEqual({ ok: false, error: { kind: 'source-failed', source: 'me', message: '401' } });

    const pageFails = setup({ page: err({ kind: 'command-failed', message: 'graph 503' }) });
    expect(await pageFails.list({ minAgeDays: 3, fetchTop: 100 })).toEqual({ ok: false, error: { kind: 'source-failed', source: 'mailbox', message: 'graph 503' } });
  });
});
