import { describe, expect, test } from 'bun:test';

import { buildDeps } from './build-deps.ts';

describe('composition root', () => {
  test('the composition root builds a complete deps record', () => {
    const deps = buildDeps({ logLevel: 'error', seed: { relevantTop: 15, pageCap: 40 }, voice: { fetchTop: 100, keep: 50 } });

    expect(typeof deps.runner.run).toBe('function');
    expect(typeof deps.files.exists).toBe('function');
    expect(typeof deps.reader.read).toBe('function');
    expect(typeof deps.writer.write).toBe('function');
    expect(typeof deps.stateStore.load).toBe('function');
    expect(typeof deps.clock.todayIso).toBe('function');
    expect(typeof deps.logger.info).toBe('function');
  });
});
