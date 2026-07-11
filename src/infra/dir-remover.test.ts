import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createBunDirRemover, createDirRemoverFromRm } from './dir-remover.ts';

describe('dir remover', () => {
  test('a directory with content is removed recursively, and removing it again is a no-op success', async () => {
    const base = mkdtempSync(join(tmpdir(), 'sweep-'));
    const runDir = join(base, 'run-20260601-070000');
    mkdirSync(join(runDir, 'bundle'), { recursive: true });
    writeFileSync(join(runDir, 'bundle', 'a.md'), 'x');

    const remover = createBunDirRemover();

    expect(await remover.remove(runDir)).toEqual({ ok: true, value: undefined });
    expect(existsSync(runDir)).toBe(false);
    // force:true — a second remove of the now-missing path stays a success (idempotent sweep)
    expect(await remover.remove(runDir)).toEqual({ ok: true, value: undefined });
  });

  test('a removal that throws surfaces as a typed remove-failed error naming the path', async () => {
    const remover = createDirRemoverFromRm(async () => {
      throw new Error('EBUSY: resource busy');
    });

    expect(await remover.remove('data/scratch/run-x')).toEqual({ ok: false, error: { kind: 'remove-failed', path: 'data/scratch/run-x', message: 'EBUSY: resource busy' } });
  });
});
