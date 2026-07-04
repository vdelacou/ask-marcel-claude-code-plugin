import { isRunState } from '../domain/email-state.ts';
import { err, ok } from '../domain/result.ts';
import type { RunId } from '../domain/run-id.ts';
import { formatError } from '../domain/utilities/format-error.ts';
import type { StateStore } from '../use-cases/ports/state-store.ts';

export const createFileStateStore = (baseDir: string): StateStore => {
  const pathOf = (runId: RunId): string => `${baseDir}/scratch/${runId}/state.json`;
  return {
    load: async (runId) => {
      const path = pathOf(runId);
      const file = Bun.file(path);
      if (!(await file.exists())) return err({ kind: 'not-found', message: `no run state at ${path}` });
      try {
        const parsed: unknown = JSON.parse(await file.text());
        if (!isRunState(parsed)) return err({ kind: 'io', message: `${path}: not a valid run state` });
        return ok(parsed);
      } catch (thrown) {
        return err({ kind: 'io', message: `${path}: ${formatError(thrown)}` });
      }
    },
    save: async (runId, state) => {
      try {
        await Bun.write(pathOf(runId), JSON.stringify(state, null, 2));
        return ok(undefined);
      } catch (thrown) {
        return err({ kind: 'io', message: `${pathOf(runId)}: ${formatError(thrown)}` });
      }
    },
  };
};
