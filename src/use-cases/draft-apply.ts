import type { RunFile } from '../domain/email-state.ts';
import { extractThreadMessages, resolveReplyTarget } from '../domain/email-thread.ts';
import { extractDraftId, extractFirstMessageId } from '../domain/mail-draft.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { RunId } from '../domain/run-id.ts';
import type { Logger } from './ports/logger.ts';
import type { Office } from './ports/office.ts';
import type { StateStore } from './ports/state-store.ts';

export type DraftApplyRequest = {
  readonly runId: RunId;
  readonly emailId: string;
  readonly conversationId: string;
  readonly replyToMessageId: string;
  readonly subject: string;
  readonly body: string;
  // Approved recipient deltas from the researcher package (SPEC §2 Phase 3): absent means
  // keep what the thread inherits; present means the draft is patched to exactly these.
  readonly to?: ReadonlyArray<string>;
  readonly cc?: ReadonlyArray<string>;
};

export type DraftApplyError =
  | { readonly kind: 'not-approved'; readonly message: string }
  | { readonly kind: 'draft-failed'; readonly message: string }
  | { readonly kind: 'state-store-failed'; readonly message: string };

export type DraftApplySummary = {
  readonly mode: 'created' | 'updated';
  readonly draftId: string;
  readonly subjectIgnored?: true;
  readonly recipientsApplied?: true;
  readonly retargeted?: true;
};

export type DraftApply = (request: DraftApplyRequest) => Promise<Result<DraftApplySummary, DraftApplyError>>;

type Deps = { readonly office: Office; readonly stateStore: StateStore; readonly logger: Logger };

const draftsParams = (conversationId: string): Record<string, string> => ({ mailFolderId: 'drafts', filter: `conversationId eq '${conversationId}'`, select: 'id,conversationId' });

// The library takes recipients as comma-separated address lists.
const recipientParams = (request: DraftApplyRequest): Record<string, string> => ({
  ...(request.to === undefined ? {} : { toRecipients: request.to.join(',') }),
  ...(request.cc === undefined ? {} : { ccRecipients: request.cc.join(',') }),
});

const hasRecipients = (request: DraftApplyRequest): boolean => request.to !== undefined || request.cc !== undefined;

type ReplyTo = { readonly id: string; readonly retargeted: boolean };

const warnFallback = (deps: Deps, request: DraftApplyRequest, message: string): ReplyTo => {
  deps.logger.warn('reply-target-resolve-failed', { emailId: request.emailId, message });
  return { id: request.replyToMessageId, retargeted: false };
};

// The reply-to id was captured at scan time; a conversation can gain a newer message before the user
// approves the draft. Re-resolve the current latest and thread under it (retargeted), or fall back to the
// scan-time id when the thread cannot be read - a transient read failure never blocks an approved draft.
const resolveReplyTo = async (deps: Deps, request: DraftApplyRequest): Promise<ReplyTo> => {
  const run = await deps.office.execute('list-conversation-messages', { conversationId: request.conversationId, top: '50', select: 'id,from,receivedDateTime' });
  if (!run.ok) return warnFallback(deps, request, run.error.message);
  const target = resolveReplyTarget(extractThreadMessages(run.value), request.replyToMessageId);
  if (target === undefined) return warnFallback(deps, request, 'empty conversation window');
  if (target.newerCount === 0) return { id: target.latestId, retargeted: false };
  deps.logger.warn('reply-target-retargeted', { emailId: request.emailId, from: request.replyToMessageId, to: target.latestId, newerCount: target.newerCount });
  return { id: target.latestId, retargeted: true };
};

const createdSummary = (draftId: string, replyTo: ReplyTo, recipientsApplied: boolean): DraftApplySummary => ({
  mode: 'created',
  draftId,
  ...(recipientsApplied ? { recipientsApplied: true as const } : {}),
  ...(replyTo.retargeted ? { retargeted: true as const } : {}),
});

const findExistingDraft = async (deps: Deps, conversationId: string): Promise<Result<string | undefined, DraftApplyError>> => {
  const run = await deps.office.execute('list-mail-folder-messages', draftsParams(conversationId));
  return run.ok ? ok(extractFirstMessageId(run.value)) : err({ kind: 'draft-failed', message: run.error.message });
};

// A new thread gets a threaded reply-all draft (create-reply-draft inherits recipients + RE: subject
// + quoted history). An approved recipients delta lands as a follow-up patch on the fresh draft: a
// failed patch fails the whole apply (state stays user_approved), and the re-run takes the update
// path on the now-existing draft - never a silently wrong audience.
const createDraft = async (deps: Deps, request: DraftApplyRequest): Promise<Result<DraftApplySummary, DraftApplyError>> => {
  const replyTo = await resolveReplyTo(deps, request);
  const run = await deps.office.execute('create-reply-draft', { replyToMessageId: replyTo.id, bodyContent: request.body, bodyContentType: 'HTML' });
  if (!run.ok) return err({ kind: 'draft-failed', message: run.error.message });
  const draftId = extractDraftId(run.value);
  if (draftId === undefined) return err({ kind: 'draft-failed', message: 'create-reply-draft returned no draft id' });
  if (!hasRecipients(request)) return ok(createdSummary(draftId, replyTo, false));
  const patched = await deps.office.execute('update-mail-draft', { messageId: draftId, ...recipientParams(request) });
  return patched.ok
    ? ok(createdSummary(draftId, replyTo, true))
    : err({ kind: 'draft-failed', message: `draft ${draftId} created but recipients not applied: ${patched.error.message}` });
};

// An existing draft on the conversation is patched in place, never duplicated.
const updateDraft = async (deps: Deps, messageId: string, request: DraftApplyRequest): Promise<Result<DraftApplySummary, DraftApplyError>> => {
  const run = await deps.office.execute('update-mail-draft', {
    messageId,
    subject: request.subject,
    bodyContent: request.body,
    bodyContentType: 'HTML',
    ...recipientParams(request),
  });
  if (!run.ok) return err({ kind: 'draft-failed', message: run.error.message });
  return ok({ mode: 'updated', draftId: extractDraftId(run.value) ?? messageId, ...(hasRecipients(request) ? { recipientsApplied: true as const } : {}) });
};

export const createDraftApply =
  (deps: Deps): DraftApply =>
  async (request) => {
    const loaded = await deps.stateStore.load(request.runId);
    if (!loaded.ok) return err({ kind: 'state-store-failed', message: loaded.error.message });
    // The code approval gate (SPEC §15.1 consequence i, replacing the Bash draft-gate hook): no draft is
    // created unless the user approved this exact email. Only user_approved advances to draft_created.
    // Defense in depth on top of the state-machine cap: a pre-research run can never draft.
    if (loaded.value.mode === 'pre-research') return err({ kind: 'not-approved', message: 'this is a pre-research run - resume it interactively before drafting' });
    if (loaded.value.emails[request.emailId] !== 'user_approved') return err({ kind: 'not-approved', message: `email ${request.emailId} is not user_approved` });
    const existing = await findExistingDraft(deps, request.conversationId);
    if (!existing.ok) return err(existing.error);
    const applied = existing.value === undefined ? await createDraft(deps, request) : await updateDraft(deps, existing.value, request);
    if (!applied.ok) return err(applied.error);
    // create-reply-draft inherits the recipients + RE: subject + quoted history from the message being
    // replied to; --subject only takes effect on update. A non-empty subject on the create path was
    // silently dropped (#8): flag it so the agent knows its subject did not apply to this draft.
    const subjectIgnored = applied.value.mode === 'created' && request.subject !== '' ? (true as const) : undefined;
    if (subjectIgnored === true) deps.logger.warn('subject-ignored-on-create', { emailId: request.emailId, subject: request.subject });
    // The gate proved the from-state, so user_approved -> draft_created is a valid transition by construction.
    const nextState: RunFile = { ...loaded.value, emails: { ...loaded.value.emails, [request.emailId]: 'draft_created' } };
    const saved = await deps.stateStore.save(request.runId, nextState);
    if (!saved.ok) return err({ kind: 'state-store-failed', message: saved.error.message });
    deps.logger.info('draft-applied', { emailId: request.emailId, mode: applied.value.mode });
    return ok({ ...applied.value, ...(subjectIgnored !== undefined ? { subjectIgnored } : {}) });
  };
