import { err, ok } from './result.ts';
import type { Result } from './result.ts';

export type EmailState =
  | 'scanned'
  | 'triaged'
  | 'approved'
  | 'skipped'
  | 'researched'
  | 'context_confirmed'
  | 'strategy_chosen'
  | 'drafted'
  | 'preflight_ok'
  | 'user_approved'
  | 'draft_created'
  | 'kb_captured'
  | 'done';

/** Per-run pipeline state: Graph email id → current gate (SPEC.md §2 state machine). */
export type RunState = Readonly<Partial<Record<string, EmailState>>>;

export type TransitionError =
  { readonly kind: 'unknown-email'; readonly emailId: string } | { readonly kind: 'invalid-transition'; readonly from: EmailState; readonly to: EmailState };

// Full Record, no Partial: every state names its exits, terminal states say so
// explicitly with [] — which also removes the unreachable `?? []` fallback.
const TRANSITIONS: Readonly<Record<EmailState, ReadonlyArray<EmailState>>> = {
  scanned: ['triaged'],
  triaged: ['approved', 'skipped'],
  approved: ['researched'],
  researched: ['context_confirmed'],
  context_confirmed: ['strategy_chosen'],
  strategy_chosen: ['drafted'],
  drafted: ['preflight_ok'],
  preflight_ok: ['user_approved'],
  user_approved: ['draft_created'],
  draft_created: ['kb_captured'],
  kb_captured: ['done'],
  skipped: [],
  done: [],
};

export const canTransition = (from: EmailState, to: EmailState): boolean => TRANSITIONS[from].includes(to);

export const isEmailState = (value: unknown): value is EmailState => typeof value === 'string' && value in TRANSITIONS;

export const isRunState = (value: unknown): value is RunState => typeof value === 'object' && value !== null && Object.values(value).every(isEmailState);

export const advanceEmail = (state: RunState, emailId: string, to: EmailState): Result<RunState, TransitionError> => {
  const from = state[emailId];
  if (from === undefined) return err({ kind: 'unknown-email', emailId });
  if (!canTransition(from, to)) return err({ kind: 'invalid-transition', from, to });
  return ok({ ...state, [emailId]: to });
};
