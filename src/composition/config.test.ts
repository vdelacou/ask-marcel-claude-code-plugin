import { describe, expect, test } from 'bun:test';

import { loadConfig } from './config.ts';

describe('config', () => {
  test('config defaults the log level to info and honors LOG_LEVEL', () => {
    expect(loadConfig({})).toEqual({ logLevel: 'info', seed: { relevantTop: 15, pageCap: 40 } });
    expect(loadConfig({ LOG_LEVEL: 'debug' })).toEqual({ logLevel: 'debug', seed: { relevantTop: 15, pageCap: 40 } });
  });
});
