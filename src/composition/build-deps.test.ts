import { describe, expect, test } from 'bun:test';

import { buildDeps } from './build-deps.ts';

describe('composition root', () => {
  test('the composition root builds a complete deps record', () => {
    const deps = buildDeps({ logLevel: 'error' });

    expect(typeof deps.runner.run).toBe('function');
    expect(typeof deps.files.exists).toBe('function');
    expect(typeof deps.logger.info).toBe('function');
  });
});
