import { describe, expect, test } from 'bun:test';

import { loadConfig } from './config.ts';

describe('config', () => {
  test('config defaults the log level to info and honors LOG_LEVEL', () => {
    expect(loadConfig({})).toEqual({ logLevel: 'info' });
    expect(loadConfig({ LOG_LEVEL: 'debug' })).toEqual({ logLevel: 'debug' });
  });
});
