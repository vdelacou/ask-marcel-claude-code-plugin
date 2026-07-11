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
// researched -> skipped exists for the pre-research resume: a speculatively
// researched email the user deselects at Gate 1 discards its package (SPEC §2).
const TRANSITIONS: Readonly<Record<EmailState, ReadonlyArray<EmailState>>> = {
  scanned: ['triaged'],
  triaged: ['approved', 'skipped'],
  approved: ['researched', 'skipped'],
  researched: ['context_confirmed', 'skipped'],
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

// ——— Run-level machine (SPEC §2): init → context_loaded → …emails… → jargon_drained →
// user_md_reviewed → reindexed → wrapped. Emails move only inside the context_loaded window
// (design principle 6 made physical: nothing advances before user.md + jargon are read), and a
// pre-research run (SPEC §2 unattended mode) can never take an email past `researched` nor the
// run past `context_loaded` — drafting overnight is impossible by construction.

export type RunPhase = 'init' | 'context_loaded' | 'jargon_drained' | 'user_md_reviewed' | 'reindexed' | 'wrapped';

export type RunMode = 'interactive' | 'pre-research';

/** The persisted state.json document: the run's phase + mode + every email's gate. */
export type RunFile = { readonly mode: RunMode; readonly phase: RunPhase; readonly emails: RunState };

const RUN_TRANSITIONS: Readonly<Record<RunPhase, ReadonlyArray<RunPhase>>> = {
  init: ['context_loaded'],
  context_loaded: ['jargon_drained'],
  jargon_drained: ['user_md_reviewed'],
  user_md_reviewed: ['reindexed'],
  reindexed: ['wrapped'],
  wrapped: [],
};

const RUN_MODES: ReadonlyArray<RunMode> = ['interactive', 'pre-research'];

export const isRunPhase = (value: unknown): value is RunPhase => typeof value === 'string' && value in RUN_TRANSITIONS;

const isRunMode = (value: unknown): value is RunMode => typeof value === 'string' && RUN_MODES.includes(value as RunMode);

export const isRunFile = (value: unknown): value is RunFile =>
  typeof value === 'object' &&
  value !== null &&
  isRunMode((value as Record<string, unknown>)['mode']) &&
  isRunPhase((value as Record<string, unknown>)['phase']) &&
  isRunState((value as Record<string, unknown>)['emails']);

// A run-state file written before the run-level machine existed is a bare email map. Lift it:
// mode interactive (only interactive runs existed), phase context_loaded (its emails were
// already moving, which is only legal inside that window).
export const liftLegacyRunState = (value: unknown): RunFile | undefined => {
  if (isRunFile(value)) return value;
  if (isRunState(value)) return { mode: 'interactive', phase: 'context_loaded', emails: value };
  return undefined;
};

// Everything an email may still reach in a pre-research run: the Phase 0-3 states only.
const PRE_RESEARCH_REACHABLE: ReadonlyArray<EmailState> = ['scanned', 'triaged', 'approved', 'skipped', 'researched'];

export type RunGuardError =
  | { readonly kind: 'emails-frozen'; readonly phase: RunPhase; readonly message: string }
  | { readonly kind: 'pre-research-cap'; readonly message: string }
  | { readonly kind: 'invalid-run-transition'; readonly from: RunPhase; readonly to: RunPhase }
  | { readonly kind: 'emails-not-terminal'; readonly message: string }
  | { readonly kind: 'queue-not-empty'; readonly message: string };

/** Advance one email inside a run, enforcing the run-level window and the pre-research cap. */
export const advanceEmailInRun = (run: RunFile, emailId: string, to: EmailState): Result<RunFile, TransitionError | RunGuardError> => {
  if (run.phase === 'init')
    return err({ kind: 'emails-frozen', phase: run.phase, message: 'run is init - read user.md + jargon, then advance-run context_loaded first (SPEC principle 6)' });
  if (run.phase !== 'context_loaded') return err({ kind: 'emails-frozen', phase: run.phase, message: `run is ${run.phase} - emails no longer move once wrap-up has begun` });
  if (run.mode === 'pre-research' && !PRE_RESEARCH_REACHABLE.includes(to)) {
    return err({ kind: 'pre-research-cap', message: `a pre-research run cannot take an email to ${to} (cap: researched); resume the run interactively first` });
  }
  const advanced = advanceEmail(run.emails, emailId, to);
  return advanced.ok ? ok({ ...run, emails: advanced.value }) : err(advanced.error);
};

const isTerminal = (state: EmailState): boolean => state === 'done' || state === 'skipped';

/** Advance the run phase. Wrap-up needs every email terminal; `wrapped` also needs an empty KB queue. */
export const advanceRunPhase = (run: RunFile, to: RunPhase, gate: { readonly queueEmpty: boolean }): Result<RunFile, RunGuardError> => {
  if (!RUN_TRANSITIONS[run.phase].includes(to)) return err({ kind: 'invalid-run-transition', from: run.phase, to });
  // A pre-research run still loads its context (init → context_loaded) but never wraps.
  if (run.mode === 'pre-research' && to !== 'context_loaded')
    return err({ kind: 'pre-research-cap', message: `a pre-research run stops at context_loaded/researched; resume it interactively to ${to}` });
  const emails = Object.values(run.emails).filter((state): state is EmailState => state !== undefined);
  if (to === 'jargon_drained' && !emails.every(isTerminal)) {
    return err({ kind: 'emails-not-terminal', message: 'wrap-up cannot start while an email is neither done nor skipped' });
  }
  if (to === 'wrapped' && !gate.queueEmpty) return err({ kind: 'queue-not-empty', message: 'the KB queue still holds undrained candidates - drain it before wrapping (SPEC §2)' });
  return ok({ ...run, phase: to });
};

/** The interactive session resuming a pre-research run lifts its restrictions (SPEC §2). */
export const resumeRun = (run: RunFile): RunFile => ({ ...run, mode: 'interactive' });
