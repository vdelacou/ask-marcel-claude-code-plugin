import { describe, expect, test } from 'bun:test';

import { createLoggerFake } from '../test-helpers/logger-fake.ts';
import { createStateStoreFake } from '../test-helpers/state-store-fake.ts';
import { createRegisterEmailState } from './register-email.ts';

const RUN = 'run-20260713-070000';

type Setup = {
  readonly register: ReturnType<typeof createRegisterEmailState>;
  readonly stateStore: ReturnType<typeof createStateStoreFake>;
  readonly logger: ReturnType<typeof createLoggerFake>;
};

const setup = (): Setup => {
  const stateStore = createStateStoreFake({ [RUN]: { mode: 'interactive', phase: 'context_loaded', emails: { m1: 'approved' } } });
  const logger = createLoggerFake();
  return { register: createRegisterEmailState({ stateStore, logger }), stateStore, logger };
};

describe('register-email', () => {
  test('a resurfaced deferral registers at scanned and walks the normal ladder from there', async () => {
    const { register, stateStore, logger } = setup();

    expect(await register(RUN, 'm-deferred')).toEqual({ ok: true, value: 'scanned' });
    expect(stateStore.snapshot(RUN)?.emails).toEqual({ m1: 'approved', 'm-deferred': 'scanned' });
    expect(logger.calls).toEqual([{ level: 'info', event: 'email-registered', meta: { runId: RUN, emailId: 'm-deferred' } }]);
  });

  test('an email the run already tracks is refused - registration never resets a position', async () => {
    const { register, stateStore } = setup();

    expect(await register(RUN, 'm1')).toEqual({ ok: false, error: { kind: 'register', error: { kind: 'already-registered', emailId: 'm1' } } });
    expect(stateStore.snapshot(RUN)?.emails['m1']).toBe('approved');
  });

  test('an invalid run id is rejected before the store is touched, and store failures surface typed', async () => {
    const { register, stateStore } = setup();

    expect(await register('../escape', 'm2')).toEqual({ ok: false, error: { kind: 'invalid-run-id', message: 'invalid RunId: "../escape"' } });
    expect(stateStore.reads).toBe(0);

    stateStore.failWith('load', { kind: 'io', message: 'disk full' });
    expect(await register(RUN, 'm2')).toEqual({ ok: false, error: { kind: 'store', message: 'disk full' } });
  });

  test('a state save failure surfaces typed and the registration is not reported done', async () => {
    const { register, stateStore } = setup();
    stateStore.failWith('save', { kind: 'io', message: 'read-only' });

    expect(await register(RUN, 'm2')).toEqual({ ok: false, error: { kind: 'store', message: 'read-only' } });
  });
});
