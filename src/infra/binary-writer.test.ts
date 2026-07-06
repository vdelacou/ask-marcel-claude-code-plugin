import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createBunBinaryWriter } from './binary-writer.ts';

describe('bun binary writer', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'binary-writer-'));
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  test('writes raw bytes to disk exactly, creating any missing parent directories', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const path = join(tmp, 'images', 'chart.png');

    const result = await createBunBinaryWriter().write(path, bytes);

    expect(result).toEqual({ ok: true, value: undefined });
    expect([...readFileSync(path)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  });

  test('a write into a read-only directory surfaces as a typed write-failed error', async () => {
    chmodSync(tmp, 0o500);
    try {
      const result = await createBunBinaryWriter().write(join(tmp, 'blocked.png'), new Uint8Array([1, 2, 3]));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('write-failed');
        expect(result.error.path).toBe(join(tmp, 'blocked.png'));
      }
    } finally {
      chmodSync(tmp, 0o700);
    }
  });
});
