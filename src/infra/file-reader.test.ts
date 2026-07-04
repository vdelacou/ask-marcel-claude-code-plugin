import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createBunFileReader } from './file-reader.ts';

describe('bun file reader', () => {
  test('reads a real file back', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reader-'));
    writeFileSync(join(dir, 'log.md'), '# Log\n');

    const result = await createBunFileReader().read(join(dir, 'log.md'));

    expect(result).toEqual({ ok: true, value: '# Log\n' });
  });

  test('a missing file surfaces read-failed naming the path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reader-'));
    const path = join(dir, 'nope.md');

    const result = await createBunFileReader().read(path);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected err');
    expect(result.error.kind).toBe('read-failed');
    expect(result.error.path).toBe(path);
  });
});
