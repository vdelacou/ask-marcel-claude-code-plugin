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

// Full Record, no Partial: every state names its exits, the one terminal state
// (`done`) says so explicitly with [] — which removes the unreachable `?? []`.
// Gate 1 is correctable: a wrong approve rewinds to skipped, and a wrong skip
// rewinds to triaged, so a transposition is fixable through advanceEmail alone
// (no hand-edited state.json). A skipped email still cannot jump the gates
// (skipped -> researched stays illegal); only `done` is a dead end.
const TRANSITIONS: Readonly<Record<EmailState, ReadonlyArray<EmailState>>> = {
  scanned: ['triaged'],
  triaged: ['approved', 'skipped'],
  approved: ['researched', 'skipped'],
  researched: ['context_confirmed'],
  context_confirmed: ['strategy_chosen'],
  strategy_chosen: ['drafted'],
  drafted: ['preflight_ok'],
  preflight_ok: ['user_approved'],
  user_approved: ['draft_created'],
  draft_created: ['kb_captured'],
  kb_captured: ['done'],
  skipped: ['triaged'],
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
