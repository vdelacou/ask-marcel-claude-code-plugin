import { describe, expect, test } from 'bun:test';

import { createBunCommandRunner, createCommandRunnerFromSpawn } from './command-runner.ts';
import type { SpawnApi } from './command-runner.ts';

const streamOf = (text: string): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });

describe('bun command runner', () => {
  test('a successful command returns its stdout and exit code', async () => {
    const spawn: SpawnApi = () => ({ exited: Promise.resolve(0), stdout: streamOf('2.6.0\n') });
    const runner = createCommandRunnerFromSpawn(spawn);

    const result = await runner.run('qmd', ['--version']);

    expect(result).toEqual({ ok: true, value: { stdout: '2.6.0', exitCode: 0 } });
  });

  test('a missing binary maps to not-found', async () => {
    const spawn: SpawnApi = () => {
      throw Object.assign(new Error('spawn qmd ENOENT'), { code: 'ENOENT' });
    };
    const runner = createCommandRunnerFromSpawn(spawn);

    const result = await runner.run('qmd', ['--version']);

    expect(result).toEqual({ ok: false, error: { kind: 'not-found', message: 'spawn qmd ENOENT' } });
  });

  test('any other spawn explosion maps to spawn-failed', async () => {
    const spawn: SpawnApi = () => {
      throw new Error('EPERM: operation not permitted');
    };
    const runner = createCommandRunnerFromSpawn(spawn);

    const result = await runner.run('qmd', ['--version']);

    expect(result).toEqual({ ok: false, error: { kind: 'spawn-failed', message: 'EPERM: operation not permitted' } });
  });

  test('the production wiring runs a real echo', async () => {
    const result = await createBunCommandRunner().run('echo', ['hi']);

    expect(result).toEqual({ ok: true, value: { stdout: 'hi', exitCode: 0 } });
  });

  test('the production wiring maps a real missing binary to not-found', async () => {
    const result = await createBunCommandRunner().run('definitely-not-a-real-binary-xyz', []);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected err');
    expect(result.error.kind).toBe('not-found');
  });
});
