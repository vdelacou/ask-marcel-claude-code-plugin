import { describe, expect, test } from 'bun:test';

import type { EmailState } from '../domain/email-state.ts';
import { parseRunId } from '../domain/run-id.ts';
import { err, ok, unwrap } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { createLoggerFake } from '../test-helpers/logger-fake.ts';
import { createOfficeFake } from '../test-helpers/office-fake.ts';
import type { OfficeFake } from '../test-helpers/office-fake.ts';
import { createStateStoreFake } from '../test-helpers/state-store-fake.ts';
import type { StateStoreFake } from '../test-helpers/state-store-fake.ts';
import { createForwardApply } from './forward-apply.ts';
import type { ForwardApplyRequest } from './forward-apply.ts';
import type { OfficeError } from './ports/office.ts';

const RUN_ID = unwrap(parseRunId('run-20260704-135959'));

const REQUEST: ForwardApplyRequest = {
  runId: RUN_ID,
  emailId: 'msg-1',
  conversationId: 'conv-1',
  forwardMessageId: 'msg-1',
  comment: 'Bob owns this, forwarding.',
  to: ['bob@internal-corp.com'],
};

type OfficeResp = Result<unknown, OfficeError>;
type Overrides = { readonly forward?: OfficeResp; readonly thread?: OfficeResp; readonly mode?: 'interactive' | 'pre-research' };

const listing = (messages: ReadonlyArray<unknown>): OfficeResp => ok({ value: messages });
const draftResource = (id: string): OfficeResp => ok({ id, isDraft: true });
const commandFailed = (message: string): OfficeResp => err({ kind: 'command-failed', message });

type Setup = {
  readonly forwardApply: ReturnType<typeof createForwardApply>;
  readonly office: OfficeFake;
  readonly stateStore: StateStoreFake;
  readonly logger: ReturnType<typeof createLoggerFake>;
};

const setup = (emailState: EmailState, overrides: Overrides = {}): Setup => {
  const stateStore = createStateStoreFake({ [RUN_ID]: { mode: overrides.mode ?? 'interactive', phase: 'context_loaded', emails: { 'msg-1': emailState } } });
  const logger = createLoggerFake();
  const office = createOfficeFake({
    'list-conversation-messages': async () =>
      overrides.thread ?? listing([{ id: 'msg-1', from: { emailAddress: { address: 's@x.com' } }, receivedDateTime: '2026-07-04T10:00:00Z' }]),
    'create-forward-draft': async () => overrides.forward ?? draftResource('fwd-draft-1'),
  });
  const forwardApply = createForwardApply({ office, stateStore, logger });
  return { forwardApply, office, stateStore, logger };
};

describe('forward-apply', () => {
  test('an approved email is forwarded to the chosen recipients and advances to draft_created', async () => {
    const { forwardApply, office, stateStore, logger } = setup('user_approved');

    const result = await forwardApply({ ...REQUEST, cc: ['assistant@internal-corp.com'], subject: 'FW: Q3 envelope' });

    expect(result).toEqual({ ok: true, value: { draftId: 'fwd-draft-1' } });
    // resolve the current latest, then create-forward-draft with comment, joined recipients, cc, and subject
    expect(office.calls).toEqual([
      { command: 'list-conversation-messages', params: { conversationId: 'conv-1', top: '50', select: 'id,from,receivedDateTime' } },
      {
        command: 'create-forward-draft',
        params: {
          forwardMessageId: 'msg-1',
          toRecipients: 'bob@internal-corp.com',
          bodyContent: 'Bob owns this, forwarding.',
          ccRecipients: 'assistant@internal-corp.com',
          subject: 'FW: Q3 envelope',
        },
      },
    ]);
    expect(stateStore.snapshot(RUN_ID)?.emails).toEqual({ 'msg-1': 'draft_created' });
    expect(logger.calls).toEqual([{ level: 'info', event: 'forward-applied', meta: { emailId: 'msg-1', draftId: 'fwd-draft-1' } }]);
  });

  test('cc and subject are omitted from the params when not given (and empty ones do not leak)', async () => {
    const { forwardApply, office } = setup('user_approved');

    await forwardApply({ ...REQUEST, cc: [], subject: '' });

    expect(office.calls[1]?.params).toEqual({ forwardMessageId: 'msg-1', toRecipients: 'bob@internal-corp.com', bodyContent: 'Bob owns this, forwarding.' });
  });

  test('a forward with no recipient is refused before any Graph call', async () => {
    const { forwardApply, office, stateStore } = setup('user_approved');

    const result = await forwardApply({ ...REQUEST, to: [] });

    expect(result).toEqual({ ok: false, error: { kind: 'no-recipients', message: 'a forward needs at least one --to recipient' } });
    expect(office.calls).toEqual([]);
    expect(stateStore.reads).toBe(0);
  });

  test('an email that is not user_approved is refused with no forward and no state change', async () => {
    const { forwardApply, office, stateStore } = setup('preflight_ok');

    const result = await forwardApply(REQUEST);

    expect(result).toEqual({ ok: false, error: { kind: 'not-approved', message: 'email msg-1 is not user_approved' } });
    expect(office.calls).toEqual([]);
    expect(stateStore.snapshot(RUN_ID)?.emails).toEqual({ 'msg-1': 'preflight_ok' });
  });

  test('a pre-research run can never forward, even if the email reads user_approved', async () => {
    const { forwardApply, office } = setup('user_approved', { mode: 'pre-research' });

    const result = await forwardApply(REQUEST);

    expect(result).toEqual({ ok: false, error: { kind: 'not-approved', message: 'this is a pre-research run - resume it interactively before drafting' } });
    expect(office.calls).toEqual([]);
  });

  test('a create-forward-draft failure surfaces typed and holds the state at user_approved for a clean re-run', async () => {
    const { forwardApply, stateStore } = setup('user_approved', { forward: commandFailed('mailbox quota exceeded') });

    expect(await forwardApply(REQUEST)).toEqual({ ok: false, error: { kind: 'draft-failed', message: 'mailbox quota exceeded' } });
    expect(stateStore.snapshot(RUN_ID)?.emails).toEqual({ 'msg-1': 'user_approved' });
  });

  test('a forward response with no draft id is a draft-failed error', async () => {
    const { forwardApply } = setup('user_approved', { forward: ok({ isDraft: true }) });

    expect(await forwardApply(REQUEST)).toEqual({ ok: false, error: { kind: 'draft-failed', message: 'create-forward-draft returned no draft id' } });
  });

  test('a state load failure and a save failure both surface as state-store-failed', async () => {
    const loadFails = setup('user_approved');
    loadFails.stateStore.failWith('load', { kind: 'io', message: 'disk full' });
    expect(await loadFails.forwardApply(REQUEST)).toEqual({ ok: false, error: { kind: 'state-store-failed', message: 'disk full' } });

    const saveFails = setup('user_approved');
    saveFails.stateStore.failWith('save', { kind: 'io', message: 'read-only volume' });
    expect(await saveFails.forwardApply(REQUEST)).toEqual({ ok: false, error: { kind: 'state-store-failed', message: 'read-only volume' } });
  });

  test('a newer message arriving since triage retargets the forward to the current latest and flags it', async () => {
    const { forwardApply, office, logger } = setup('user_approved', {
      thread: listing([
        { id: 'msg-1', from: { emailAddress: { address: 's@x.com' } }, receivedDateTime: '2026-07-04T10:00:00Z' },
        { id: 'msg-2', from: { emailAddress: { address: 's@x.com' } }, receivedDateTime: '2026-07-04T11:00:00Z' },
      ]),
    });

    const result = await forwardApply(REQUEST);

    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual({ draftId: 'fwd-draft-1', retargeted: true });
    expect(office.calls).toContainEqual({
      command: 'create-forward-draft',
      params: { forwardMessageId: 'msg-2', toRecipients: 'bob@internal-corp.com', bodyContent: 'Bob owns this, forwarding.' },
    });
    expect(logger.calls).toContainEqual({ level: 'warn', event: 'reply-target-retargeted', meta: { emailId: 'msg-1', from: 'msg-1', to: 'msg-2', newerCount: 1 } });
  });

  test('a superseding message beyond the fetched window still retargets the forward and counts the whole window', async () => {
    const { forwardApply, office, logger } = setup('user_approved', {
      thread: listing([
        { id: 'msg-8', from: { emailAddress: { address: 's@x.com' } }, receivedDateTime: '2026-07-04T12:00:00Z' },
        { id: 'msg-9', from: { emailAddress: { address: 's@x.com' } }, receivedDateTime: '2026-07-04T13:00:00Z' },
      ]),
    });

    await forwardApply(REQUEST); // triaged msg-1 is not in the window

    expect(office.calls).toContainEqual({
      command: 'create-forward-draft',
      params: { forwardMessageId: 'msg-9', toRecipients: 'bob@internal-corp.com', bodyContent: 'Bob owns this, forwarding.' },
    });
    expect(logger.calls).toContainEqual({ level: 'warn', event: 'reply-target-retargeted', meta: { emailId: 'msg-1', from: 'msg-1', to: 'msg-9', newerCount: 2 } });
  });

  test('a conversation fetch failure falls back to the triaged forward id and never blocks the approved forward', async () => {
    const { forwardApply, office, logger } = setup('user_approved', { thread: commandFailed('graph 503') });

    const result = await forwardApply(REQUEST);

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.retargeted).toBeUndefined();
    expect(office.calls).toContainEqual({
      command: 'create-forward-draft',
      params: { forwardMessageId: 'msg-1', toRecipients: 'bob@internal-corp.com', bodyContent: 'Bob owns this, forwarding.' },
    });
    expect(logger.calls).toContainEqual({ level: 'warn', event: 'reply-target-resolve-failed', meta: { emailId: 'msg-1', message: 'graph 503' } });
  });

  test('an empty conversation window falls back to the triaged forward id', async () => {
    const { forwardApply, office, logger } = setup('user_approved', { thread: listing([]) });

    await forwardApply(REQUEST);

    expect(office.calls).toContainEqual({
      command: 'create-forward-draft',
      params: { forwardMessageId: 'msg-1', toRecipients: 'bob@internal-corp.com', bodyContent: 'Bob owns this, forwarding.' },
    });
    expect(logger.calls).toContainEqual({ level: 'warn', event: 'reply-target-resolve-failed', meta: { emailId: 'msg-1', message: 'empty conversation window' } });
  });
});
