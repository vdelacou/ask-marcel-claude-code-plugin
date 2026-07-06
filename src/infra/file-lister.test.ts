import { describe, expect, test } from 'bun:test';

import { createBunFileLister, createFileListerFromScan } from './file-lister.ts';
import type { ScanApi } from './file-lister.ts';

const scanOf = (paths: ReadonlyArray<string>): ScanApi =>
  async function* () {
    yield* paths;
  };

describe('file lister', () => {
  test('collects the scanned paths and returns them sorted', async () => {
    const lister = createFileListerFromScan(scanOf(['data/kb/people/marc.md', 'data/kb/log.md', 'data/kb/people/jane.md']));

    expect(await lister.list('data/kb/**/*.md')).toEqual({ ok: true, value: ['data/kb/log.md', 'data/kb/people/jane.md', 'data/kb/people/marc.md'] });
  });

  test('a scan that throws surfaces as a typed list-failed error', async () => {
    const throwing: ScanApi = async function* () {
      yield 'one';
      throw new Error('permission denied');
    };
    const result = await createFileListerFromScan(throwing).list('**/*.md');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('list-failed');
      expect(result.error.message).toContain('permission denied');
    }
  });
});

describe('createBunFileLister (production wiring smoke)', () => {
  test('scans the working directory with a real glob and returns matching files', async () => {
    // globs the source tree (present under cwd in every environment) rather than the gitignored data/kb
    const result = await createBunFileLister().list('src/infra/*.ts');
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.includes('src/infra/file-lister.ts')).toBe(true);
  });
});
