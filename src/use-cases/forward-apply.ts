import type { RunFile } from '../domain/email-state.ts';
import { extractDraftId } from '../domain/mail-draft.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { RunId } from '../domain/run-id.ts';
import type { Logger } from './ports/logger.ts';
import type { Office } from './ports/office.ts';
import type { StateStore } from './ports/state-store.ts';

// The redirect stance (SPEC §2 Phase 3/4) made real: an approved email is forwarded to the
// right owner with a short comment, as an UNSENT draft. Same code approval gate as draft-apply
// (a forward is a draft too) - and the gate is also the idempotency guard, since a second
// forward would find the email already at draft_created and be refused.
export type ForwardApplyRequest = {
  readonly runId: RunId;
  readonly emailId: string;
  readonly forwardMessageId: string;
  readonly comment: string;
  readonly to: ReadonlyArray<string>;
  readonly cc?: ReadonlyArray<string>;
  readonly subject?: string;
};

export type ForwardApplyError =
  | { readonly kind: 'not-approved'; readonly message: string }
  | { readonly kind: 'no-recipients'; readonly message: string }
  | { readonly kind: 'draft-failed'; readonly message: string }
  | { readonly kind: 'state-store-failed'; readonly message: string };

export type ForwardApplySummary = { readonly draftId: string };

export type ForwardApply = (request: ForwardApplyRequest) => Promise<Result<ForwardApplySummary, ForwardApplyError>>;

type Deps = { readonly office: Office; readonly stateStore: StateStore; readonly logger: Logger };

// The library takes recipients as comma-separated address lists; the comment is plain text
// (Graph forward comments carry no HTML, so no signature template here - keep it short).
const forwardParams = (request: ForwardApplyRequest): Record<string, string> => ({
  forwardMessageId: request.forwardMessageId,
  toRecipients: request.to.join(','),
  bodyContent: request.comment,
  ...(request.cc === undefined || request.cc.length === 0 ? {} : { ccRecipients: request.cc.join(',') }),
  ...(request.subject === undefined || request.subject === '' ? {} : { subject: request.subject }),
});

export const createForwardApply =
  (deps: Deps): ForwardApply =>
  async (request) => {
    // A forward with no recipient is not actionable - refuse before touching Graph (the command
    // would reject it too, but a client-side guard keeps the state clean and the reason clear).
    if (request.to.length === 0) return err({ kind: 'no-recipients', message: 'a forward needs at least one --to recipient' });
    const loaded = await deps.stateStore.load(request.runId);
    if (!loaded.ok) return err({ kind: 'state-store-failed', message: loaded.error.message });
    // The code approval gate (SPEC §15.1 consequence i): no draft - reply or forward - without approval.
    if (loaded.value.mode === 'pre-research') return err({ kind: 'not-approved', message: 'this is a pre-research run - resume it interactively before drafting' });
    if (loaded.value.emails[request.emailId] !== 'user_approved') return err({ kind: 'not-approved', message: `email ${request.emailId} is not user_approved` });
    const run = await deps.office.execute('create-forward-draft', forwardParams(request));
    if (!run.ok) return err({ kind: 'draft-failed', message: run.error.message });
    const draftId = extractDraftId(run.value);
    if (draftId === undefined) return err({ kind: 'draft-failed', message: 'create-forward-draft returned no draft id' });
    // The gate proved the from-state, so user_approved -> draft_created is valid by construction.
    const nextState: RunFile = { ...loaded.value, emails: { ...loaded.value.emails, [request.emailId]: 'draft_created' } };
    const saved = await deps.stateStore.save(request.runId, nextState);
    if (!saved.ok) return err({ kind: 'state-store-failed', message: saved.error.message });
    deps.logger.info('forward-applied', { emailId: request.emailId, draftId });
    return ok({ draftId });
  };
