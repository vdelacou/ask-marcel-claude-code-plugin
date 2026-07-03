import type { RunState } from '../domain/email-state.ts';
import { err, ok } from '../domain/result.ts';
import type { RunId } from '../domain/run-id.ts';
import type { StateStore, StateStoreError } from '../use-cases/ports/state-store.ts';

export type StateStoreFake = StateStore & {
  /** In-memory view of a run's state, for assertions. */
  readonly snapshot: (runId: string) => RunState | undefined;
  /** Error-injection knob: make the next load or save fail with the given error. */
  readonly failWith: (op: 'load' | 'save', error: StateStoreError) => void;
  /** Number of load calls seen, to assert a rejected input never touched the store. */
  readonly reads: number;
};

export const createStateStoreFake = (seed: Readonly<Record<string, RunState>> = {}): StateStoreFake => {
  const runs = new Map<string, RunState>(Object.entries(seed));
  const failures: { load?: StateStoreError; save?: StateStoreError } = {};
  let reads = 0;

  return {
    get reads() {
      return reads;
    },
    snapshot: (runId) => runs.get(runId),
    failWith: (op, error) => {
      failures[op] = error;
    },
    load: async (runId: RunId) => {
      reads += 1;
      if (failures.load) return err(failures.load);
      const state = runs.get(runId);
      return state === undefined ? err({ kind: 'not-found', message: `no run ${runId}` }) : ok(state);
    },
    save: async (runId: RunId, state: RunState) => {
      if (failures.save) return err(failures.save);
      runs.set(runId, state);
      return ok(undefined);
    },
  };
};
