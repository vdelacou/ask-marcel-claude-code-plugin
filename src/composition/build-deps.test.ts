import { describe, expect, test } from 'bun:test';

import { buildDeps } from './build-deps.ts';
import { loadConfig } from './config.ts';

describe('composition root', () => {
  test('the composition root builds a complete deps record', () => {
    const deps = buildDeps({ ...loadConfig({}), logLevel: 'error' });

    expect(typeof deps.office.execute).toBe('function');
    expect(typeof deps.runner.run).toBe('function');
    expect(typeof deps.files.exists).toBe('function');
    expect(typeof deps.reader.read).toBe('function');
    expect(typeof deps.writer.write).toBe('function');
    expect(typeof deps.binaryWriter.write).toBe('function');
    expect(typeof deps.lister.list).toBe('function');
    expect(typeof deps.remover.remove).toBe('function');
    expect(typeof deps.stateStore.load).toBe('function');
    expect(typeof deps.clock.todayIso).toBe('function');
    expect(typeof deps.logger.info).toBe('function');
  });
});
