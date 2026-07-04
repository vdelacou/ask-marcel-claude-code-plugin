import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createBunFileProbe } from './file-probe.ts';

describe('bun file probe', () => {
  test('an existing file probes true', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-'));
    writeFileSync(join(dir, 'index.md'), '# hello');

    expect(await createBunFileProbe().exists(join(dir, 'index.md'))).toBe(true);
  });

  test('a missing path probes false', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-'));

    expect(await createBunFileProbe().exists(join(dir, 'nope.md'))).toBe(false);
  });
});
