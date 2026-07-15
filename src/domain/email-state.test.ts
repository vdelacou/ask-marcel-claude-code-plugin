import { describe, expect, test } from 'bun:test';

import { advanceEmailInRun, advanceRunPhase, isRunFile, isRunPhase, liftLegacyRunState, resumeRun } from './email-state.ts';
import type { EmailState, RunFile } from './email-state.ts';

// The per-email ladder is exercised classicist-style through advance-email-state.test.ts;
// this file pins the run-level machine's guards, messages, and file-shape recognition.

const run = (overrides: Partial<RunFile> = {}): RunFile => ({ mode: 'interactive', phase: 'context_loaded', emails: { m1: 'triaged' }, ...overrides });

describe('run file shape', () => {
  test('isRunPhase accepts every phase and rejects everything else', () => {
    for (const phase of ['init', 'context_loaded', 'jargon_drained', 'user_md_reviewed', 'reindexed', 'wrapped']) expect(isRunPhase(phase)).toBe(true);
    expect(isRunPhase('emails')).toBe(false);
    expect(isRunPhase(42)).toBe(false);
  });

  test('isRunFile recognizes both modes and rejects a bad mode, phase, or emails map', () => {
    expect(isRunFile(run())).toBe(true);
    expect(isRunFile(run({ mode: 'pre-research' }))).toBe(true);
    expect(isRunFile({ mode: 'overnight', phase: 'init', emails: {} })).toBe(false);
    expect(isRunFile({ mode: 'interactive', phase: 'later', emails: {} })).toBe(false);
    expect(isRunFile({ mode: 'interactive', phase: 'init', emails: { m1: 'not-a-state' } })).toBe(false);
    expect(isRunFile(null)).toBe(false);
  });

  test('liftLegacyRunState passes a RunFile through untouched and lifts a bare email map', () => {
    const preResearch = run({ mode: 'pre-research', phase: 'init' });
    expect(liftLegacyRunState(preResearch)).toBe(preResearch);
    expect(liftLegacyRunState({ m1: 'approved' })).toEqual({ mode: 'interactive', phase: 'context_loaded', emails: { m1: 'approved' } });
    expect(liftLegacyRunState('garbage')).toBeUndefined();
  });
});

describe('advanceEmailInRun guards', () => {
  test('the init freeze names what to do, and it is a distinct message from the wrap freeze', () => {
    const atInit = advanceEmailInRun(run({ phase: 'init' }), 'm1', 'approved');
    expect(atInit).toEqual({
      ok: false,
      error: { kind: 'emails-frozen', phase: 'init', message: 'run is init - read user.md + jargon, then advance-run context_loaded first (SPEC principle 6)' },
    });

    const atWrap = advanceEmailInRun(run({ phase: 'user_md_reviewed', emails: { m1: 'done' } }), 'm1', 'done');
    expect(atWrap).toEqual({
      ok: false,
      error: { kind: 'emails-frozen', phase: 'user_md_reviewed', message: 'run is user_md_reviewed - emails no longer move once wrap-up has begun' },
    });
  });

  test('a pre-research run reaches every Phase 0-3 state and is refused every drafting state, by name', () => {
    const allowed: ReadonlyArray<readonly [EmailState, EmailState]> = [
      ['scanned', 'triaged'],
      ['triaged', 'approved'],
      ['triaged', 'skipped'],
      ['approved', 'researched'],
    ];
    for (const [from, to] of allowed) {
      expect(advanceEmailInRun(run({ mode: 'pre-research', emails: { m1: from } }), 'm1', to)).toEqual({ ok: true, value: run({ mode: 'pre-research', emails: { m1: to } }) });
    }

    const blocked = advanceEmailInRun(run({ mode: 'pre-research', emails: { m1: 'researched' } }), 'm1', 'context_confirmed');
    expect(blocked).toEqual({
      ok: false,
      error: { kind: 'pre-research-cap', message: 'a pre-research run cannot take an email to context_confirmed (cap: researched); resume the run interactively first' },
    });
  });
});

describe('advanceRunPhase guards', () => {
  test('only wrapped consults the queue gate - jargon_drained proceeds even while candidates are queued', () => {
    const terminal = run({ emails: { m1: 'done', m2: 'skipped' } });
    expect(advanceRunPhase(terminal, 'jargon_drained', { queueRemaining: 3 })).toEqual({ ok: true, value: { ...terminal, phase: 'jargon_drained' } });

    const atReindexed = run({ phase: 'reindexed', emails: { m1: 'done' } });
    expect(advanceRunPhase(atReindexed, 'wrapped', { queueRemaining: 3 })).toEqual({
      ok: false,
      error: { kind: 'queue-not-empty', message: '3 undrained candidate(s) remain in the KB queue - drain or discard before wrapping (SPEC §2)' },
    });
    expect(advanceRunPhase(atReindexed, 'wrapped', { queueRemaining: 0 })).toEqual({ ok: true, value: { ...atReindexed, phase: 'wrapped' } });
    expect(advanceRunPhase(atReindexed, 'wrapped', { queueRemaining: 'unreadable' })).toEqual({
      ok: false,
      error: { kind: 'queue-not-empty', message: 'the KB queue could not be read - drain or discard before wrapping (SPEC §2)' },
    });
  });

  test('the terminality gate belongs to jargon_drained alone, with its exact message', () => {
    expect(advanceRunPhase(run({ emails: { m1: 'researched' } }), 'jargon_drained', { queueRemaining: 0 })).toEqual({
      ok: false,
      error: { kind: 'emails-not-terminal', message: 'wrap-up cannot start while an email is neither done nor skipped' },
    });
    // init -> context_loaded never checks terminality, whatever the emails hold
    expect(advanceRunPhase(run({ phase: 'init', emails: { m1: 'scanned' } }), 'context_loaded', { queueRemaining: 0 })).toEqual({
      ok: true,
      value: run({ phase: 'context_loaded', emails: { m1: 'scanned' } }),
    });
  });

  test('the pre-research cap names the refused phase and spares only context_loaded', () => {
    expect(advanceRunPhase(run({ mode: 'pre-research', phase: 'init', emails: {} }), 'context_loaded', { queueRemaining: 0 })).toEqual({
      ok: true,
      value: run({ mode: 'pre-research', phase: 'context_loaded', emails: {} }),
    });
    expect(advanceRunPhase(run({ mode: 'pre-research', emails: { m1: 'skipped' } }), 'jargon_drained', { queueRemaining: 0 })).toEqual({
      ok: false,
      error: { kind: 'pre-research-cap', message: 'a pre-research run stops at context_loaded/researched; resume it interactively to jargon_drained' },
    });
  });

  test('resume flips ONLY the mode - phase and emails ride along untouched', () => {
    const preResearch = run({ mode: 'pre-research', emails: { m1: 'researched', m2: 'skipped' } });
    expect(resumeRun(preResearch)).toEqual({ mode: 'interactive', phase: 'context_loaded', emails: { m1: 'researched', m2: 'skipped' } });
  });
});
