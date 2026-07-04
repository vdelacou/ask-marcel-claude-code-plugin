import { err, ok } from '../domain/result.ts';
import { formatError } from '../domain/utilities/format-error.ts';
import type { CommandRunner } from '../use-cases/ports/command-runner.ts';

/**
 * Minimal slice of Bun.spawn's real surface. The test seam sits on the SDK
 * side (rule 13): tests inject a fake SpawnApi, production passes Bun.spawn.
 */
export type SpawnApi = (cmd: ReadonlyArray<string>) => {
  readonly exited: Promise<number>;
  readonly stdout: ReadableStream<Uint8Array>;
};

const isNotFound = (thrown: unknown): boolean => thrown instanceof Error && 'code' in thrown && thrown.code === 'ENOENT';

export const createCommandRunnerFromSpawn = (spawn: SpawnApi): CommandRunner => ({
  run: async (cmd, args) => {
    try {
      const proc = spawn([cmd, ...args]);
      const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
      return ok({ stdout: stdout.trim(), exitCode });
    } catch (thrown) {
      const message = formatError(thrown);
      return isNotFound(thrown) ? err({ kind: 'not-found', message }) : err({ kind: 'spawn-failed', message });
    }
  },
});

export const createBunCommandRunner = (): CommandRunner => createCommandRunnerFromSpawn((cmd) => Bun.spawn([...cmd], { stdout: 'pipe', stderr: 'ignore' }));
