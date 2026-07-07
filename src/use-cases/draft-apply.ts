import type { RunState } from '../domain/email-state.ts';
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
};

export type DraftApplyError =
  | { readonly kind: 'not-approved'; readonly message: string }
  | { readonly kind: 'draft-failed'; readonly message: string }
  | { readonly kind: 'state-store-failed'; readonly message: string };

export type DraftApplySummary = { readonly mode: 'created' | 'updated'; readonly draftId: string };

export type DraftApply = (request: DraftApplyRequest) => Promise<Result<DraftApplySummary, DraftApplyError>>;

type Deps = { readonly office: Office; readonly stateStore: StateStore; readonly logger: Logger };

const draftsParams = (conversationId: string): Record<string, string> => ({ mailFolderId: 'drafts', filter: `conversationId eq '${conversationId}'`, select: 'id,conversationId' });

const findExistingDraft = async (deps: Deps, conversationId: string): Promise<Result<string | undefined, DraftApplyError>> => {
  const run = await deps.office.execute('list-mail-folder-messages', draftsParams(conversationId));
  return run.ok ? ok(extractFirstMessageId(run.value)) : err({ kind: 'draft-failed', message: run.error.message });
};

// A new thread gets a threaded reply-all draft (create-reply-draft inherits recipients + RE: subject + quoted history).
const createDraft = async (deps: Deps, request: DraftApplyRequest): Promise<Result<DraftApplySummary, DraftApplyError>> => {
  const run = await deps.office.execute('create-reply-draft', { replyToMessageId: request.replyToMessageId, bodyContent: request.body, bodyContentType: 'HTML' });
  if (!run.ok) return err({ kind: 'draft-failed', message: run.error.message });
  const draftId = extractDraftId(run.value);
  return draftId === undefined ? err({ kind: 'draft-failed', message: 'create-reply-draft returned no draft id' }) : ok({ mode: 'created', draftId });
};

// An existing draft on the conversation is patched in place, never duplicated.
const updateDraft = async (deps: Deps, messageId: string, request: DraftApplyRequest): Promise<Result<DraftApplySummary, DraftApplyError>> => {
  const run = await deps.office.execute('update-mail-draft', { messageId, subject: request.subject, bodyContent: request.body, bodyContentType: 'HTML' });
  return run.ok ? ok({ mode: 'updated', draftId: extractDraftId(run.value) ?? messageId }) : err({ kind: 'draft-failed', message: run.error.message });
};

export const createDraftApply =
  (deps: Deps): DraftApply =>
  async (request) => {
    const loaded = await deps.stateStore.load(request.runId);
    if (!loaded.ok) return err({ kind: 'state-store-failed', message: loaded.error.message });
    // The code approval gate (SPEC §15.1 consequence i, replacing the Bash draft-gate hook): no draft is
    // created unless the user approved this exact email. Only user_approved advances to draft_created.
    if (loaded.value[request.emailId] !== 'user_approved') return err({ kind: 'not-approved', message: `email ${request.emailId} is not user_approved` });
    const existing = await findExistingDraft(deps, request.conversationId);
    if (!existing.ok) return err(existing.error);
    const applied = existing.value === undefined ? await createDraft(deps, request) : await updateDraft(deps, existing.value, request);
    if (!applied.ok) return err(applied.error);
    // The gate proved the from-state, so user_approved -> draft_created is a valid transition by construction.
    const nextState: RunState = { ...loaded.value, [request.emailId]: 'draft_created' };
    const saved = await deps.stateStore.save(request.runId, nextState);
    if (!saved.ok) return err({ kind: 'state-store-failed', message: saved.error.message });
    deps.logger.info('draft-applied', { emailId: request.emailId, mode: applied.value.mode });
    return ok(applied.value);
  };
