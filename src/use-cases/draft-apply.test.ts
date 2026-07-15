import { describe, expect, test } from 'bun:test';

import type { EmailState } from '../domain/email-state.ts';
import { parseRunId } from '../domain/run-id.ts';
import { err, ok, unwrap } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { createLoggerFake } from '../test-helpers/logger-fake.ts';
import type { LoggerFake } from '../test-helpers/logger-fake.ts';
import { createOfficeFake } from '../test-helpers/office-fake.ts';
import type { OfficeCall, OfficeFake } from '../test-helpers/office-fake.ts';
import { createStateStoreFake } from '../test-helpers/state-store-fake.ts';
import type { StateStoreFake } from '../test-helpers/state-store-fake.ts';
import { createDraftApply } from './draft-apply.ts';
import type { DraftApplyRequest } from './draft-apply.ts';
import type { OfficeError } from './ports/office.ts';

const RUN_ID = unwrap(parseRunId('run-20260704-135959'));
const REQUEST: DraftApplyRequest = { runId: RUN_ID, emailId: 'msg-1', conversationId: 'conv-1', replyToMessageId: 'msg-1', subject: 'RE: Q3', body: '<p>Reply</p>' };

type OfficeResp = Result<unknown, OfficeError>;

type Overrides = {
  readonly drafts?: OfficeResp;
  readonly create?: OfficeResp;
  readonly update?: OfficeResp;
  readonly thread?: OfficeResp;
  readonly mode?: 'interactive' | 'pre-research';
};

const listing = (messages: ReadonlyArray<unknown>): OfficeResp => ok({ value: messages });
const draftResource = (id: string): OfficeResp => ok({ id, isDraft: true });
const commandFailed = (message: string): OfficeResp => err({ kind: 'command-failed', message });

type Setup = {
  readonly draftApply: ReturnType<typeof createDraftApply>;
  readonly office: OfficeFake;
  readonly stateStore: StateStoreFake;
  readonly logger: LoggerFake;
};

const setup = (emailState: EmailState, overrides: Overrides = {}): Setup => {
  const stateStore = createStateStoreFake({ [RUN_ID]: { mode: overrides.mode ?? 'interactive', phase: 'context_loaded', emails: { 'msg-1': emailState } } });
  const logger = createLoggerFake();
  // The office fake enforces the library's param contracts, so a wrong bodyContentType fails here.
  const office = createOfficeFake({
    'list-mail-folder-messages': async () => overrides.drafts ?? listing([]),
    'list-conversation-messages': async () =>
      overrides.thread ?? listing([{ id: 'msg-1', from: { emailAddress: { address: 's@x.com' } }, receivedDateTime: '2026-07-04T10:00:00Z' }]),
    'create-reply-draft': async () => overrides.create ?? draftResource('new-draft-1'),
    'update-mail-draft': async () => overrides.update ?? draftResource('existing-draft-1'),
  });
  const draftApply = createDraftApply({ office, stateStore, logger });
  return { draftApply, office, stateStore, logger };
};

describe('draft-apply', () => {
  test('an approved email with no existing draft creates a threaded reply-all draft and advances the state', async () => {
    const { draftApply, office, stateStore, logger } = setup('user_approved');

    const result = await draftApply(REQUEST);

    expect(result).toEqual({ ok: true, value: { mode: 'created', draftId: 'new-draft-1', subjectIgnored: true } });
    // it searches Drafts by conversation, then creates a threaded reply draft (never a fresh compose)
    expect(office.calls).toEqual([
      { command: 'list-mail-folder-messages', params: { mailFolderId: 'drafts', filter: "conversationId eq 'conv-1'", select: 'id,conversationId' } },
      { command: 'list-conversation-messages', params: { conversationId: 'conv-1', top: '50', select: 'id,from,receivedDateTime' } },
      { command: 'create-reply-draft', params: { replyToMessageId: 'msg-1', bodyContent: '<p>Reply</p>', bodyContentType: 'HTML' } },
    ]);
    expect(stateStore.snapshot(RUN_ID)?.emails).toEqual({ 'msg-1': 'draft_created' });
    expect(logger.calls).toEqual([
      { level: 'warn', event: 'subject-ignored-on-create', meta: { emailId: 'msg-1', subject: 'RE: Q3' } },
      { level: 'info', event: 'draft-applied', meta: { emailId: 'msg-1', mode: 'created' } },
    ]);
  });

  test('a create with no --subject is not flagged (the inherited RE: subject is the expected path)', async () => {
    const { draftApply, logger } = setup('user_approved');

    const result = await draftApply({ ...REQUEST, subject: '' });

    expect(result).toEqual({ ok: true, value: { mode: 'created', draftId: 'new-draft-1' } });
    expect(logger.calls.some((call) => call.event === 'subject-ignored-on-create')).toBe(false);
  });

  test('an approved email that already has a draft on the conversation patches it in place, never duplicating', async () => {
    const { draftApply, office, stateStore } = setup('user_approved', { drafts: listing([{ id: 'existing-draft-1', conversationId: 'conv-1' }]) });

    const result = await draftApply(REQUEST);

    expect(result).toEqual({ ok: true, value: { mode: 'updated', draftId: 'existing-draft-1' } });
    expect(office.calls.some((call) => call.command === 'create-reply-draft')).toBe(false);
    expect(office.calls).toContainEqual({
      command: 'update-mail-draft',
      params: { messageId: 'existing-draft-1', subject: 'RE: Q3', bodyContent: '<p>Reply</p>', bodyContentType: 'HTML' },
    });
    expect(stateStore.snapshot(RUN_ID)?.emails).toEqual({ 'msg-1': 'draft_created' });
  });

  test('an email that is not user_approved is refused with no draft touched and no state change', async () => {
    // preflight_ok is one gate short of approval — the code gate must still refuse it
    const { draftApply, office, stateStore } = setup('preflight_ok');

    const result = await draftApply(REQUEST);

    expect(result).toEqual({ ok: false, error: { kind: 'not-approved', message: 'email msg-1 is not user_approved' } });
    // the gate fires before any Graph draft command is issued
    expect(office.calls).toEqual([]);
    expect(stateStore.snapshot(RUN_ID)?.emails).toEqual({ 'msg-1': 'preflight_ok' });
  });

  test('an approved recipients delta patches the fresh reply draft in a follow-up call', async () => {
    const { draftApply, office } = setup('user_approved');

    const result = await draftApply({ ...REQUEST, to: ['jane@internal-corp.com', 'peer@internal-corp.com'], cc: ['boss@internal-corp.com'] });

    expect(result).toEqual({ ok: true, value: { mode: 'created', draftId: 'new-draft-1', subjectIgnored: true, recipientsApplied: true } });
    expect(office.calls[3]).toEqual({
      command: 'update-mail-draft',
      params: { messageId: 'new-draft-1', toRecipients: 'jane@internal-corp.com,peer@internal-corp.com', ccRecipients: 'boss@internal-corp.com' },
    });
  });

  test('on the update path the recipients ride the same patch - one call, no follow-up', async () => {
    const { draftApply, office } = setup('user_approved', { drafts: listing([{ id: 'existing-draft-1', conversationId: 'conv-1' }]) });

    const result = await draftApply({ ...REQUEST, cc: ['boss@internal-corp.com'] });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toMatchObject({ mode: 'updated', recipientsApplied: true });
    expect(office.calls).toHaveLength(2);
    expect(office.calls[1]?.params['ccRecipients']).toBe('boss@internal-corp.com');
    expect(office.calls[1]?.params['toRecipients']).toBeUndefined();
  });

  test('a created draft whose recipients patch fails does NOT advance - the re-run patches the existing draft', async () => {
    const { draftApply, office, stateStore } = setup('user_approved', { update: commandFailed('recipient rejected') });

    const result = await draftApply({ ...REQUEST, cc: ['boss@internal-corp.com'] });

    expect(result).toEqual({ ok: false, error: { kind: 'draft-failed', message: 'draft new-draft-1 created but recipients not applied: recipient rejected' } });
    expect(office.calls).toHaveLength(4);
    expect(stateStore.snapshot(RUN_ID)?.emails).toEqual({ 'msg-1': 'user_approved' });
  });

  test('a pre-research run can never draft, even if an email somehow reads user_approved', async () => {
    const { draftApply, office } = setup('user_approved', { mode: 'pre-research' });

    const result = await draftApply(REQUEST);

    expect(result).toEqual({ ok: false, error: { kind: 'not-approved', message: 'this is a pre-research run - resume it interactively before drafting' } });
    expect(office.calls).toEqual([]);
  });

  test('a state that cannot be loaded fails as state-store-failed, before any draft is attempted', async () => {
    const officeLog: OfficeCall[] = [];
    const missingRun = createDraftApply({
      office: {
        execute: async (command, params) => {
          officeLog.push({ command, params });
          return draftResource('x');
        },
      },
      stateStore: createStateStoreFake(),
      logger: createLoggerFake(),
    });

    expect(await missingRun(REQUEST)).toEqual({ ok: false, error: { kind: 'state-store-failed', message: `no run ${RUN_ID}` } });
    expect(officeLog).toEqual([]);
  });

  test('a draft-command failure surfaces as draft-failed and never advances the state', async () => {
    const createFails = setup('user_approved', { create: commandFailed('mailbox quota exceeded') });
    expect(await createFails.draftApply(REQUEST)).toEqual({ ok: false, error: { kind: 'draft-failed', message: 'mailbox quota exceeded' } });
    expect(createFails.stateStore.snapshot(RUN_ID)?.emails).toEqual({ 'msg-1': 'user_approved' });

    const noId = setup('user_approved', { create: ok({ isDraft: true }) });
    expect(await noId.draftApply(REQUEST)).toEqual({ ok: false, error: { kind: 'draft-failed', message: 'create-reply-draft returned no draft id' } });

    const draftsSearchFails = setup('user_approved', { drafts: commandFailed('graph 503') });
    expect(await draftsSearchFails.draftApply(REQUEST)).toEqual({ ok: false, error: { kind: 'draft-failed', message: 'graph 503' } });
  });

  test('a failure to persist the advanced state surfaces as state-store-failed', async () => {
    const { draftApply, stateStore } = setup('user_approved');
    stateStore.failWith('save', { kind: 'io', message: 'disk full' });

    expect(await draftApply(REQUEST)).toEqual({ ok: false, error: { kind: 'state-store-failed', message: 'disk full' } });
  });

  test('a newer message arriving since triage retargets the reply to the current latest and flags it', async () => {
    const { draftApply, office, logger } = setup('user_approved', {
      thread: listing([
        { id: 'msg-1', from: { emailAddress: { address: 's@x.com' } }, receivedDateTime: '2026-07-04T10:00:00Z' },
        { id: 'msg-2', from: { emailAddress: { address: 's@x.com' } }, receivedDateTime: '2026-07-04T11:00:00Z' },
      ]),
    });

    const result = await draftApply(REQUEST);

    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toMatchObject({ mode: 'created', draftId: 'new-draft-1', retargeted: true });
    expect(office.calls).toContainEqual({ command: 'create-reply-draft', params: { replyToMessageId: 'msg-2', bodyContent: '<p>Reply</p>', bodyContentType: 'HTML' } });
    expect(logger.calls).toContainEqual({ level: 'warn', event: 'reply-target-retargeted', meta: { emailId: 'msg-1', from: 'msg-1', to: 'msg-2', newerCount: 1 } });
  });

  test('a superseding message keeps the count even when the triaged message is beyond the fetched window', async () => {
    const { draftApply, office, logger } = setup('user_approved', {
      thread: listing([
        { id: 'msg-8', from: { emailAddress: { address: 's@x.com' } }, receivedDateTime: '2026-07-04T12:00:00Z' },
        { id: 'msg-9', from: { emailAddress: { address: 's@x.com' } }, receivedDateTime: '2026-07-04T13:00:00Z' },
      ]),
    });

    await draftApply(REQUEST); // triaged msg-1 is not in the window

    expect(office.calls).toContainEqual({ command: 'create-reply-draft', params: { replyToMessageId: 'msg-9', bodyContent: '<p>Reply</p>', bodyContentType: 'HTML' } });
    expect(logger.calls).toContainEqual({ level: 'warn', event: 'reply-target-retargeted', meta: { emailId: 'msg-1', from: 'msg-1', to: 'msg-9', newerCount: 2 } });
  });

  test('a conversation fetch failure falls back to the triaged id and never blocks the approved draft', async () => {
    const { draftApply, office, logger } = setup('user_approved', { thread: commandFailed('graph 503') });

    const result = await draftApply(REQUEST);

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.retargeted).toBeUndefined();
    expect(office.calls).toContainEqual({ command: 'create-reply-draft', params: { replyToMessageId: 'msg-1', bodyContent: '<p>Reply</p>', bodyContentType: 'HTML' } });
    expect(logger.calls).toContainEqual({ level: 'warn', event: 'reply-target-resolve-failed', meta: { emailId: 'msg-1', message: 'graph 503' } });
  });

  test('an empty conversation window falls back to the triaged id', async () => {
    const { draftApply, office, logger } = setup('user_approved', { thread: listing([]) });

    await draftApply(REQUEST);

    expect(office.calls).toContainEqual({ command: 'create-reply-draft', params: { replyToMessageId: 'msg-1', bodyContent: '<p>Reply</p>', bodyContentType: 'HTML' } });
    expect(logger.calls).toContainEqual({ level: 'warn', event: 'reply-target-resolve-failed', meta: { emailId: 'msg-1', message: 'empty conversation window' } });
  });
});
