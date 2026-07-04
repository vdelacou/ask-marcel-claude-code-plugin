import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createBunFileWriter } from './file-writer.ts';

describe('bun file writer', () => {
  test('the bun writer creates parent directories and writes the content', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'writer-'));
    const path = join(dir, 'kb', 'people', 'index.md');

    const result = await createBunFileWriter().write(path, '# People\n');

    expect(result).toEqual({ ok: true, value: undefined });
    expect(readFileSync(path, 'utf8')).toBe('# People\n');
  });

  test('a write into an unwritable location surfaces write-failed naming the path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'writer-'));
    chmodSync(dir, 0o555);
    const path = join(dir, 'blocked.md');

    const result = await createBunFileWriter().write(path, 'nope');

    chmodSync(dir, 0o755);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected err');
    expect(result.error.kind).toBe('write-failed');
    expect(result.error.path).toBe(path);
  });
});
