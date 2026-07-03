import { describe, expect, test } from 'bun:test';

import type { EmailState, RunState } from '../domain/email-state.ts';
import type { Result } from '../domain/result.ts';
import { createLoggerFake } from '../test-helpers/logger-fake.ts';
import type { LoggerFake } from '../test-helpers/logger-fake.ts';
import { createStateStoreFake } from '../test-helpers/state-store-fake.ts';
import type { StateStoreFake } from '../test-helpers/state-store-fake.ts';
import { createAdvanceEmailState } from './advance-email-state.ts';
import type { AdvanceEmailState } from './advance-email-state.ts';

const RUN = 'run-20260703-am';

type Setup = { readonly advance: AdvanceEmailState; readonly stateStore: StateStoreFake; readonly logger: LoggerFake };

const setup = (emails: RunState): Setup => {
  const stateStore = createStateStoreFake({ [RUN]: emails });
  const logger = createLoggerFake();
  return { advance: createAdvanceEmailState({ stateStore, logger }), stateStore, logger };
};

const expectErr: <T, E>(result: Result<T, E>) => asserts result is { readonly ok: false; readonly error: E } = (result) => {
  expect(result.ok).toBe(false);
};

describe('advance-email-state', () => {
  test('an email triaged as needing a reply is approved at Gate 1 and the run remembers it', async () => {
    const { advance, stateStore, logger } = setup({ 'msg-1': 'triaged' });

    const result = await advance(RUN, 'msg-1', 'approved');

    expect(result).toEqual({ ok: true, value: 'approved' });
    expect(stateStore.snapshot(RUN)?.['msg-1']).toBe('approved');
    expect(logger.calls).toEqual([{ level: 'info', event: 'email-state-advanced', meta: { emailId: 'msg-1', to: 'approved' } }]);
  });

  test('an email the user unchecks at Gate 1 is skipped, and a skipped email never re-enters the pipeline', async () => {
    const { advance } = setup({ 'msg-1': 'triaged' });

    expect(await advance(RUN, 'msg-1', 'skipped')).toEqual({ ok: true, value: 'skipped' });

    const revived = await advance(RUN, 'msg-1', 'researched');
    expectErr(revived);
    expect(revived.error).toMatchObject({ kind: 'transition', error: { kind: 'invalid-transition', from: 'skipped', to: 'researched' } });
  });

  test('an email cannot get its Outlook draft before the user approved the text', async () => {
    const { advance, stateStore } = setup({ 'msg-1': 'preflight_ok' });

    const result = await advance(RUN, 'msg-1', 'draft_created');

    expectErr(result);
    expect(result.error).toMatchObject({ kind: 'transition', error: { kind: 'invalid-transition', from: 'preflight_ok', to: 'draft_created' } });
    expect(stateStore.snapshot(RUN)?.['msg-1']).toBe('preflight_ok');
  });

  test('every approved reply walks the full gate ladder to done, one legal step at a time', async () => {
    const { advance } = setup({ 'msg-1': 'scanned' });
    const ladder: ReadonlyArray<EmailState> = [
      'triaged',
      'approved',
      'researched',
      'context_confirmed',
      'strategy_chosen',
      'drafted',
      'preflight_ok',
      'user_approved',
      'draft_created',
      'kb_captured',
      'done',
    ];

    for (const step of ladder) {
      expect(await advance(RUN, 'msg-1', step)).toEqual({ ok: true, value: step });
    }
  });

  test('a run id that tries to escape the scratch directory is rejected before any state is touched', async () => {
    const { advance, stateStore } = setup({});

    const result = await advance('../../etc', 'msg-1', 'triaged');

    expectErr(result);
    expect(result.error).toEqual({ kind: 'invalid-run-id', message: 'invalid RunId: "../../etc"' });
    expect(stateStore.reads).toBe(0);

    const slashed = await advance('abc/def', 'msg-1', 'triaged');
    expectErr(slashed);
    expect(slashed.error).toMatchObject({ kind: 'invalid-run-id' });
  });

  test('advancing an email the scan never saw fails loudly instead of inventing state', async () => {
    const { advance } = setup({});

    const result = await advance(RUN, 'msg-ghost', 'triaged');

    expectErr(result);
    expect(result.error).toMatchObject({ kind: 'transition', error: { kind: 'unknown-email', emailId: 'msg-ghost' } });
  });

  test('a state store read failure surfaces as a store error, never a crash', async () => {
    const { advance, stateStore } = setup({ 'msg-1': 'triaged' });
    stateStore.failWith('load', { kind: 'io', message: 'disk full' });

    const result = await advance(RUN, 'msg-1', 'approved');

    expect(result).toEqual({ ok: false, error: { kind: 'store', message: 'disk full' } });
  });

  test('a state store write failure surfaces as a store error and the transition is not reported as done', async () => {
    const { advance, stateStore } = setup({ 'msg-1': 'triaged' });
    stateStore.failWith('save', { kind: 'io', message: 'read-only volume' });

    const result = await advance(RUN, 'msg-1', 'approved');

    expect(result).toEqual({ ok: false, error: { kind: 'store', message: 'read-only volume' } });
  });
});
