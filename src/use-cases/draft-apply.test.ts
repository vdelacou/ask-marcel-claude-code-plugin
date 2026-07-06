import { describe, expect, test } from 'bun:test';

import type { EmailState } from '../domain/email-state.ts';
import { parseRunId } from '../domain/run-id.ts';
import { err, ok, unwrap } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { createLoggerFake } from '../test-helpers/logger-fake.ts';
import type { LoggerFake } from '../test-helpers/logger-fake.ts';
import { createStateStoreFake } from '../test-helpers/state-store-fake.ts';
import type { StateStoreFake } from '../test-helpers/state-store-fake.ts';
import { createDraftApply } from './draft-apply.ts';
import type { DraftApplyRequest } from './draft-apply.ts';
import type { OfficeError } from './ports/office.ts';

const RUN_ID = unwrap(parseRunId('run-20260704-135959'));
const REQUEST: DraftApplyRequest = { runId: RUN_ID, emailId: 'msg-1', conversationId: 'conv-1', replyToMessageId: 'msg-1', subject: 'RE: Q3', body: '<p>Reply</p>' };

type OfficeResp = Result<unknown, OfficeError>;
type OfficeCall = { readonly command: string; readonly params: Record<string, string> };

type Overrides = { readonly drafts?: OfficeResp; readonly create?: OfficeResp; readonly update?: OfficeResp };

const listing = (messages: ReadonlyArray<unknown>): OfficeResp => ok({ value: messages });
const draftResource = (id: string): OfficeResp => ok({ id, isDraft: true });
const commandFailed = (message: string): OfficeResp => err({ kind: 'command-failed', message });

type Setup = {
  readonly draftApply: ReturnType<typeof createDraftApply>;
  readonly officeLog: ReadonlyArray<OfficeCall>;
  readonly stateStore: StateStoreFake;
  readonly logger: LoggerFake;
};

const setup = (emailState: EmailState, overrides: Overrides = {}): Setup => {
  const officeLog: OfficeCall[] = [];
  const stateStore = createStateStoreFake({ [RUN_ID]: { 'msg-1': emailState } });
  const logger = createLoggerFake();
  const draftApply = createDraftApply({
    office: {
      execute: async (command, params) => {
        officeLog.push({ command, params });
        if (command === 'list-mail-folder-messages') return overrides.drafts ?? listing([]);
        if (command === 'create-reply-draft') return overrides.create ?? draftResource('new-draft-1');
        if (command === 'update-mail-draft') return overrides.update ?? draftResource('existing-draft-1');
        return err({ kind: 'unknown-command', message: command });
      },
    },
    stateStore,
    logger,
  });
  return { draftApply, officeLog, stateStore, logger };
};

describe('draft-apply', () => {
  test('an approved email with no existing draft creates a threaded reply-all draft and advances the state', async () => {
    const { draftApply, officeLog, stateStore, logger } = setup('user_approved');

    const result = await draftApply(REQUEST);

    expect(result).toEqual({ ok: true, value: { mode: 'created', draftId: 'new-draft-1' } });
    // it searches Drafts by conversation, then creates a threaded reply draft (never a fresh compose)
    expect(officeLog).toEqual([
      { command: 'list-mail-folder-messages', params: { mailFolderId: 'drafts', filter: "conversationId eq 'conv-1'", select: 'id,conversationId' } },
      { command: 'create-reply-draft', params: { replyToMessageId: 'msg-1', bodyContent: '<p>Reply</p>', bodyContentType: 'html' } },
    ]);
    expect(stateStore.snapshot(RUN_ID)).toEqual({ 'msg-1': 'draft_created' });
    expect(logger.calls).toEqual([{ level: 'info', event: 'draft-applied', meta: { emailId: 'msg-1', mode: 'created' } }]);
  });

  test('an approved email that already has a draft on the conversation patches it in place, never duplicating', async () => {
    const { draftApply, officeLog, stateStore } = setup('user_approved', { drafts: listing([{ id: 'existing-draft-1', conversationId: 'conv-1' }]) });

    const result = await draftApply(REQUEST);

    expect(result).toEqual({ ok: true, value: { mode: 'updated', draftId: 'existing-draft-1' } });
    expect(officeLog.some((call) => call.command === 'create-reply-draft')).toBe(false);
    expect(officeLog).toContainEqual({
      command: 'update-mail-draft',
      params: { messageId: 'existing-draft-1', subject: 'RE: Q3', bodyContent: '<p>Reply</p>', bodyContentType: 'html' },
    });
    expect(stateStore.snapshot(RUN_ID)).toEqual({ 'msg-1': 'draft_created' });
  });

  test('an email that is not user_approved is refused with no draft touched and no state change', async () => {
    // preflight_ok is one gate short of approval — the code gate must still refuse it
    const { draftApply, officeLog, stateStore } = setup('preflight_ok');

    const result = await draftApply(REQUEST);

    expect(result).toEqual({ ok: false, error: { kind: 'not-approved', message: 'email msg-1 is not user_approved' } });
    // the gate fires before any Graph draft command is issued
    expect(officeLog).toEqual([]);
    expect(stateStore.snapshot(RUN_ID)).toEqual({ 'msg-1': 'preflight_ok' });
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
    expect(createFails.stateStore.snapshot(RUN_ID)).toEqual({ 'msg-1': 'user_approved' });

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
});
